"""Small stdio client for the installed Codex App Server public protocol."""
from collections import deque
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time


class CodexError(RuntimeError):
    pass


def find_codex():
    command = shutil.which("codex")
    if command and Path(command).suffix.lower() == ".exe":
        return command
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "OpenAI" / "Codex" / "bin"
    candidates = list(base.glob("*/codex.exe"))
    if not candidates:
        raise CodexError("没有找到已安装的 Codex CLI。")
    return str(max(candidates, key=lambda item: item.stat().st_mtime))


class CodexRPC:
    def __init__(self, *, proxy=False, overrides=(), cwd=None, command=None,
                 initialize_params=None, initialized_method="initialized", env_extra=None):
        self.queue = queue.Queue()
        self.notifications = []
        self.errors = deque(maxlen=12)
        self.next_id = 0
        self.lock = threading.RLock()
        self.mode = "desktop-proxy" if proxy else "stdio"
        if command is None:
            command = [find_codex(), "app-server"]
            for setting in overrides:
                command.extend(["-c", setting])
            command.extend(["proxy"] if proxy else ["--stdio"])
        env = dict(os.environ)
        for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
            env.pop(key, None)
        env.update(env_extra or {})
        self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, encoding="utf-8", errors="replace", bufsize=1,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()
        try:
            self.call("initialize", initialize_params or {"clientInfo": {"name": "laurentina_bridge", "title": "Laurentina Bridge", "version": "0.1.0"},
                                     "capabilities": {"experimentalApi": True}}, timeout=25)
            self.send({"method": initialized_method, "params": {}})
        except Exception:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                try:
                    self.queue.put(json.loads(line))
                except ValueError:
                    continue
        finally:
            self.queue.put(None)

    def _read_errors(self):
        for line in self.process.stderr:
            self.errors.append(line[-800:])

    def send(self, message):
        try:
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise CodexError("Codex 会话连接已断开。") from exc

    def receive(self, timeout=30):
        try:
            message = self.queue.get(timeout=max(0.01, timeout))
        except queue.Empty as exc:
            raise CodexError("Codex 接口等待超时。") from exc
        if message is None:
            raise CodexError("Codex 会话接口已退出。")
        return message

    def call(self, method, params=None, timeout=30):
        with self.lock:
            self.next_id += 1
            identity = self.next_id
            self.send({"id": identity, "method": method, "params": params or {}})
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                message = self.receive(deadline-time.monotonic())
                if message.get("id") == identity and "method" not in message:
                    if "error" in message:
                        error = message["error"]
                        raise CodexError(str(error.get("message", "Codex 接口请求失败"))[:700])
                    return message.get("result", {})
                if "method" in message and "id" in message:
                    self.send({"id": message["id"], "error": {"code": -32601, "message": "This read-only client does not grant permissions."}})
                else:
                    self.notifications.append(message)
            raise CodexError("Codex 接口等待超时。")

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=4)
            except (OSError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    self.process.kill()
        for stream in (self.process.stdout, self.process.stderr):
            try:
                stream.close()
            except OSError:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


if __name__ == "__main__":
    report = {}
    for proxy in (True, False):
        try:
            with CodexRPC(proxy=proxy) as rpc:
                listing = rpc.call("thread/list", {"limit": 100, "useStateDbOnly": True,
                    "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"], "sortKey": "updated_at"})
                account = rpc.call("account/read", {"refreshToken": False})
                report[rpc.mode] = {"ok": True, "threads": [{"id": item["id"], "title": item.get("name") or item.get("preview", "")[:100],
                    "source": item.get("source"), "status": item.get("status"), "cwd": item.get("cwd")} for item in listing.get("data", [])],
                    "has_more": bool(listing.get("nextCursor")), "account_type": (account.get("account") or {}).get("type")}
        except Exception as error:
            report["desktop-proxy" if proxy else "stdio"] = {"ok": False, "error": str(error)[:500]}
    destination = Path(__file__).resolve().parent / ".local" / "codex-probe.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: {key: (len(value) if key == "threads" else value) for key,value in result.items()} for name,result in report.items()}, ensure_ascii=False))
