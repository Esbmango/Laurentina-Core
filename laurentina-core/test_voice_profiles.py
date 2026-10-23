import base64
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from unittest.mock import patch

from core_voice_profiles import VoiceProfiles
from local_voice_service import handler_for


class ProfilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.profiles = VoiceProfiles(self.temp.name)

    def test_import_validation_precedes_runtime(self):
        base = {"name": "Test voice", "filename": "voice.wav", "transcript": "Hello.", "audio_base64": base64.b64encode(b"x" * 100).decode()}
        for update in ({"name": ""}, {"transcript": ""}, {"filename": "voice.exe"}, {"audio_base64": "not-base64!"}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.profiles.import_reference({**base, **update})
        self.assertEqual(list(self.profiles.folder.iterdir()), [])

    def test_delete_rejects_traversal_and_keeps_other_files(self):
        marker = Path(self.temp.name) / "keep.txt"
        marker.write_text("keep")
        for value in ("..", "../keep.txt", "a" * 31, "A" * 32, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.profiles.delete(value)
        self.assertEqual(marker.read_text(), "keep")

    def test_delete_only_selected_profile(self):
        for value in ("a" * 32, "b" * 32):
            self.profiles._path(value).mkdir()
        self.profiles.delete("a" * 32)
        self.assertFalse(self.profiles._path("a" * 32).exists())
        self.assertTrue(self.profiles._path("b" * 32).exists())

    def test_library_hides_reference_paths_and_skips_incomplete(self):
        profile_id = "a" * 32
        path = self.profiles._path(profile_id)
        path.mkdir()
        data = {"id": profile_id, "name": "Demo", "transcript": "Hello.", "duration_seconds": 5, "created_at": "2026-10-21"}
        (path / "profile.json").write_text(json.dumps(data))
        with patch.object(self.profiles, "status", return_value={}):
            self.assertEqual(self.profiles.list()["profiles"], [])
            (path / "reference.wav").write_bytes(b"test")
            self.assertEqual(self.profiles.list()["profiles"], [data])
            self.assertNotIn("reference.wav", json.dumps(self.profiles.list()))

    def test_status_exposes_model_loading_stage_and_only_structured_diagnostics(self):
        health = {"load_phase": "loading_weights", "load_timings": {"torch_import_ms": 27.5},
                  "last_error": {"type": "RuntimeError", "phase": "loading_weights"}, "busy": True,
                  "input": "private fixture never returned", "transcript": "reference never returned"}
        with patch.object(self.profiles, "_health", return_value=health):
            status = self.profiles.status()
        self.assertEqual(status["load_phase"], "loading_weights")
        self.assertEqual(status["load_timings"], {"torch_import_ms": 27.5})
        self.assertTrue(status["busy"])
        self.assertNotIn("input", status)
        self.assertNotIn("transcript", status)


class LocalHttpTests(unittest.TestCase):
    def setUp(self):
        class FakeEngine:
            model = None
            device = "test"
            busy = False
            epoch = 0
            cancelled = threading.Event()
            def cancel(self):
                self.epoch += 1
                self.cancelled.set()
            def memory_status(self):
                return {}
            def synthesize(self, payload):
                if payload.get("voice") != "known":
                    raise ValueError()
                return b"RIFF-test"
            def stream(self, payload, expected_epoch=None):
                if payload.get("voice") != "known":
                    raise ValueError()
                for _ in range(2):
                    result = io.BytesIO()
                    with wave.open(result, "wb") as audio:
                        audio.setnchannels(1)
                        audio.setsampwidth(2)
                        audio.setframerate(24000)
                        audio.writeframes(b"\0\0" * 240)
                    yield result.getvalue(), 24000, .01
        self.engine = FakeEngine()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), lambda *args: None)
        port = self.server.server_address[1]
        self.server.RequestHandlerClass = handler_for(self.engine, "test-library", port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)
        self.base = f"http://127.0.0.1:{port}"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_no_browser_origin_and_host_rebinding(self):
        for headers in ({"Origin": "https://example.com"}, {"Origin": "null"}, {"Host": "attacker.test"}):
            with self.subTest(headers=headers), self.assertRaises(urllib.error.HTTPError) as caught:
                self.opener.open(urllib.request.Request(self.base + "/health", headers=headers))
            self.assertEqual(caught.exception.code, 403)

    def test_speech_and_stop_and_invalid_voice(self):
        def post(payload, path="/v1/audio/speech"):
            return self.opener.open(urllib.request.Request(self.base + path,
                json.dumps(payload).encode(), {"Content-Type": "application/json"}))
        with post({"input": "Hello", "voice": "known"}) as result:
            self.assertEqual(result.headers["Content-Type"], "audio/wav")
            self.assertEqual(result.read(), b"RIFF-test")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post({"input": "Hello", "voice": "../secret"})
        self.assertEqual(caught.exception.code, 400)
        with post({}, "/v1/audio/stop") as result:
            self.assertTrue(json.load(result)["ok"])
        self.assertTrue(self.engine.cancelled.is_set())

    def test_ndjson_stream_has_contiguous_sequence_and_complete_wav_chunks(self):
        request = urllib.request.Request(self.base + "/v1/audio/speech/stream",
            json.dumps({"input": "Hello", "voice": "known"}).encode(), {"Content-Type": "application/json"})
        with self.opener.open(request) as response:
            self.assertTrue(response.headers["Content-Type"].startswith("application/x-ndjson"))
            events = [json.loads(line) for line in response]
        self.assertEqual([event["seq"] for event in events[:-1]], [0, 1])
        self.assertEqual(events[-1], {"type": "done", "done": True, "chunks": 2, "complete": True})
        for event in events[:-1]:
            with wave.open(io.BytesIO(base64.b64decode(event["audio_base64"])), "rb") as audio:
                self.assertEqual(audio.getnframes(), 240)
                self.assertEqual(audio.getframerate(), event["sample_rate"])

    def test_invalid_stream_emits_error_and_no_completion(self):
        request = urllib.request.Request(self.base + "/v1/audio/speech/stream",
            json.dumps({"input": "Hello", "voice": "unknown"}).encode(), {"Content-Type": "application/json"})
        with self.opener.open(request) as response:
            events = [json.loads(line) for line in response]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertNotIn("complete", events[0])


if __name__ == "__main__":
    unittest.main()
