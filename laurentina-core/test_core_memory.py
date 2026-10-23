"""Isolated memory contract/privacy tests. Never opens the live Qdrant store."""
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "hy-memory-starter"))
import app
from core_memory import MemoryBridge, _ServiceUnavailable


class FakeClient:
    def __init__(self):
        self.rows = {}
        self.calls = []
        self.bad_save = False
        self.bad_search = False
        self.noop = False
        self.wrong_get = False

    def list_memories(self, **args):
        self.calls.append(("list", args))
        rows = [dict(row) for row in self.rows.values() if row["user_id"] == args["user_id"]]
        return {"vdb": {"memories": rows[:args["limit"]], "total": len(rows)}}

    def search(self, query, **args):
        self.calls.append(("search", args))
        if self.bad_search:
            return {"memories": {"normal": []}}
        rows = [dict(row) for row in self.rows.values() if row["user_id"] in args["user_ids"]]
        return {"rewrite": query, "memories": {"normal": rows[:args["limit"]]}}

    def add_extracted(self, content, **args):
        self.calls.append(("add", args))
        if self.bad_save:
            return {"success": True, "agent_status": "failed", "memory_id": None}
        if self.noop:
            return {"success": True, "agent_status": "success", "memory_id": "", "memory_ids": []}
        identity = str(uuid.uuid4())
        self.rows[identity] = {"memory_id": identity, "content": content, "user_id": args["user_id"],
            "source": args["source"], "agent_id": args["agent_id"], "status": "active", "gmt_created": 123}
        return {"success": True, "agent_status": "success", "memory_id": identity, "memory_ids": [identity]}

    def get(self, identity):
        self.calls.append(("get", identity))
        row = self.rows.get(identity)
        if row and self.wrong_get:
            return {**row, "memory_id": "another-id"}
        return dict(row) if row else None

    def delete(self, identity):
        self.calls.append(("delete", identity))
        deleted = self.rows.pop(identity, None) is not None
        return {"success": deleted, "deleted_count": int(deleted)}


