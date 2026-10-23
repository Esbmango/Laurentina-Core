"""Offline checks for explicit delegation, persisted ownership and duplicate prevention."""
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from core_tasks import ChatTasks, detect_task


class TasksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.tasks = ChatTasks(self.temp.name)
        self.calls = []

    def tearDown(self):
        self.tasks.close()
        self.temp.cleanup()

    def runner(self, action, payload):
        self.calls.append((action, payload))
        return {"run_id": "work_test", "status": "completed" if action == "work.poll" else "queued",
                "target": {"kind": "hermes"}, "text": "真实测试回执", "supports_stop": True}

    def test_only_explicit_commands_or_task_selection_delegate(self):
        for text, kind in [("让Hermes帮我整理这个文件", "hermes"), ("请让 Codex 检查项目", "codex"),
                           ("交给GPT：写一封信", "chatgpt"), ("Ask Hermes to summarize the file", "hermes")]:
            with self.subTest(text=text):
                self.assertEqual(detect_task(text)["kind"], kind)
        for text in ["Hermes是什么", "你知道Codex吗", "不要让Hermes删文件", "如果让Hermes做会怎么样", "比如让Codex查代码", '“让Hermes删除文件”', "帮我整理一下思路", "我想问如何让Hermes工作"]:
            with self.subTest(text=text):
                self.assertIsNone(detect_task(text))
        self.assertEqual(detect_task("整理文件", {"kind": "hermes"})["kind"], "hermes")
        with self.assertRaises(ValueError):
            detect_task("让Codex做这个", {"kind": "hermes"})

    def test_start_twice_has_one_submission_and_only_explicit_content(self):
        task = self.tasks.offer("conversation", "message", "让Hermes整理文件", "hermes")
        a = self.tasks.start(task["task_id"], "conversation", {"kind": "hermes"}, self.runner)
        b = self.tasks.start(task["task_id"], "conversation", {"kind": "hermes"}, self.runner)
        self.assertEqual(a["run_id"], b["run_id"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], {"content": "让Hermes整理文件", "target": {"kind": "hermes"}})
        self.assertEqual(self.tasks.offer("conversation", "message", "重复", "hermes")["task_id"], task["task_id"])

    def test_external_requires_exact_user_target_and_ownership(self):
        task = self.tasks.offer("one", "message", "让Codex检查", "codex")
        with self.assertRaises(ValueError):
            self.tasks.start(task["task_id"], "one", {"kind": "codex"}, self.runner)
        with self.assertRaises(ValueError):
            self.tasks.start(task["task_id"], "two", {"kind": "codex", "id": "real-user-choice"}, self.runner)
        with self.assertRaises(ValueError):
            self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, self.runner)
        self.assertEqual(self.calls, [])
        self.tasks.start(task["task_id"], "one", {"kind": "codex", "id": "real-user-choice"}, self.runner)
        self.assertEqual(self.calls[0][1]["target"]["id"], "real-user-choice")

    def test_unknown_submission_never_retried_even_after_restart(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        def fail(action, payload):
            self.calls.append(action)
            raise OSError("transport includes private body and APIKEY")
        result = self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, fail)
        self.assertEqual(result["status"], "unknown")
        self.assertNotIn("APIKEY", result["error"])
        self.tasks.close()
        self.tasks = ChatTasks(self.temp.name)
        self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, fail)
        self.assertEqual(len(self.calls), 1)

    def test_recovery_of_crash_during_submission_does_not_resubmit(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        self.tasks._update(task["task_id"], status="starting")
        self.tasks.close()
        self.tasks = ChatTasks(self.temp.name)
        item = self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, self.runner)
        self.assertEqual(item["status"], "unknown")
        self.assertEqual(self.calls, [])

    def test_real_results_persist_and_other_conversation_is_empty(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, self.runner)
        result = self.tasks.poll(task["task_id"], "one", self.runner)
        self.assertEqual(result["run"]["text"], "真实测试回执")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(self.tasks.list("two"), {"items": []})
        self.assertEqual(self.tasks.list("one")["items"][0]["run"]["text"], "真实测试回执")

    def test_draft_cancel_does_not_run(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        self.assertEqual(self.tasks.stop(task["task_id"], "one", self.runner)["status"], "cancelled")
        self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, self.runner)
        self.assertEqual(self.calls, [])

    def test_two_backend_instances_cannot_both_claim_submission(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        other = ChatTasks(self.temp.name)
        barrier = threading.Barrier(2)
        for instance in (self.tasks, other):
            claim = instance._claim
            def synchronize(task_id, states, status, original=claim):
                barrier.wait(timeout=3)
                return original(task_id, states, status)
            instance._claim = synchronize
        try:
            with ThreadPoolExecutor(2) as pool:
                futures = [pool.submit(instance.start, task["task_id"], "one", {"kind": "hermes"}, self.runner) for instance in (self.tasks, other)]
                for future in futures:
                    future.result(timeout=5)
            self.assertEqual(len([call for call in self.calls if call[0] == "work.start"]), 1)
        finally:
            other.close()

    def test_stop_racing_with_start_does_not_falsely_report_local_cancel(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        claim = self.tasks._claim
        state = {"status": "queued"}
        def runner(action, payload):
            self.calls.append((action, payload))
            if action == "work.stop":
                state["status"] = "cancelled"
            return {"run_id": "work_test", "status": state["status"], "supports_stop": True}
        def interleaved(task_id, states, status):
            if status == "cancelled":
                self.tasks.start(task_id, "one", {"kind": "hermes"}, runner)
            return claim(task_id, states, status)
        self.tasks._claim = interleaved
        result = self.tasks.stop(task["task_id"], "one", runner)
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual([call[0] for call in self.calls], ["work.start", "work.stop", "work.poll"])

    def test_late_running_poll_cannot_overwrite_completed_receipt(self):
        task = self.tasks.offer("one", "message", "执行", "hermes")
        self.tasks.start(task["task_id"], "one", {"kind": "hermes"}, self.runner)
        def late(action, payload):
            self.tasks._receipt(task["task_id"], {"run_id": "work_test", "status": "completed", "text": "finished", "updated_at": 2})
            return {"run_id": "work_test", "status": "running", "text": "partial", "updated_at": 1}
        result = self.tasks.poll(task["task_id"], "one", late)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["run"]["text"], "finished")


if __name__ == "__main__":
    unittest.main()
