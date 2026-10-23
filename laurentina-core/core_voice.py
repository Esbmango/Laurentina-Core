"""Local speech adapter. Heavy dependencies live only in .voice-venv."""
from __future__ import annotations

import base64
import html
import io
import json
import math
import os
import queue
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import wave
import weakref
import uuid
from pathlib import Path
from core_speech_text import strip_spoken_symbols, target_speech_language

MAX_AUDIO = 8 * 1024 * 1024
MAX_OUTPUT = 16 * 1024 * 1024
MAX_STREAM_CHUNKS = 512
MAX_STREAM_LINE = 2 * 1024 * 1024
VOICE_ID = "zh_CN-huayan-medium"
ENGLISH_VOICE = "en_US-lessac-medium"
MANAGED_SPEECH_URL = "http://127.0.0.1:18766/v1/audio/speech"
VOICE_IDS = ("auto", VOICE_ID, ENGLISH_VOICE)
DEFAULTS = {"tts_provider": "piper", "voice": "auto", "custom_url": "", "custom_model": "",
            "custom_voice": "", "auto_speak": True, "voice_input_mode": "direct", "speech_rate": 1.0,
            "speech_language": "Auto", "voice_clone_mode": "icl", "voice_orb_open_panel": False}
VOICE_BEHAVIOR_VERSION = 1
MIMES = {"audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav"}


def normalize_speech_text(text):
    """Remove presentation markup without rewriting the user's words or numbers."""
    text = html.unescape(text.replace("\r\n", "\n").replace("\r", "\n"))
    text = re.sub(r"!\[([^\]]*)\]\([^\n)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^\n)]*\)", r"\1", text)
    text = re.sub(r"(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)", "", text)
    text = re.sub(r"(?m)^\s*```[^\n]*$", "", text)
    text = re.sub(r"(`+|\*\*|__|~~)", "", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b\ufeff]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return strip_spoken_symbols(re.sub(r"\n{3,}", "\n\n", text))