class MemoryTests(unittest.TestCase):
    def setUp(self):
        MemoryBridge._start_attempts.clear()
        directory = ROOT / "hy-memory-starter/.local/test-work"
        directory.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="core-memory-", dir=directory)
        self.client = FakeClient()
        self.service = app.MemoryService(Path(self.temp.name))
        self.service.config = {**app.DEFAULTS, "mode": "pro", "llm_url": "http://127.0.0.1:11434/v1",
            "embed_url": "http://127.0.0.1:11434/v1", "llm_model": "fake", "embed_model": "fake",
            "llm_key": "test-unused", "embed_key": "test-unused"}
        self.service.get_client = lambda: self.client
        self.shared = "a" * 32
        self.server = app.AppServer(("127.0.0.1", 0), self.service, self.shared)
        self.private = self.server.core_scope("private")
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        connection = Path(self.temp.name) / "connection.json"
        connection.write_text(json.dumps({"url": self.url}), encoding="utf-8")
        self.bridge = MemoryBridge(connection_path=connection)

    def tearDown(self):
        self.server.shutdown()
        self.worker.join(timeout=3)
        self.server.server_close()
        self.server.close_memories()
        self.temp.cleanup()

    def seed(self, content, namespace=None, source="hermes"):
        identity = str(uuid.uuid4())
        self.client.rows[identity] = {"memory_id": identity, "content": content,
            "user_id": namespace or self.shared, "agent_id": app.AGENT_ID, "source": source}
        return identity

    def test_scoped_library_includes_existing_other_assistants(self):
        shared_id = self.seed("Existing Hermes fact")
        private_id = self.seed("Private detail", self.private)
        self.assertEqual(self.private, self.server.core_scope("private"))
        with self.assertRaises(app.UserError):
            self.server.validate_scope(self.private)
        self.assertEqual([item["id"] for item in self.bridge.list()], [shared_id])
        self.assertEqual([item["id"] for item in self.bridge.list("private")], [private_id])
        self.assertEqual(self.service.default_user_id, self.shared)
        self.assertEqual([item["id"] for item in self.bridge.search("detail", "private")], [private_id])

    def test_write_needs_verified_scoped_id_and_success_status(self):
        saved = self.bridge.remember("Explicit stable fact", "private", category="identity")
        self.assertTrue(saved["ok"])
        self.assertEqual(saved["id"], saved["memory_id"])
        self.assertEqual(saved["agent_status"], "success")
        self.assertEqual(saved["category"], "identity")
        self.assertEqual(self.client.rows[saved["id"]]["user_id"], self.private)
        self.assertEqual(self.bridge.list("private")[0]["category"], "identity")
        self.client.bad_save = True
        with self.assertRaisesRegex(RuntimeError, "写入未成功"):
            self.bridge.remember("Must never be marked saved")
        self.client.bad_save = False
        self.client.wrong_get = True
        with self.assertRaisesRegex(RuntimeError, "编号验证失败"):
            self.bridge.remember("Wrong returned identity")

    def test_reconcile_noop_requires_exact_scoped_existing_fact(self):
        existing = self.seed("Exact durable fact")
        self.client.noop = True
        self.assertEqual(self.bridge.remember("Exact durable fact")["id"], existing)
        with self.assertRaisesRegex(RuntimeError, "尚不能确认"):
            self.bridge.remember("Different fact")

    def test_delete_guards_namespace_target_identity_and_neighbors(self):
        identity = self.seed("Private", self.private)
        with self.assertRaisesRegex(RuntimeError, "归属验证失败"):
            self.bridge.delete(identity, "shared")
        self.assertIn(identity, self.client.rows)
        self.client.wrong_get = True
        with self.assertRaisesRegex(RuntimeError, "编号验证失败"):
            self.bridge.delete(identity, "private")
        self.client.wrong_get = False
        foreign = self.seed("Another person's memory", "another-user")
        self.client.rows[identity]["supersedes"] = [foreign]
        with self.assertRaisesRegex(RuntimeError, "关联记忆归属"):
            self.bridge.delete(identity, "private")
        self.assertFalse(any(name == "delete" for name, _ in self.client.calls))
        own_predecessor = self.seed("Earlier private fact", self.private)
        self.client.rows[identity]["supersedes"] = [own_predecessor]
        with self.assertRaisesRegex(RuntimeError, "历史版本"):
            self.bridge.delete(identity, "private")
        self.assertFalse(any(name == "delete" for name, _ in self.client.calls))
        self.client.rows[identity]["supersedes"] = []
        self.assertTrue(self.bridge.delete(identity, "private")["ok"])
        self.assertIn(foreign, self.client.rows)

    def test_nonliteral_or_remote_endpoints_fail_before_any_sdk_use(self):
        for endpoint in ("https://cloud.invalid/v1", "http://localhost:11434/v1", "", "http://127.0.0.1:bad/v1"):
            self.service.config["llm_url"] = endpoint
            self.assertFalse(self.bridge.health()["ok"])
            for operation, payload in (("health", {}), ("list", {}), ("search", {"query": "q"}),
                ("remember", {"content": "f"}), ("delete", {"id": "id"})):
                with self.assertRaisesRegex(app.UserError, "本地模型"):
                    self.server.core_call(operation, {"scope": "private", **payload})
        self.assertEqual(self.client.calls, [])

    def test_search_failure_and_bounded_validation(self):
        self.client.bad_search = True
        with self.assertRaisesRegex(RuntimeError, "检索没有正常完成"):
            self.bridge.search("q")
        for value in (0, 101, True, "8"):
            with self.assertRaises(ValueError):
                self.bridge.list(limit=value)
        with self.assertRaises(ValueError):
            self.bridge.list("user-specified-namespace")
        with self.assertRaises(app.UserError):
            self.server.core_call("list", {"scope": self.private})
        self.client.bad_search = False
        identity = self.seed("Foreign malicious result", "different-user")
        self.client.search = lambda *a, **k: {"rewrite": "q", "memories": {"normal": [self.client.rows[identity]]}}
        with self.assertRaisesRegex(RuntimeError, "归属验证失败"):
            self.bridge.search("q")

    def test_http_protections_and_core_version(self):
        with urlopen(self.url + "/api/status") as response:
            self.assertEqual(json.load(response)["core_memory_version"], 1)
        self.assertTrue(self.bridge.health()["ok"])
        for headers in ({"X-HyMemory-Token": "wrong"},
            {"X-HyMemory-Token": self.server.token, "Origin": "https://foreign.invalid"},
            {"X-HyMemory-Token": self.server.token, "Host": "foreign.invalid"}):
            request = Request(self.url + "/api/core/list", data=b'{"scope":"shared"}',
                headers={"Content-Type": "application/json", **headers})
            with self.assertRaises(HTTPError) as caught:
                urlopen(request)
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()
        # An ignored user_id cannot override the server-owned namespace.
        self.server.core_call("list", {"scope": "shared", "user_id": self.private})
        self.assertEqual(self.client.calls[-1][1]["user_id"], self.shared)

    def test_status_identity_mismatch_prevents_any_memory_call(self):
        bridge = MemoryBridge(project_root=ROOT / "wrong-project", connection_path=self.bridge.connection_path)
        self.assertFalse(bridge.health()["ok"])
        self.assertEqual(self.client.calls, [])

    def test_cold_start_uses_hidden_sanitized_bounded_launcher_then_retries(self):
        with patch.object(self.bridge, "_probe_status", side_effect=[
            _ServiceUnavailable("missing"), _ServiceUnavailable("missing"), (self.url, "ready-token")]), \
            patch("core_memory.subprocess.run", return_value=SimpleNamespace(returncode=0)) as run, \
            patch.dict(os.environ, {"PYTHONHOME": "bad", "PYTHONPATH": "bad", "VIRTUAL_ENV": "bad", "PYTHONINSPECT": "1"}):
            self.assertEqual(self.bridge._status(), (self.url, "ready-token"))
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], str(self.bridge.project_root / ".venv/Scripts/python.exe"))
        self.assertEqual(args[0][-1], "--no-browser")
        self.assertIn("-E", args[0])
        self.assertEqual(kwargs["timeout"], 25)
        self.assertEqual(kwargs["creationflags"], getattr(__import__("subprocess"), "CREATE_NO_WINDOW", 0))
        self.assertFalse({"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "PYTHONINSPECT"} & set(kwargs["env"]))

    def test_cold_start_singleflight_across_threads_and_instances(self):
        ready = threading.Event()
        started = []
        bridges = [MemoryBridge(connection_path=self.bridge.connection_path) for _ in range(8)]
        def probe(instance):
            if not ready.is_set():
                raise _ServiceUnavailable("not ready")
            return self.url, "ready-token"
        def launch(*args, **kwargs):
            started.append(True)
            ready.wait(0.03)
            ready.set()
            return SimpleNamespace(returncode=0)
        with patch.object(MemoryBridge, "_probe_status", probe), patch("core_memory.subprocess.run", side_effect=launch):
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda bridge: bridge._status(), bridges))
        self.assertEqual(len(started), 1)
        self.assertTrue(all(item == (self.url, "ready-token") for item in results))

    def test_cold_start_failure_is_throttled_without_retry_storm(self):
        with patch.object(self.bridge, "_probe_status", side_effect=_ServiceUnavailable("missing")), \
            patch("core_memory.subprocess.run", return_value=SimpleNamespace(returncode=1)) as run:
            with self.assertRaisesRegex(RuntimeError, "无法启动"):
                self.bridge._status()
            with self.assertRaisesRegex(RuntimeError, "尚未就绪"):
                self.bridge._status()
            self.assertEqual(run.call_count, 1)

    def test_cold_start_only_for_missing_connection_or_unreachable_valid_loopback(self):
        missing = MemoryBridge(connection_path=Path(self.temp.name) / "missing.json")
        with self.assertRaises(_ServiceUnavailable):
            missing._probe_status()
        with patch.object(self.bridge.opener, "open", side_effect=URLError("connection refused")):
            with self.assertRaises(_ServiceUnavailable):
                self.bridge._probe_status()
        with patch.object(self.bridge.opener, "open", side_effect=HTTPError(self.url, 403, "forbidden", {}, None)):
            with self.assertRaises(RuntimeError) as caught:
                self.bridge._probe_status()
            self.assertNotIsInstance(caught.exception, _ServiceUnavailable)
        self.bridge.connection_path.write_text('{"url":"https://cloud.invalid"}', encoding="utf-8")
        with patch("core_memory.subprocess.run") as run:
            self.assertFalse(self.bridge.health()["ok"])
            run.assert_not_called()

    def test_cold_start_never_for_identity_config_or_old_core_version(self):
        with patch("core_memory.subprocess.run") as run:
            mismatch = MemoryBridge(project_root=ROOT / "wrong-project", connection_path=self.bridge.connection_path)
            self.assertFalse(mismatch.health()["ok"])
            self.service.config["llm_url"] = "https://cloud.invalid/v1"
            self.assertFalse(self.bridge.health()["ok"])
            run.assert_not_called()
        with patch.object(self.bridge, "_status", return_value=(self.url, "token")), \
            patch.object(self.bridge.opener, "open", side_effect=HTTPError(self.url, 404, "missing", {}, None)), \
            patch("core_memory.subprocess.run") as run:
            self.assertIn("重新启动", self.bridge.health()["error"])
            run.assert_not_called()

    def test_real_sdk_uses_separate_database_and_private_namespace(self):
        # Actual installed HyMemory + local Qdrant; deterministic model fixture.
        # The production service, config and database are never opened here.
        from http.server import ThreadingHTTPServer
        from selftest import FakeModel, TEXT
        FakeModel.failed = False
        model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        model.daemon_threads = True
        model_worker = threading.Thread(target=model.serve_forever, daemon=True)
        model_worker.start()
        service = app.MemoryService(Path(self.temp.name) / "real-sdk")
        endpoint = f"http://127.0.0.1:{model.server_port}/v1"
        service.config = {**self.service.config, "llm_url": endpoint, "embed_url": endpoint, "dimensions": 16}
        server = app.AppServer(("127.0.0.1", 0), service, self.shared)
        try:
            saved = server.core_call("remember", {"scope": "shared", "content": TEXT})
            private = server.core_call("remember", {"scope": "private", "content": TEXT})
            self.assertNotEqual(saved["id"], private["id"])
            self.assertEqual(server.core_call("list", {"scope": "shared"})["items"][0]["id"], saved["id"])
            self.assertEqual(server.core_call("list", {"scope": "private"})["items"][0]["id"], private["id"])
            hits = server.core_call("search", {"scope": "private", "query": TEXT})["items"]
            self.assertTrue(any(row["id"] == private["id"] for row in hits))
            with self.assertRaises(app.UserError):
                server.core_call("delete", {"scope": "shared", "id": private["id"]})
            self.assertTrue(server.core_call("delete", {"scope": "private", "id": private["id"]})["ok"])
            self.assertEqual(server.core_call("list", {"scope": "private"})["items"], [])
            self.assertTrue(server.core_call("list", {"scope": "shared"})["items"])
        finally:
            server.server_close()
            server.close_memories()
            model.shutdown()
            model_worker.join(timeout=3)
            model.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
