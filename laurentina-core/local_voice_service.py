"""Loopback-only, offline reference-voice synthesis using an isolated Qwen runtime."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path
import re
import socket
import threading
import time
from core_speech_text import strip_spoken_symbols, target_speech_language


def normalize_reference(source, output):
    import numpy as np
    import soundfile as sf
    import soxr
    info = sf.info(source)
    if not 8000 <= info.samplerate <= 192000 or not 1 <= info.channels <= 8 or not 3 <= info.duration <= 30:
        raise ValueError("Reference must contain 3–30 seconds of audio")
    audio, sr = sf.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 0.0001:
        raise ValueError("Reference audio is silent or invalid")
    if sr != 24000:
        audio = soxr.resample(audio, sr, 24000)
    sf.write(output, audio, 24000, subtype="PCM_16")


class SpeechCancelled(RuntimeError):
    pass


class LocalVoiceEngine:
    def __init__(self, data_dir, model_dir, backend="auto"):
        from core_voice_profiles import VoiceProfiles
        self.profiles = VoiceProfiles(data_dir)
        self.model_dir = Path(model_dir)
        self.model = None
        self.accelerator = None
        self.backend_preference = backend
        self.backend = "not_loaded"
        self.backend_warning = None
        self.device = None
        self.lock = threading.Lock()
        self.busy = False
        self.prompt_cache = {}
        self.cancelled = threading.Event()
        self.epoch = 0
        self.last_used = time.monotonic()
        self.load_phase = "not_loaded"
        self.load_timings = {}
        self.last_error = None

    def release_idle(self, idle_seconds):
        if type(idle_seconds) not in (int, float) or not math.isfinite(idle_seconds) or not 90 <= idle_seconds <= 86400:
            raise ValueError("Invalid idle duration")
        if not self.lock.acquire(blocking=False):
            return {"released": False, "reason": "busy"}
        try:
            if self.busy or time.monotonic() - self.last_used < idle_seconds:
                return {"released": False, "reason": "recently_used"}
            if self.model is None:
                return {"released": False, "reason": "not_loaded"}
            self.accelerator = None
            self.prompt_cache.clear()
            self.model = None
            self.backend = "not_loaded"
            self.backend_warning = None
            self.load_phase = "not_loaded"
            import gc
            gc.collect()
            if self.device and self.device.startswith("cuda"):
                import torch
                torch.cuda.empty_cache()
            return {"released": True}
        finally:
            self.lock.release()

    def cancel(self):
        self.epoch += 1
        self.cancelled.set()

    def memory_status(self):
        if self.model is not None and self.device and self.device.startswith("cuda"):
            import torch
            return {"gpu_allocated_mb": round(torch.cuda.memory_allocated() / 1024 ** 2),
                    "gpu_reserved_mb": round(torch.cuda.memory_reserved() / 1024 ** 2)}
        return {}

    def load(self):
        if self.model is None:
            started = time.monotonic()
            self.load_phase = "importing_torch"
            import torch
            self.load_timings["torch_import_ms"] = round((time.monotonic() - started) * 1000, 1)
            started = time.monotonic()
            self.load_phase = "importing_qwen"
            from qwen_tts import Qwen3TTSModel
            self.load_timings["qwen_import_ms"] = round((time.monotonic() - started) * 1000, 1)
            self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
            torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
            started = time.monotonic()
            self.load_phase = "loading_weights"
            self.model = Qwen3TTSModel.from_pretrained(str(self.model_dir), local_files_only=True,
                low_cpu_mem_usage=True,
                device_map=self.device, dtype=torch.bfloat16 if self.device.startswith("cuda") else torch.float32,
                attn_implementation="sdpa")
            self.load_timings["weights_ms"] = round((time.monotonic() - started) * 1000, 1)
            self.backend = "official"
            if self.backend_preference != "official" and self.device.startswith("cuda"):
                started = time.monotonic()
                self.load_phase = "preparing_cuda_graph"
                try:
                    from importlib.metadata import version
                    if version("faster-qwen3-tts") != "0.3.2":
                        raise RuntimeError("Unverified accelerator version")
                    from faster_qwen3_tts import FasterQwen3TTS
                    from faster_qwen3_tts.predictor_graph import PredictorGraph
                    from faster_qwen3_tts.talker_graph import TalkerGraph
                    talker = self.model.model.talker
                    config = self.model.model.config.talker_config
                    predictor = talker.code_predictor
                    # Build from the explicitly offline-loaded base model. The
                    # upstream convenience constructor omits local_files_only.
                    self.accelerator = FasterQwen3TTS(base_model=self.model,
                        predictor_graph=PredictorGraph(predictor, predictor.model.config, config.hidden_size,
                            device=self.device, dtype=torch.bfloat16),
                        talker_graph=TalkerGraph(talker.model, config, device=self.device, dtype=torch.bfloat16, max_seq_len=2048),
                        device=self.device, dtype=torch.bfloat16, max_seq_len=2048)
                    self.accelerator.warmup(prefill_len=120)
                    self.backend = "cuda_graph"
                except Exception:
                    # Unsupported GPUs or missing optional acceleration retain
                    # the original local engine. Never route speech to a cloud.
                    self.accelerator = None
                    self.backend_warning = "CUDA acceleration unavailable; using the original local engine"
                    import gc
                    gc.collect()
                    torch.cuda.empty_cache()
                self.load_timings["cuda_graph_ms"] = round((time.monotonic() - started) * 1000, 1)
            self.load_phase = "ready"

    def stream(self, payload, expected_epoch=None):
        text, profile_id = payload.get("input"), payload.get("voice")
        if isinstance(text, str):
            text = strip_spoken_symbols(text)
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValueError("Speech input must contain 1–2000 characters")
        if payload.get("response_format", "wav") != "wav":
            raise ValueError("This local service returns WAV audio")
        speed = payload.get("speed", 1.0)
        speaker_only = payload.get("x_vector_only_mode", False)
        if type(speaker_only) is not bool:
            raise ValueError("Reference mode must be a boolean")
        language = payload.get("language", "Auto")
        if language not in ("Auto", "Chinese", "English", "Japanese"):
            raise ValueError("Unsupported speech language")
        if language == "Auto":
            language = target_speech_language(text)
        if type(speed) not in (int, float) or not math.isfinite(speed) or not 0.7 <= speed <= 1.4:
            raise ValueError("Speech speed must be between 0.7 and 1.4")
        profile = self.profiles.get(profile_id)
        requested_epoch = self.epoch if expected_epoch is None else expected_epoch
        if not self.lock.acquire(timeout=120):
            raise RuntimeError("Local voice service is busy")
        try:
            if requested_epoch != self.epoch:
                raise SpeechCancelled("Queued speech was cancelled")
            self.busy = True
            self.last_used = time.monotonic()
            self.cancelled.clear()
            self.load()
            if self.cancelled.is_set():
                raise SpeechCancelled("Speech was cancelled")
            import soundfile as sf
            import numpy as np
            import torch
            from transformers import StoppingCriteria, StoppingCriteriaList
            event = self.cancelled
            class StopRequested(StoppingCriteria):
                def __call__(self, input_ids, scores, **kwargs):
                    return event.is_set()
            # Modes must never share a cached ICL prompt: speaker-only excludes
            # reference speech codes and transcript by design. Keep ICL default.
            prompt_key = profile_id + ":speaker_only" if speaker_only else profile_id
            if prompt_key not in self.prompt_cache:
                while len(self.prompt_cache) >= 2:
                    del self.prompt_cache[next(iter(self.prompt_cache))]
                reference = self.profiles._path(profile_id) / "reference.wav"
                ref_audio, sr = sf.read(reference, dtype="float32")
                # A small tail of silence prevents the final reference phoneme
                # from bleeding into the beginning of a new sentence.
                ref_audio = np.concatenate((ref_audio, np.zeros(int(sr * .3), dtype=np.float32)))
                self.prompt_cache[prompt_key] = self.model.create_voice_clone_prompt(
                    ref_audio=(ref_audio, sr), ref_text=None if speaker_only else profile["transcript"],
                    x_vector_only_mode=speaker_only)
            else:
                self.prompt_cache[prompt_key] = self.prompt_cache.pop(prompt_key)
            def arrays():
                with torch.inference_mode():
                    if self.accelerator is not None:
                        iterator = self.accelerator.generate_voice_clone_streaming(text=text.strip(), language=language,
                            voice_clone_prompt=self.prompt_cache[prompt_key],
                            ref_text="" if speaker_only else profile["transcript"], xvec_only=speaker_only,
                            chunk_size=4, max_new_tokens=min(1800, max(160, len(text) * 20)))
                        try:
                            for audio, sr, timing in iterator:
                                if event.is_set():
                                    raise SpeechCancelled("Speech was cancelled")
                                yield audio, sr
                        finally:
                            iterator.close()
                    else:
                        wavs, sr = self.model.generate_voice_clone(text=text.strip(), language=language,
                            voice_clone_prompt=self.prompt_cache[prompt_key], x_vector_only_mode=speaker_only,
                            max_new_tokens=min(2048, max(160, len(text) * 20)),
                            use_cache=True, stopping_criteria=StoppingCriteriaList([StopRequested()]))
                        yield wavs[0], sr
            total_samples, selected_rate, buffered = 0, None, []
            for audio, sr in arrays():
                if event.is_set():
                    raise SpeechCancelled("Speech was cancelled")
                audio = np.asarray(audio, dtype=np.float32).reshape(-1)
                if not len(audio):
                    continue
                if not np.isfinite(audio).all() or sr != 24000 or (selected_rate is not None and sr != selected_rate):
                    raise RuntimeError("Model returned invalid speech")
                total_samples += len(audio)
                selected_rate = sr
                if total_samples / sr > 600 or total_samples * 2 > 16 * 1024 * 1024:
                    raise RuntimeError("Speech output exceeds the local audio limit")
                if speed == 1:
                    yield self._wav(audio, sr), sr, len(audio) / sr
                else:
                    buffered.append(audio)
            if not total_samples:
                raise RuntimeError("Model returned no speech")
            if speed != 1:
                import librosa
                audio = librosa.effects.time_stretch(np.concatenate(buffered), rate=float(speed))
                if event.is_set():
                    raise SpeechCancelled("Speech was cancelled")
                yield self._wav(audio, selected_rate), selected_rate, len(audio) / selected_rate
        finally:
            self.busy = False
            self.last_used = time.monotonic()
            self.lock.release()

    @staticmethod
    def _wav(audio, rate):
        import soundfile as sf
        output = io.BytesIO()
        sf.write(output, audio, rate, format="WAV", subtype="PCM_16")
        return output.getvalue()

    def synthesize(self, payload):
        import wave
        frames, sample_rate = [], None
        for raw, rate, duration in self.stream(payload):
            sample_rate = rate
            with wave.open(io.BytesIO(raw), "rb") as audio:
                frames.append(audio.readframes(audio.getnframes()))
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(sample_rate)
            audio.writeframes(b"".join(frames))
        return output.getvalue()


def handler_for(engine, identity, port, control_token=""):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LaurentinaLocalVoice/0.6"

        def log_message(self, *args):
            pass

        def _allowed(self):
            return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}") and not self.headers.get("Origin")

        def _send(self, status, value, content_type="application/json"):
            raw = value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            if not self._allowed():
                return self._send(403, {"error": "Loopback clients only"})
            if self.path != "/health":
                return self._send(404, {"error": "Not found"})
            self._send(200, {"service": "laurentina-local-voice", "identity": identity,
                "model_loaded": engine.model is not None, "device": engine.device, "busy": engine.busy,
                "backend": getattr(engine, "backend", "unknown"), "backend_warning": getattr(engine, "backend_warning", None),
                "load_phase": getattr(engine, "load_phase", "unknown"), "load_timings": dict(getattr(engine, "load_timings", {})),
                "last_error": getattr(engine, "last_error", None),
                **engine.memory_status()})

        def do_POST(self):
            if not self._allowed():
                return self._send(403, {"error": "Loopback clients only"})
            if self.path not in ("/v1/audio/speech", "/v1/audio/speech/stream", "/v1/audio/stop", "/v1/service/shutdown", "/v1/service/release_idle"):
                return self._send(404, {"error": "Not found"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self._send(415, {"error": "JSON required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 24000:
                    raise ValueError()
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                return self._send(400, {"error": "Invalid request"})
            if self.path == "/v1/audio/stop":
                engine.cancel()
                return self._send(200, {"ok": True})
            if self.path in ("/v1/service/shutdown", "/v1/service/release_idle"):
                token = payload.get("token")
                if not control_token or not isinstance(token, str) or not token.isascii() or not hmac.compare_digest(token, control_token):
                    return self._send(403, {"error": "Invalid service control token"})
                if self.path.endswith("release_idle"):
                    idle = payload.get("idle_seconds", 300)
                    if type(idle) not in (int, float) or not math.isfinite(idle) or not 90 <= idle <= 86400:
                        return self._send(400, {"error": "Invalid idle duration"})
                    return self._send(200, engine.release_idle(idle))
                self._send(200, {"ok": True})
                engine.cancel()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if self.path == "/v1/audio/speech/stream":
                # Reserve the cancellation generation before acknowledging the
                # headers. A stop arriving immediately after HTTP open must
                # cancel this request even before the generator's first next().
                expected_epoch = engine.epoch
                started_at = time.monotonic()
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.flush()
                self.close_connection = True
                iterator, count = engine.stream(payload, expected_epoch=expected_epoch), 0
                def line(value):
                    self.wfile.write(json.dumps(value).encode("utf-8") + b"\n")
                    self.wfile.flush()
                try:
                    for raw, rate, duration in iterator:
                        line({"type": "audio", "seq": count, "audio_base64": base64.b64encode(raw).decode("ascii"),
                              "mime_type": "audio/wav", "sample_rate": rate, "duration_seconds": round(duration, 6),
                              "synthesis_elapsed_seconds": round(time.monotonic() - started_at, 6)})
                        count += 1
                    line({"type": "done", "done": True, "chunks": count, "complete": True})
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    engine.cancel()
                except SpeechCancelled:
                    line({"type": "error", "done": True, "code": "cancelled", "error": "Local speech was cancelled"})
                except Exception as exc:
                    engine.last_error = {"type": type(exc).__name__, "phase": getattr(engine, "load_phase", "unknown")}
                    line({"type": "error", "done": True, "code": "synthesis_failed", "error": "Local speech synthesis did not complete"})
                finally:
                    iterator.close()
                return
            try:
                result = engine.synthesize(payload)
                self._send(200, result, "audio/wav")
            except (ValueError, FileNotFoundError):
                self._send(400, {"error": "Invalid input or reference voice; check the selected voice profile"})
            except Exception:
                self._send(503, {"error": "Local voice synthesis failed; check model readiness and available memory"})
    return Handler


def watch_parent(parent_pid):
    if not parent_pid:
        return
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, parent_pid)
        if not handle:
            os._exit(0)
        kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        kernel.CloseHandle(handle)
        os._exit(0)
    while True:
        try:
            os.kill(parent_pid, 0)
        except ProcessLookupError:
            os._exit(0)
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--port", type=int, default=18766)
    parser.add_argument("--parent-pid", type=int)
    parser.add_argument("--backend", choices=("auto", "official", "cuda_graph"), default="auto")
    parser.add_argument("--diagnostic-traceback-seconds", type=int, default=0)
    parser.add_argument("--normalize", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.normalize:
        normalize_reference(args.normalize, args.output)
        return
    if not args.data_dir or not args.model_dir or not 1024 <= args.port <= 65535:
        parser.error("data directory, model directory and unprivileged port are required")
    if args.diagnostic_traceback_seconds:
        if not 5 <= args.diagnostic_traceback_seconds <= 180:
            parser.error("diagnostic traceback interval must be 5–180 seconds")
        import faulthandler
        faulthandler.dump_traceback_later(args.diagnostic_traceback_seconds, repeat=True)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    identity = hashlib.sha256(str(args.data_dir.resolve()).encode("utf-8")).hexdigest()[:24]
    token_path = args.data_dir / "local-voice-service.token"
    token = token_path.read_text(encoding="ascii").strip() if token_path.is_file() else ""
    # Downloading is a separate setup step. Runtime speech can connect only to
    # literal loopback addresses, including if a dependency tries to download.
    original_connect, original_connect_ex = socket.socket.connect, socket.socket.connect_ex
    def local_connect(sock, address):
        if not isinstance(address, tuple) or address[0] not in ("127.0.0.1", "::1"):
            raise OSError("External network access is disabled for local voice synthesis")
        return original_connect(sock, address)
    def local_connect_ex(sock, address):
        if not isinstance(address, tuple) or address[0] not in ("127.0.0.1", "::1"):
            raise OSError("External network access is disabled for local voice synthesis")
        return original_connect_ex(sock, address)
    socket.socket.connect, socket.socket.connect_ex = local_connect, local_connect_ex
    engine = LocalVoiceEngine(args.data_dir, args.model_dir, args.backend)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(engine, identity, args.port, token))
    server.daemon_threads = True
    if args.parent_pid:
        threading.Thread(target=watch_parent, args=(args.parent_pid,), daemon=True, name="voice-parent-watch").start()
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
