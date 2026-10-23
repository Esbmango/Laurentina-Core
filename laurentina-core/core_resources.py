"""Conservative local resource policy. Never infer ownership from a model list.

Telemetry contains capacity and model metadata only. Leases do not expire on a
timer: a long-running inference or Hermes review must remain busy until ended.
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import deque
from pathlib import Path

MIB = 1024 * 1024
STAGES = {"asr", "tts", "chat", "work", "continuous_voice"}
PRESETS = {
    "balanced": {"asr_idle_seconds": 600, "tts_idle_seconds": 900, "custom_idle_seconds": 900},
    "low_memory": {"asr_idle_seconds": 90, "tts_idle_seconds": 180, "custom_idle_seconds": 300},
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise OSError("Local resource endpoint redirected")


def _local_json(path, payload=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    endpoint = "http://127.0.0.1:11434" + path
    request = urllib.request.Request(endpoint, data=None if payload is None else json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
    with opener.open(request, timeout=2) as response:
        if response.geturl() != endpoint:
            raise OSError("Local resource endpoint redirected")
        data = response.read(256 * 1024 + 1)
    if len(data) > 256 * 1024:
        raise ValueError("Resource metadata exceeds limit")
    return json.loads(data)


def _ram_snapshot():
    unavailable = {"available": False, "total_bytes": None, "available_bytes": None, "used_percent": None}
    try:
        if sys.platform == "win32":
            import ctypes
            class MemoryStatus(ctypes.Structure):
                _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong) for name in ("total", "free", "page_total", "page_free", "virtual_total", "virtual_free", "extended_free")]
            value = MemoryStatus()
            value.length = ctypes.sizeof(value)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
                return unavailable
            total, free = value.total, value.free
        elif sys.platform == "darwin":
            # Unified memory is system RAM, not a separately measurable NVIDIA
            # VRAM pool. vm_stat is an estimate, cached by ResourceManager.
            flags = {"capture_output": True, "text": True, "timeout": 2, "check": True}
            total = int(subprocess.run(["/usr/sbin/sysctl", "-n", "hw.memsize"], **flags).stdout.strip())
            output = subprocess.run(["/usr/bin/vm_stat"], **flags).stdout
            size = re.search(r"page size of (\d+) bytes", output)
            if not size or total <= 0:
                return unavailable
            values = {key.strip(): int(count) for key, count in re.findall(r"^([^:\n]+):\s*(\d+)\.", output, re.M)}
            free = sum(values.get(key, 0) for key in ("Pages free", "Pages inactive", "Pages speculative")) * int(size[1])
            free = min(total, free)
        else:
            values = {}
            for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0]) * 1024
            total, free = values["MemTotal"], values["MemAvailable"]
        return {"available": True, "total_bytes": total, "available_bytes": free,
                "used_percent": round(100 * (1 - free / total), 1),
                **({"estimated": True, "unified_memory": True} if sys.platform == "darwin" else {})}
    except (OSError, ValueError, KeyError, AttributeError, subprocess.SubprocessError):
        return unavailable


def hardware_snapshot():
    """Read only: no inference, model load, unload, or process inventory."""
    gpus = []
    executable = shutil.which("nvidia-smi")
    if executable:
        try:
            result = subprocess.run([executable, "--query-gpu=index,memory.total,memory.used,memory.free,utilization.gpu",
                                     "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=2,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
            for line in result.stdout[:16384].splitlines()[:16]:
                values = [float(part.strip()) for part in line.split(",")]
                if len(values) == 5 and all(math.isfinite(n) and n >= 0 for n in values):
                    index, total, used, free, utilization = values
                    gpus.append({"index": int(index), "total_bytes": int(total * MIB), "used_bytes": int(used * MIB),
                                 "free_bytes": int(free * MIB), "utilization_percent": utilization})
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    ollama = {"available": False, "models": []}
    try:
        value = _local_json("/api/ps")
        if isinstance(value, dict) and isinstance(value.get("models"), list):
            ollama["available"] = True
            for model in value["models"][:100]:
                if not isinstance(model, dict) or not isinstance(model.get("name"), str):
                    continue
                metadata = {"name": model["name"][:160]}
                for key in ("size_vram", "context_length"):
                    item = model.get(key)
                    metadata[key] = item if type(item) is int and item >= 0 else None
                ollama["models"].append(metadata)
    except (OSError, ValueError, TypeError):
        pass
    return {"ram": _ram_snapshot(), "gpus": gpus, "ollama": ollama}


def pressure_for(hardware):
    reasons, critical, known = [], False, False
    ram = hardware.get("ram", {})
    if ram.get("available") and type(ram.get("available_bytes")) is int:
        known = True
        free = ram["available_bytes"]
        if free < 1536 * MIB:
            reasons.append("ram_low")
        critical = free < 512 * MIB
    for gpu in hardware.get("gpus", []):
        if type(gpu.get("free_bytes")) is not int:
            continue
        known = True
        if gpu["free_bytes"] < 1024 * MIB:
            reasons.append("vram_low")
        critical = critical or gpu["free_bytes"] < 256 * MIB
    return {"level": "critical" if critical else "warning" if reasons else "normal" if known else "unknown",
            "reasons": sorted(set(reasons))}


def _identifier(value, name, maximum=160):
    if value is not None and (not isinstance(value, str) or not value or len(value) > maximum or
                              not re.fullmatch(r"[A-Za-z0-9_.:/@+-]+", value)):
        raise ValueError(name + "格式无效。")
    return value


class ResourceManager:
    CACHE_SECONDS = 5

    def __init__(self, data_dir, snapshotter=None, clock=None):
        self.data_dir = Path(data_dir)
        self.config_path = self.data_dir / "resource-settings.json"
        self.lock = threading.RLock()
        self.snapshot_lock = threading.Lock()
        self.snapshotter = snapshotter or hardware_snapshot
        self.clock = clock or time.monotonic
        self._snapshot, self._snapshot_at = None, float("-inf")
        self.leases, self.owned_models = {}, {}
        self.continuous = False
        self.events = deque(maxlen=24)
        self.last_activity = {stage: self.clock() for stage in STAGES}
        self.custom_seen = None
        self.stop_event = threading.Event()
        self.thread = None
        self.background_probe = None

    def settings(self):
        with self.lock:
            try:
                value = json.loads(self.config_path.read_text(encoding="utf-8"))
                if isinstance(value.get("preset"), str) and value["preset"] in PRESETS:
                    return {"preset": value["preset"]}
            except (OSError, ValueError, AttributeError):
                pass
            return {"preset": "balanced"}

    def save_settings(self, payload):
        if not isinstance(payload, dict) or any(key != "preset" for key in payload):
            raise ValueError("资源设置字段无效。")
        with self.lock:
            value = {**self.settings(), **payload}
            if not isinstance(value["preset"], str) or value["preset"] not in PRESETS:
                raise ValueError("请选择均衡或低内存模式。")
            self.data_dir.mkdir(parents=True, exist_ok=True)
            temporary = self.config_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(value), encoding="utf-8")
            temporary.replace(self.config_path)
            return value

    def hardware(self):
        with self.snapshot_lock:
            now = self.clock()
            if self._snapshot is None or now - self._snapshot_at >= self.CACHE_SECONDS:
                try:
                    self._snapshot = self.snapshotter()
                except Exception:
                    self._snapshot = {"ram": {"available": False}, "gpus": [], "ollama": {"available": False, "models": []}}
                self._snapshot_at = self.clock()
            return copy.deepcopy(self._snapshot)

    def begin(self, stage, owner=None, model=None):
        if stage not in STAGES:
            raise ValueError("资源阶段无效。")
        owner, model = _identifier(owner, "资源所有者", 100), _identifier(model, "模型")
        with self.lock:
            lease = uuid.uuid4().hex
            self.leases[lease] = {"stage": stage, "owner": owner, "model": model, "started": self.clock()}
            self.last_activity[stage] = self.clock()
            return lease

    def end(self, lease):
        with self.lock:
            value = self.leases.pop(lease, None)
            if value:
                self.last_activity[value["stage"]] = self.clock()
            return {"ok": True, "ended": value is not None}

    def touch(self, lease):
        with self.lock:
            value = self.leases.get(lease)
            if value:
                self.last_activity[value["stage"]] = self.clock()
            return {"ok": value is not None}

    def set_continuous(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("连续语音状态无效。")
        with self.lock:
            self.continuous = enabled
            self.last_activity["tts"] = self.last_activity["asr"] = self.clock()
        return {"ok": True, "continuous": enabled}

    def _background(self, background=None):
        if background is None and self.background_probe:
            try:
                background = self.background_probe()
            except Exception:
                pass
        if not isinstance(background, dict):
            return {"known": False, "idle": False}
        known = background.get("known") is True
        return {"known": known, "idle": known and background.get("idle") is True}

    def admission(self, stage, model=None, background=None):
        if stage not in STAGES:
            raise ValueError("资源阶段无效。")
        model = _identifier(model, "模型")
        pressure = pressure_for(self.hardware())
        reasons = list(pressure["reasons"])
        with self.lock:
            low = self.settings()["preset"] == "low_memory"
            conflicts = [item for item in self.leases.values() if stage in ("chat", "work") and
                         item["stage"] in ("chat", "work") and
                         (item["stage"] != stage or (model is not None and item["model"] != model))]
        if conflicts:
            reasons.append("local_runner_busy")
        state = self._background(background)
        if stage in ("chat", "work") and state["known"] and not state["idle"]:
            reasons.append("background_review_busy")
        blocked = low and (bool(conflicts) or "background_review_busy" in reasons)
        return {"allowed": not blocked, "status": "wait" if blocked else "warning" if reasons else "ready",
                "reasons": reasons, "pressure": pressure, "choices": ["wait", "retry"] if blocked else []}

    def register_owned_model(self, name, purpose="work", exclusive=False):
        name = _identifier(name, "模型")
        purpose = _identifier(purpose, "用途", 40)
        if not name or type(exclusive) is not bool:
            raise ValueError("模型管理信息无效。")
        with self.lock:
            self.owned_models[name] = {"name": name, "purpose": purpose, "exclusive": exclusive}
        return {"ok": True}

    def release_owned_model(self, name, background=None):
        """Explicit action only. Unknown Hermes review state always blocks unload."""
        name = _identifier(name, "模型")
        state = self._background(background)
        with self.lock:
            model = self.owned_models.get(name)
            if not model or not model["exclusive"]:
                return {"released": False, "reason": "model_not_exclusively_owned"}
            if self.continuous or self.leases:
                return {"released": False, "reason": "activity_busy"}
            if not state["known"] or not state["idle"]:
                return {"released": False, "reason": "background_review_busy" if state["known"] else "background_state_unknown"}
            try:
                result = _local_json("/api/generate", {"model": name, "keep_alive": 0})
            except (OSError, ValueError, TypeError):
                return {"released": False, "reason": "unload_failed"}
            if not isinstance(result, dict) or result.get("done") is not True or result.get("done_reason") != "unload":
                return {"released": False, "reason": "unload_unconfirmed"}
            self.events.append({"kind": "released", "resource": "owned_model", "model": name})
            return {"released": True, "name": name}

    def maintain(self, voice=None, profiles=None, background=None):
        pressure = pressure_for(self.hardware())
        settings = self.settings()
        ttl = dict(PRESETS[settings["preset"]])
        if settings["preset"] == "low_memory" and pressure["level"] == "critical":
            ttl.update(asr_idle_seconds=30, tts_idle_seconds=60, custom_idle_seconds=90)
        released, deferred = [], []
        with self.lock:
            stages = {item["stage"] for item in self.leases.values()}
            keep = self.continuous or "continuous_voice" in stages
            keep_asr, keep_tts = keep or "asr" in stages, keep or "tts" in stages
            if voice:
                if hasattr(voice, "set_resource_preset"):
                    voice.set_resource_preset(settings["preset"])
                result = voice.release_idle(keep_asr=keep_asr, keep_tts=keep_tts,
                    asr_idle_seconds=ttl["asr_idle_seconds"], tts_idle_seconds=ttl["tts_idle_seconds"])
                released.extend(result.get("released", []))
            if profiles:
                # Profiles owns the lifetime/health lock and must recheck busy there.
                # A status->stop sequence can kill a request that has just started.
                if hasattr(profiles, "release_idle"):
                    result = profiles.release_idle(idle_seconds=ttl["custom_idle_seconds"], keep_loaded=keep_tts)
                    if result.get("released"):
                        released.append("custom_tts")
                elif not keep_tts:
                    deferred.append("custom_tts_safe_release_unavailable")
            for resource in released:
                self.events.append({"kind": "released", "resource": resource})
        # Automatic Ollama release deliberately remains off: per-model idle and
        # externally initiated reviews cannot be inferred from run.completed.
        return {"ok": True, "released": released, "deferred": deferred, "continuous": keep, "ttl": ttl}

    def status(self):
        hardware = self.hardware()
        pressure = pressure_for(hardware)
        background = self._background()
        with self.lock:
            now = self.clock()
            activities = [{"stage": item["stage"], "owner": item["owner"], "model": item["model"],
                           "elapsed_seconds": round(max(0, now - item["started"]), 1)} for item in self.leases.values()]
            return {"settings": self.settings(), "hardware": hardware, "pressure": pressure,
                    "activities": activities, "continuous": self.continuous, "ttl": dict(PRESETS[self.settings()["preset"]]),
                    "managed_models": list(copy.deepcopy(self.owned_models).values()), "events": list(self.events),
                    "recommendations": pressure["reasons"], "background": background,
                    "capabilities": {"idle_voice_reclaim": True, "automatic_model_switch": False,
                                     "automatic_ollama_unload": False}}

    def start(self, voice_provider=None, profiles_provider=None, background_probe=None, interval=10):
        if type(interval) not in (int, float) or not math.isfinite(interval) or not 0.05 <= interval <= 300:
            raise ValueError("资源维护间隔无效。")
        with self.lock:
            if self.thread and self.thread.is_alive():
                return {"ok": True}
            self.background_probe = background_probe
            self.stop_event.clear()
            def run():
                while not self.stop_event.is_set():
                    try:
                        voice = voice_provider() if voice_provider else None
                        profiles = profiles_provider() if profiles_provider else None
                        self.maintain(voice=voice, profiles=profiles)
                    except Exception:
                        # Keep maintenance alive without logging user data or
                        # exception strings from outside this resource module.
                        with self.lock:
                            self.events.append({"kind": "maintenance_unavailable"})
                    self.stop_event.wait(interval)
            self.thread = threading.Thread(target=run, name="core-resource-maintenance", daemon=True)
            self.thread.start()
        return {"ok": True}

    def close(self):
        self.stop_event.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=5)
        return {"ok": True}
