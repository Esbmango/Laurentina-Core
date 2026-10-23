"""Custom voice idle eviction and language routing, using CPU-only test doubles."""
import contextlib
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import weakref
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from core_voice_profiles import VoiceProfiles
from local_voice_service import LocalVoiceEngine, handler_for


class Model:
    def __init__(self): self.languages, self.prompts, self.generations = [], [], []
    def create_voice_clone_prompt(self, **kwargs):
        self.prompts.append(kwargs)
        return object()
    def generate_voice_clone(self, **kwargs):
        self.generations.append(kwargs)
        self.languages.append(kwargs["language"])
        return [np.zeros(240, dtype=np.float32)], 24000


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="voice-idle-")
        self.addCleanup(self.temp.cleanup)
        self.engine = LocalVoiceEngine(self.temp.name, self.temp.name, backend="official")
        self.engine.model = Model()
        self.engine.device = "cpu"
        self.engine.last_used = time.monotonic() - 1000
        self.engine.prompt_cache["known"] = object()
        self.engine.profiles.get = lambda profile_id: {"transcript": "Reference in Japanese 日本語"}
        self.engine.profiles._path = lambda profile_id: Path(self.temp.name)
        self.engine._wav = lambda audio, rate: b"test-wav"
        self.loads = []
        def load(*args, **kwargs):
            self.loads.append(kwargs)
            return Model()
        self.torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None),
            set_num_threads=lambda n: None, inference_mode=contextlib.nullcontext, float32="float32", bfloat16="bfloat16")
        self.modules = {"torch": self.torch, "qwen_tts": SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=load)),
            "soundfile": SimpleNamespace(read=lambda *args, **kwargs: (np.zeros(240, dtype=np.float32), 24000)),
            "transformers": SimpleNamespace(StoppingCriteria=object, StoppingCriteriaList=list)}

    def test_recently_used_and_busy_never_reclaimed(self):
        model = self.engine.model
        self.engine.last_used = time.monotonic()
        self.assertFalse(self.engine.release_idle(90)["released"])
        self.engine.last_used -= 1000
        self.engine.lock.acquire()
        try:
            self.assertEqual(self.engine.release_idle(90), {"released": False, "reason": "busy"})
        finally:
            self.engine.lock.release()
        self.assertIs(self.engine.model, model)

    def test_reclaim_releases_model_prompt_accelerator_refs_and_next_request_reloads(self):
        reference = weakref.ref(self.engine.model)
        self.engine.accelerator = Model()
        accelerator = weakref.ref(self.engine.accelerator)
        self.assertTrue(self.engine.release_idle(90)["released"])
        self.assertIsNone(reference())
        self.assertIsNone(accelerator())
        self.assertEqual(self.engine.prompt_cache, {})
        with patch.dict("sys.modules", self.modules):
            result = list(self.engine.stream({"input": "你好", "voice": "known"}))
        self.assertEqual(len(result), 1)
        self.assertEqual(len(self.loads), 1)
        self.assertTrue(self.loads[0]["local_files_only"])
        self.assertEqual(self.engine.model.languages, ["Chinese"])
        self.assertFalse(self.engine.release_idle(90)["released"], "freshly reloaded speech must retain its warm cache")

    def test_stream_keeps_lock_through_yield_and_reclaim_cannot_interrupt_audio(self):
        with patch.dict("sys.modules", self.modules):
            stream = self.engine.stream({"input": "Hello", "voice": "known"})
            next(stream)
            self.assertTrue(self.engine.busy)
            self.assertEqual(self.engine.release_idle(90)["reason"], "busy")
            stream.close()
        self.assertFalse(self.engine.busy)
        self.assertFalse(self.engine.release_idle(90)["released"])

    def test_japanese_kana_and_explicit_language_override_reference_language(self):
        cases = [("こんにちは世界", "Auto", "Japanese"), ("ｺﾝﾆﾁﾊ", "Auto", "Japanese"),
                 ("你好世界", "Auto", "Chinese"), ("Hello world", "Auto", "English"),
                 ("日本語", "Japanese", "Japanese"), ("こんにちは", "Chinese", "Chinese"),
                 ("你好", "English", "English")]
        with patch.dict("sys.modules", self.modules):
            for text, setting, expected in cases:
                with self.subTest(text=text, setting=setting):
                    list(self.engine.stream({"input": text, "voice": "known", "language": setting}))
                    self.assertEqual(self.engine.model.languages[-1], expected)

    def test_gpu_release_only_empties_owned_engine_cache_after_idle_check(self):
        emptied = []
        self.engine.device = "cuda:0"
        self.torch.cuda.empty_cache = lambda: emptied.append(True)
        with patch.dict("sys.modules", self.modules):
            self.assertTrue(self.engine.release_idle(90)["released"])
            self.assertFalse(self.engine.release_idle(90)["released"])
        self.assertEqual(emptied, [True])

    def test_japanese_reference_transcript_is_preserved_for_chinese_and_english_targets(self):
        reference = "こんにちは、私はあなたの助手です。"
        captured = []
        self.engine.prompt_cache.clear()
        self.engine.profiles.get = lambda profile: {"transcript": reference}
        self.engine.model.create_voice_clone_prompt = lambda **kwargs: captured.append(kwargs["ref_text"]) or object()
        with patch.dict("sys.modules", self.modules):
            list(self.engine.stream({"input": "你好💙", "voice": "known", "language": "Auto"}))
            list(self.engine.stream({"input": "Hello💙", "voice": "known", "language": "Auto"}))
        self.assertEqual(captured, [reference])
        self.assertEqual(self.engine.model.languages, ["Chinese", "English"])

    def test_reference_prompt_cache_retains_only_two_recent_voices(self):
        self.engine.prompt_cache.clear()
        with patch.dict("sys.modules", self.modules):
            for voice in ("first", "second", "first", "third"):
                list(self.engine.stream({"input": "Hello", "voice": voice}))
        self.assertEqual(list(self.engine.prompt_cache), ["first", "third"])

    def test_speaker_only_is_explicit_and_does_not_reuse_icl_reference_codes(self):
        self.engine.prompt_cache.clear()
        with patch.dict("sys.modules", self.modules):
            list(self.engine.stream({"input": "你好", "voice": "known"}))
            icl = self.engine.prompt_cache["known"]
            list(self.engine.stream({"input": "Hello", "voice": "known", "x_vector_only_mode": True}))
            speaker = self.engine.prompt_cache["known:speaker_only"]
            list(self.engine.stream({"input": "你好", "voice": "known"}))
        model = self.engine.model
        self.assertFalse(model.prompts[0]["x_vector_only_mode"])
        self.assertEqual(model.prompts[0]["ref_text"], "Reference in Japanese 日本語")
        self.assertTrue(model.prompts[1]["x_vector_only_mode"])
        self.assertIsNone(model.prompts[1]["ref_text"])
        self.assertEqual(len(model.prompts), 2, "returning to ICL should reuse its own cached prompt")
        self.assertIsNot(icl, speaker)
        self.assertEqual([item["voice_clone_prompt"] for item in model.generations], [icl, speaker, icl])
        self.assertEqual([item["x_vector_only_mode"] for item in model.generations], [False, True, False])
        self.assertEqual(model.languages, ["Chinese", "English", "Chinese"])

    def test_accelerated_speaker_only_omits_reference_transcript_and_bounds_cache(self):
        self.engine.prompt_cache.clear()
        captured = []
        def generate(**kwargs):
            captured.append(kwargs)
            yield np.zeros(240, dtype=np.float32), 24000, {}
        self.engine.accelerator = SimpleNamespace(generate_voice_clone_streaming=generate)
        with patch.dict("sys.modules", self.modules):
            for voice, speaker_only in (("known", False), ("known", True), ("other", True)):
                list(self.engine.stream({"input": "Hello", "voice": voice, "x_vector_only_mode": speaker_only}))
        self.assertEqual([item["xvec_only"] for item in captured], [False, True, True])
        self.assertEqual([item["ref_text"] for item in captured], ["Reference in Japanese 日本語", "", ""])
        self.assertEqual(list(self.engine.prompt_cache), ["known:speaker_only", "other:speaker_only"])

    def test_invalid_reference_mode_never_loads_or_changes_prompt_cache(self):
        for invalid in ("true", 1, None, {}, []):
            with self.subTest(value=invalid), patch.dict("sys.modules", self.modules), self.assertRaises(ValueError):
                list(self.engine.stream({"input": "Hello", "voice": "known", "x_vector_only_mode": invalid}))
        self.assertEqual(list(self.engine.prompt_cache), ["known"])
        self.assertEqual(self.engine.model.generations, [])

    def test_invalid_idle_values_do_not_touch_cache(self):
        for value in (0, 89, True, None, float("nan"), 86401):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.engine.release_idle(value)
        self.assertIsNotNone(self.engine.model)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="voice-idle-http-")
        self.addCleanup(self.temp.cleanup)
        self.profiles = VoiceProfiles(self.temp.name)
        self.profiles.token_path.write_text("local-test-token", encoding="ascii")
        self.engine = LocalVoiceEngine(self.temp.name, self.temp.name)
        self.engine.model, self.engine.device = Model(), "cpu"
        self.engine.last_used = time.monotonic() - 1000
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), lambda *args: None)
        self.port = self.server.server_address[1]
        self.server.RequestHandlerClass = handler_for(self.engine, self.profiles.identity, self.port, "local-test-token")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)
        self.patch = patch("core_voice_profiles.SERVICE_PORT", self.port)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, token, **kwargs):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/v1/service/release_idle",
            json.dumps({"token": token, **kwargs}).encode(), {"Content-Type": "application/json"})
        return self.opener.open(request, timeout=2)

    def test_matching_identity_and_token_release_cache_without_stopping_service(self):
        self.assertTrue(self.profiles.release_idle(90)["released"])
        self.assertFalse(self.profiles.status()["model_loaded"])
        self.assertTrue(self.profiles.status()["service_running"])

    def test_wrong_identity_or_missing_token_never_requests_release(self):
        other = VoiceProfiles(Path(self.temp.name) / "other-library")
        other.token_path.write_text("local-test-token", encoding="ascii")
        self.assertEqual(other.release_idle(90)["reason"], "not_owned")
        self.profiles.token_path.unlink()
        self.assertEqual(self.profiles.release_idle(90)["reason"], "not_owned")
        self.assertIsNotNone(self.engine.model)

    def test_wrong_and_unicode_control_tokens_are_rejected(self):
        for token in ("wrong-token", "秘密", None):
            with self.subTest(token=token), self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(token, idle_seconds=90)
            self.assertEqual(caught.exception.code, 403)
        self.assertIsNotNone(self.engine.model)

    def test_recent_active_and_keep_loaded_preserve_model(self):
        self.engine.last_used = time.monotonic()
        self.assertFalse(self.profiles.release_idle(90)["released"])
        self.engine.last_used -= 1000
        self.engine.lock.acquire()
        try:
            self.assertEqual(self.profiles.release_idle(90)["reason"], "busy")
        finally:
            self.engine.lock.release()
        self.assertEqual(self.profiles.release_idle(90, keep_loaded=True)["reason"], "continuous_voice")
        self.assertIsNotNone(self.engine.model)

    def test_invalid_idle_duration_is_rejected_by_http_and_client(self):
        for value in (0, True, "300", 89, float("nan")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.profiles.release_idle(value)
            with self.subTest(value=value), self.assertRaises(urllib.error.HTTPError) as caught:
                self.post("local-test-token", idle_seconds=value)
            self.assertEqual(caught.exception.code, 400)
        self.assertIsNotNone(self.engine.model)


if __name__ == "__main__":
    unittest.main(verbosity=2)
