"""Local reference-voice library and isolated Qwen3-TTS service lifecycle."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
from core_platform import project_home, voice_environment, venv_python, python_site, subprocess_options, mark_owned, terminate_owned
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import wave
from datetime import datetime, timezone

PROFILE_ID = re.compile(r"[a-f0-9]{32}")
MAX_REFERENCE = 20 * 1024 * 1024
SERVICE_PORT = 18766
MODEL_FOLDER = "qwen3-tts-0.6b-base"


class VoiceProfileError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise VoiceProfileError("Local voice service redirects are not allowed")


class VoiceProfiles:
    def __init__(self, data_dir, root_dir=None):
        self.data_dir = Path(data_dir).resolve()
        self.root = Path(root_dir).resolve() if root_dir else project_home("core", Path(__file__).resolve().parent)
        self.folder = self.data_dir / "voice-profiles"
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.environment = voice_environment(self.root, ".custom-voice-venv", data=self.data_dir)
        self.python = venv_python(self.environment)
        self.model_path = (self.data_dir if sys.platform == "darwin" else self.root / ".local") / "models" / MODEL_FOLDER
        self.endpoint = f"http://127.0.0.1:{SERVICE_PORT}/v1/audio/speech"
        self.identity = hashlib.sha256(str(self.data_dir).encode("utf-8")).hexdigest()[:24]
        self.token_path = self.data_dir / "local-voice-service.token"
        self.process = None
        self.lock = threading.RLock()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def _path(self, profile_id):
        if not isinstance(profile_id, str) or not PROFILE_ID.fullmatch(profile_id):
            raise ValueError("声音档案无效。")
        path = (self.folder / profile_id).resolve()
        if path.parent != self.folder.resolve():
            raise ValueError("声音档案路径无效。")
        return path

    def list(self):
        profiles = []
        with self.lock:
            for child in self.folder.iterdir():
                if not child.is_dir() or not PROFILE_ID.fullmatch(child.name):
                    continue
                try:
                    profiles.append(self.get(child.name))
                except (OSError, ValueError):
                    continue
        return {"profiles": sorted(profiles, key=lambda p: p["created_at"], reverse=True), "status": self.status()}

    def get(self, profile_id):
        path = self._path(profile_id)
        data = json.loads((path / "profile.json").read_text(encoding="utf-8"))
        if data.get("id") != profile_id or not (path / "reference.wav").is_file():
            raise ValueError("声音档案不完整，请重新导入。")
        return {key: data[key] for key in ("id", "name", "transcript", "duration_seconds", "created_at")}

    def import_reference(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("声音档案格式无效。")
        name, transcript = payload.get("name", ""), payload.get("transcript", "")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
            raise ValueError("请填写 1–80 个字符的声音名称。")
        if not isinstance(transcript, str) or not 1 <= len(transcript.strip()) <= 1500 or "\x00" in transcript:
            raise ValueError("请填写参考录音中实际说出的文字（最多 1500 字）。")
        filename = payload.get("filename", "reference.wav")
        if not isinstance(filename, str) or Path(filename).suffix.lower() not in (".wav", ".flac", ".mp3", ".ogg"):
            raise ValueError("参考音频支持 WAV、FLAC、MP3 或 OGG。")
        encoded = payload.get("audio_base64")
        if not isinstance(encoded, str) or not encoded or len(encoded) > MAX_REFERENCE * 4 // 3 + 8:
            raise ValueError("参考音频为空或超过 20 MB。")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, UnicodeEncodeError):
            raise ValueError("参考音频编码无效。") from None
        if not 44 <= len(raw) <= MAX_REFERENCE:
            raise ValueError("参考音频为空或超过 20 MB。")
        if not self.python.is_file():
            raise VoiceProfileError("本地自定义声音环境尚未准备好，请先运行 SetupCustomVoice.cmd。")
        profile_id = uuid.uuid4().hex
        path = self._path(profile_id)
        with self.lock:
            path.mkdir()
            source = path / ("upload" + Path(filename).suffix.lower())
            source.write_bytes(raw)
            try:
                result = subprocess.run([str(self.python), "-B", "-E", "-s", "-X", "utf8", str(self.root / "local_voice_service.py"),
                    "--normalize", str(source), "--output", str(path / "reference.wav")],
                    capture_output=True, timeout=45, **subprocess_options())
                if result.returncode:
                    raise ValueError("无法读取参考音频，请使用 3–30 秒清晰、单人说话的录音。")
                with wave.open(str(path / "reference.wav"), "rb") as audio:
                    duration = audio.getnframes() / audio.getframerate()
                data = {"id": profile_id, "name": name.strip(), "transcript": transcript.strip(),
                        "duration_seconds": round(duration, 3), "created_at": datetime.now(timezone.utc).isoformat()}
                (path / "profile.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                source.unlink()
            except Exception:
                # The resolved target is a fresh, UUID-named child of our library.
                if path.parent == self.folder.resolve():
                    shutil.rmtree(path)
                raise
        return self.get(profile_id)

    def delete(self, profile_id):
        path = self._path(profile_id)
        with self.lock:
            if path.exists():
                shutil.rmtree(path)
        return {"ok": True, "id": profile_id}

    def _health(self):
        try:
            with self.opener.open(f"http://127.0.0.1:{SERVICE_PORT}/health", timeout=0.6) as response:
                value = json.loads(response.read(10000))
            return value if value.get("service") == "laurentina-local-voice" and value.get("identity") == self.identity else None
        except Exception:
            return None

    def status(self):
        health = self._health()
        site = python_site(self.environment)
        installed = self.python.is_file() and all((site / name).is_file() for name in ("qwen_tts/__init__.py", "torch/__init__.py", "soundfile.py"))
        ready = installed and (self.model_path / "model.safetensors").is_file() and (self.model_path / "speech_tokenizer" / "model.safetensors").is_file()
        value = {"installed": installed, "models_ready": ready, "service_running": bool(health), "endpoint": self.endpoint,
                 "engine": "Qwen3-TTS 0.6B Base", "model_loaded": bool(health and health.get("model_loaded"))}
        if health:
            value.update(device=health.get("device"), busy=health.get("busy", False))
            for key in ("gpu_allocated_mb", "gpu_reserved_mb", "backend", "backend_warning", "load_phase", "load_timings", "last_error"):
                if key in health:
                    value[key] = health[key]
        if not ready:
            value["error"] = "本地自定义声音模型尚未准备好，请运行 SetupCustomVoice.cmd。"
        return value

    def start_service(self):
        with self.lock:
            if self._health():
                return self.status()
            if not self.status()["models_ready"]:
                raise VoiceProfileError("本地自定义声音模型尚未准备好，请先运行 SetupCustomVoice.cmd。")
            log = self.data_dir / "local-voice-service.log"
            try:
                with self.token_path.open("x", encoding="ascii") as token_file:
                    token_file.write(secrets.token_urlsafe(32))
            except FileExistsError:
                pass
            env = os.environ.copy()
            env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
            with log.open("wb") as stream:
                self.process = subprocess.Popen([str(self.python), "-B", "-E", "-s", "-X", "utf8", str(self.root / "local_voice_service.py"),
                    "--data-dir", str(self.data_dir), "--model-dir", str(self.model_path), "--port", str(SERVICE_PORT), "--parent-pid", str(os.getpid())],
                    cwd=self.root, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, env=env,
                    **subprocess_options(owned=True))
                mark_owned(self.process)
            for _ in range(40):
                if self._health():
                    return self.status()
                if self.process.poll() is not None:
                    break
                time.sleep(0.15)
            raise VoiceProfileError("本地声音服务未能启动，请检查端口或本地声音服务日志。")

    def release_idle(self, idle_seconds=300, keep_loaded=False):
        if type(keep_loaded) is not bool or type(idle_seconds) not in (int, float) or not math.isfinite(idle_seconds) or not 90 <= idle_seconds <= 86400:
            raise ValueError("闲置回收设置无效。")
        if keep_loaded:
            return {"released": False, "reason": "continuous_voice"}
        with self.lock:
            if not self._health() or not self.token_path.is_file():
                return {"released": False, "reason": "not_owned"}
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{SERVICE_PORT}/v1/service/release_idle",
                    json.dumps({"token": self.token_path.read_text(encoding="ascii").strip(), "idle_seconds": idle_seconds}).encode("ascii"),
                    {"Content-Type": "application/json"})
                with self.opener.open(request, timeout=2) as response:
                    value = json.loads(response.read(1000))
                    if not isinstance(value, dict) or type(value.get("released")) is not bool:
                        return {"released": False, "reason": "invalid_response"}
                    return value
            except Exception:
                return {"released": False, "reason": "unavailable"}

    def stop_service(self):
        with self.lock:
            if self._health() and self.token_path.is_file():
                try:
                    request = urllib.request.Request(f"http://127.0.0.1:{SERVICE_PORT}/v1/service/shutdown",
                        json.dumps({"token": self.token_path.read_text(encoding="ascii").strip()}).encode("ascii"),
                        {"Content-Type": "application/json"})
                    with self.opener.open(request, timeout=2) as response:
                        response.read(1000)
                except Exception:
                    pass
            if self.process and self.process.poll() is None:
                terminate_owned(self.process)
                self.process = None
        return {"ok": True}

    def close(self):
        self.stop_service()
