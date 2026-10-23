"""Offline deferred-profile priority, persistence and privacy checks."""
import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from core_backend import Core, Job, Ollama, now, uid
from test_core_backend import Memory, Model, TEST_ROOT, wait_until


class Voice:
    def __init__(self):
        self.tts = self.asr = False

    def activity_status(self):
        return {"tts": {"busy": self.tts}, "asr": {"busy": self.asr}}

    def close(self):
        pass


class Extractor(Model):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.facts = [{"category": "preference", "evidence": "我喜欢蓝色"}]
        self.raise_error = False

    def extract(self, model, text):
        self.calls.append((model, text))
        if self.raise_error:
            raise OSError("offline local model")
        return self.facts


class CancellableExtractor(Ollama):
    """Exercise the real adapter's cancellation contract without a connection."""
    def __init__(self):
        self.calls = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.cancelled = threading.Event()
        self.active = self.maximum_active = 0

    def extract(self, model, text, job=None):
        self.calls.append((model, text))
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.started.set()
        try:
            while not self.release.wait(0.005):
                if job.cancelled.is_set():
                    self.cancelled.set()
                    raise InterruptedError("cancelled offline extraction")
            if job.cancelled.is_set():
                self.cancelled.set()
                raise InterruptedError("cancelled offline extraction")
            return [{"category": "preference", "evidence": "我喜欢蓝色"}]
        finally:
            self.active -= 1


class FactSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.timing = patch.multiple(Core, FACT_IDLE_GRACE=0.055, FACT_POLL_SECONDS=0.008, FACT_RETRY_SECONDS=5)
        self.timing.start()
        self.temp = tempfile.TemporaryDirectory(prefix="fact-scheduler-", dir=TEST_ROOT)
        self.path = Path(self.temp.name)
        (self.path / "resource-settings.json").write_text(json.dumps({"preset": "low_memory"}), encoding="utf-8")
        self.memory, self.model, self.voice = Memory(), Extractor(), Voice()
        self.cores = []
        self.core = self.new_core()

    def tearDown(self):
        if isinstance(self.model, CancellableExtractor):
            self.model.release.set()
        for core in self.cores:
            core.shutdown()
            core.resources().hardware.assert_not_called()
            core.db.close()
        self.temp.cleanup()
        self.timing.stop()

    def new_core(self):
        core = Core(self.path, memory=self.memory, ollama=self.model, voice=self.voice)
        # A scheduling decision must never need a system/GPU probe.
        core.resources().snapshotter = lambda: self.fail("scheduler probed hardware")
        core.resources().hardware = Mock(side_effect=AssertionError("scheduler probed hardware"))
        self.cores.append(core)
        return core

    def completed(self, text="我喜欢蓝色", mode="daily"):
        conversation = self.core.dispatch("conversation.create", {"mode": mode})
        message = {"id": uid(), "role": "user", "content": text, "created_at": now(), "status": "completed",
                   "privacy": "private" if mode == "private" else "shared", "memory_hold": 0}
        job = Job(conversation["id"], message)
        job.done = True
        with self.core.lock:
            self.core.db.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)",
                                 (message["id"], conversation["id"], "user", text, message["created_at"], "completed"))
            self.core.db.execute("INSERT INTO message_privacy VALUES (?,?,0,NULL)", (message["id"], message["privacy"]))
            self.core.db.commit()
            self.core.jobs[job.id] = job
        return job, conversation

    def pending(self, core=None):
        core = core or self.core
        with core.lock:
            return [dict(row) for row in core.db.execute("SELECT * FROM fact_extraction_queue")]

    def finished(self, job):
        wait_until(lambda: any(event["type"] == "memory" and event["status"] == "completed" for event in job.events))
        wait_until(lambda: not self.pending())

    def test_queue_stores_only_existing_reference_and_never_claims_saved(self):
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        queued = self.pending()
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["message_id"], job.user_message["id"])
        self.assertEqual(queued[0]["captured_mode"], "daily")
        self.assertNotIn(job.user_message["content"], json.dumps(queued, ensure_ascii=False))
        self.assertEqual(set(queued[0]), {"message_id", "captured_mode", "enqueued_at", "retry_after", "attempts"})
        self.assertEqual(self.model.calls, [])
        self.assertEqual(self.memory.items, [])
        self.assertEqual(job.events[-1]["status"], "pending")
        self.assertTrue(job.events[-1]["memory_pending"])
        self.assertEqual(job.events[-1]["memories"], [])

    def test_waits_for_tts_asr_leases_and_continuous_then_saves_once(self):
        self.voice.tts = True
        job, conversation = self.completed()
        resources = self.core.resources()
        resources.set_continuous(True)
        lease = resources.begin("work", owner="offline-test")
        self.core.schedule_facts(job, conversation)
        time.sleep(0.09)
        self.voice.tts, self.voice.asr = False, True
        resources.set_continuous(False)
        resources.end(lease)
        time.sleep(0.09)
        self.assertEqual(self.model.calls, [])
        self.voice.asr = False
        self.finished(job)
        self.assertEqual(len(self.model.calls), 1)
        self.assertEqual(len(self.memory.items), 1)
        self.assertEqual(self.memory.items[0]["scope"], "shared")

    def test_grace_restarts_when_new_speech_arrives_and_cancel_removes_reference(self):
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        time.sleep(0.025)
        self.voice.tts = True
        time.sleep(0.055)
        self.assertEqual(self.model.calls, [])
        job.cancelled.set()
        wait_until(lambda: not self.pending())
        self.voice.tts = False
        time.sleep(0.07)
        self.assertEqual(self.model.calls, [])
        self.assertEqual(job.events[-1]["status"], "cancelled")

    def test_balanced_retains_immediate_extraction_even_when_voice_busy(self):
        self.core.resources().save_settings({"preset": "balanced"})
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.finished(job)
        self.assertEqual(len(self.model.calls), 1)
        self.assertIsNone(self.core._fact_worker)

    def test_restart_resumes_reference_with_captured_private_mode_after_switch(self):
        self.voice.tts = True
        text = "我的保险箱里有一封信"
        self.model.facts = [{"category": "private_fact", "evidence": text}]
        job, conversation = self.completed(text, "private")
        self.core.schedule_facts(job, conversation)
        self.core.dispatch("conversation.set_mode", {"id": conversation["id"], "mode": "daily"})
        self.core.shutdown()
        self.core.db.close()
        self.cores.remove(self.core)
        self.voice.tts = False
        resumed = self.new_core()
        self.core = resumed
        wait_until(lambda: len(self.memory.items) == 1)
        wait_until(lambda: not self.pending())
        self.assertEqual(self.memory.items[0]["scope"], "private")
        self.assertEqual(self.model.calls, [("qwen3.5:9b", text)])

    def test_delete_cascades_pending_queue_and_never_extracts(self):
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.core.dispatch("conversation.delete", {"id": conversation["id"]})
        self.assertEqual(self.pending(), [])
        self.voice.tts = False
        time.sleep(0.09)
        self.assertEqual(self.model.calls, [])

    def test_secret_hold_changed_while_waiting_is_rechecked(self):
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        with self.core.lock:
            self.core.db.execute("UPDATE message_privacy SET privacy='private',memory_hold=1 WHERE message_id=?", (job.user_message["id"],))
            self.core.db.commit()
        wait_until(lambda: not self.pending())
        self.voice.tts = False
        time.sleep(0.08)
        self.assertEqual(self.model.calls, [])
        self.assertEqual(self.memory.items, [])

    def test_each_resource_lease_and_continuous_mode_independently_defers_extraction(self):
        resources = self.core.resources()
        for stage in ("chat", "work", "tts", "asr", "continuous_voice"):
            with self.subTest(stage=stage):
                lease = resources.begin(stage, owner="offline-test")
                job, conversation = self.completed()
                self.core.schedule_facts(job, conversation)
                before = len(self.model.calls)
                time.sleep(0.08)
                self.assertEqual(len(self.model.calls), before)
                job.cancelled.set()
                wait_until(lambda: not self.pending())
                resources.end(lease)
        resources.set_continuous(True)
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        time.sleep(0.08)
        self.assertEqual(self.model.calls, [])
        resources.set_continuous(False)
        self.finished(job)

    def test_active_new_chat_without_resource_lease_defers_extraction(self):
        active, _ = self.completed("你好")
        active.done = False
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        time.sleep(0.085)
        self.assertEqual(self.model.calls, [])
        active.done = True
        self.finished(job)

    def test_identical_queue_submission_is_deduplicated(self):
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.core.schedule_facts(job, conversation)
        self.assertEqual(len(self.pending()), 1)
        self.voice.tts = False
        self.finished(job)
        self.assertEqual(len(self.model.calls), 1)
        self.assertEqual(len(self.memory.items), 1)

    def test_deleted_source_during_memory_save_is_removed_from_long_term_memory(self):
        original = self.memory.remember
        entered, release = threading.Event(), threading.Event()

        def remember(*args, **kwargs):
            entered.set()
            release.wait(2)
            return original(*args, **kwargs)

        self.memory.remember = remember
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.assertTrue(entered.wait(2))
        try:
            self.core.dispatch("conversation.delete", {"id": conversation["id"]})
        finally:
            release.set()
        wait_until(lambda: any(event["type"] == "memory" and event["status"] == "completed" for event in job.events))
        self.assertEqual(self.memory.items, [])
        self.assertEqual(self.core.profile_list()["items"], [])
        self.assertEqual(self.pending(), [])

    def test_task_secret_and_unpersisted_messages_are_not_queued(self):
        self.voice.tts = True
        job, conversation = self.completed()
        job.task_intent = {"content": "work"}
        self.core.schedule_facts(job, conversation)
        job.task_intent, job.memory_hold = None, True
        self.core.schedule_facts(job, conversation)
        job.memory_hold = False
        job.user_message["id"] = "not-in-local-history"
        self.core.schedule_facts(job, conversation)
        self.assertEqual(self.pending(), [])
        self.assertEqual(self.model.calls, [])

    def test_active_extraction_yields_to_new_tts_without_parallel_retries(self):
        self.model = CancellableExtractor()
        self.core.ollama = self.model
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.assertTrue(self.model.started.wait(2))
        self.voice.tts = True
        self.assertTrue(self.model.cancelled.wait(2))
        time.sleep(0.09)
        self.assertEqual(len(self.model.calls), 1)
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.memory.items, [])
        self.voice.tts = False
        self.model.release.set()
        self.finished(job)
        self.assertEqual(len(self.model.calls), 2)
        self.assertEqual(self.model.maximum_active, 1)
        self.assertEqual(len(self.memory.items), 1)

    def test_hold_during_extraction_prevents_all_memory_writes(self):
        self.model = CancellableExtractor()
        self.core.ollama = self.model
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.assertTrue(self.model.started.wait(2))
        with self.core.lock:
            self.core.db.execute("UPDATE message_privacy SET memory_hold=1 WHERE message_id=?", (job.user_message["id"],))
            self.core.db.commit()
        self.model.release.set()
        wait_until(lambda: not self.pending())
        self.assertEqual(self.memory.items, [])
        self.assertEqual(self.core.profile_list()["items"], [])

    def test_shutdown_interrupts_wait_promptly_and_keeps_pending_for_restart(self):
        self.voice.tts = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        started = time.monotonic()
        self.core.shutdown()
        self.assertLess(time.monotonic() - started, 0.4)
        self.assertFalse(self.core._fact_worker.is_alive())
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.model.calls, [])

    def test_shutdown_cancels_inflight_extraction_without_losing_queue(self):
        self.model = CancellableExtractor()
        self.core.ollama = self.model
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.assertTrue(self.model.started.wait(2))
        started = time.monotonic()
        self.core.shutdown()
        self.assertLess(time.monotonic() - started, 0.7)
        self.assertFalse(self.core._fact_worker.is_alive())
        self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.memory.items, [])

    def test_offline_extraction_is_retained_with_bounded_retry_and_no_saved_claim(self):
        self.model.raise_error = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        wait_until(lambda: self.pending() and self.pending()[0]["attempts"] == 1)
        time.sleep(0.12)
        self.assertEqual(len(self.model.calls), 1)
        self.assertGreater(self.pending()[0]["retry_after"], time.time())
        self.assertEqual(self.memory.items, [])
        self.assertEqual(job.events[-1]["status"], "error")

    def test_unconfirmed_save_is_visible_error_and_never_reported_as_synced(self):
        self.memory.unconfirmed = True
        job, conversation = self.completed()
        self.core.schedule_facts(job, conversation)
        self.finished(job)
        profiles = self.core.profile_list()["items"]
        self.assertEqual([item["status"] for item in profiles], ["error"])
        self.assertTrue(all(item["status"] == "error" for item in job.events[-1]["memories"]))
        self.assertEqual(self.memory.items, [])


