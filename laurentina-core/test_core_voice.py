"""Offline voice/privacy checks, no downloads, microphones or model inference."""
import base64
import io
import json
import concurrent.futures
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

from core_backend import Core
from core_voice import ENGLISH_VOICE, MAX_AUDIO, VOICE_ID, NoRedirect, ResidentWorker, VoiceBridge, VoiceError, local_speech_url, normalize_speech_text, speech_chunks, validated_wav
import core_voice_worker as worker

TEST_ROOT = Path(__file__).resolve().parent / ".local" / "test-work"
TEST_ROOT.mkdir(parents=True, exist_ok=True)


def wav_bytes(samples=1000, rate=22050):
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(b"\x00\x01" * samples)
    return output.getvalue()


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="voice-", dir=TEST_ROOT)
        self.root = Path(self.temp.name)
        self.bridge = VoiceBridge(self.root / "data", root_dir=self.root)

    def tearDown(self):
        self.bridge.close()
        self.temp.cleanup()

    def test_custom_endpoint_literal_loopback_only_no_credentials_or_redirects(self):
        for address in ("https://example.com/v1", "http://localhost:8888/v1", "http://127.0.0.1.evil/v1", "file:///secret", "http://user:secret@127.0.0.1:8888/v1", "http://127.0.0.1:8888/v1?key=x", "http://127.0.0.1:8888/../v1"):
            with self.assertRaises(ValueError, msg=address):
                local_speech_url(address)
        self.assertEqual(local_speech_url("http://127.0.0.1:8888/v1"), "http://127.0.0.1:8888/v1/audio/speech")
        self.assertEqual(local_speech_url("http://[::1]:8888/audio/speech"), "http://[::1]:8888/audio/speech")
        with self.assertRaises(VoiceError):
            NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_settings_default_to_voice_first_and_keep_explicit_opt_out(self):
        self.assertEqual(self.bridge.settings()["voice"], "auto")
        self.assertTrue(self.bridge.settings()["auto_speak"])
        self.assertEqual(self.bridge.settings()["voice_input_mode"], "direct")
        self.bridge.save_settings({"voice": ENGLISH_VOICE, "auto_speak": False, "voice_input_mode": "review"})
        other = VoiceBridge(self.root / "data", root_dir=self.root)
        self.assertEqual(other.settings()["voice"], ENGLISH_VOICE)
        self.assertFalse(other.settings()["auto_speak"])
        self.assertEqual(other.settings()["voice_input_mode"], "review")
        with self.assertRaises(ValueError):
            self.bridge.save_settings({"api_key": "secret"})
        with self.assertRaises(ValueError):
            self.bridge.save_settings({"tts_provider": "custom", "custom_url": "https://remote.example/v1"})

    def test_legacy_settings_migrate_once_without_changing_voice_provider(self):
        self.bridge.config_path.write_text(json.dumps({"tts_provider": "piper", "voice": ENGLISH_VOICE,
            "auto_speak": False}), encoding="utf-8")
        result = self.bridge.settings()
        self.assertTrue(result["auto_speak"])
        self.assertEqual(result["voice_input_mode"], "direct")
        self.assertEqual(result["voice"], ENGLISH_VOICE)
        stored = json.loads(self.bridge.config_path.read_text(encoding="utf-8"))
        self.assertEqual(stored["_behavior_version"], 1)
        self.assertNotIn("_behavior_version", result)
        self.bridge.save_settings({"auto_speak": False, "voice_input_mode": "review"})
        self.assertFalse(VoiceBridge(self.root / "data").settings()["auto_speak"])

    def test_voice_input_mode_validation_and_failed_save_preserves_settings(self):
        self.bridge.save_settings({"voice_input_mode": "review", "auto_speak": False})
        for value in ("auto", "", None, True, {}):
            with self.assertRaises(ValueError):
                self.bridge.save_settings({"voice_input_mode": value})
        self.assertEqual(self.bridge.settings()["voice_input_mode"], "review")
        self.assertFalse(self.bridge.settings()["auto_speak"])

    def test_target_language_validation_is_independent_of_voice_reference_language(self):
        self.assertEqual(self.bridge.settings()["speech_language"], "Auto")
        for language in ("Auto", "Chinese", "English", "Japanese"):
            self.assertEqual(self.bridge.save_settings({"speech_language": language})["speech_language"], language)
        for language in ("Klingon", "zh", None, True, {}):
            with self.assertRaises(ValueError):
                self.bridge.save_settings({"speech_language": language})

    def test_orb_open_panel_preference_is_boolean_and_keeps_input_mode(self):
        self.assertFalse(self.bridge.settings()["voice_orb_open_panel"])
        self.bridge.save_settings({"voice_orb_open_panel": True, "voice_input_mode": "review"})
        self.assertTrue(self.bridge.settings()["voice_orb_open_panel"])
        self.assertEqual(self.bridge.settings()["voice_input_mode"], "review")
        for value in (1, "true", None, {}):
            with self.assertRaises(ValueError):
                self.bridge.save_settings({"voice_orb_open_panel": value})

    def test_reference_mode_defaults_to_icl_and_invalid_save_is_atomic(self):
        self.assertEqual(self.bridge.settings()["voice_clone_mode"], "icl")
        self.bridge.save_settings({"voice_clone_mode": "speaker_only"})
        for value in ("auto", "Japanese", True, None, {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.bridge.save_settings({"voice_clone_mode": value})
        self.assertEqual(self.bridge.settings()["voice_clone_mode"], "speaker_only")
        self.assertEqual(self.bridge.settings()["speech_language"], "Auto")

    def test_emoji_cleanup_only_changes_spoken_copy_and_rejects_empty_speech(self):
        original = "你好👩🏽‍🚀，今天有1️⃣个任务❤️！ English 🇬🇧。"
        self.assertEqual(normalize_speech_text(original), "你好 ，今天有1个任务 ！ English 。")
        self.assertIn("👩🏽‍🚀", original)
        self.bridge.runner = lambda message: self.fail("emoji-only input must not start a model")
        with self.assertRaises(ValueError):
            self.bridge.speak("👩🏽‍🚀❤️")

    def test_consumed_final_audio_retries_until_ack_then_releases_base64(self):
        self.bridge.runner = lambda message: {"ok": True, "audio_base64": base64.b64encode(wav_bytes()).decode()}
        session = self.bridge.start("Hello.")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            first = self.bridge.poll(session["id"], 0)
            if first["done"]: break
            time.sleep(.01)
        self.assertEqual(first["chunks"], self.bridge.poll(session["id"], 0)["chunks"])
        self.assertEqual(len(first["chunks"]), 1)
        self.assertEqual(self.bridge.poll(session["id"], 1)["chunks"], [])
        self.assertEqual(self.bridge.speech_session["chunks"], [])

    def test_stream_reuses_validated_incoming_base64_without_duplicate_encoding(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        self.bridge.runner = lambda message: {"ok": True, "audio_base64": encoded}
        with patch("core_voice.base64.b64encode", side_effect=AssertionError("must share the existing validated audio string")):
            result, chunks = self._collect_stream(self.bridge.start("Hello.")["id"])
        self.assertNotIn("error", result)
        self.assertIs(chunks[0]["audio_base64"], encoded)

    def test_release_keeps_active_stream_and_continuous_flags(self):
        calls = []
        for action, resident in self.bridge.workers.items():
            resident.release_idle = lambda seconds=0, action=action: calls.append(action) or {"released": True}
        self.bridge.speech_session = {"done": False}
        self.assertEqual(self.bridge.release_idle()["released"], ["asr"])
        self.assertEqual(calls, ["transcribe"])
        calls.clear()
        self.assertEqual(self.bridge.release_idle(keep_tts=True, keep_asr=True)["released"], [])
        self.assertEqual(calls, [])
        self.bridge.speech_session = None

    def test_speech_rate_validation_and_normalization_preserve_spoken_content(self):
        self.assertEqual(self.bridge.settings()["speech_rate"], 1.0)
        for value in (True, None, "1.0", 0.69, 1.41, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                self.bridge.save_settings({"speech_rate": value})
        self.bridge.save_settings({"speech_rate": 1.2})
        self.assertEqual(self.bridge.settings()["speech_rate"], 1.2)
        raw = "## 晚上好\n- **劳纶缇娜**说：看看[报告](https://example.test/private)。\n2026年预算 1.5 万元，English 25%。"
        result = normalize_speech_text(raw)
        self.assertEqual(result, "晚上好\n劳纶缇娜说：看看报告。\n2026年预算 1.5 万元，English 25%。")
        calls = []
        self.bridge.runner = lambda payload: calls.append(payload) or {"ok": True, "audio_base64": base64.b64encode(wav_bytes()).decode()}
        self.bridge.speak(raw)
        self.assertEqual(calls[0]["speech_rate"], 1.2)
        self.assertNotIn("https://", json.dumps(calls))

    def test_language_selection_chinese_english_and_mixed_paragraphs(self):
        self.assertEqual(speech_chunks("晚上好，我们继续。" )[0]["voice"], VOICE_ID)
        self.assertEqual(speech_chunks("Good evening. Let us continue.")[0]["voice"], ENGLISH_VOICE)
        self.assertEqual([c["voice"] for c in speech_chunks("晚上好\nGood evening")], [VOICE_ID, ENGLISH_VOICE])
        self.assertEqual(speech_chunks("Good evening, today we will continue 你好")[0]["voice"], ENGLISH_VOICE)
        self.assertEqual(speech_chunks("继续进行 English 测试")[0]["voice"], VOICE_ID)

    def test_speak_supplies_correct_local_models_and_validated_wav(self):
        calls = []
        def run(payload):
            calls.append(payload)
            return {"ok": True, "audio_base64": base64.b64encode(wav_bytes()).decode()}
        self.bridge.runner = run
        result = self.bridge.speak("晚上好\nGood evening")
        chunks = calls[0]["chunks"]
        self.assertEqual([c["voice"] for c in chunks], [VOICE_ID, ENGLISH_VOICE])
        self.assertTrue(chunks[0]["model_path"].endswith(VOICE_ID + ".onnx"))
        self.assertTrue(chunks[1]["model_path"].endswith(ENGLISH_VOICE + ".onnx"))
        self.assertEqual(base64.b64decode(result["audio_base64"]), wav_bytes())
        with self.assertRaises(ValueError):
            self.bridge.speak("x" * 2001)
        with self.assertRaises(ValueError):
            self.bridge.speak("")

    def test_explicit_prepare_loads_selected_models_without_audio_or_text(self):
        calls = []
        self.bridge.runner = lambda payload: calls.append(payload) or {"ok": True, "ready": True}
        result = self.bridge.prepare()
        self.assertTrue(result["asr_ready"])
        self.assertTrue(result["tts_ready"])
        self.assertEqual([call["engine"] for call in calls], ["piper", "whisper"])
        self.assertEqual(len(calls[0]["model_paths"]), 2)
        self.assertTrue(all(call["action"] == "prepare" for call in calls))
        self.assertTrue(all("audio_path" not in call and "text" not in call for call in calls))
        calls.clear()
        self.bridge.save_settings({"tts_provider": "custom", "custom_url": "http://127.0.0.1:9000/v1"})
        self.assertFalse(self.bridge.prepare()["tts_ready"])
        self.assertEqual([call["engine"] for call in calls], ["whisper"])

    def test_transcribe_validates_format_and_cleans_private_audio_after_success_or_failure(self):
        paths = []
        def run(payload):
            paths.append(Path(payload["audio_path"]))
            self.assertTrue(paths[-1].is_file())
            self.assertEqual(paths[-1].read_bytes(), b"a" * 100)
            self.assertEqual(payload["max_seconds"], 60)
            return {"ok": True, "text": "你好 Hello"}
        self.bridge.runner = run
        result = self.bridge.transcribe(base64.b64encode(b"a" * 100).decode(), "audio/webm;codecs=opus")
        self.assertEqual(result["text"], "你好 Hello")
        self.assertFalse(paths[0].exists())
        self.bridge.runner = lambda payload: {"ok": False, "error": "本地识别失败"}
        with self.assertRaises(VoiceError):
            self.bridge.transcribe(base64.b64encode(b"a" * 100).decode(), "audio/webm")
        self.assertEqual(list(self.bridge.temp_root.iterdir()), [])
        for encoded, mime in (("notbase64!", "audio/webm"), ("A" * (MAX_AUDIO * 4 // 3 + 100), "audio/webm"), ("YQ==", "image/png")):
            with self.assertRaises(ValueError):
                self.bridge.transcribe(encoded, mime)

    def test_custom_provider_requests_wav_preserves_custom_voice_and_rejects_bad_output(self):
        requests = []
        class Response(io.BytesIO):
            def geturl(self):
                return "http://127.0.0.1:9000/v1/audio/speech"
        def open_request(request, timeout):
            requests.append(request)
            return Response(wav_bytes())
        self.bridge.opener = SimpleNamespace(open=open_request)
        self.bridge.save_settings({"tts_provider": "custom", "custom_url": "http://127.0.0.1:9000/v1", "custom_model": "local-model", "custom_voice": "my-private-voice", "speech_language": "Japanese"})
        self.bridge.speak("Hello 你好")
        payload = json.loads(requests[0].data)
        self.assertEqual(payload["voice"], "my-private-voice")
        self.assertEqual(payload["response_format"], "wav")
        self.assertEqual(payload["language"], "Japanese")
        self.assertNotIn("x_vector_only_mode", payload, "third-party APIs must not receive a bundled-engine extension")
        self.assertTrue(self.bridge.custom_verified)
        self.bridge.opener = SimpleNamespace(open=lambda *a, **kw: Response(b"not audio"))
        with self.assertRaises(VoiceError):
            self.bridge.speak("Hello")

    def test_auto_language_resolves_from_target_before_calling_existing_custom_service(self):
        requests = []
        endpoint = "http://127.0.0.1:9000/v1/audio/speech"
        class Response(io.BytesIO):
            def geturl(self): return endpoint
        self.bridge.opener = SimpleNamespace(open=lambda request, timeout: requests.append(json.loads(request.data)) or Response(wav_bytes()))
        self.bridge.save_settings({"tts_provider": "custom", "custom_url": endpoint, "speech_language": "Auto"})
        self.bridge.speak("Hello 💙")
        self.bridge.speak("你好 💙")
        self.assertEqual([request["language"] for request in requests], ["English", "Chinese"])
        self.assertEqual([request["input"] for request in requests], ["Hello", "你好"])

    def test_custom_stop_uses_only_managed_endpoint_and_discards_late_audio(self):
        entered, release = threading.Event(), threading.Event()
        requests = []
        url = "http://127.0.0.1:18766/v1/audio/speech"
        class Response(io.BytesIO):
            def geturl(self): return url
            def read(self, *args):
                if self.getvalue() == wav_bytes():
                    entered.set()
                    release.wait(timeout=5)
                return super().read(*args)
        def open_request(request, timeout):
            requests.append((request.full_url, request.data))
            return Response(wav_bytes() if request.full_url.endswith("/speech") else b"{}")
        self.bridge.opener = SimpleNamespace(open=open_request)
        self.bridge.save_settings({"tts_provider": "custom", "custom_url": url})
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.bridge.speak, "这是本地测试。")
            self.assertTrue(entered.wait(timeout=5))
            self.bridge.stop()
            release.set()
            with self.assertRaisesRegex(VoiceError, "已停止"):
                future.result(timeout=5)
        self.assertFalse(self.bridge.custom_verified)
        self.assertEqual(requests[-1], ("http://127.0.0.1:18766/v1/audio/stop", b"{}"))
        self.bridge.save_settings({"custom_url": "http://127.0.0.1:9000/v1/audio/speech"})
        count = len(requests)
        self.bridge.stop()
        self.assertEqual(len(requests), count)

    def _stream_fixture(self, events):
        encoded = b"".join((json.dumps(event) + "\n").encode() for event in events)
        class Response(io.BytesIO):
            def geturl(self): return "http://127.0.0.1:18766/v1/audio/speech/stream"
        def open_request(request, timeout):
            return Response(encoded if request.full_url.endswith("/stream") else b"{}")
        self.bridge.opener = SimpleNamespace(open=open_request)
        self.bridge.save_settings({"tts_provider": "custom", "custom_url": "http://127.0.0.1:18766/v1/audio/speech"})

    def _collect_stream(self, session_id):
        chunks, after = [], 0
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = self.bridge.poll(session_id, after)
            chunks.extend(result["chunks"])
            if result["chunks"]:
                after = result["chunks"][-1]["seq"]
            if result["done"]:
                return result, chunks
            time.sleep(0.01)
        self.fail("Voice stream did not terminate")

    def test_piper_start_poll_preserves_existing_full_wav_compatibility(self):
        self.bridge.runner = lambda payload: {"ok": True, "audio_base64": base64.b64encode(wav_bytes()).decode()}
        session = self.bridge.start("你好，我们继续。")
        result, chunks = self._collect_stream(session["id"])
        self.assertNotIn("error", result)
        self.assertEqual([chunk["seq"] for chunk in chunks], [1])
        self.assertEqual(base64.b64decode(chunks[0]["audio_base64"]), wav_bytes())
        self.assertEqual(result["diagnostics"]["chunks"], 1)
        self.assertGreater(result["diagnostics"]["audio_seconds"], 0)
        self.assertGreaterEqual(result["diagnostics"]["first_audio_ms"], 0)
        self.assertNotIn("你好", json.dumps(result["diagnostics"]))
        self.assertEqual(self.bridge.poll(session["id"], 1)["chunks"], [])
        self.bridge.stop()
        self.assertEqual(self.bridge.poll(session["id"])["chunks"], [])

    def test_managed_stream_resequences_and_backpressures_at_four_unacknowledged_chunks(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        events = [{"type": "audio", "seq": i, "audio_base64": encoded, "mime_type": "audio/wav"} for i in range(7)]
        self._stream_fixture(events + [{"type": "done", "complete": True, "chunks": 7}])
        session = self.bridge.start("这是一段分块朗读。")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self.bridge.lock:
                count = len(self.bridge.speech_session["chunks"])
            if count == 4:
                break
            time.sleep(0.01)
        time.sleep(0.03)
        with self.bridge.lock:
            self.assertEqual(len(self.bridge.speech_session["chunks"]), 4)
            self.assertFalse(self.bridge.speech_session["done"])
        result, chunks = self._collect_stream(session["id"])
        self.assertEqual([chunk["seq"] for chunk in chunks], list(range(1, 8)))
        self.assertNotIn("error", result)
        self.assertTrue(self.bridge.custom_verified)

    def test_managed_stream_forwards_selected_target_language(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        self._stream_fixture([{"type": "audio", "seq": 0, "audio_base64": encoded, "mime_type": "audio/wav"},
                              {"type": "done", "complete": True, "chunks": 1}])
        original, calls = self.bridge.opener.open, []
        def capture(request, timeout):
            if request.full_url.endswith("/stream"):
                calls.append(json.loads(request.data))
            return original(request, timeout)
        self.bridge.opener.open = capture
        self.bridge.save_settings({"speech_language": "English"})
        result, chunks = self._collect_stream(self.bridge.start("Hello 你好")["id"])
        self.assertNotIn("error", result)
        self.assertEqual(calls[0]["language"], "English")

    def test_managed_stream_forwards_reference_mode_and_text_free_language_diagnostics(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        self._stream_fixture([{"type": "audio", "seq": 0, "audio_base64": encoded, "mime_type": "audio/wav"},
                              {"type": "done", "complete": True, "chunks": 1}])
        original, calls = self.bridge.opener.open, []
        def capture(request, timeout):
            if request.full_url.endswith("/stream"):
                calls.append(json.loads(request.data))
            return original(request, timeout)
        self.bridge.opener.open = capture
        self.bridge.save_settings({"speech_language": "Japanese", "voice_clone_mode": "speaker_only"})
        result, _ = self._collect_stream(self.bridge.start("Hello private routing fixture")["id"])
        self.assertTrue(calls[0]["x_vector_only_mode"])
        diagnostics = result["diagnostics"]
        self.assertEqual(diagnostics["detected_language"], "English")
        self.assertEqual(diagnostics["effective_language"], "Japanese")
        self.assertEqual(diagnostics["requested_language"], "Japanese")
        self.assertTrue(diagnostics["language_override"])
        self.assertEqual(diagnostics["reference_mode"], "speaker_only")
        self.assertNotIn("private routing fixture", json.dumps(diagnostics))

    def test_stream_rejects_out_of_order_and_incomplete_success(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        for events in ([{"type": "audio", "seq": 2, "audio_base64": encoded, "mime_type": "audio/wav"}],
                       [{"type": "done", "complete": True, "chunks": 0}],
                       [{"type": "audio", "seq": 0, "audio_base64": encoded, "mime_type": "audio/wav"}]):
            self._stream_fixture(events)
            session = self.bridge.start("错误流测试。")
            result, chunks = self._collect_stream(session["id"])
            self.assertIn("error", result)
            self.assertFalse(self.bridge.custom_verified)

    def test_stream_enforces_cumulative_audio_limit(self):
        raw = wav_bytes()
        encoded = base64.b64encode(raw).decode()
        self._stream_fixture([{"type": "audio", "seq": i, "audio_base64": encoded, "mime_type": "audio/wav"} for i in range(3)])
        with patch("core_voice.MAX_OUTPUT", len(raw) * 2):
            session = self.bridge.start("长度限制测试。")
            result, chunks = self._collect_stream(session["id"])
        self.assertIn("error", result)
        self.assertLessEqual(len(chunks), 2)

    def test_stop_clears_buffered_stream_and_unblocks_backpressure_before_next_session(self):
        encoded = base64.b64encode(wav_bytes()).decode()
        self._stream_fixture([{"type": "audio", "seq": i, "audio_base64": encoded, "mime_type": "audio/wav"} for i in range(10)])
        old = self.bridge.start("这段会被停止。")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if len(self.bridge.poll(old["id"])["chunks"]) == 4:
                break
            time.sleep(0.01)
        self.bridge.stop()
        stopped = self.bridge.poll(old["id"])
        self.assertTrue(stopped["done"])
        self.assertEqual(stopped["chunks"], [])
        self.assertIn("error", stopped)
        self.assertFalse(self.bridge.custom_verified)
        self._stream_fixture([{"type": "audio", "seq": 0, "audio_base64": encoded, "mime_type": "audio/wav"},
                              {"type": "done", "chunks": 1, "complete": True}])
        current = self.bridge.start("接下来是新的一段。")
        result, chunks = self._collect_stream(current["id"])
        self.assertNotEqual(current["id"], old["id"])
        self.assertEqual([chunk["seq"] for chunk in chunks], [1])
        self.assertNotIn("error", result)
        self.assertEqual(self.bridge.poll(old["id"])["chunks"], [])

    def test_wav_validation_rejects_incomplete_or_wrong_audio(self):
        with self.assertRaises(VoiceError):
            validated_wav(b"<html>not audio</html>")
        with self.assertRaises(VoiceError):
            validated_wav(wav_bytes()[:-50])

    def test_status_requires_both_models_for_auto_and_no_claim_for_missing_runtime(self):
        status = self.bridge.status()
        self.assertFalse(status["asr_ready"])
        self.assertFalse(status["tts_ready"])
        self.assertEqual(len(status["voices"]), 3)
        for path in (self.bridge.python, self.bridge.site / "faster_whisper" / "__init__.py", self.bridge.site / "piper" / "__init__.py"):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        for name in ("model.bin", "config.json", "tokenizer.json"):
            path = self.bridge.asr_model / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        self.bridge.tts_model.parent.mkdir(parents=True, exist_ok=True)
        self.bridge.tts_model.touch()
        Path(str(self.bridge.tts_model) + ".json").touch()
        self.assertTrue(self.bridge.status()["asr_ready"])
        self.assertFalse(self.bridge.status()["tts_ready"])
        self.bridge.english_model.touch()
        Path(str(self.bridge.english_model) + ".json").touch()
        self.assertTrue(self.bridge.status()["tts_ready"])

    def test_asr_worker_detects_duration_by_decoded_samples_before_loading_model(self):
        audio_path = self.root / "audio.webm"
        audio_path.write_bytes(b"a" * 100)
        for name in ("model.bin", "config.json", "tokenizer.json"):
            self.bridge.asr_model.mkdir(parents=True, exist_ok=True)
            (self.bridge.asr_model / name).touch()
        class Container:
            streams = SimpleNamespace(audio=[True])
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def decode(self, **kwargs):
                return iter([SimpleNamespace(samples=16000 * 61, sample_rate=16000)])
        def must_not_load(*args, **kwargs):
            raise AssertionError("Overlong private recording must not reach Whisper")
        with patch.dict("sys.modules", {"av": SimpleNamespace(open=lambda path: Container(), AudioResampler=lambda **kw: None), "faster_whisper": SimpleNamespace(WhisperModel=must_not_load)}):
            with self.assertRaises(worker.VoiceError):
                worker.transcribe({"audio_path": str(audio_path), "model_path": str(self.bridge.asr_model)})

    def test_asr_worker_keeps_english_chinese_auto_detection_and_offline_model(self):
        audio_path = self.root / "audio.webm"
        audio_path.write_bytes(b"a" * 100)
        for name in ("model.bin", "config.json", "tokenizer.json"):
            self.bridge.asr_model.mkdir(parents=True, exist_ok=True)
            (self.bridge.asr_model / name).touch()
        options = {}
        class Resampler:
            def __init__(self, **kwargs):
                options["resampler"] = kwargs
                self.flushed = False
            def resample(self, frame):
                if frame is None:
                    self.flushed = True
                    options["flushed"] = True
                    return [SimpleNamespace(to_ndarray=lambda: np.zeros((1, 16), dtype=np.float32))]
                return [SimpleNamespace(to_ndarray=lambda: np.zeros((1, 15984), dtype=np.float32))]
        class Container:
            streams = SimpleNamespace(audio=[True])
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def decode(self, **kwargs): return iter([SimpleNamespace(samples=16000, sample_rate=16000)])
        class Whisper:
            def __init__(self, path, **kwargs): options.update(kwargs)
            def transcribe(self, audio, **kwargs):
                options["input_is_array"] = isinstance(audio, np.ndarray)
                options["input_dtype"] = str(audio.dtype)
                options["input_shape"] = audio.shape
                options.update(kwargs)
                return [SimpleNamespace(text="Hello 世界")], None
        with patch.dict("sys.modules", {"av": SimpleNamespace(open=lambda path: Container(), AudioResampler=Resampler), "faster_whisper": SimpleNamespace(WhisperModel=Whisper)}):
            result = worker.transcribe({"audio_path": str(audio_path), "model_path": str(self.bridge.asr_model)})
        self.assertEqual(result["text"], "Hello 世界")
        self.assertIsNone(options["language"])
        self.assertTrue(options["local_files_only"])
        self.assertEqual(options["device"], "cpu")
        self.assertEqual(options["compute_type"], "int8")
        self.assertEqual(options["resampler"], {"format": "fltp", "layout": "mono", "rate": 16000})
        self.assertTrue(options["flushed"])
        self.assertTrue(options["input_is_array"])
        self.assertEqual(options["input_dtype"], "float32")
        self.assertEqual(options["input_shape"], (16000,))

    def test_bilingual_tts_worker_joins_real_wav_parts_without_omitting_text(self):
        models, spoken = [], []
        for voice in (VOICE_ID, ENGLISH_VOICE):
            path = self.bridge.tts_model.with_name(voice + ".onnx")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
            Path(str(path) + ".json").touch()
            models.append(path)
        class Piper:
            @staticmethod
            def load(path, **kwargs):
                return Piper()
            def synthesize_wav(self, text, wav_file):
                spoken.append(text)
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x01" * 100)
        with patch.dict("sys.modules", {"piper": SimpleNamespace(PiperVoice=Piper)}), patch.object(worker, "_load_piper", side_effect=lambda path, preset: Piper.load(path)):
            result = worker.speak({"chunks": [{"text": "你好", "model_path": str(models[0])}, {"text": "Hello", "model_path": str(models[1])}]})
        self.assertEqual(spoken, ["你好", "Hello"])
        with wave.open(io.BytesIO(base64.b64decode(result["audio_base64"])), "rb") as stream:
            self.assertEqual(stream.getnframes(), 200)

    def test_tts_worker_caches_models_and_reloads_changed_files(self):
        model = self.bridge.tts_model
        model.parent.mkdir(parents=True, exist_ok=True)
        model.write_bytes(b"model")
        Path(str(model) + ".json").write_text("{}")
        loads, configs = [], []
        class Piper:
            @staticmethod
            def load(path, **kwargs):
                loads.append(path)
                return Piper()
            def synthesize_wav(self, text, wav_file, syn_config=None):
                configs.append(syn_config)
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x01" * 100)
        module = SimpleNamespace(PiperVoice=Piper, SynthesisConfig=lambda **kw: kw)
        payload = {"chunks": [{"text": "你好", "model_path": str(model)}], "speech_rate": 1.25}
        with patch.dict("sys.modules", {"piper": module}), patch.object(worker, "_load_piper", side_effect=lambda path, preset: Piper.load(path)):
            worker.speak(payload)
            worker.speak(payload)
            self.assertEqual(len(loads), 1)
            model.write_bytes(b"updated-model")
            worker.speak(payload)
            self.assertEqual(len(loads), 2)
        self.assertEqual(configs, [{"length_scale": 0.8}] * 3)


class ResidentWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="resident-voice-", dir=TEST_ROOT)
        self.root = Path(self.temp.name)
        self.script = self.root / "worker.py"
        self.script.write_text('''import json, os, sys, time
from pathlib import Path
for line in sys.stdin.buffer:
    p = json.loads(line)
    if p.get("started"):
        Path(p["started"]).write_text("started")
    time.sleep(p.get("delay", 0))
    if p.get("malformed"):
        print("not-json", flush=True)
    else:
        print(json.dumps({"ok": True, "request_id": p["request_id"], "pid": os.getpid(), "value": p.get("value")}), flush=True)
''', encoding="utf-8")
        self.worker = ResidentWorker(Path(sys.executable), self.script, self.root, "speak")

    def tearDown(self):
        self.worker.cancel(close=True)
        self.temp.cleanup()

    def test_process_reused_and_idle_stop_preserves_warm_model_process(self):
        first = self.worker.request({"value": "one"}, 5)
        if os.name == "nt":
            self.assertIsNotNone(self.worker._lifetime["job"], "Windows inference process needs an owned kill-on-close job")
        self.worker.cancel()
        second = self.worker.request({"value": "two"}, 5)
        self.assertEqual(first["pid"], second["pid"])
        self.assertEqual(second["value"], "two")
        self.worker.cancel(close=True)
        with self.assertRaises(VoiceError):
            self.worker.request({}, 1)

    def test_timeout_and_bad_protocol_recover_with_new_process(self):
        old = self.worker.request({}, 5)["pid"]
        with self.assertRaisesRegex(VoiceError, "超时"):
            self.worker.request({"delay": 1}, 0.03)
        next_pid = self.worker.request({}, 5)["pid"]
        self.assertNotEqual(old, next_pid)
        with self.assertRaisesRegex(VoiceError, "连接中断"):
            self.worker.request({"malformed": True}, 5)
        self.assertNotEqual(next_pid, self.worker.request({}, 5)["pid"])

    def test_idle_release_reclaims_owned_process_then_reloads_on_next_request(self):
        first = self.worker.request({"value": "one"}, 5)
        process = self.worker.process
        self.assertTrue(self.worker.activity_status()["loaded"])
        self.assertFalse(self.worker.release_idle(60)["released"], "do not evict every sentence")
        self.assertTrue(self.worker.release_idle()["released"])
        self.assertIsNotNone(process.poll())
        self.assertFalse(self.worker.activity_status()["loaded"])
        second = self.worker.request({"value": "two"}, 5)
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertEqual(second["value"], "two")

    def test_idle_reclamation_cannot_cancel_active_or_queued_request(self):
        started = self.root / "active.txt"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            active = pool.submit(self.worker.request, {"delay": 0.25, "started": str(started)}, 5)
            deadline = time.monotonic() + 5
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(started.exists())
            queued = pool.submit(self.worker.request, {"value": "queued"}, 5)
            self.assertTrue(self.worker.activity_status()["busy"])
            self.assertFalse(self.worker.release_idle()["released"])
            first, second = active.result(timeout=5), queued.result(timeout=5)
            self.assertEqual(first["pid"], second["pid"])
            self.assertEqual(second["value"], "queued")

    @unittest.skipUnless(os.name == "nt", "Windows venv process-tree lifetime")
    def test_owned_job_kills_venv_launcher_and_inference_child_on_abrupt_parent_exit(self):
        import ctypes
        import venv
        from ctypes import wintypes
        project = Path(__file__).resolve().parent
        # This checks a real Windows venv launcher, not an installed ASR/TTS
        # environment. A fresh stdlib-only venv also works on clean CI hosts.
        worker_env = self.root / 'worker-venv'
        venv.create(worker_env, with_pip=False)
        worker_python = worker_env / 'Scripts/python.exe'
        parent_script = self.root / "parent.py"
        parent_script.write_text("\n".join([
            "import json, sys, time",
            "from pathlib import Path",
            "sys.path.insert(0, " + repr(str(project)) + ")",
            "from core_voice import ResidentWorker",
            "worker = ResidentWorker(Path(" + repr(str(worker_python)) + "), Path(" + repr(str(self.script)) + "), Path(" + repr(str(self.root)) + "), 'speak')",
            "reply = worker.request({}, 5)",
            "print(json.dumps({'native_pid': reply['pid'], 'launcher_pid': worker.process.pid, 'job':bool(worker._lifetime['job'])}),flush=True)",
            "while True: time.sleep(1)",
        ]), encoding="utf-8")
        parent = subprocess.Popen([sys.executable, "-E", "-s", "-X", "utf8", str(parent_script)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD), wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes, kernel.WaitForSingleObject.restype = (wintypes.HANDLE, wintypes.DWORD), wintypes.DWORD
        kernel.TerminateProcess.argtypes, kernel.TerminateProcess.restype = (wintypes.HANDLE, wintypes.UINT), wintypes.BOOL
        kernel.CloseHandle.argtypes, kernel.CloseHandle.restype = (wintypes.HANDLE,), wintypes.BOOL
        handles = []
        try:
            reply = json.loads(parent.stdout.readline())
            self.assertTrue(reply["job"])
            for pid in {reply["native_pid"], reply["launcher_pid"]}:
                handle = kernel.OpenProcess(0x100001, False, pid)
                self.assertTrue(handle)
                handles.append(handle)
            parent.kill()
            parent.wait(timeout=5)
            for handle in handles:
                self.assertEqual(kernel.WaitForSingleObject(handle, 3000), 0,
                                 "Inference process survived its owning Core process")
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=5)
            if parent.stdout:
                parent.stdout.close()
            for handle in handles:
                if kernel.WaitForSingleObject(handle, 0) != 0:
                    kernel.TerminateProcess(handle, 1)
                kernel.CloseHandle(handle)

    def test_cancel_stops_active_request_and_discards_preexisting_queue(self):
        # Separate process startup from cancellation readiness on memory-starved
        # Windows hosts; the assertions below concern active/queued RPC calls.
        self.worker.request({}, 30)
        started = self.root / "active.txt"
        queued_started = self.root / "queued.txt"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            active = pool.submit(self.worker.request, {"delay": 10, "started": str(started)}, 20)
            deadline = time.monotonic() + 5
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(started.exists())
            queued = pool.submit(self.worker.request, {"started": str(queued_started)}, 20)
            # Ensure the second call has reached the serialized request lock.
            time.sleep(0.05)
            self.worker.cancel()
            for future in (active, queued):
                with self.assertRaisesRegex(VoiceError, "已停止"):
                    future.result(timeout=5)
        self.assertFalse(queued_started.exists())
        self.assertTrue(self.worker.request({}, 5)["ok"])


class WorkDispatchTests(unittest.TestCase):
    def test_explicit_work_content_only_no_private_history_and_no_auto_approval(self):
        with tempfile.TemporaryDirectory(prefix="work-dispatch-", dir=TEST_ROOT) as directory:
            calls = []
            class Work:
                def start(self, text, **kwargs):
                    calls.append((text, kwargs))
                    return {"run_id": "r1", "status": "running"}
                def list(self): return [{"run_id": "r1"}]
                def approve(self, run_id, decision):
                    calls.append((run_id, decision))
                    return {"ok": True}
            core = Core(directory, memory=SimpleNamespace(), ollama=SimpleNamespace(), work=Work())
            try:
                conversation = core.dispatch("conversation.create", {"mode": "private"})
                core.db.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)", ("m1", conversation["id"], "user", "PRIVATE_RAW_CANARY", "now", "completed"))
                core.db.commit()
                result = core.dispatch("work.start", {"content": "创建公开报告", "conversation_id": conversation["id"], "target": {"kind": "hermes"}})
                self.assertEqual(result["run_id"], "r1")
                self.assertEqual(calls, [("创建公开报告", {"target": {"kind": "hermes"}})])
                self.assertNotIn("PRIVATE_RAW_CANARY", json.dumps(calls))
                self.assertEqual(core.dispatch("work.list")["items"], [{"run_id": "r1"}])
                with self.assertRaises(ValueError):
                    core.dispatch("work.approve", {"run_id": "r1"})
                with self.assertRaises(ValueError):
                    core.dispatch("work.approve", {"run_id": "r1", "decision": "deny"})
                decision = {"choice": "deny", "request_id": "request-1"}
                core.dispatch("work.approve", {"run_id": "r1", "decision": decision})
                self.assertEqual(calls[-1], ("r1", decision))
            finally:
                core.db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
