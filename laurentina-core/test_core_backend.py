"""Offline privacy, cancellation, persistence and HTTP contract checks."""
import io
import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from core_backend import Core, CoreHTTP, Job, NoRedirect, Ollama, VisibleText
from core_resources import ResourceManager

TEST_ROOT = Path(__file__).resolve().parent / ".local" / "test-work"
TEST_ROOT.mkdir(parents=True, exist_ok=True)


class Memory:
    def __init__(self):
        self.items = []
        self.queries = []
        self.fail = False
        self.unconfirmed = False

    def health(self):
        return {"ok": True}

    def search(self, query, scope="shared", limit=8):
        self.queries.append((query, scope))
        return [dict(m) for m in self.items if m["scope"] == scope][:limit]

    def list(self, scope="shared", limit=100):
        return [dict(m) for m in self.items if m["scope"] == scope][:limit]

    def remember(self, content, scope="shared", source="core", category="fact"):
        if self.fail:
            raise OSError("unavailable")
        if self.unconfirmed:
            return {"ok": True, "status": "pending"}
        result = {"id": str(len(self.items) + 1), "content": content, "scope": scope, "source": source, "category": category}
        self.items.append(result)
        return {"ok": True, **result}

    def delete(self, memory_id, scope="shared"):
        if self.fail:
            raise OSError("unavailable")
        self.items[:] = [m for m in self.items if not (m["id"] == memory_id and m["scope"] == scope)]
        return {"ok": True}


class Model:
    def __init__(self):
        self.facts = []
        self.prompts = []
        self.started = threading.Event()
        self.finished = threading.Event()
        self.release = threading.Event()
        self.slow = False
        self.fail = False

    def health(self, model):
        return {"ok": True, "models": ["qwen3.5:9b"], "model": model}

    def stream(self, model, messages, job):
        self.prompts.append(messages)
        try:
            yield "你好"
            self.started.set()
            if self.slow:
                self.release.wait(3)
            if self.fail:
                raise OSError("upstream contains secret request body")
            if not job.cancelled.is_set():
                yield "，我在。"
        finally:
            self.finished.set()

    def extract(self, model, text):
        return self.facts


def wait_until(predicate, seconds=3):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition timed out")


