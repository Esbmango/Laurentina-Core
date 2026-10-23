"""Real SDK + local deterministic fake model endpoints; no paid API calls."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app

TEXT = "The user prefers jasmine tea."


class FakeModel(BaseHTTPRequestHandler):
    calls = 0
    failed = False
    chat_calls = 0

    def log_message(self, *args):
        pass

    def do_POST(self):
        FakeModel.calls += 1
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if FakeModel.failed:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"fake service unavailable"}}')
            return
        if self.path.endswith("/embeddings"):
            texts = body["input"]
            if isinstance(texts, str):
                texts = [texts]
            dimensions = body.get("dimensions", 16)
            vectors = []
            for text in texts:
                # Deliberately deterministic; this checks plumbing, not semantics.
                # Keep the fixture fact equivalent when wrapped in role-labelled
                # dialogue; no real semantic-model quality is asserted here.
                canonical = TEXT if TEXT in str(text) else str(text)
                digest = hashlib.sha256(canonical.encode()).digest()
                vector = [(digest[i % 32] - 127) / 127 for i in range(dimensions)]
                norm = math.sqrt(sum(value * value for value in vector))
                vector = [value / norm for value in vector]
                vectors.append(vector)
            result = {"object": "list", "model": body["model"],
                      "data": [{"object": "embedding", "index": i, "embedding": vector}
                               for i, vector in enumerate(vectors)],
                      "usage": {"prompt_tokens": 1, "total_tokens": 1}}
        elif self.path.endswith("/chat/completions"):
            FakeModel.chat_calls += 1
            prompt = json.dumps(body["messages"])
            if "Reply with OK" in prompt:
                content = "OK"
            elif '"ops"' in prompt or "\\\"ops\\\"" in prompt or "RECONCILE" in prompt:
                content = json.dumps({"ops": [{"op": "ADD", "content": TEXT,
                                               "layer": "L2_FACT", "owner": "user",
                                               "tags": ["tea"]}]})
            else:
                content = json.dumps({"memory": [{"content": TEXT, "tags": ["tea"],
                                                  "owner": "user"}],
                                      "intentions": [], "basic_info": {}})
            result = {"id": "test-completion", "object": "chat.completion", "created": 1,
                      "model": body["model"], "choices": [{"index": 0, "finish_reason": "stop",
                      "message": {"role": "assistant", "content": content}}],
                      "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def request(url, payload=None, token=None, headers=None):
    actual_headers = dict(headers or {})
    if payload is not None:
        actual_headers["Content-Type"] = "application/json"
        if token:
            actual_headers["X-HyMemory-Token"] = token
    req = Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=actual_headers)
    try:
        with urlopen(req, timeout=120) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code >= 500:
            print("Unexpected local test error:", exc.read(2000).decode("utf-8"), flush=True)
        raise


def expect_http(status, action):
    try:
        action()
        raise AssertionError(f"Expected HTTP {status}")
    except HTTPError as exc:
        assert exc.code == status, exc.code


def worker(directory):
    service = app.MemoryService(Path(directory))
    try:
        result = service.search(TEXT)
        assert any(TEXT in row["content"] for row in result["memories"]), result
        print("PERSISTENCE_OK", flush=True)
    finally:
        service.close()


def main():
    directory = app.ROOT / ".local" / "t" / uuid.uuid4().hex[:8]
    directory.mkdir(parents=True)
    # Avoid OS temp/cache locations: all test artifacts remain under this project.
    os.environ["TIKTOKEN_CACHE_DIR"] = str(directory / "token-cache")
    model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
    model.daemon_threads = True
    threading.Thread(target=model.serve_forever, daemon=True).start()
    endpoint = f"http://127.0.0.1:{model.server_port}/v1"
    service = app.MemoryService(directory / "lite")
    server = app.AppServer(("127.0.0.1", 0), service)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}"
    token = server.token
    checks = []

    try:
        status = request(url + "/api/status")
        assert status["version"] == "2.0.4" and not status["configured"]
        assert FakeModel.calls == 0
        expect_http(403, lambda: request(url + "/api/config", {}, "invalid-token"))
        expect_http(403, lambda: request(url + "/api/config", {}, token,
                                       {"Origin": "https://untrusted.example"}))
        expect_http(403, lambda: request(url + "/api/status", headers={"Host": "untrusted.example"}))
        expect_http(400, lambda: request(url + "/api/add", {"text": TEXT}, token))
        assert FakeModel.calls == 0
        checks.append("Unconfigured state and local request protections")

        config = {**app.DEFAULTS, "mode": "lite", "embed_url": endpoint,
                  "embed_model": "mock-embedding", "embed_key": "test-secret-do-not-expose", "dimensions": 16}
        saved = request(url + "/api/config", config, token)
        assert "embed_key" not in saved["config"]
        assert saved["config"]["embed_key_saved"]
        assert b"test-secret-do-not-expose" not in service.store.path.read_bytes()
        assert app.ConfigStore(directory / "lite").load()["embed_key"] == config["embed_key"]
        blank = {**config, "embed_key": ""}
        request(url + "/api/config", blank, token)
        assert service.config["embed_key"] == config["embed_key"]
        moved = app.validated_config({**blank, "embed_url": endpoint + "/other"}, config)
        assert not moved["embed_key"]
        checks.append("Windows encrypted save, masked responses, safe key retention")

        assert request(url + "/api/check", {}, token)["ok"]
        added = request(url + "/api/add", {"text": TEXT}, token)
        assert added["result"]["success"], added
        found = request(url + "/api/search", {"text": TEXT}, token)
        assert any(TEXT in row["content"] for row in found["memories"]), found
        isolated = service.get_client().search(TEXT, user_ids=["different-user"], scene="chat", min_score=0)
        assert not any(isolated["memories"].values()), isolated
        assert FakeModel.chat_calls == 0
        checks.append("Real Lite write, search, and user isolation without LLM calls")

        FakeModel.failed = True
        expect_http(400, lambda: request(url + "/api/search", {"text": "an uncached new question"}, token))
        FakeModel.failed = False
        checks.append("API failures shown as errors, not empty successful searches")

        service.close()
        child = subprocess.run([sys.executable, "-B", "-X", "utf8", __file__, "--worker", str(directory / "lite")],
                               capture_output=True, text=True, encoding="utf-8", timeout=120)
        assert child.returncode == 0 and "PERSISTENCE_OK" in child.stdout, (child.returncode, child.stdout, child.stderr)
        checks.append("Memory survives a completely new Python process")

        pro = app.MemoryService(directory / "pro")
        try:
            pro.save({**config, "mode": "pro", "llm_url": endpoint,
                      "llm_model": "mock-chat", "llm_key": "test-chat-secret"})
            assert app.check_connections(pro.config)["ok"]
            result = pro.add(TEXT)
            assert result["result"].get("agent_status") == "success", result
            found = pro.search(TEXT)
            assert any(TEXT in row["content"] for row in found["memories"]), found
            assert FakeModel.chat_calls >= 2
            checks.append("Real Pro fact extraction and recall with a mock chat API")
        finally:
            pro.close()

        scope_a, scope_b = "a" * 32, "b" * 32
        print("SELFTEST: starting Hermes API isolation", flush=True)
        turn = {"scope": scope_a, "turn_id": hashlib.sha256(b"integration-turn").hexdigest(),
                "user": TEXT, "assistant": "Noted.", "session_id": "first-session"}
        first = request(url + "/api/hermes/add", turn, token)
        print("SELFTEST: Hermes write completed", flush=True)
        second = request(url + "/api/hermes/add", turn, token)
        print("SELFTEST: Hermes duplicate completed", flush=True)
        assert first["ok"] and not first["deduplicated"] and second["deduplicated"]
        found = request(url + "/api/hermes/search", {"scope": scope_a, "text": TEXT}, token)
        assert any(TEXT in memory["content"] for memory in found["memories"]), found
        other = request(url + "/api/hermes/search", {"scope": scope_b, "text": TEXT}, token)
        assert not other["memories"], other
        checks.append("Hermes scope isolation and completed-turn retry deduplication")

        report = {"passed": len(checks), "checks": checks,
                  "note": "Local fake models; paid provider and real semantic quality not tested."}
        (app.ROOT / ".local" / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
    finally:
        FakeModel.failed = False
        server.shutdown()
        server.server_close()
        server.close_memories()
        model.shutdown()
        model.server_close()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        worker(sys.argv[2])
    else:
        main()
