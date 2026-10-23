"""Isolated provider HTTP-stream fixtures; never contact a real AI provider."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import sys
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from core_providers import ProviderBridge, ProviderError, _NoRedirect

KEY = "provider-test-only-key-987654321"
MESSAGES = [{"role": "user", "content": "你好"}]
TEST_ROOT = Path(__file__).resolve().parent / ".local" / "provider-tests"


def isolated_directory():
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(prefix="isolated-", dir=TEST_ROOT)


def sse(*packets):
    return b"".join(b"data: " + (p.encode() if isinstance(p, str) else json.dumps(p, ensure_ascii=False).encode()) + b"\n\n" for p in packets)


def completed(text="你好"):
    return {"type": "response.completed", "response": {"status": "completed", "output": [
        {"type": "message", "content": [{"type": "output_text", "text": text}]}]}}


def chat_delta(text="", **kwargs):
    return {"choices": [{"delta": {"content": text, **kwargs}}]}


class OllamaFixture:
    def __init__(self):
        self.calls = []

    def health(self, model):
        self.calls.append(("health", model))
        return {"ok": True, "models": [model]}

    def stream(self, model, messages, job):
        self.calls.append(("stream", model, messages))
        yield "本地回复"


class JobFixture:
    def __init__(self):
        self.cancelled = threading.Event()
        self.attached, self.detached = [], []

    def attach(self, response):
        self.attached.append(response)

    def detach(self, response):
        self.detached.append(response)


class ResponseFixture(io.BytesIO):
    def __init__(self, data, on_read=None):
        super().__init__(data)
        self.on_read = on_read

    def readline(self, size=-1):
        if self.on_read:
            self.on_read()
        return super().readline(size)


class HTTPFixture:
    def __init__(self, data=b"", error=None, on_read=None):
        self.data, self.error, self.on_read = data, error, on_read
        self.requests, self.responses = [], []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        if self.error:
            raise self.error
        response = ResponseFixture(self.data, self.on_read)
        self.responses.append(response)
        return response


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = isolated_directory()
        self.addCleanup(self.temp.cleanup)
        if sys.platform == "darwin":
            # Still exercise the native Keychain, then remove only the random
            # accounts created by this test; never leave fixture credentials.
            from core_platform import _module as platform
            accounts = []
            original = platform._Keychain.add
            def tracked(store, account, data):
                original(store, account, data)
                accounts.append(account)
            def cleanup():
                for account in accounts:
                    platform._Keychain().delete(account)
            self.addCleanup(cleanup)
            mocked = patch.object(platform._Keychain, "add", tracked)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.ollama = OllamaFixture()
        self.bridge = ProviderBridge(self.temp.name, self.ollama)

    def cloud(self, kind="openai", **changes):
        values = {"kind": kind, "model": "user-chosen-model", "api_key": KEY}
        if kind == "custom":
            values.update(name="测试服务", base_url="http://127.0.0.1:54321/prefix/v1")
        return self.bridge.save({**values, **changes})

    def stream_with(self, payload, identity="openai", job=None):
        self.bridge.opener = HTTPFixture(payload)
        return self.bridge.stream(MESSAGES, job or JobFixture(), provider_id=identity)

    def test_default_is_local_and_configuration_never_contacts_network(self):
        self.bridge.opener = HTTPFixture(error=AssertionError("unexpected network"))
        items = self.bridge.list()
        self.assertEqual(items["active_id"], "local")
        self.assertEqual(len(items["items"]), 3)
        self.assertFalse(next(i for i in items["items"] if i["id"] == "openai")["available"])
        self.assertEqual(list(self.bridge.stream(MESSAGES, JobFixture())), ["本地回复"])
        self.assertEqual(self.ollama.calls[0][1], "qwen3.5:9b")
        self.assertEqual(self.bridge.opener.requests, [])

    def test_key_is_encrypted_public_config_safe_blank_preserves_clear_removes(self):
        item = self.cloud()
        self.bridge.select(item["id"])
        secret = Path(self.temp.name, "provider-secrets.json").read_text(encoding="utf-8")
        public = Path(self.temp.name, "providers.json").read_text(encoding="utf-8")
        self.assertNotIn(KEY, secret + public + json.dumps(self.bridge.list()))
        self.assertTrue(item["has_key"])
        cipher = json.loads(secret)["keys"]["openai"]["cipher"]
        self.bridge.save({"id": "openai", "api_key": "", "model": "new-model"})
        self.assertEqual(self.bridge.keys["openai"]["cipher"], cipher)
        loaded = ProviderBridge(self.temp.name, self.ollama)
        self.assertEqual(loaded.selected()["model"], "new-model")
        self.assertTrue(loaded.selected()["has_key"])
        loaded.save({"id": "openai", "clear_key": True})
        self.assertFalse(loaded.selected()["has_key"])
        with self.assertRaises(ValueError):
            loaded.select("openai")
        self.assertEqual(loaded.selected()["id"], "openai")

    def test_url_and_key_validation_do_not_enable_remote_http_or_redirect(self):
        for base in ("http://example.com/v1", "http://localhost:9/v1", "http://127.0.0.2/v1",
                     "http://[::1]:9/v1", "https://user:password@example.com", "https://example.com/v1?key=secret",
                     "https://example.com/#fragment", "https://example.com/\n", "file:///tmp/provider"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                self.cloud("custom", base_url=base)
        for kind, base in (("openai", "https://example.com/v1"), ("openai", "https://api.openai.com/v2"),
                           ("deepseek", "http://api.deepseek.com")):
            with self.subTest(kind=kind, base=base), self.assertRaises(ValueError):
                self.cloud(kind, base_url=base)
        for key in ("has space", "bad\r\nHeader: secret", "中文"):
            with self.assertRaises(ValueError):
                self.cloud(api_key=key)
        with self.assertRaises(ProviderError):
            _NoRedirect().redirect_request(None, None, 302, "secret", {}, "https://untrusted.test")

    def test_endpoint_change_requires_new_key_and_crash_mismatch_fails_closed(self):
        item = self.cloud("custom")
        with self.assertRaises(ValueError):
            self.bridge.save({"id": item["id"], "base_url": "https://other.example/v1"})
        self.bridge.keys[item["id"]]["base_url"] = "https://interrupted-save.example/v1"
        self.assertFalse(next(i for i in self.bridge.list()["items"] if i["id"] == item["id"])["has_key"])
        with self.assertRaises(ProviderError):
            list(self.bridge.stream(MESSAGES, JobFixture(), item["id"]))
        self.assertEqual(self.ollama.calls, [])

    def test_snapshot_keeps_model_endpoint_and_key_after_edit_and_delete(self):
        item = self.cloud("custom")
        job = JobFixture()
        job.provider_snapshot = self.bridge.snapshot(item["id"])
        self.assertNotIn(KEY, repr(job.provider_snapshot))
        self.bridge.save({"id": item["id"], "model": "replacement", "base_url": "https://other.example/v1", "api_key": "different-test-key"})
        self.bridge.delete(item["id"])
        fixture = HTTPFixture(sse(chat_delta("saved"), "[DONE]"))
        self.bridge.opener = fixture
        self.assertEqual("".join(self.bridge.stream(MESSAGES, job, item["id"])), "saved")
        request = fixture.requests[0][0]
        self.assertEqual(request.full_url, item["base_url"] + "/chat/completions")
        self.assertEqual(json.loads(request.data)["model"], item["model"])
        self.assertEqual(request.get_header("Authorization"), "Bearer " + KEY)
        with self.assertRaises(ValueError):
            list(self.bridge.stream(MESSAGES, job, "local"))

    def test_responses_stream_requires_completed_and_ignores_reasoning(self):
        self.cloud()
        job = JobFixture()
        payload = sse({"type": "response.reasoning_summary_text.delta", "delta": "hidden"},
            {"type": "response.output_text.delta", "delta": "你"},
            {"type": "response.output_text.delta", "delta": "好"}, completed())
        self.assertEqual("".join(self.stream_with(payload, job=job)), "你好")
        fixture = self.bridge.opener
        request = fixture.requests[0][0]
        body = json.loads(request.data)
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        self.assertEqual(body["input"], MESSAGES)
        self.assertIs(body["store"], False)
        self.assertNotIn("messages", body)
        self.assertTrue(fixture.responses[0].closed)
        self.assertEqual(job.attached, job.detached)

    def test_responses_completed_can_supply_text_without_prior_delta(self):
        self.cloud()
        self.assertEqual("".join(self.stream_with(sse(completed("完整回答")))), "完整回答")

    def test_responses_failed_incomplete_error_or_eof_preserve_partial_and_fail(self):
        self.cloud()
        for packet in ({"type": "response.failed", "response": {"status": "failed", "error": {"message": KEY}}},
                       {"type": "response.incomplete", "response": {"status": "incomplete"}},
                       {"type": "error", "message": KEY},
                       {"type": "response.completed", "response": {"status": "failed"}}, None):
            with self.subTest(packet=packet):
                frames = [{"type": "response.output_text.delta", "delta": "部分"}]
                if packet:
                    frames.append(packet)
                generator = self.stream_with(sse(*frames))
                self.assertEqual(next(generator), "部分")
                with self.assertRaises(ProviderError) as raised:
                    list(generator)
                self.assertNotIn(KEY, str(raised.exception))
        self.assertEqual(self.ollama.calls, [])

    def test_deepseek_done_prefix_and_no_thinking_content(self):
        self.cloud("deepseek", base_url="https://api.deepseek.com/v1")
        payload = sse(chat_delta("", reasoning_content="private reasoning"), chat_delta("<thi"),
            chat_delta("nk>hidden</think>可见"), {"choices": [{"delta": {}, "finish_reason": "stop"}]}, "[DONE]")
        self.assertEqual("".join(self.stream_with(payload, "deepseek")), "可见")
        request = self.bridge.opener.requests[0][0]
        self.assertEqual(request.full_url, "https://api.deepseek.com/v1/chat/completions")
        self.assertEqual(json.loads(request.data)["thinking"], {"type": "disabled"})

    def test_chat_stream_without_done_or_with_length_limit_fails(self):
        item = self.cloud("custom", api_key="")
        for packets in ((chat_delta("部分"),),
                        (chat_delta("部分"), {"choices": [{"delta": {}, "finish_reason": "length"}]}, "[DONE]")):
            generator = self.stream_with(sse(*packets), item["id"])
            self.assertEqual(next(generator), "部分")
            with self.assertRaises(ProviderError):
                list(generator)

    def test_http_provider_and_unknown_transport_errors_are_sanitized(self):
        self.cloud()
        for error in (HTTPError("https://api.openai.com/v1/responses", 401, KEY, {}, io.BytesIO(KEY.encode())),
                      RuntimeError("Authorization: Bearer " + KEY), ValueError(KEY)):
            self.bridge.opener = HTTPFixture(error=error)
            with self.subTest(error=type(error).__name__), self.assertRaises(ProviderError) as raised:
                list(self.bridge.stream(MESSAGES, JobFixture(), "openai"))
            self.assertNotIn(KEY, str(raised.exception))
            self.assertNotIn("Bearer", str(raised.exception))
            self.assertEqual(self.ollama.calls, [])

    def test_malformed_and_oversized_sse_are_bounded_and_sanitized(self):
        self.cloud()
        for payload in (b"data: " + KEY.encode() + b"\n\n", b"data: []\n\n", b"data: " + b"x" * 262145 + b"\n\n"):
            with self.subTest(size=len(payload)), self.assertRaises(ProviderError) as raised:
                list(self.stream_with(payload))
            self.assertNotIn(KEY, str(raised.exception))

    def test_cancel_prevents_request_and_during_stream_closes_response(self):
        self.cloud()
        job = JobFixture()
        job.cancelled.set()
        self.bridge.opener = HTTPFixture()
        self.assertEqual(list(self.bridge.stream(MESSAGES, job, "openai")), [])
        self.assertEqual(self.bridge.opener.requests, [])
        job = JobFixture()
        fixture = HTTPFixture(sse({"type": "response.output_text.delta", "delta": "invisible"}), on_read=job.cancelled.set)
        self.bridge.opener = fixture
        self.assertEqual(list(self.bridge.stream(MESSAGES, job, "openai")), [])
        self.assertTrue(fixture.responses[0].closed)
        self.assertEqual(job.attached, job.detached)

    def test_connection_test_performs_real_generation_protocol_and_rejects_empty(self):
        self.cloud()
        self.bridge.opener = HTTPFixture(sse(completed("OK")))
        result = self.bridge.test("openai")
        self.assertEqual(result, {"ok": True, "models": ["user-chosen-model"], "method": "generation"})
        self.assertTrue(next(i for i in self.bridge.list()["items"] if i["id"] == "openai")["connected"])
        self.assertEqual(json.loads(self.bridge.opener.requests[0][0].data)["max_output_tokens"], 256)
        self.bridge.opener = HTTPFixture(sse(completed("")))
        self.assertFalse(self.bridge.test("openai")["ok"])
        self.bridge.opener = HTTPFixture(error=RuntimeError(KEY))
        self.assertNotIn(KEY, json.dumps(self.bridge.test("openai")))
        with patch.object(self.ollama, "health", side_effect=ValueError(KEY)):
            self.assertNotIn(KEY, json.dumps(self.bridge.test("local")))

    def test_select_delete_and_local_test_are_explicit_without_fallback(self):
        self.cloud()
        self.bridge.select("openai")
        self.bridge.opener = HTTPFixture(error=OSError(KEY))
        with self.assertRaises(ProviderError):
            list(self.bridge.stream(MESSAGES, JobFixture()))
        self.assertEqual(self.bridge.selected()["id"], "openai")
        self.assertEqual(self.ollama.calls, [])
        self.assertEqual(self.bridge.delete("openai"), {"ok": True, "active_id": "local"})
        self.assertFalse(next(i for i in self.bridge.list()["items"] if i["id"] == "openai")["available"])
        self.assertEqual(self.bridge.test("local")["method"], "local-model-status")
        with self.assertRaises(ValueError):
            self.bridge.delete("local")

    def test_corrupt_config_is_preserved_instead_of_reset(self):
        path = Path(self.temp.name, "providers.json")
        path.write_text("{broken", encoding="utf-8")
        with self.assertRaises(ProviderError):
            ProviderBridge(self.temp.name, self.ollama)
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")


@unittest.skipUnless(os.environ.get("LAURENTINA_PROVIDER_HTTP_TEST") == "1", "Opt in to isolated real loopback HTTP fixture")
class LoopbackProviderTests(unittest.TestCase):
    def test_real_stdlib_http_sse_preserves_custom_prefix_and_blocks_redirect(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                self.server.posts.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                if self.server.redirect:
                    self.send_response(302)
                    self.send_header("Location", "/do-not-follow")
                    self.end_headers()
                    return
                payload = sse(chat_delta("测试回复"), {"choices": [{"delta": {}, "finish_reason": "stop"}]}, "[DONE]")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.posts, server.redirect = [], False
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with isolated_directory() as directory:
                bridge = ProviderBridge(directory, OllamaFixture())
                item = bridge.save({"kind": "custom", "name": "本地测试", "model": "fixture", "base_url": f"http://127.0.0.1:{server.server_port}/gateway/v1"})
                with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1"}):
                    self.assertEqual("".join(bridge.stream(MESSAGES, JobFixture(), item["id"])), "测试回复")
                self.assertEqual(server.posts[0][0], "/gateway/v1/chat/completions")
                server.redirect = True
                with self.assertRaises(ProviderError):
                    list(bridge.stream(MESSAGES, JobFixture(), item["id"]))
                self.assertEqual(len(server.posts), 2)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(5)


if __name__ == "__main__":
    unittest.main()