def offline_core(*args, **kwargs):
    """Keep real admission/leases while isolating all system/model telemetry.

    A fake chat model alone does not make Core offline: admission runs before
    its stream and the default snapshot probes nvidia-smi and Ollama /api/ps.
    Every fresh/reopened Core in these routing tests needs the same boundary.
    """
    core = Core(*args, **kwargs)
    core._resources = ResourceManager(core.data_dir, snapshotter=lambda: {
        "ram": {"available": True, "total_bytes": 16 * 1024**3, "available_bytes": 8 * 1024**3},
        "gpus": [], "ollama": {"available": False, "models": []}})
    return core


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="backend-", dir=TEST_ROOT)
        self.memory, self.model = Memory(), Model()
        self.core = offline_core(self.temp.name, memory=self.memory, ollama=self.model)

    def tearDown(self):
        self.model.release.set()
        self.core.shutdown()
        # Background memory jobs are short offline operations; let their lock finish.
        time.sleep(0.02)
        self.core.db.close()
        self.temp.cleanup()

    def conversation(self, mode="daily"):
        return self.core.dispatch("conversation.create", {"mode": mode})

    def test_offline_chat_admission_keeps_real_policy_without_system_or_network_probes(self):
        manager = self.core.resources()
        self.assertIsInstance(manager, ResourceManager)
        with patch("core_resources.hardware_snapshot") as hardware, \
                patch("core_resources._local_json") as ollama, \
                patch("core_resources.subprocess.run") as external_process:
            for mode in ("daily", "private"):
                job = self.send(self.conversation(mode), "你好")
                self.assertEqual(job.final_message["status"], "completed")
                self.assertEqual(manager.leases, {})
            hardware.assert_not_called()
            ollama.assert_not_called()
            external_process.assert_not_called()

    def test_fake_model_entry_waits_for_capacity_snapshot_before_stream(self):
        # Reproduce the CI boundary deterministically, without actual telemetry:
        # the stream's entered event cannot fire until admission has returned.
        entered, release = threading.Event(), threading.Event()
        manager = self.core.resources()
        snapshot = manager.snapshotter()

        def blocked_snapshot():
            entered.set()
            release.wait(2)
            return snapshot

        manager.snapshotter = blocked_snapshot
        sent = self.core.dispatch("chat.send", {"conversation_id": self.conversation()["id"], "content": "你好"})
        try:
            self.assertTrue(entered.wait(1), "fixture did not reach capacity admission")
            self.assertFalse(self.model.started.is_set())
        finally:
            release.set()
        self.assertTrue(self.model.started.wait(1), "fixture model did not enter after admission released")
        wait_until(lambda: self.core.job(sent["job_id"]).done)

    def send(self, conversation, text):
        result = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": text})
        job = self.core.job(result["job_id"])
        wait_until(lambda: job.done)
        return job

    def facts(self, text, mode="private"):
        conversation = self.conversation(mode)
        job = Job(conversation["id"], {"id": "human", "content": text})
        self.core.process_facts(job, {"mode": mode})
        return self.core.profile_list()["items"]

    def test_daily_cannot_read_private_memories_or_other_private_history(self):
        self.memory.remember("private-canary-abc", scope="private")
        self.memory.remember("shared-name-abc", scope="shared")
        private = self.conversation("private")
        self.send(private, "私聊原文标记 raw-private-981")
        daily = self.conversation("daily")
        self.send(daily, "你好")
        prompt = json.dumps(self.model.prompts[-1], ensure_ascii=False)
        self.assertIn("shared-name-abc", prompt)
        self.assertNotIn("private-canary-abc", prompt)
        self.assertNotIn("raw-private-981", prompt)
        self.assertIn("private-canary-abc", json.dumps(self.model.prompts[0]))
        self.assertEqual(self.memory.queries[-1][1], "shared")

    def test_grounded_allowlist_extracts_shared_profile_but_keeps_private_fact_local(self):
        text = "我喜欢简短回复。我的保险箱里有一封信。"
        self.model.facts = [
            {"category": "preference", "evidence": "我喜欢简短回复", "content": "INVENTED"},
            {"category": "private_fact", "evidence": "我的保险箱里有一封信"},
            {"category": "identity", "evidence": "我是医生"},
        ]
        items = self.facts(text)
        self.assertEqual(len(items), 2)
        shared = [m for m in self.memory.items if m["scope"] == "shared"]
        self.assertEqual(shared[0]["content"], "用户明确表示：我喜欢简短回复")
        self.assertNotIn("保险箱", json.dumps(shared, ensure_ascii=False))
        self.assertNotIn("INVENTED", json.dumps(self.memory.items))
        self.assertEqual([m["scope"] for m in items].count("private"), 1)

    def test_hypothetical_quoted_test_and_do_not_remember_are_not_profile_facts(self):
        for human, evidence in [
            ("假设我是医生", "我是医生"), ("他说我是医生", "我是医生"),
            ("这是测试，我喜欢蓝色", "我喜欢蓝色"), ("不要记住我喜欢蓝色", "我喜欢蓝色"),
            ("比如我喜欢蓝色", "我喜欢蓝色"), ("我喜欢蓝色？", "我喜欢蓝色？"),
            ('“我喜欢蓝色”', '我喜欢蓝色'), ('"我喜欢蓝色"', '我喜欢蓝色'),
        ]:
            self.model.facts = [{"category": "preference" if "喜欢" in evidence else "identity", "evidence": evidence}]
            self.assertEqual(self.facts(human), [])
        self.assertEqual(self.memory.items, [])

    def test_private_raw_text_cannot_ride_on_shared_excerpt(self):
        text = "我喜欢猫。我的秘密是红色信封。"
        self.model.facts = [{"category": "preference", "evidence": text}]
        self.assertTrue(all(item["scope"] == "private" for item in self.facts(text)))
        self.model.facts = [{"category": "preference", "evidence": "我喜欢猫"}]
        self.facts("不要共享：我喜欢猫")
        self.assertEqual(len(self.memory.items), 2)
        self.assertTrue(all(item["scope"] == "private" for item in self.memory.items))

    def test_compound_private_experiences_never_ride_on_approved_preference(self):
        cases = [
            "我喜欢蓝色，我昨晚去了心理咨询中心",
            "我喜欢蓝色并且去了律师事务所",
            "我喜欢蓝色同时去见了律师",
            "我喜欢蓝色因为昨晚去了心理咨询中心",
            "我喜欢蓝色昨天去见了律师",
            "我喜欢蓝色然后去了律师事务所",
            "I prefer short replies, I visited a divorce lawyer yesterday",
            "I prefer short replies and visited a lawyer",
            "I prefer short replies because I visited a divorce lawyer yesterday",
            "I prefer short replies when I meet a lawyer",
            "I prefer short replies after meeting a lawyer",
            "I prefer short replies so visited a lawyer",
            "我喜欢蓝色所以去了律师事务所",
            "I prefer short replies I visited a lawyer",
        ]
        for text in cases:
            self.model.facts = [{"category": "preference", "evidence": text}]
            self.facts(text)
        self.assertEqual(len(self.memory.items), len(cases))
        self.assertTrue(all(item["scope"] == "private" for item in self.memory.items))

    def test_standalone_approved_facts_and_project_routing_still_share(self):
        cases = [
            ("name", "我叫小林"), ("name", "我希望助手叫劳纶缇娜"),
            ("language", "平时用中文交流"), ("preference", "我喜欢简短回复"),
            ("habit", "我每天喝咖啡"), ("goal", "我的目标是学习Python"),
            ("identity", "我是软件工程师"), ("preference", "I prefer short replies."),
            ("habit", "I usually drink coffee"), ("goal", "I want to learn Python"),
            ("preference", "我希望日常先用本地Qwen，工作时调用云端"),
        ]
        for category, text in cases:
            self.model.facts = [{"category": category, "evidence": text}]
            self.facts(text)
        active = self.core.profile_list()["items"]
        self.assertTrue(active)
        self.assertTrue(all(item["scope"] == "shared" and item["status"] == "synced" for item in active))
        self.assertTrue(any("工作时调用云端" in item["content"] for item in active))

    def test_no_share_and_sensitive_identity_are_private_not_shared(self):
        for text in ("不要共享，我叫小林", "我是糖尿病患者", "我的家庭地址是松树街8号", "我的银行账号是123456789"):
            category = "name" if "我叫" in text else "identity"
            evidence = "我叫小林" if "我叫" in text else text
            self.model.facts = [{"category": category, "evidence": evidence}]
            self.facts(text)
        self.assertEqual(len(self.memory.items), 4)
        self.assertTrue(all(m["scope"] == "private" for m in self.memory.items))

    def test_explicit_service_failure_with_id_is_not_confirmed_save(self):
        from core_backend import confirmed_memory
        with self.assertRaises(RuntimeError):
            confirmed_memory({"ok": True, "id": "made-up", "agent_status": "failed"})

    def test_deleted_conversation_is_not_mined_after_generation(self):
        conversation = self.conversation("private")
        self.core.dispatch("conversation.delete", {"id": conversation["id"]})
        self.model.facts = [{"category": "preference", "evidence": "我喜欢简短回复"}]
        job = Job(conversation["id"], {"id": "human", "content": "我喜欢简短回复"})
        self.core.process_facts(job, conversation)
        self.assertEqual(self.memory.items, [])

    def test_unconfirmed_save_is_error_not_success(self):
        self.memory.unconfirmed = True
        self.model.facts = [{"category": "preference", "evidence": "我喜欢中文"}]
        items = self.facts("我喜欢中文")
        self.assertEqual(items[0]["status"], "error")
        with self.assertRaises(RuntimeError):
            self.core.dispatch("memory.remember", {"scope": "shared", "content": "用户明确表示：我喜欢中文"})

    def test_deleted_profile_does_not_reextract_and_failed_delete_is_visible(self):
        self.model.facts = [{"category": "preference", "evidence": "我喜欢中文"}]
        item = self.facts("我喜欢中文")[0]
        self.memory.fail = True
        with self.assertRaises(RuntimeError):
            self.core.dispatch("profile.delete", {"id": item["id"]})
        self.assertEqual(self.core.profile_list()["items"][0]["status"], "error")
        self.memory.fail = False
        self.core.dispatch("profile.delete", {"id": item["id"]})
        self.assertEqual(self.facts("我喜欢中文"), [])
        self.assertEqual(self.memory.items, [])

    def test_language_update_supersedes_old_scoped_memory(self):
        self.model.facts = [{"category": "language", "evidence": "用中文交流"}]
        self.facts("用中文交流")
        self.model.facts = [{"category": "language", "evidence": "用英语交流"}]
        result = self.facts("用英语交流")
        self.assertEqual(len(result), 1)
        self.assertEqual(self.memory.items[0]["content"], "用户明确表示：用英语交流")

    def test_cancel_preserves_partial_and_restart_preserves_messages(self):
        self.model.slow = True
        conversation = self.conversation()
        result = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "你好"})
        self.assertTrue(self.model.started.wait(2))
        self.core.dispatch("chat.cancel", {"job_id": result["job_id"]})
        messages = self.core.messages(conversation["id"])
        self.assertEqual(messages[-1]["content"], "你好")
        self.assertEqual(messages[-1]["status"], "cancelled")
        self.model.release.set()
        self.assertTrue(self.model.finished.wait(1), "cancelled fixture stream did not release")
        another = offline_core(self.temp.name, memory=self.memory, ollama=self.model)
        try:
            persisted = another.messages(conversation["id"])
            self.assertEqual(persisted, messages)
            self.assertEqual(len(persisted), 2)
        finally:
            another.db.close()

    def test_failed_model_does_not_leak_transport_exception_and_retains_partial(self):
        self.model.fail = True
        job = self.send(self.conversation(), "你好")
        events = self.core.dispatch("chat.poll", {"job_id": job.id})["events"]
        self.assertTrue(any(e["type"] == "error" for e in events))
        self.assertNotIn("secret request body", json.dumps(events))
        self.assertEqual(job.final_message["status"], "failed")
        self.assertEqual(job.final_message["content"], "你好")

    def test_one_job_per_conversation_and_unknown_model_rejected(self):
        self.model.slow = True
        conversation = self.conversation()
        self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "你好"})
        with self.assertRaises(ValueError):
            self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "重复"})
        with self.assertRaises(ValueError):
            self.core.dispatch("conversation.delete", {"id": conversation["id"]})
        with self.assertRaises(ValueError):
            self.core.dispatch("settings.save", {"model": "cloud-model"})

    def test_character_canonical_local_bounded_summary_shared_and_no_fake_sync(self):
        persona = "这是用户定义的角色。" * 100
        result = self.core.dispatch("character.save", {"name": "劳纶缇娜", "persona": persona})
        self.assertEqual(result["persona"], persona)
        self.assertEqual(result["memory_sync"]["status"], "synced")
        self.assertLess(len(self.memory.items[0]["content"]), 600)
        self.memory.fail = True
        result = self.core.dispatch("character.save", {"name": "劳纶缇娜", "persona": "新角色"})
        self.assertEqual(result["persona"], "新角色")
        self.assertEqual(result["memory_sync"]["status"], "error")
        with self.assertRaises(ValueError):
            self.core.dispatch("character.save", {"name": "abc", "persona": "", "avatar": "data:image/svg+xml;base64,PHN2Zz4="})

    def test_bootstrap_is_lazy_and_default_settings_fixed(self):
        class Slow:
            def __getattr__(self, name):
                raise AssertionError("bootstrap must not probe network")
        self.core.memory = Slow()
        self.core.ollama = Slow()
        self.core.resources().save_settings({"preset": "low_memory"})
        self.core.resources().snapshotter = lambda: (_ for _ in ()).throw(AssertionError("bootstrap must not probe hardware"))
        result = self.core.dispatch("bootstrap")
        self.assertEqual(result["settings"]["base_url"], "http://127.0.0.1:11434")
        self.assertEqual(result["resources"], {"preset": "low_memory"})

    def test_chat_reports_actual_local_route_for_speech_scheduling(self):
        conversation = self.conversation()
        sent = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "你好"})
        self.assertIs(sent["speech_local"], True)
        wait_until(lambda: self.core.job(sent["job_id"]).done)