def speech_chunks(text, voice="auto"):
    chunks = []
    for paragraph in re.split(r"\n+", text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if voice == "auto":
            chinese = len(re.findall(r"[\u3400-\u9fff]", paragraph))
            english = len(re.findall(r"[A-Za-z]+", paragraph))
            selected = VOICE_ID if chinese and chinese * 2 >= english else ENGLISH_VOICE
        else:
            selected = voice
        chunks.append({"text": paragraph, "voice": selected})
    return chunks


class VoiceError(RuntimeError):
    pass


def _windows_process_job(process):
    """Keep the venv launcher and inference child in an owned lifetime group."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    class Limits(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
            ("flags", wintypes.DWORD), ("minimum_working_set", ctypes.c_size_t), ("maximum_working_set", ctypes.c_size_t),
            ("active_processes", wintypes.DWORD), ("affinity", ctypes.c_size_t),
            ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
    class Counters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ("reads", "writes", "others", "read_bytes", "write_bytes", "other_bytes")]
    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("basic", Limits), ("io", Counters), ("process_memory", ctypes.c_size_t),
            ("job_memory", ctypes.c_size_t), ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateJobObjectW
    create.argtypes, create.restype = (wintypes.LPVOID, wintypes.LPCWSTR), wintypes.HANDLE
    configure = kernel.SetInformationJobObject
    configure.argtypes, configure.restype = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD), wintypes.BOOL
    assign = kernel.AssignProcessToJobObject
    assign.argtypes, assign.restype = (wintypes.HANDLE, wintypes.HANDLE), wintypes.BOOL
    close = kernel.CloseHandle
    close.argtypes, close.restype = (wintypes.HANDLE,), wintypes.BOOL
    handle = create(None, None)
    if not handle:
        return None
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not configure(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not assign(handle, wintypes.HANDLE(int(process._handle))):
        close(handle)
        return None
    return lambda: close(handle)


class ResidentWorker:
    """One offline inference process per task, with serialized, bounded JSON RPC.

    ASR and TTS use separate instances so recording can interrupt speech without
    discarding the recognition model. A cancelled queued call never starts later.
    """
    MAX_LINE = 24 * 1024 * 1024

    def __init__(self, python, script, root, action):
        self.python, self.script, self.root = python, script, root
        self.action = action
        self.state_lock = threading.RLock()
        self.request_lock = threading.Lock()
        self.epoch = 0
        self.serial = 0
        self.closed = False
        self.in_flight = False
        self.pending_requests = 0
        self.last_activity = time.monotonic()
        self.process = None
        self.responses = None
        self._lifetime = {"process": None, "job": None}
        self._finalizer = weakref.finalize(self, self._dispose, self._lifetime)

    @staticmethod
    def _dispose(state):
        process = state.get("process")
        state["process"] = None
        job = state.get("job")
        state["job"] = None
        if job:
            job()
        if process is None:
            return
        try:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        for stream in (process.stdin, process.stdout):
            if stream:
                try:
                    stream.close()
                except OSError:
                    pass

    @staticmethod
    def _read_responses(process, responses):
        try:
            while True:
                line = process.stdout.readline(ResidentWorker.MAX_LINE + 1)
                if not line:
                    responses.put_nowait(None)
                    return
                if len(line) > ResidentWorker.MAX_LINE or not line.endswith(b"\n"):
                    responses.put_nowait(None)
                    return
                responses.put_nowait(line)
        except (OSError, ValueError, queue.Full):
            try:
                responses.put_nowait(None)
            except queue.Full:
                pass

    def _start(self):
        if self.process is not None and self.process.poll() is None:
            return
        self._dispose(self._lifetime)
        if not self.python.is_file():
            raise VoiceError("本地语音运行环境尚未安装。")
        env = os.environ.copy()
        env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", TOKENIZERS_PARALLELISM="false")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        process = subprocess.Popen([str(self.python), "-E", "-s", "-X", "utf8", str(self.script), "--serve", self.action],
            cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, creationflags=flags)
        self.process = process
        self._lifetime["process"] = process
        self._lifetime["job"] = _windows_process_job(process)
        self.responses = queue.Queue(maxsize=2)
        threading.Thread(target=self._read_responses, args=(process, self.responses), daemon=True,
                         name="voice-" + self.action).start()

    def request(self, message, timeout):
        with self.state_lock:
            self.pending_requests += 1
            self.last_activity = time.monotonic()
            epoch = self.epoch
        try:
            return self._request(message, timeout, epoch)
        finally:
            with self.state_lock:
                self.pending_requests -= 1
                self.last_activity = time.monotonic()

    def _request(self, message, timeout, epoch):
        with self.request_lock:
            with self.state_lock:
                if self.closed or epoch != self.epoch:
                    raise VoiceError("朗读已停止。" if self.action == "speak" else "语音处理已停止。")
                self._start()
                process, responses = self.process, self.responses
                self.in_flight = True
                self.serial += 1
                request_id = self.serial
                encoded = (json.dumps({**message, "request_id": request_id}, ensure_ascii=False) + "\n").encode("utf-8")
                try:
                    process.stdin.write(encoded)
                    process.stdin.flush()
                except (OSError, ValueError):
                    self.in_flight = False
                    self._dispose(self._lifetime)
                    raise VoiceError("本地语音连接中断，请重试。") from None
            try:
                line = responses.get(timeout=timeout)
            except queue.Empty:
                with self.state_lock:
                    self.in_flight = False
                    if self.process is process:
                        self._dispose(self._lifetime)
                raise VoiceError("本地语音处理超时，请缩短录音或文本后重试。") from None
            with self.state_lock:
                self.in_flight = False
                if self.closed or epoch != self.epoch:
                    raise VoiceError("朗读已停止。" if self.action == "speak" else "语音处理已停止。")
                try:
                    result = json.loads(line) if line else None
                    valid = isinstance(result, dict) and result.get("request_id") == request_id
                except (ValueError, UnicodeDecodeError):
                    valid = False
                if not valid:
                    if self.process is process:
                        self._dispose(self._lifetime)
                    raise VoiceError("本地语音连接中断，请重试。")
                return result

    def activity_status(self):
        with self.state_lock:
            loaded = self.process is not None and self.process.poll() is None
            return {"loaded": loaded, "busy": bool(self.pending_requests or self.in_flight),
                    "idle_seconds": max(0, time.monotonic() - self.last_activity),
                    "pid": self.process.pid if loaded else None}

    def release_idle(self, idle_seconds=0):
        """Drop only this worker's idle cache; queued calls count as active."""
        if type(idle_seconds) not in (int, float) or not math.isfinite(idle_seconds) or idle_seconds < 0:
            raise ValueError("闲置时间无效。")
        with self.state_lock:
            state = self.activity_status()
            if not state["loaded"] or state["busy"] or state["idle_seconds"] < idle_seconds:
                return {"released": False, **state}
            self._dispose(self._lifetime)
            self.process = None
            self.responses = None
            return {"released": True, "loaded": False, "busy": False, "idle_seconds": state["idle_seconds"]}

    def cancel(self, close=False):
        with self.state_lock:
            self.epoch += 1
            self.closed = self.closed or close
            if self.in_flight or close:
                self._dispose(self._lifetime)
        return {"ok": True}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise VoiceError("语音接口发生重定向，已停止请求。")


def local_speech_url(value):
    if not isinstance(value, str) or not value or len(value) > 1000 or any(ord(c) < 32 for c in value):
        raise ValueError("请填写本机语音接口地址。")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError("语音接口地址格式无效。") from None
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "::1"):
        raise ValueError("自定义语音接口必须使用 127.0.0.1 或 [::1] 的本机地址。")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or (port is not None and not 1 <= port <= 65535):
        raise ValueError("语音接口地址不能包含账号、密码、查询参数或片段。")
    path = parsed.path.rstrip("/")
    if any(part in (".", "..") for part in urllib.parse.unquote(path).split("/")):
        raise ValueError("语音接口路径无效。")
    if not path.endswith("/audio/speech"):
        path += "/audio/speech"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _validate_wav(raw):
    if not isinstance(raw, bytes) or not 44 <= len(raw) <= MAX_OUTPUT or not raw.startswith(b"RIFF") or raw[8:12] != b"WAVE":
        raise VoiceError("语音服务未返回有效 WAV 音频，请检查接口或缩短文本。")
    try:
        with wave.open(io.BytesIO(raw), "rb") as audio:
            if audio.getnchannels() not in (1, 2) or not 8000 <= audio.getframerate() <= 192000 or audio.getsampwidth() not in (1, 2, 3, 4):
                raise VoiceError("语音服务返回的 WAV 参数不受支持。")
            frames = audio.getnframes()
            if frames <= 0 or frames / audio.getframerate() > 600:
                raise VoiceError("语音结果为空或超过十分钟，请缩短文本。")
            frame_bytes = audio.getnchannels() * audio.getsampwidth()
            remaining = frames
            while remaining:
                count = min(remaining, max(1, 65536 // frame_bytes))
                if len(audio.readframes(count)) != count * frame_bytes:
                    raise VoiceError("语音服务返回的音频不完整。")
                remaining -= count
            duration = frames / audio.getframerate()
    except (wave.Error, EOFError):
        raise VoiceError("语音服务返回的 WAV 音频无法读取。") from None
    return duration


def validated_wav(raw):
    _validate_wav(raw)
    return {"audio_base64": base64.b64encode(raw).decode("ascii"), "mime_type": "audio/wav"}


class VoiceBridge:
    def __init__(self, data_dir, root_dir=None, runner=None, opener=None):
        self.data_dir = Path(data_dir).resolve()
        self.root = Path(root_dir).resolve() if root_dir else Path(__file__).resolve().parent
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.data_dir / "voice-settings.json"
        self.temp_root = self.data_dir / "voice-temp"
        self.python = self.root / ".voice-venv" / "Scripts" / "python.exe"
        self.site = self.root / ".voice-venv" / "Lib" / "site-packages"
        self.asr_model = self.root / ".local" / "models" / "whisper-base"
        self.tts_model = self.root / ".local" / "models" / "piper" / (VOICE_ID + ".onnx")
        self.english_model = self.tts_model.with_name(ENGLISH_VOICE + ".onnx")
        self.runner = runner
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.lock = threading.RLock()
        self.active = {}
        self.workers = {action: ResidentWorker(self.python, self.root / "core_voice_worker.py", self.root, action)
                        for action in ("speak", "transcribe")}
        self.custom_verified = False
        self.speech_epoch = 0
        self.stream_open_lock = threading.RLock()
        self.stream_condition = threading.Condition(self.lock)
        self.speech_session = None
        self.last_tts_activity = time.monotonic()
        self.tts_requests = 0
        self.resource_preset = "balanced"

    def settings(self):
        try:
            with self.lock:
                data = json.loads(self.config_path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    raise ValueError()
                # v0.4 makes the user's requested voice-first behavior the default
                # once. Later opt-outs carry the version and remain untouched.
                version = data.get("_behavior_version", 0)
                migrate = type(version) is not int or version < VOICE_BEHAVIOR_VERSION
                value = self._validate({**DEFAULTS, **data, **({"auto_speak": True, "voice_input_mode": "direct"} if migrate else {})})
                if migrate:
                    self._write_settings(value)
                return value
        except (OSError, ValueError):
            return dict(DEFAULTS)

    def _write_settings(self, value):
        temporary = self.config_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({**value, "_behavior_version": VOICE_BEHAVIOR_VERSION}, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.config_path)

    def _validate(self, data):
        provider = data.get("tts_provider")
        if provider not in ("piper", "custom"):
            raise ValueError("请选择本地 Piper 或自定义本机语音接口。")
        if type(data.get("auto_speak")) is not bool:
            raise ValueError("自动朗读设置无效。")
        if type(data.get("voice_orb_open_panel")) is not bool:
            raise ValueError("语音球打开面板设置无效。")
        if data.get("voice_input_mode") not in ("direct", "review"):
            raise ValueError("请选择识别后直接发送或先检查文字。")
        if data.get("voice") not in VOICE_IDS:
            raise ValueError("请选择自动中英切换、华燕中文或 Lessac 英文声音。")
        if data.get("speech_language") not in ("Auto", "Chinese", "English", "Japanese"):
            raise ValueError("请选择自动、中文、英文或日文朗读语言。")
        if data.get("voice_clone_mode") not in ("icl", "speaker_only"):
            raise ValueError("请选择完整参考或仅保留音色。")
        rate = data.get("speech_rate")
        if type(rate) not in (int, float) or not math.isfinite(rate) or not 0.7 <= rate <= 1.4:
            raise ValueError("朗读速度应在 0.7–1.4 倍之间。")
        for key in ("custom_model", "custom_voice"):
            if not isinstance(data.get(key), str) or len(data[key]) > 160 or any(ord(c) < 32 for c in data[key]):
                raise ValueError("自定义语音模型或声音名称无效。")
        if data.get("custom_url"):
            data["custom_url"] = local_speech_url(data["custom_url"])
        elif provider == "custom":
            raise ValueError("请先填写本机自定义语音接口地址。")
        return {k: data[k] for k in DEFAULTS}

    def save_settings(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("语音设置格式不正确。")
        if any(key not in DEFAULTS for key in payload):
            raise ValueError("语音设置含有不支持的字段。")
        previous = self.settings()
        value = self._validate({**previous, **payload})
        changed_voice = any(previous[key] != value[key] for key in
                            ("tts_provider", "voice", "custom_url", "custom_model", "custom_voice", "speech_rate", "speech_language", "voice_clone_mode"))
        if changed_voice or (previous["auto_speak"] and not value["auto_speak"]):
            self.stop()
        with self.lock:
            self._write_settings(value)
            self.custom_verified = False
        return value

    def status(self):
        settings = self.settings()
        runtime = self.python.is_file()
        asr_ready = runtime and (self.site / "faster_whisper" / "__init__.py").is_file() and all((self.asr_model / n).is_file() for n in ("model.bin", "config.json", "tokenizer.json"))
        model_paths = [self.tts_model, self.english_model] if settings["voice"] == "auto" else [self.tts_model if settings["voice"] == VOICE_ID else self.english_model]
        piper_ready = runtime and (self.site / "piper" / "__init__.py").is_file() and all(path.is_file() and Path(str(path) + ".json").is_file() for path in model_paths)
        tts_ready = piper_ready if settings["tts_provider"] == "piper" else bool(settings["custom_url"])
        errors = []
        if not asr_ready:
            errors.append("本地语音识别运行环境或模型尚未准备好。")
        if not tts_ready:
            errors.append("本地中英语音模型尚未准备好。")
        return {"ok": asr_ready and tts_ready, "asr_ready": asr_ready, "tts_ready": tts_ready,
                "voices": [{"id": "auto", "name": "自动 · 中文 / English"}, {"id": VOICE_ID, "name": "华燕 · 中文（本地）"},
                           {"id": ENGLISH_VOICE, "name": "Lessac · English（本地）"}], "settings": settings,
                "provider_verified": piper_ready if settings["tts_provider"] == "piper" else self.custom_verified,
                **({"error": " ".join(errors)} if errors else {})}

    def _worker(self, action, payload, timeout=150):
        with self.lock:
            preset = self.resource_preset
        message = {"action": action, **payload, "resource_preset": preset}
        if self.runner:
            result = self.runner(message)
        else:
            result = self.workers[action].request(message, timeout)
        if not isinstance(result, dict) or result.get("ok") is not True:
            error = result.get("error") if isinstance(result, dict) else None
            raise VoiceError(error if isinstance(error, str) and len(error) < 300 else "本地语音处理失败。")
        return result

    def set_resource_preset(self, preset):
        if preset not in ("balanced", "low_memory"):
            raise ValueError("资源模式无效。")
        # Apply to the next request; maintenance never cancels active speech.
        with self.lock:
            self.resource_preset = preset
        return {"ok": True}

    def activity_status(self):
        with self.lock:
            tts = self.workers["speak"].activity_status()
            tts["busy"] = tts["busy"] or bool(self.tts_requests) or bool(self.speech_session and not self.speech_session["done"])
            tts["idle_seconds"] = min(tts["idle_seconds"], max(0, time.monotonic() - self.last_tts_activity))
            return {"tts": tts, "asr": self.workers["transcribe"].activity_status()}

    def release_idle(self, *, keep_tts=False, keep_asr=False, asr_idle_seconds=0, tts_idle_seconds=0):
        """Release owned idle offline caches without cancelling an active session."""
        released = []
        with self.lock:
            if not keep_asr and self.workers["transcribe"].release_idle(asr_idle_seconds)["released"]:
                released.append("asr")
            if not keep_tts and not self.tts_requests and not (self.speech_session and not self.speech_session["done"]):
                if self.workers["speak"].release_idle(tts_idle_seconds)["released"]:
                    released.append("piper")
        return {"ok": True, "released": released}

    def transcribe(self, audio_base64, mime_type):
        if not isinstance(mime_type, str) or mime_type.split(";")[0].strip().lower() not in MIMES:
            raise ValueError("录音仅支持 WebM、Ogg 或 WAV。")
        mime = mime_type.split(";")[0].strip().lower()
        if not isinstance(audio_base64, str) or not audio_base64 or len(audio_base64) > (MAX_AUDIO * 4 // 3 + 8):
            raise ValueError("录音为空或超过 8 MiB，请控制在一分钟以内。")
        try:
            raw = base64.b64decode(audio_base64, validate=True)
        except (ValueError, UnicodeEncodeError):
            raise ValueError("录音数据格式不正确。") from None
        if not 16 <= len(raw) <= MAX_AUDIO:
            raise ValueError("录音为空或超过 8 MiB。")
        if self.runner is None and not self.status()["asr_ready"]:
            raise VoiceError("本地语音识别模型或运行环境尚未准备好。")
        self.temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="asr-", dir=self.temp_root) as directory:
            path = Path(directory) / ("recording" + MIMES[mime])
            path.write_bytes(raw)
            result = self._worker("transcribe", {"audio_path": str(path), "model_path": str(self.asr_model), "max_seconds": 60})
        text = result.get("text", "")
        if not isinstance(text, str) or len(text) > 12000:
            raise VoiceError("语音识别返回无效文本。")
        return {"text": text.strip()}

    def prepare(self):
        settings = self.settings()
        tts_ready = self.custom_verified if settings["tts_provider"] == "custom" else False
        if settings["tts_provider"] == "piper":
            paths = [self.tts_model, self.english_model] if settings["voice"] == "auto" else [self.tts_model if settings["voice"] == VOICE_ID else self.english_model]
            self._worker("speak", {"action": "prepare", "engine": "piper", "model_paths": [str(path) for path in paths]})
            tts_ready = True
        self._worker("transcribe", {"action": "prepare", "engine": "whisper", "model_path": str(self.asr_model)})
        return {"ok": True, "asr_ready": True, "tts_ready": tts_ready, "tts_provider": settings["tts_provider"]}

    def speak(self, text, *, _expected_epoch=None):
        with self.lock:
            self.tts_requests += 1
            self.last_tts_activity = time.monotonic()
        try:
            return self._speak(text, _expected_epoch=_expected_epoch)
        finally:
            with self.lock:
                self.tts_requests -= 1
                self.last_tts_activity = time.monotonic()

    def _speak(self, text, *, _expected_epoch=None):
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValueError("每次朗读应为 1–2000 个字符；较长回答请分段播放。")
        text = normalize_speech_text(text)
        if not text:
            raise ValueError("没有可朗读的文字。")
        settings = self.settings()
        original_encoded = None
        with self.lock:
            epoch = self.speech_epoch if _expected_epoch is None else _expected_epoch
            if epoch != self.speech_epoch:
                raise VoiceError("朗读已停止。")
        if settings["tts_provider"] == "piper":
            if self.runner is None and not self.status()["tts_ready"]:
                raise VoiceError("本地中英声音模型或运行环境尚未准备好。")
            chunks = speech_chunks(text.strip(), settings["voice"])
            for chunk in chunks:
                chunk["model_path"] = str(self.tts_model if chunk["voice"] == VOICE_ID else self.english_model)
            result = self._worker("speak", {"chunks": chunks, "speech_rate": settings["speech_rate"]})
            encoded = result.get("audio_base64", "")
            if not isinstance(encoded, str) or len(encoded) > MAX_OUTPUT * 4 // 3 + 8:
                raise VoiceError("本地语音结果过大，请分段朗读。")
            try:
                raw = base64.b64decode(encoded, validate=True)
                original_encoded = encoded
            except (ValueError, UnicodeEncodeError):
                raise VoiceError("本地语音结果格式无效。") from None
        else:
            endpoint = local_speech_url(settings["custom_url"])
            body = {"input": text.strip(), "response_format": "wav", "voice": settings["custom_voice"] or "default",
                    "language": target_speech_language(text) if settings["speech_language"] == "Auto" else settings["speech_language"]}
            if endpoint == MANAGED_SPEECH_URL:
                body["x_vector_only_mode"] = settings["voice_clone_mode"] == "speaker_only"
            if settings["speech_rate"] != 1:
                body["speed"] = settings["speech_rate"]
            if settings["custom_model"]:
                body["model"] = settings["custom_model"]
            request = urllib.request.Request(endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json", "Accept": "audio/wav"})
            try:
                with self.opener.open(request, timeout=90) as response:
                    # Defense in depth if an injected opener follows redirects.
                    if getattr(response, "geturl", lambda: endpoint)() != endpoint:
                        raise VoiceError("语音接口发生重定向，已停止请求。")
                    raw = response.read(MAX_OUTPUT + 1)
            except VoiceError:
                raise
            except Exception:
                raise VoiceError("无法从自定义本机语音接口获取 WAV，请检查服务和声音配置。") from None
        _validate_wav(raw)
        result = {"audio_base64": original_encoded if original_encoded is not None else base64.b64encode(raw).decode("ascii"), "mime_type": "audio/wav"}
        with self.lock:
            if epoch != self.speech_epoch:
                raise VoiceError("朗读已停止。")
            if settings["tts_provider"] == "custom":
                self.custom_verified = True
        return result

    def start(self, text):
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValueError("每次朗读应为 1–2000 个字符。")
        text = normalize_speech_text(text)
        if not text:
            raise ValueError("没有可朗读的文字。")
        self.stop()
        settings = self.settings()
        with self.lock:
            session = {"id": uuid.uuid4().hex, "epoch": self.speech_epoch, "chunks": [], "bytes": 0,
                       "done": False, "response": None, "next_seq": 1, "ack": 0,
                       "started_at": time.monotonic(), "source_at": None,
                       "diagnostics": {"first_audio_ms": None, "audio_seconds": 0, "chunks": 0,
                                       "max_source_gap_ms": 0, "backpressure_ms": 0}}
            if settings["tts_provider"] == "custom":
                detected = target_speech_language(text)
                effective = detected if settings["speech_language"] == "Auto" else settings["speech_language"]
                session["diagnostics"].update(requested_language=settings["speech_language"],
                    detected_language=detected, effective_language=effective,
                    language_override=detected != "Auto" and effective != detected,
                    reference_mode=settings["voice_clone_mode"] if settings["custom_url"] == MANAGED_SPEECH_URL else "external")
            self.speech_session = session
            self.last_tts_activity = time.monotonic()
        threading.Thread(target=self._run_session, args=(session, text, settings), daemon=True,
                         name="voice-stream").start()
        return {"id": session["id"]}

    def poll(self, session_id, after=0):
        if not isinstance(session_id, str) or not re.fullmatch(r"[a-f0-9]{32}", session_id):
            raise ValueError("朗读会话无效。")
        if type(after) is not int or after < 0:
            raise ValueError("朗读进度无效。")
        with self.lock:
            session = self.speech_session
            if not session or session["id"] != session_id:
                return {"id": session_id, "chunks": [], "done": True, "error": "朗读已停止。"}
            if after >= session["next_seq"]:
                raise ValueError("朗读进度超出已生成的声音。")
            session["ack"] = max(after, session["ack"])
            session["chunks"] = [chunk for chunk in session["chunks"] if chunk["seq"] > session["ack"]]
            self.stream_condition.notify_all()
            diagnostics = {**session["diagnostics"], "elapsed_ms": round((time.monotonic() - session["started_at"]) * 1000, 1),
                           "phase": "stopped" if session.get("error") else "completed" if session["done"] else
                                    "streaming" if session["diagnostics"]["chunks"] else "awaiting_first_audio"}
            return {"id": session_id, "chunks": [dict(chunk) for chunk in session["chunks"] if chunk["seq"] > after],
                    "done": session["done"], "diagnostics": diagnostics,
                    **({"error": session["error"]} if session.get("error") else {})}

    def _session_current(self, session):
        return self.speech_session is session and session["epoch"] == self.speech_epoch and not session["done"]

    def _append_chunk(self, session, raw, *, _encoded=None):
        # _encoded is the exact string already decoded into raw by our reader.
        # Validate PCM once, then share it rather than allocating another base64.
        duration = _validate_wav(raw)
        result = {"audio_base64": _encoded if _encoded is not None else base64.b64encode(raw).decode("ascii"), "mime_type": "audio/wav"}
        received_at = time.monotonic()
        with self.lock:
            while self._session_current(session) and len(session["chunks"]) >= 4:
                self.stream_condition.wait(timeout=0.5)
            if not self._session_current(session):
                raise VoiceError("朗读已停止。")
            if session["bytes"] + len(raw) > MAX_OUTPUT or session["next_seq"] > MAX_STREAM_CHUNKS:
                raise VoiceError("语音结果过大，请缩短文本后重试。")
            session["bytes"] += len(raw)
            session["chunks"].append({"seq": session["next_seq"], **result})
            session["next_seq"] += 1
            now = time.monotonic()
            diagnostics = session["diagnostics"]
            if diagnostics["first_audio_ms"] is None:
                diagnostics["first_audio_ms"] = round((received_at - session["started_at"]) * 1000, 1)
            if session["source_at"] is not None:
                diagnostics["max_source_gap_ms"] = round(max(diagnostics["max_source_gap_ms"],
                    (received_at - session["source_at"]) * 1000), 1)
            diagnostics["backpressure_ms"] = round(diagnostics["backpressure_ms"] + (now - received_at) * 1000, 1)
            diagnostics["audio_seconds"] = round(diagnostics["audio_seconds"] + duration, 4)
            diagnostics["chunks"] += 1
            session["source_at"] = now

    @staticmethod
    def _close_stream(response):
        if response is None:
            return
        # Interrupt a concurrent urllib read before closing its buffered object.
        sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
        if sock:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        try:
            response.close()
        except (OSError, ValueError):
            pass

    def _run_session(self, session, text, settings):
        response = None
        try:
            with self.lock:
                if not self._session_current(session):
                    return
            if settings["tts_provider"] != "custom" or settings["custom_url"] != MANAGED_SPEECH_URL:
                result = self.speak(text, _expected_epoch=session["epoch"])
                self._append_chunk(session, base64.b64decode(result["audio_base64"], validate=True), _encoded=result["audio_base64"])
            else:
                body = {"input": text, "voice": settings["custom_voice"] or "default", "response_format": "wav",
                        "speed": settings["speech_rate"],
                        "language": target_speech_language(text) if settings["speech_language"] == "Auto" else settings["speech_language"],
                        "x_vector_only_mode": settings["voice_clone_mode"] == "speaker_only"}
                if settings["custom_model"]:
                    body["model"] = settings["custom_model"]
                endpoint = MANAGED_SPEECH_URL + "/stream"
                request = urllib.request.Request(endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "application/json", "Accept": "application/x-ndjson"})
                # The managed service sends headers before loading/inference.
                # Stop must wait until this old request is actually submitted,
                # then cancel it before a new stream is allowed to start.
                with self.stream_open_lock:
                    with self.lock:
                        if not self._session_current(session):
                            return
                    response = self.opener.open(request, timeout=5)
                    if getattr(response, "geturl", lambda: endpoint)() != endpoint:
                        raise VoiceError("语音接口发生重定向，已停止请求。")
                    with self.lock:
                        session["response"] = response
                sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                if sock:
                    sock.settimeout(90)
                count, complete = 0, False
                while True:
                    line = response.readline(MAX_STREAM_LINE + 1)
                    if not line:
                        break
                    if len(line) > MAX_STREAM_LINE or not line.endswith(b"\n"):
                        raise VoiceError("语音流数据无效或过大。")
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        raise VoiceError("语音流数据无效。") from None
                    if not isinstance(event, dict):
                        raise VoiceError("语音流数据无效。")
                    del line
                    if event.get("type") == "audio":
                        encoded = event.get("audio_base64")
                        if type(event.get("seq")) is not int or event["seq"] != count or event.get("mime_type") != "audio/wav" or not isinstance(encoded, str):
                            raise VoiceError("语音流顺序或音频格式无效。")
                        try:
                            raw = base64.b64decode(encoded, validate=True)
                        except (ValueError, UnicodeEncodeError):
                            raise VoiceError("语音流音频编码无效。") from None
                        self._append_chunk(session, raw, _encoded=encoded)
                        service_elapsed = event.get("synthesis_elapsed_seconds")
                        if type(service_elapsed) in (int, float) and math.isfinite(service_elapsed) and service_elapsed >= 0:
                            with self.lock:
                                diagnostics = session["diagnostics"]
                                if "service_first_audio_ms" not in diagnostics:
                                    diagnostics["service_first_audio_ms"] = round(service_elapsed * 1000, 1)
                                diagnostics["service_elapsed_ms"] = round(service_elapsed * 1000, 1)
                        count += 1
                    elif event.get("type") == "done":
                        if event.get("complete") is not True or type(event.get("chunks")) is not int or event["chunks"] != count or count == 0:
                            raise VoiceError("语音流未完整结束。")
                        complete = True
                        break
                    elif event.get("type") == "error":
                        raise VoiceError("朗读已停止。" if event.get("code") == "cancelled" else "本地声音合成未完成，请重试。")
                    else:
                        raise VoiceError("语音流事件无效。")
                if not complete:
                    raise VoiceError("语音流连接中断，请重试。")
                with self.lock:
                    if self._session_current(session):
                        self.custom_verified = True
            with self.lock:
                if self._session_current(session):
                    session["done"] = True
        except Exception as exc:
            with self.lock:
                if self._session_current(session):
                    session["done"] = True
                    session["error"] = str(exc) if isinstance(exc, VoiceError) else "本地声音合成未完成，请重试。"
        finally:
            self._close_stream(response)
            with self.lock:
                session["response"] = None
                self.last_tts_activity = time.monotonic()

    def stop(self):
        with self.lock:
            self.speech_epoch += 1
            session = self.speech_session
            if session:
                session["done"] = True
                session["error"] = "朗读已停止。"
                session["chunks"] = []
            self.stream_condition.notify_all()
            response = session.get("response") if session else None
        self.workers["speak"].cancel()
        settings = self.settings()
        # Only our bundled, explicitly configured service exposes this protocol.
        # Never infer administrative paths for arbitrary third-party endpoints.
        if settings["tts_provider"] == "custom" and settings["custom_url"] == MANAGED_SPEECH_URL:
            request = urllib.request.Request(MANAGED_SPEECH_URL.removesuffix("/speech") + "/stop", data=b"{}",
                headers={"Content-Type": "application/json"}, method="POST")
            try:
                with self.stream_open_lock:
                    with self.opener.open(request, timeout=2) as cancellation:
                        cancellation.read(1024)
            except Exception:
                pass
        with self.lock:
            response = session.get("response") if session else response
        self._close_stream(response)
        return {"ok": True}

    def close(self):
        self.stop()
        for worker in self.workers.values():
            worker.cancel(close=True)