class OllamaFactStreamingTests(unittest.TestCase):
    def setUp(self):
        self.adapter = Ollama()
        self.job = Job("offline-conversation", {"id": "offline-user"})
        self.calls = []

    def response(self, packets):
        if isinstance(packets, list):
            raw = b"\n".join(json.dumps(packet, ensure_ascii=False).encode("utf-8") for packet in packets) + b"\n"
        else:
            raw = json.dumps(packets, ensure_ascii=False).encode("utf-8")
        response = io.BytesIO(raw)

        def request(path, body=None, timeout=None):
            self.calls.append({"path": path, "body": body, "timeout": timeout})
            return response

        self.adapter._request = request
        return response

    def test_deferred_structured_json_is_accumulated_from_ndjson(self):
        response = self.response([
            {"message": {"content": '{"facts":[{"category":"preference",'}},
            {"message": {"content": '"evidence":"我喜欢蓝色"}]}'}, "done": False},
            {"message": {"content": ""}, "done": True},
        ])
        result = self.adapter.extract("fixture-local", "我喜欢蓝色", job=self.job)
        self.assertEqual(result, [{"category": "preference", "evidence": "我喜欢蓝色"}])
        self.assertTrue(self.calls[0]["body"]["stream"])
        self.assertEqual(self.calls[0]["path"], "/api/chat")
        self.assertEqual(self.calls[0]["body"]["format"]["type"], "object")
        self.assertIsNone(self.job.response)
        self.assertTrue(response.closed)

    def test_balanced_preserves_nonstreaming_adapter_contract(self):
        self.response({"message": {"content": '{"facts":[]}'}})
        self.assertEqual(self.adapter.extract("fixture-local", "你好"), [])
        self.assertIs(self.calls[0]["body"]["stream"], False)

    def test_truncated_stream_never_counts_as_completed_fact_extraction(self):
        self.response([{"message": {"content": '{"facts":[]}'}}])
        with self.assertRaisesRegex(RuntimeError, "未完整结束"):
            self.adapter.extract("fixture-local", "你好", job=self.job)
        self.assertIsNone(self.job.response)

    def test_accumulated_and_packet_sizes_are_bounded(self):
        for packets in (
            [{"message": {"content": "x" * 20000}}, {"message": {"content": "y" * 20000}, "done": True}],
            [{"message": {"content": "x" * 66000}, "done": True}],
        ):
            with self.subTest(packet_count=len(packets)):
                self.response(packets)
                with self.assertRaises(RuntimeError):
                    self.adapter.extract("fixture-local", "你好", job=self.job)
                self.assertIsNone(self.job.response)

    def test_cancelled_before_request_sends_nothing(self):
        self.response([{"message": {"content": '{"facts":[]}'}, "done": True}])
        self.job.cancelled.set()
        with self.assertRaises(InterruptedError):
            self.adapter.extract("fixture-local", "你好", job=self.job)
        self.assertEqual(self.calls, [])

    def test_cancellation_during_stream_discards_even_valid_complete_json(self):
        response = self.response([{"message": {"content": '{"facts":[]}'}, "done": True}])
        read = response.readline

        def cancelling_read(*args):
            line = read(*args)
            self.assertIs(self.job.response, response)
            self.job.cancelled.set()
            return line

        response.readline = cancelling_read
        with self.assertRaises(InterruptedError):
            self.adapter.extract("fixture-local", "你好", job=self.job)
        self.assertTrue(response.closed)
        self.assertIsNone(self.job.response)


if __name__ == "__main__":
    unittest.main()