class WireTests(unittest.TestCase):
    def test_cancel_interrupts_blocked_upstream_socket_before_close(self):
        interrupted, closed = threading.Event(), threading.Event()
        response = SimpleNamespace(fp=SimpleNamespace(raw=SimpleNamespace(_sock=SimpleNamespace(shutdown=lambda mode: interrupted.set()))),
                                   close=lambda: closed.set())
        job = Job("c", {})
        job.attach(response)
        job.cancelled.set()
        job.abort_upstream()
        self.assertTrue(interrupted.is_set())
        self.assertTrue(closed.wait(1))

    def test_stream_strips_thinking_native_fields_and_split_tags(self):
        packets = [
            {"message": {"thinking": "SECRET REASONING", "content": "<thi"}},
            {"message": {"content": "nk>HIDDEN"}},
            {"message": {"content": "</think>你好"}},
            {"message": {"reasoning_content": "HIDDEN2", "content": "，<analysis>NEVER</analysis>世界"}},
            {"done": True},
        ]
        raw = b"\n".join(json.dumps(p).encode() for p in packets)
        model = Ollama()
        model._request = lambda *args, **kwargs: io.BytesIO(raw)
        result = "".join(model.stream("qwen3.5:9b", [], Job("c", {})))
        self.assertEqual(result, "你好，世界")
        visible = VisibleText()
        self.assertEqual(visible.feed("ok<think>unfinished", final=True), "ok")

    def test_model_redirect_is_denied(self):
        with self.assertRaises(RuntimeError):
            NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_http_requires_token_exact_host_origin_and_json(self):
        with tempfile.TemporaryDirectory(prefix="http-", dir=TEST_ROOT) as directory:
            core = offline_core(directory, memory=Memory(), ollama=Model())
            server = CoreHTTP(core, token="test-token")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            url = f"http://127.0.0.1:{server.server_port}/rpc"
            def request(extra):
                headers = {"Content-Type": "application/json", "X-Core-Token": "test-token", **extra}
                return opener.open(urllib.request.Request(url, data=b'{"action":"bootstrap"}', headers=headers), timeout=3)
            try:
                for extra, code in [({"X-Core-Token": "wrong"}, 403), ({"Host": "evil.example"}, 403),
                                    ({"Origin": "https://evil.example"}, 403), ({"Origin": "null"}, 403),
                                    ({"Content-Type": "text/plain"}, 415)]:
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        request(extra)
                    self.assertEqual(caught.exception.code, code)
                with request({}) as response:
                    self.assertTrue(json.load(response)["ok"])
            finally:
                server.shutdown()
                server.server_close()
                core.db.close()

    def test_loopback_http_binds_and_serves_without_hostname_resolution(self):
        with tempfile.TemporaryDirectory(prefix="http-no-dns-", dir=TEST_ROOT) as directory:
            core = offline_core(directory, memory=Memory(), ollama=Model())
            server = None
            thread = None
            try:
                with patch("socket.getfqdn", side_effect=AssertionError("Loopback must not resolve DNS")):
                    server = CoreHTTP(core, token="test-token")
                self.assertEqual(server.server_name, "127.0.0.1")
                self.assertEqual(server.server_port, server.socket.getsockname()[1])
                self.assertGreater(server.server_port, 0)
                self.assertEqual(server.socket.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR), 0)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/rpc",
                    data=b'{"action":"bootstrap"}', headers={"Content-Type": "application/json",
                    "X-Core-Token": "test-token"})
                with opener.open(request, timeout=3) as response:
                    self.assertTrue(json.load(response)["ok"])
            finally:
                if server is not None:
                    if thread is not None:
                        server.shutdown()
                        thread.join(timeout=3)
                    server.server_close()
                core.db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
