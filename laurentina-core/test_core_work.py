"""Actual adapter against isolated loopback Runs fixture, no model or tool calls."""
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import uuid

from core_work import WorkBridge, protect_work_key, unprotect_work_key, _WorkUnavailable

KEY = "test-only-private-hermes-key-012345"


class FakeDesktop:
    def __init__(self):
        self.items = [{"id": str(uuid.uuid4()), "kind": kind, "title": title}
            for kind, title in (("codex", "真实 Codex 标题"), ("chatgpt", "真实 ChatGPT 标题"))]
        self.states, self.records, self.sends = {}, {}, []
        self.uncertain = False
        for item in self.items:
            self.states[item["id"]] = {"thread": {"id": item["id"], "status": {"type": "idle"}},
                "turns": [{"id": "old-turn", "status": "completed", "items": [{"type": "agentMessage", "text": "旧回复"}]}]}

    def conversations(self, query="", limit=50):
        return {"ok": True, "conversations": [item for item in self.items if query in item["title"]]}

    def read(self, identity):
        conversation = self.states[identity]
        latest = conversation["turns"][0]
        return {"ok": True, "conversation": conversation,
            "reply_ready": latest["id"] != "old-turn" and latest["status"] == "completed"}

    def send(self, identity, text):
        self.sends.append((identity, text))
        request_id = uuid.uuid4().hex
        self.records[request_id] = {"id": request_id, "thread_id": identity, "previous_turn": "old-turn",
            "state": "accepted", "is_latest": True}
        if self.uncertain:
            raise TimeoutError("unknown delivery")
        return {"ok": True, "thread_id": identity, "request_id": request_id}

    def request(self, desktop, request_id, identity):
        return self.records.get(request_id)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def auth(self):
        if self.headers.get("Authorization") != "Bearer " + KEY:
            self.send_json(401, {"error": {"message": "Invalid API key"}})
            return False
        return True

    def do_GET(self):
        if not self.auth():
            return
        if self.path == "/v1/capabilities":
            return self.send_json(200, {"object": "hermes.api_server.capabilities", "platform": "hermes-agent",
                "model": self.server.model_name, "auth": {"type": "bearer", "required": True},
                "features": {name: True for name in ("run_submission", "run_status", "run_stop", "run_approval_response")}})
        parts = self.path.split("/")
        remote = parts[3] if len(parts) >= 4 else ""
        run = self.server.runs.get(remote)
        if not run:
            return self.send_json(404, {"error": {"message": "No run"}})
        if self.path.endswith("/events"):
            events = self.server.events.get(remote, [])
            last = int(self.headers.get("Last-Event-ID", "-1"))
            data = b": open\n\n"
            for event in events:
                if event["seq"] > last:
                    data += f'id: {event["seq"]}\ndata: {json.dumps(event)}\n\n'.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self.send_json(200, run)

    def do_POST(self):
        if not self.auth():
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        self.server.posts.append((self.path, body, self.headers.get("Idempotency-Key")))
        if self.path == "/v1/runs":
            remote = "run_" + uuid.uuid4().hex
            self.server.runs[remote] = {"object": "hermes.run", "run_id": remote, "status": "running", "session_id": remote}
            self.server.events[remote] = [{"event": "message.delta", "run_id": remote, "seq": 0, "delta": "真实进度"},
                {"event": "reasoning.available", "run_id": remote, "seq": 1, "text": "PRIVATE REASONING"},
                {"event": "tool.started", "run_id": remote, "seq": 2, "tool": "read_file", "preview": "README"}]
            return self.send_json(202, {"run_id": remote, "status": "started"})
        parts = self.path.split("/")
        remote = parts[3] if len(parts) >= 4 else ""
        run = self.server.runs.get(remote)
        if not run:
            return self.send_json(404, {"error": {"message": "No run"}})
        if self.path.endswith("/stop"):
            run["status"] = "stopping"
            return self.send_json(200, {"run_id": remote, "status": "stopping"})
        if self.path.endswith("/approval"):
            run["status"] = "running"
            run.pop("approval", None)
            return self.send_json(200, {"object": "hermes.run.approval_response", "run_id": remote,
                "request_id": body["request_id"], "choice": body["choice"], "resolved": 1})
        return self.send_json(404, {})


class WorkTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent / ".local/test-work"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="runs-", dir=root)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.server.model_name = "laurentina-core"
        self.server.runs, self.server.events, self.server.posts = {}, {}, []
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.directory = Path(self.temp.name)
        self.connection = {"url": f"http://127.0.0.1:{self.server.server_port}", "key_dpapi": protect_work_key(KEY),
            "model_name": "laurentina-core", "model": "qwen3.5:9b", "provider": "local Qwen"}
        (self.directory / "hermes-api.json").write_text(json.dumps(self.connection), encoding="utf-8")
        self.env = patch.dict("os.environ", {"LAURENTINA_HERMES_URL": "", "LAURENTINA_HERMES_API_KEY": ""})
        self.env.start()
        self.bridge = WorkBridge(self.directory, auto_start=False)
        self.desktop = patch.object(self.bridge, "_desktop", return_value=None)
        self.desktop.start()
        self.memory = patch.object(self.bridge, "_shared_context", side_effect=lambda text: text)
        self.memory.start()

    def tearDown(self):
        self.memory.stop()
        self.desktop.stop()
        self.bridge.close()
        self.server.shutdown()
        self.worker.join(timeout=2)
        self.server.server_close()
        self.env.stop()
        self.temp.cleanup()

    def settled(self, run_id):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.bridge.poll(run_id)
            if result["status"] != "submitting":
                return result
            threading.Event().wait(0.02)
        self.fail("background submission did not settle")

    def test_real_http_admission_stream_progress_completion_and_persistence(self):
        self.assertTrue(self.bridge.health()["ok"])
        self.assertEqual(self.bridge.targets()[0]["model"], "qwen3.5:9b")
        started = self.bridge.start("Only this explicit work instruction")
        self.assertTrue(started["remote_run_id"].startswith("run_"))
        self.assertEqual(self.server.posts[0][2], started["run_id"])
        self.assertEqual(set(self.server.posts[0][1]), {"input", "model_options"})
        deadline = time.monotonic() + 3
        result = self.bridge.poll(started["run_id"])
        while (not result["text"] or not any(event["event"] == "tool.started" for event in result["events"])) and time.monotonic() < deadline:
            threading.Event().wait(0.03)
            result = self.bridge.poll(started["run_id"])
        self.assertEqual(result["text"], "真实进度")
        self.assertTrue(any(event["event"] == "tool.started" for event in result["events"]))
        self.assertNotIn("PRIVATE REASONING", json.dumps(result))
        remote = started["remote_run_id"]
        self.server.runs[remote].update(status="completed", output="实际完成结果")
        self.assertEqual(self.bridge.poll(started["run_id"])["text"], "实际完成结果")
        self.bridge.close()
        self.bridge = WorkBridge(self.directory, auto_start=False)
        self.assertEqual(self.bridge.list()[0]["text"], "实际完成结果")
        self.assertEqual(len(self.server.posts), 1)

    def test_known_runtime_hint_reaches_hermes_without_changing_user_task_record(self):
        with patch.object(self.bridge, "_runtime_context", return_value="\n\nVerified local Python: /known/python.exe"):
            started = self.bridge.start("Create an explicitly requested report")
        self.assertEqual(started["content"], "Create an explicitly requested report")
        payload = self.server.posts[0][1]["input"]
        self.assertTrue(payload.startswith("Create an explicitly requested report"))
        self.assertIn("/known/python.exe", payload)
        self.assertNotIn(KEY, payload)

    def test_windows_encrypted_key_never_persisted_to_database_or_file(self):
        self.assertEqual(unprotect_work_key(self.connection["key_dpapi"]), KEY)
        self.assertNotIn(KEY, (self.directory / "hermes-api.json").read_text(encoding="utf-8"))
        started = self.bridge.start("check encrypted credentials")
        self.assertNotIn(KEY, json.dumps(self.bridge.list()))
        with self.bridge.lock:
            self.bridge.db.execute("PRAGMA wal_checkpoint(FULL)")
        self.assertNotIn(KEY.encode(), (self.directory / "work.sqlite3").read_bytes())
        self.connection["key"] = KEY
        (self.directory / "hermes-api.json").write_text(json.dumps(self.connection), encoding="utf-8")
        self.assertFalse(self.bridge.health()["ok"])
        with self.assertRaises(RuntimeError):
            unprotect_work_key("invalid ciphertext")

    def test_duplicate_submission_and_concurrent_clicks_send_once(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            runs = list(pool.map(lambda _: self.bridge.start("same work"), range(5)))
        self.assertEqual(len({item["run_id"] for item in runs}), 1)
        self.assertEqual(len(self.server.posts), 1)

    def test_unknown_delivery_has_receipt_and_never_resends(self):
        real = self.bridge._json
        def uncertain(connection, path, payload=None, **kwargs):
            if path == "/v1/runs":
                raise RuntimeError("connection lost")
            return real(connection, path, payload, **kwargs)
        with patch.object(self.bridge, "_json", side_effect=uncertain):
            first = self.bridge.start("uncertain job")
        self.assertEqual(first["status"], "unknown")
        self.assertEqual(self.bridge.start("uncertain job")["run_id"], first["run_id"])
        self.assertEqual(self.bridge.poll(first["run_id"])["status"], "unknown")
        with self.assertRaisesRegex(RuntimeError, "尚未确认"):
            self.bridge.stop(first["run_id"])
        self.assertEqual(self.server.posts, [])

    def test_approval_needs_exact_current_user_choice_and_request(self):
        started = self.bridge.start("work requiring approval")
        remote = started["remote_run_id"]
        self.server.runs[remote].update(status="waiting_for_approval", approval={"request_id": "approval-1",
            "choices": ["once", "deny"], "command": "a bounded command", "reason": "Requires decision"})
        result = self.bridge.poll(started["run_id"])
        self.assertEqual(result["approval"]["choices"], ["once", "deny"])
        with self.assertRaises(ValueError):
            self.bridge.approve(started["run_id"], "once")
        with self.assertRaises(ValueError):
            self.bridge.approve(started["run_id"], {"choice": "always", "request_id": "approval-1"})
        with self.assertRaises(ValueError):
            self.bridge.approve(started["run_id"], {"choice": "once", "request_id": "stale"})
        self.assertEqual(len(self.server.posts), 1)
        result = self.bridge.approve(started["run_id"], {"choice": "deny", "request_id": "approval-1"})
        self.assertEqual(result["status"], "running")
        self.assertEqual(self.server.posts[-1][1], {"choice": "deny", "request_id": "approval-1"})

    def test_stop_reports_stopping_then_actual_cancelled(self):
        started = self.bridge.start("long work")
        result = self.bridge.stop(started["run_id"])
        self.assertEqual(result["status"], "stopping")
        self.server.runs[started["remote_run_id"]].update(status="cancelled", output="")
        self.assertEqual(self.bridge.poll(started["run_id"])["status"], "cancelled")

    def test_fail_closed_identity_remote_url_foreign_run_and_target(self):
        self.server.model_name = "another-agent"
        self.assertFalse(self.bridge.health()["ok"])
        with self.assertRaisesRegex(RuntimeError, "身份不匹配"):
            self.bridge.start("must not send")
        self.assertEqual(self.server.posts, [])
        self.connection["url"] = "https://cloud.invalid"
        (self.directory / "hermes-api.json").write_text(json.dumps(self.connection), encoding="utf-8")
        self.assertFalse(self.bridge.health()["ok"])
        with self.assertRaises(ValueError):
            self.bridge.start("task", target={"kind": "codex", "id": "invented"})
        with self.assertRaises(ValueError):
            self.bridge.poll("run_" + uuid.uuid4().hex)

    def test_restarted_submitting_receipt_unknown_without_submission(self):
        started = self.bridge.start("original task")
        self.bridge._update(started["run_id"], status="submitting", remote_id=None)
        self.bridge.db.execute("UPDATE work SET owner_pid=99999999 WHERE id=?", (started["run_id"],))
        self.bridge.db.commit()
        self.bridge.close()
        self.bridge = WorkBridge(self.directory, auto_start=False)
        self.assertEqual(self.bridge.list()[0]["status"], "unknown")
        self.assertEqual(len(self.server.posts), 1)

    def test_health_instance_does_not_interrupt_live_submission(self):
        started = self.bridge.start("another task")
        self.bridge._update(started["run_id"], status="submitting")
        observer = WorkBridge(self.directory, auto_start=False)
        try:
            self.assertTrue(observer.health()["ok"])
            self.assertEqual(observer.list()[0]["status"], "submitting")
        finally:
            observer.close()

    def test_external_real_ids_fresh_turns_and_no_old_reply_or_extra_messages(self):
        desktop = FakeDesktop()
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
            patch.object(self.bridge, "_desktop_request", side_effect=desktop.request):
            listed = self.bridge.targets()
            self.assertEqual({item["kind"] for item in listed}, {"hermes", "codex", "chatgpt"})
            for target in desktop.items:
                started = self.bridge.start("explicit external work", target={**target, "title": "invented display title"})
                started = self.settled(started["run_id"])
                self.assertEqual(started["target"]["title"], target["title"])
                duplicate = self.bridge.start("explicit external work", target=target)
                self.assertEqual(duplicate["run_id"], started["run_id"])
                pending = self.bridge.poll(started["run_id"])
                self.assertEqual(pending["status"], "running")
                self.assertEqual(pending["text"], "")
                desktop.states[target["id"]]["turns"] = [{"id": "fresh-turn", "status": "in_progress", "items": []}]
                self.assertEqual(self.bridge.poll(started["run_id"])["text"], "")
                desktop.states[target["id"]]["turns"] = [{"id": "fresh-turn", "status": "completed", "items": [
                    {"type": "agentMessage", "phase": "commentary", "text": "处理中"},
                    {"type": "agentMessage", "text": "实际新回复"}]}]
                final = self.bridge.poll(started["run_id"])
                self.assertEqual(final["status"], "completed")
                self.assertEqual(final["text"], "实际新回复")
                self.assertFalse(final["supports_stop"])
            self.assertEqual(len(desktop.sends), 2)
            self.assertTrue(all(text == "explicit external work" for _, text in desktop.sends))
        self.assertEqual(self.server.posts, [])

    def test_external_active_wrong_kind_and_intervening_request_fail_closed(self):
        desktop = FakeDesktop()
        target = desktop.items[0]
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
            patch.object(self.bridge, "_desktop_request", side_effect=desktop.request):
            wrong = self.bridge.start("task", target={"kind": "chatgpt", "id": target["id"]})
            self.assertEqual(self.settled(wrong["run_id"])["status"], "failed")
            desktop.states[target["id"]]["thread"]["status"] = {"type": "working"}
            active = self.bridge.start("task", target=target)
            self.assertEqual(self.settled(active["run_id"])["status"], "failed")
            self.assertEqual(desktop.sends, [])
            desktop.states[target["id"]]["thread"]["status"] = {"type": "idle"}
            started = self.bridge.start("idle task", target=target)
            started = self.settled(started["run_id"])
            next(iter(desktop.records.values()))["is_latest"] = False
            desktop.states[target["id"]]["turns"] = [{"id": "other-turn", "status": "completed", "items": [
                {"type": "agentMessage", "text": "unrelated reply"}]}]
            result = self.bridge.poll(started["run_id"])
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(result["text"], "")

    def test_external_uncertain_delivery_never_retries_or_claims_stop(self):
        desktop = FakeDesktop()
        desktop.uncertain = True
        target = desktop.items[0]
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
            patch.object(self.bridge, "_desktop_request", side_effect=desktop.request):
            first = self.bridge.start("uncertain external task", target=target)
            first = self.settled(first["run_id"])
            self.assertEqual(first["status"], "unknown")
            self.assertEqual(self.bridge.start("uncertain external task", target=target)["run_id"], first["run_id"])
            self.assertEqual(len(desktop.sends), 1)
            with self.assertRaisesRegex(RuntimeError, "对应的"):
                self.bridge.stop(first["run_id"])

    def test_external_returns_immediate_receipt_before_slow_preflight(self):
        desktop, gate = FakeDesktop(), threading.Event()
        original = desktop.conversations
        def slow(*args, **kwargs):
            gate.wait(2)
            return original(*args, **kwargs)
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
            patch.object(desktop, "conversations", side_effect=slow), \
            patch.object(self.bridge, "_desktop_request", side_effect=desktop.request):
            before = time.monotonic()
            receipt = self.bridge.start("slow lookup", target=desktop.items[0])
            self.assertLess(time.monotonic() - before, 0.5)
            self.assertEqual(receipt["status"], "submitting")
            self.assertEqual(self.bridge.poll(receipt["run_id"])["text"], "")
            self.assertEqual(desktop.sends, [])
            gate.set()
            self.assertEqual(self.settled(receipt["run_id"])["status"], "running")

    def test_native_cold_start_hidden_bounded_singleflight_and_retry(self):
        observer = WorkBridge(self.directory, auto_start=True)
        try:
            with patch.object(observer, "_verified_once", side_effect=[_WorkUnavailable("offline"),
                _WorkUnavailable("offline"), {**self.connection, "key": KEY}]), \
                patch("core_work.subprocess.run", return_value=SimpleNamespace(returncode=0)) as run:
                self.assertTrue(observer.health()["ok"])
            args, kwargs = run.call_args
            self.assertIn("setup_work.py", args[0][-3])
            self.assertEqual(kwargs["timeout"], 60)
            self.assertEqual(kwargs["env"]["LAURENTINA_WORK_AUTO_START"], "0")
            self.assertNotIn(KEY, str(args))
            self.assertNotIn("--force", args[0])
        finally:
            observer.close()

    def test_native_identity_auth_and_bad_metadata_never_cold_start(self):
        observer = WorkBridge(self.directory, auto_start=True)
        try:
            self.server.model_name = "other-agent"
            with patch("core_work.subprocess.run") as run:
                self.assertFalse(observer.health()["ok"])
                self.server.model_name = "laurentina-core"
                self.connection["key_dpapi"] = protect_work_key("wrong-test-api-key-0123456789")
                (self.directory / "hermes-api.json").write_text(json.dumps(self.connection), encoding="utf-8")
                self.assertFalse(observer.health()["ok"])
                self.connection["url"] = "https://remote.invalid"
                (self.directory / "hermes-api.json").write_text(json.dumps(self.connection), encoding="utf-8")
                self.assertFalse(observer.health()["ok"])
                run.assert_not_called()
        finally:
            observer.close()

    def test_native_cold_start_concurrent_instances_launch_once(self):
        ready = threading.Event()
        observers = [WorkBridge(self.directory, auto_start=True) for _ in range(5)]
        def probe(instance):
            if not ready.is_set():
                raise _WorkUnavailable("offline")
            return {**self.connection, "key": KEY}
        def launch(*args, **kwargs):
            ready.wait(0.03)
            ready.set()
            return SimpleNamespace(returncode=0)
        try:
            with patch.object(WorkBridge, "_verified_once", probe), \
                patch("core_work.subprocess.run", side_effect=launch) as run:
                with ThreadPoolExecutor(max_workers=5) as pool:
                    results = list(pool.map(lambda observer: observer.health(), observers))
                self.assertTrue(all(result["ok"] for result in results))
                self.assertEqual(run.call_count, 1)
        finally:
            for observer in observers:
                observer.close()

    def test_native_failed_cold_start_is_throttled_without_launch_storm(self):
        observer = WorkBridge(self.directory, auto_start=True)
        try:
            with patch.object(observer, "_verified_once", side_effect=_WorkUnavailable("offline")), \
                patch("core_work.subprocess.run", return_value=SimpleNamespace(returncode=1)) as run:
                self.assertFalse(observer.health()["ok"])
                self.assertFalse(observer.health()["ok"])
                self.assertEqual(run.call_count, 1)
        finally:
            observer.close()

    def test_desktop_disconnect_is_observable_without_extra_health_bridge_calls(self):
        desktop = FakeDesktop()
        with patch.object(self.bridge, "_desktop", return_value=desktop), \
            patch.object(self.bridge, "_desktop_configured", return_value=True), \
            patch.object(desktop, "conversations", side_effect=FileNotFoundError("ENOENT secret-pipe-path")) as listing:
            targets = self.bridge.targets()
            self.assertEqual([item["kind"] for item in targets], ["hermes"])
            health = self.bridge.health()
            self.assertTrue(health["ok"])
            status = health["desktop_bridge"]
            self.assertEqual(status["state"], "disconnected")
            self.assertTrue(status["configured"])
            self.assertTrue(status["checked_at"])
            self.assertIn("重新连接", status["error"])
            self.assertNotIn("secret-pipe-path", json.dumps(health))
            self.assertNotIn("ENOENT", json.dumps(health))
            self.assertEqual(listing.call_count, 1)
            listing.side_effect = None
            listing.return_value = {"ok": True, "conversations": []}
            self.assertEqual([item["kind"] for item in self.bridge.targets()], ["hermes"])
            self.assertEqual(self.bridge.health()["desktop_bridge"]["state"], "connected")
            self.assertEqual(listing.call_count, 2)
        with patch.object(self.bridge, "_desktop_configured", return_value=False):
            self.assertEqual(self.bridge.health()["desktop_bridge"]["state"], "unconfigured")


if __name__ == "__main__":
    unittest.main(verbosity=2)
