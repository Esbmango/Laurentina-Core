"""Start a native Hermes API gateway with one scoped encrypted-key source."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
from urllib.error import URLError
from urllib.request import Request, build_opener, ProxyHandler

from core_work import WorkBridge, protect_work_key

ROOT = Path(__file__).resolve().parent


def start(data_dir):
    data_dir = Path(data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    connection = data_dir / "hermes-api.json"
    bridge = WorkBridge(data_dir, auto_start=False)
    try:
        existing = None
        if connection.is_file():
            health = bridge.health()
            if health.get("ok"):
                return {"ok": True, "reused": True, "provider": health.get("provider", "Hermes 当前配置")}
            # Invalid or foreign connection metadata is an error, not permission to overwrite it.
            existing = bridge._connection()
            # A reachable service with incompatible identity/auth is never
            # overwritten. A dead owned gateway reuses the same port and key,
            # preserving its durable run/approval ownership.
            try:
                request = Request(existing["url"] + "/v1/capabilities", headers={"Authorization": "Bearer " + existing["key"]})
                with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
                    response.read(2_000_000)
            except URLError as exc:
                from urllib.error import HTTPError
                if isinstance(exc, HTTPError):
                    exc.close()
                    raise RuntimeError("现有工作接口可以访问，但身份或认证不匹配；连接配置未被改动。") from None
            else:
                raise RuntimeError("现有工作接口可以访问，但能力验证未通过；连接配置未被改动。")

        # The Windows sandbox may virtualize LOCALAPPDATA; the install belongs
        # to this user's actual Hermes home, never to a package sandbox.
        home = Path.home() / "AppData/Local/hermes"
        hermes = home / "bin/hermes.exe"
        if not hermes.is_file():
            raise RuntimeError("未找到已经安装的 Hermes。")
        if existing:
            from urllib.parse import urlsplit
            port = urlsplit(existing["url"]).port
            key = existing["key"]
            value = {k: v for k, v in existing.items() if k not in ("key", "fingerprint")}
        else:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            key = secrets.token_urlsafe(40)
            value = {"url": f"http://127.0.0.1:{port}", "key_dpapi": protect_work_key(key),
                     "model_name": "laurentina-core", "model": "qwen3.5:9b", "provider": "Hermes 当前配置（本地 Qwen）"}
            temporary = connection.with_suffix(".tmp")
            temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            temporary.replace(connection)
        from install_work_source import install
        install(data_dir, home)
        env = dict(os.environ)
        for name in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
            env.pop(name, None)
        env.update(HERMES_HOME=str(home), API_SERVER_ENABLED="true", API_SERVER_HOST="127.0.0.1", API_SERVER_PORT=str(port),
                   API_SERVER_KEY=key, API_SERVER_MODEL_NAME=value["model_name"])
        process = subprocess.Popen([str(hermes), "gateway", "run"], cwd=ROOT, env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)
        # No --replace/--force: an existing gateway is never terminated by this helper.
        deadline = time.monotonic() + 50
        while time.monotonic() < deadline:
            health = bridge.health()
            if health.get("ok"):
                (data_dir / "hermes-launch.json").write_text(json.dumps({"pid": process.pid, "started_at": time.time()}), encoding="utf-8")
                return {"ok": True, "reused": False, "provider": value["provider"]}
            if process.poll() is not None:
                raise RuntimeError("Hermes 工作服务未能启动；若已有其他网关，请在 Hermes 中检查状态。现有进程未被停止。")
            time.sleep(.5)
        raise RuntimeError("Hermes 工作接口尚未就绪，请稍后检查工作页的连接状态。")
    finally:
        bridge.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(ROOT / ".local"))
    args = parser.parse_args()
    try:
        print(json.dumps(start(args.data_dir), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:500]}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
