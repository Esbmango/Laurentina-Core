"""Offline backend → real adapter → chat receipt integration for validation."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock

from core_backend import Core
from core_tasks import ChatTasks
import test_core_work as fixture


class BackendValidationTests(unittest.TestCase):
    def setUp(self):
        fixture.WorkTests.setUp(self)
        self.tasks = ChatTasks(self.directory / "chat-receipts")
        self.core = Core(self.directory / "core", memory=object(), ollama=object(), voice=object(), work=self.bridge, tasks=self.tasks)
        self.core._resources = Mock()
        self.core._resources.admission.return_value = {"allowed": True}
        self.core._resources.begin.return_value = "test-resource-lease"
        self.artifact_temp = tempfile.TemporaryDirectory(prefix="laurentina-v07-integration-")
        self.artifact_root = Path(self.artifact_temp.name)
        (self.artifact_root / "report.md").write_text("existing report", encoding="utf-8")
        self.spec = {"root": str(self.artifact_root), "checks": [{"kind": "file", "path": "report.md"}]}

    def tearDown(self):
        self.core.db.close()
        self.tasks.close()
        fixture.WorkTests.tearDown(self)
        self.artifact_temp.cleanup()

    def completed_chat_task(self):
        task = self.tasks.offer("conversation", "message", "让Hermes生成这个报告", "hermes")
        receipt = self.tasks.start(task["task_id"], "conversation", {"kind": "hermes"}, self.core.work_action)
        remote = receipt["run"]["remote_run_id"]
        self.server.runs[remote].update(status="completed", output="Executor result")
        self.core.work_action("work.poll", {"run_id": receipt["run_id"]})
        return self.tasks.list("conversation")["items"][0]

    def refresh_until_checked(self, run_id):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.core.work_action("work.poll", {"run_id": run_id})
            if result["validation"]["status"] != "pending":
                return result
            threading.Event().wait(0.01)
        self.fail("backend validation did not settle")

    def test_backend_start_forwards_explicit_spec_without_remote_leak(self):
        receipt = self.core.work_action("work.start", {"content": "generate file", "validation": self.spec})
        self.assertEqual(receipt["validation"]["status"], "pending")
        self.assertEqual(receipt["validation_spec"]["root"], str(self.artifact_root.resolve()))
        self.assertNotIn(str(self.artifact_root), json.dumps(self.server.posts[0][1]))
        self.assertEqual(len(self.server.posts), 1)

    def test_completed_chat_receipt_revalidation_updates_without_submitting_again(self):
        task = self.completed_chat_task()
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["run"]["validation"]["status"], "not_requested")
        self.core.work_action("work.validate", {"run_id": task["run_id"], "validation": self.spec})
        final = self.refresh_until_checked(task["run_id"])
        displayed = self.tasks.list("conversation")["items"][0]
        self.assertEqual(displayed["status"], "completed")
        self.assertEqual(displayed["run"]["text"], "Executor result")
        self.assertEqual(displayed["run"]["validation"]["status"], "passed")
        self.assertEqual(displayed["run"]["validation"]["checked_at"], final["validation"]["checked_at"])
        self.assertEqual([path for path, _body, _key in self.server.posts], ["/v1/runs"])

    def test_failed_check_keeps_chat_execution_completed_and_old_poll_cannot_erase_it(self):
        task = self.completed_chat_task()
        stale = dict(task["run"])
        bad_spec = {**self.spec, "checks": [{"kind": "file", "path": "missing.txt"}]}
        self.core.work_action("work.validate", {"run_id": task["run_id"], "validation": bad_spec})
        final = self.refresh_until_checked(task["run_id"])
        self.assertEqual(final["validation"]["status"], "failed")
        self.tasks.sync_run(stale)
        displayed = self.tasks.list("conversation")["items"][0]
        self.assertEqual(displayed["status"], "completed")
        self.assertEqual(displayed["run"]["validation"]["status"], "failed")
        self.assertEqual(len(self.server.posts), 1)

    def test_invalid_revalidation_keeps_previous_receipt_and_does_not_submit(self):
        task = self.completed_chat_task()
        invalid = {**self.spec, "checks": [{"kind": "file", "path": "../private.txt"}]}
        with self.assertRaises(ValueError):
            self.core.work_action("work.validate", {"run_id": task["run_id"], "validation": invalid})
        self.assertEqual(self.tasks.list("conversation")["items"][0]["run"]["validation"]["status"], "not_requested")
        self.assertEqual(len(self.server.posts), 1)


if __name__ == "__main__":
    unittest.main()
