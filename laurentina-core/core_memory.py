"""Local-only client of the existing HyMemory owner process. Stdlib only."""
from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from core_platform import project_home, project_data, runtime_python, subprocess_options


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("记忆服务重定向已被阻止。")


class _ServiceUnavailable(RuntimeError):
    """Only a missing connection or unreachable valid local endpoint."""


class MemoryBridge:
    """Scopes are chosen symbolically; the server alone derives namespaces."""

    _start_lock = threading.Lock()
    _start_attempts = {}

    def __init__(self, project_root=None, connection_path=None, timeout=180):
        self.project_root = Path(project_root).resolve() if project_root else project_home("memory", Path(__file__).resolve().parent.parent / "hy-memory-starter")
        self.connection_path = Path(connection_path or project_data("memory", self.project_root) / "connection.json")
        self.timeout = timeout
        self.opener = build_opener(ProxyHandler({}), _NoRedirect())

    @staticmethod
    def _scope(scope):
        if scope not in ("shared", "private"):
            raise ValueError("请选择共享或私密记忆。")
        return scope

    @staticmethod
    def _limit(limit):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("记忆数量必须是 1 到 100 的整数。")
        return limit

    @staticmethod
    def _local_config(config):
        for key in ("llm_url", "embed_url"):
            try:
                parsed = urlsplit(config.get(key, ""))
                valid = (parsed.scheme in ("http", "https")
                         and ipaddress.ip_address(parsed.hostname or "").is_loopback
                         and not parsed.username and not parsed.password
                         and not parsed.query and not parsed.fragment)
                parsed.port
            except (AttributeError, TypeError, ValueError):
                valid = False
            if not valid:
                raise RuntimeError("Core 记忆仅使用本地模型：请将聊天和嵌入服务都设为本机 IP 地址。")

    def _probe_status(self):
        try:
            connection = json.loads(self.connection_path.read_text(encoding="utf-8"))
            url = connection.get("url", "")
            parsed = urlsplit(url)
            if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
                raise ValueError("Invalid local address")
        except FileNotFoundError as exc:
            raise _ServiceUnavailable("尚未找到本地记忆服务连接。") from exc
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            raise RuntimeError("尚未找到有效的本地记忆服务连接。") from exc
        try:
            with self.opener.open(url + "/api/status", timeout=4) as response:
                value = json.loads(response.read(262144))
        except HTTPError as exc:
            exc.close()
            raise RuntimeError("本地记忆服务未返回有效状态。") from exc
        except OSError as exc:
            raise _ServiceUnavailable("本地记忆服务暂时无法连接。") from exc
        except ValueError as exc:
            raise RuntimeError("本地记忆服务暂时无法连接。") from exc
        try:
            trusted = (isinstance(value, dict) and value.get("app") == "Laurentina-HyMemory-Starter"
                       and Path(value.get("workspace", "")).resolve() == self.project_root
                       and isinstance(value.get("token"), str) and len(value["token"]) >= 16)
        except (TypeError, ValueError):
            trusted = False
        if not trusted:
            raise RuntimeError("本地记忆服务身份不匹配。")
        self._local_config(value.get("config", {}))
        if not value.get("configured") or not value.get("hermes_connected"):
            raise RuntimeError("共享记忆的本地模型或 Hermes 连接尚未配置完成。")
        return url, value["token"]

    def _status(self):
        try:
            return self._probe_status()
        except _ServiceUnavailable:
            pass
        if not self._start_lock.acquire(timeout=35):
            raise RuntimeError("本地记忆服务正在启动，请稍后重试。")
        try:
            # Other threads/instances share this lock and may already have
            # started the service. Recheck before creating another process.
            try:
                return self._probe_status()
            except _ServiceUnavailable:
                pass
            key = str(self.project_root)
            now = time.monotonic()
            if now - self._start_attempts.get(key, float("-inf")) < 30:
                raise RuntimeError("本地记忆服务尚未就绪，请稍后重试或查看服务日志。")
            python = runtime_python("memory", self.project_root)
            launcher = self.project_root / "launcher.py"
            if not python.is_file() or not launcher.is_file():
                raise RuntimeError("本地记忆启动环境不完整，请检查 HyMemory 安装。")
            env = dict(os.environ)
            for name in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__", "PYTHONSTARTUP", "PYTHONINSPECT"):
                env.pop(name, None)
            self._start_attempts[key] = now
            try:
                result = subprocess.run([str(python), "-B", "-E", "-s", "-X", "utf8", str(launcher), "--no-browser"],
                    cwd=self.project_root, env=env, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=25,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise RuntimeError("本地记忆服务未能及时启动，请检查本地服务日志。") from exc
            if result.returncode:
                raise RuntimeError("本地记忆服务无法启动，请检查本地服务日志。")
            try:
                return self._probe_status()
            except _ServiceUnavailable as exc:
                raise RuntimeError("本地记忆服务启动后仍未就绪，请稍后重试。") from exc
        finally:
            self._start_lock.release()

    def _post(self, operation, payload):
        url, token = self._status()
        request = Request(url + "/api/core/" + operation,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-HyMemory-Token": token, "Origin": url},
            method="POST")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                value = json.loads(response.read(2_000_000))
        except HTTPError as exc:
            if exc.code == 404:
                exc.close()
                raise RuntimeError("记忆服务需要重新启动，以加载 Core 连接。") from exc
            try:
                detail = json.loads(exc.read(4096)).get("error")
            except (ValueError, AttributeError):
                detail = None
            finally:
                exc.close()
            raise RuntimeError(detail or "本地记忆操作未完成。") from exc
        except (URLError, OSError, ValueError) as exc:
            raise RuntimeError("本地记忆操作未完成，请检查本机模型和服务。") from exc
        if not isinstance(value, dict) or value.get("ok") is not True:
            raise RuntimeError("本地记忆服务未确认操作完成。")
        return value

    def health(self):
        try:
            self._post("health", {"scope": "shared"})
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300]}

    def search(self, query, scope="shared", limit=8):
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 12000:
            raise ValueError("请输入 1 到 12000 字的检索内容。")
        return self._post("search", {"scope": self._scope(scope), "query": query.strip(), "limit": self._limit(limit)})["items"]

    def list(self, scope="shared", limit=100):
        return self._post("list", {"scope": self._scope(scope), "limit": self._limit(limit)})["items"]

    def remember(self, content, scope="shared", source="core", category="fact"):
        if not isinstance(content, str) or not 1 <= len(content.strip()) <= 12000:
            raise ValueError("请输入 1 到 12000 字的记忆内容。")
        result = self._post("remember", {"scope": self._scope(scope), "content": content.strip(),
                                         "source": source, "category": category})
        if not result.get("id") or result.get("memory_id") != result["id"] or result.get("agent_status") != "success":
            raise RuntimeError("记忆写入没有返回可核验的保存结果。")
        return result

    def delete(self, memory_id, scope="shared"):
        if not isinstance(memory_id, str) or not 1 <= len(memory_id) <= 100:
            raise ValueError("记忆编号格式不正确。")
        return self._post("delete", {"scope": self._scope(scope), "id": memory_id})
