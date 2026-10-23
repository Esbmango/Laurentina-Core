"""Run completion and local verification are distinct, persistent receipts."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import core_work
from core_work_validation import normalize_spec, pending_result, validate_artifacts
import test_core_work as fixture


class WorkValidationTests(unittest.TestCase):
    setUp = fixture.WorkTests.setUp
    tearDown = fixture.WorkTests.tearDown

    def artifacts(self):
        temp = tempfile.TemporaryDirectory(prefix="laurentina-receipt-")
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        (root / "report.md").write_text("report", encoding="utf-8")
        (root / "summary.json").write_text('{"total":123}', encoding="utf-8")
        return {"root": str(root), "checks": [{"kind": "file", "path": "report.md"}]}

    def complete(self, receipt):
        self.server.runs[receipt["remote_run_id"]].update(status="completed", output="Executor says done")
        return self.bridge.poll(receipt["run_id"])

    def verified(self, run_id, bridge=None):
        bridge = bridge or self.bridge
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = next(item for item in bridge.list() if item["run_id"] == run_id)
            if result["validation"]["status"] != "pending":
                return result
            threading.Event().wait(0.01)
        self.fail("artifact verification did not settle")

    def test_no_spec_explicitly_reports_unverified_and_keeps_historical_digest(self):
        with patch("core_work.validate_artifacts") as check:
            receipt = self.bridge.start("an ordinary work request")
            result = self.complete(receipt)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["validation"]["status"], "not_requested")
            self.assertIsNone(result["validation_spec"])
            expected = hashlib.sha256(json.dumps(["an ordinary work request", None, "hermes", "default"], ensure_ascii=False).encode()).hexdigest()
            self.assertEqual(self.bridge._row(receipt["run_id"])["digest"], expected)
            check.assert_not_called()

    def test_checks_start_only_after_completion_and_keep_spec_local(self):
        spec = self.artifacts()
        entered, gate = threading.Event(), threading.Event()
        def slow(*args, **kwargs):
            entered.set()
            gate.wait(3)
            return validate_artifacts(*args, **kwargs)
        with patch("core_work.validate_artifacts", side_effect=slow) as checker:
            receipt = self.bridge.start("produce result", validation=spec)
            self.assertEqual(receipt["validation"]["status"], "pending")
            self.assertEqual(receipt["validation"]["phase"], "waiting_for_execution")
            checker.assert_not_called()
            self.assertNotIn(spec["root"], json.dumps(self.server.posts[0][1]))
            started = time.monotonic()
            result = self.complete(receipt)
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(entered.wait(1))
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["validation"]["status"], "pending")
            gate.set()
            result = self.verified(receipt["run_id"])
        self.assertEqual(result["validation"]["status"], "passed")
        self.assertEqual(result["validation_spec"], normalize_spec(spec))
        self.assertEqual(len(self.server.posts), 1)

    def test_attach_to_old_completed_run_failed_check_never_changes_execution(self):
        receipt = self.bridge.start("existing result")
        self.complete(receipt)
        spec = self.artifacts()
        spec["checks"] = [{"kind": "file", "path": "missing.txt"}]
        self.bridge.validate(receipt["run_id"], spec)
        result = self.verified(receipt["run_id"])
        self.assertEqual(result["validation"]["status"], "failed")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["text"], "Executor says done")
        self.assertEqual(len(self.server.posts), 1)
        self.bridge.close()
        self.bridge = core_work.WorkBridge(self.directory, auto_start=False)
        result = self.bridge.list()[0]
        self.assertEqual(result["validation"]["status"], "failed")
        self.assertEqual(result["validation_spec"], normalize_spec(spec))
        self.assertEqual(len(self.server.posts), 1)

    def test_invalid_spec_rejected_before_admission(self):
        spec = self.artifacts()
        spec["checks"][0]["path"] = "../private.txt"
        with self.assertRaises(ValueError):
            self.bridge.start("invalid declaration", validation=spec)
        self.assertEqual(self.bridge.list(), [])
        self.assertEqual(self.server.posts, [])

    def test_external_completed_turn_is_checked_without_extra_chat_message(self):
        desktop = fixture.FakeDesktop()
        target = desktop.items[0]
        spec = self.artifacts()
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
             patch.object(self.bridge, "_desktop_request", side_effect=desktop.request):
            receipt = self.bridge.start("explicit external fixture", target=target, validation=spec)
            fixture.WorkTests.settled(self, receipt["run_id"])
            desktop.states[target["id"]]["turns"] = [{"id": "fresh-turn", "status": "completed", "items": [
                {"type": "agentMessage", "text": "actual external reply"}]}]
            result = self.bridge.poll(receipt["run_id"])
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["validation_spec"], normalize_spec(spec))
            self.assertEqual(self.verified(receipt["run_id"])["validation"]["status"], "passed")
        self.assertEqual(len(desktop.sends), 1)
        self.assertEqual(desktop.sends[0][1], "explicit external fixture")
        self.assertEqual(self.server.posts, [])

    def test_duplicate_clicks_with_same_spec_send_once(self):
        spec = self.artifacts()
        with ThreadPoolExecutor(max_workers=5) as workers:
            results = list(workers.map(lambda _: self.bridge.start("same validated work", validation=spec), range(5)))
        self.assertEqual(len({result["run_id"] for result in results}), 1)
        self.assertEqual(len(self.server.posts), 1)

    def test_failed_cancelled_interrupted_skip_read_and_unknown_waits(self):
        spec = self.artifacts()
        with patch("core_work.validate_artifacts") as checker:
            for status in ("failed", "cancelled", "interrupted", "unknown"):
                receipt = self.bridge.start("status " + status, validation=spec)
                self.bridge._update(receipt["run_id"], status=status)
                result = next(item for item in self.bridge.list() if item["run_id"] == receipt["run_id"])
                self.assertEqual(result["validation"]["status"], "pending" if status == "unknown" else "failed")
                if status != "unknown":
                    self.assertEqual(result["validation"]["phase"], "not_run")
            checker.assert_not_called()
        self.assertEqual(len(self.server.posts), 4)

    def test_replacing_spec_discards_stale_worker_result(self):
        spec = self.artifacts()
        entered, release = threading.Event(), threading.Event()
        def checker(current, **kwargs):
            if current["checks"][0]["path"] == "report.md":
                entered.set()
                release.wait(3)
            return validate_artifacts(current, **kwargs)
        with patch("core_work.validate_artifacts", side_effect=checker):
            receipt = self.bridge.start("replace local checks", validation=spec)
            self.complete(receipt)
            self.assertTrue(entered.wait(1))
            newer = {**spec, "checks": [{"kind": "file", "path": "missing.txt"}]}
            self.bridge.validate(receipt["run_id"], newer)
            self.assertEqual(self.verified(receipt["run_id"])["validation"]["status"], "failed")
            release.set()
            deadline = time.monotonic() + 2
            while self.bridge.validation_workers and time.monotonic() < deadline:
                threading.Event().wait(0.01)
        self.assertEqual(self.bridge.validation_workers, {})
        self.assertEqual(self.verified(receipt["run_id"])["validation"]["status"], "failed")
        self.assertEqual(len(self.server.posts), 1)

    def test_observer_does_not_duplicate_live_validation_claim(self):
        spec = self.artifacts()
        entered, release = threading.Event(), threading.Event()
        def checker(*args, **kwargs):
            entered.set()
            release.wait(3)
            return validate_artifacts(*args, **kwargs)
        observer = core_work.WorkBridge(self.directory, auto_start=False)
        try:
            with patch("core_work.validate_artifacts", side_effect=checker) as check:
                receipt = self.bridge.start("one verification owner", validation=spec)
                self.complete(receipt)
                self.assertTrue(entered.wait(1))
                for _ in range(3):
                    self.assertEqual(observer.list()[0]["validation"]["status"], "pending")
                self.assertEqual(check.call_count, 1)
                self.assertEqual(observer.validation_workers, {})
                release.set()
                self.assertEqual(self.verified(receipt["run_id"], observer)["validation"]["status"], "passed")
        finally:
            release.set()
            observer.close()
        self.assertEqual(len(self.server.posts), 1)

    def test_restart_recovers_dead_owner_without_resubmission(self):
        receipt = self.bridge.start("recover verification only")
        self.complete(receipt)
        spec = normalize_spec(self.artifacts())
        with self.bridge.lock:
            self.bridge.db.execute("UPDATE work SET validation_spec=?,validation_result=?,validation_owner_pid=?,validation_claim=? WHERE id=?",
                (json.dumps(spec), json.dumps(pending_result()), 2147483647, "abandoned", receipt["run_id"]))
            self.bridge.db.commit()
        self.bridge.close()
        self.bridge = core_work.WorkBridge(self.directory, auto_start=False)
        self.assertEqual(self.verified(receipt["run_id"])["validation"]["status"], "passed")
        self.assertEqual(len(self.server.posts), 1)

    def test_close_cancels_local_read_and_releases_claim_for_reopen(self):
        spec = self.artifacts()
        entered = threading.Event()
        def until_closed(current, cancelled):
            entered.set()
            deadline = time.monotonic() + 3
            while not cancelled() and time.monotonic() < deadline:
                threading.Event().wait(0.01)
            raise InterruptedError("stopped")
        with patch("core_work.validate_artifacts", side_effect=until_closed):
            receipt = self.bridge.start("close during local check", validation=spec)
            self.complete(receipt)
            self.assertTrue(entered.wait(1))
            self.bridge.close()
            self.assertEqual(self.bridge.validation_workers, {})
        self.bridge = core_work.WorkBridge(self.directory, auto_start=False)
        row = self.bridge._row(receipt["run_id"])
        self.assertIsNone(row["validation_claim"])
        self.assertIsNone(row["validation_owner_pid"])
        self.assertEqual(self.verified(receipt["run_id"])["validation"]["status"], "passed")
        self.assertEqual([path for path, _body, _key in self.server.posts], ["/v1/runs"])


if __name__ == "__main__":
    unittest.main()
