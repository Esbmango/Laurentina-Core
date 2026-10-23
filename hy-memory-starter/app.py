"""Local HyMemory setup and memory playground. Run with the project venv."""
from __future__ import annotations

import argparse
import errno
import hashlib
import importlib.metadata
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
from socketserver import TCPServer
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from platform_support import project_home, project_data, protect_bytes, SecretStoreError

ROOT = project_home("memory", Path(__file__).resolve().parent)
DATA = project_data("memory", ROOT)
APP_ID = "Laurentina-HyMemory-Starter"
API_VERSION = 2
USER_ID = "personal"
AGENT_ID = "laurentina"
DEFAULTS = {
    "preset": "custom", "mode": "pro", "llm_url": "", "llm_model": "",
    "llm_key": "", "embed_url": "", "embed_model": "", "embed_key": "",
    "dimensions": 1024,
}
# Keep every SDK file within this project's private data folder.
os.environ["MEMORY_DATA_DIR"] = str(DATA / "sdk")
os.environ["MEMORY_LOG_LEVEL"] = "ERROR"
os.environ["MEMORY_LOG_LLM_CONTENT"] = "false"
os.environ["MEMORY_ENABLE_GRAPH"] = "false"
os.environ["MEMORY_LOCAL_RERANK_ENABLED"] = "false"
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ["PYTHONUTF8"] = "1"


class UserError(Exception):
    pass


def protect(data: bytes, decrypt: bool = False) -> bytes:
    try:
        return protect_bytes(data, decrypt=decrypt)
    except SecretStoreError as exc:
        raise UserError(str(exc)) from None


class ConfigStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.path = directory / "config.dpapi"

    def load(self):
        if not self.path.exists():
            return dict(DEFAULTS)
        try:
            saved = json.loads(protect(self.path.read_bytes(), decrypt=True))
            return {**DEFAULTS, **saved}
        except Exception as exc:
            raise UserError("配置无法解密，请在保存时的本机账户中解锁安全存储。原文件已保留。") from exc

    def save(self, config):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        encrypted = protect(json.dumps(config, ensure_ascii=False).encode("utf-8"))
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        temporary.replace(self.path)


def public_config(config):
    result = {key: value for key, value in config.items() if not key.endswith("_key")}
    result["llm_key_saved"] = bool(config["llm_key"])
    result["embed_key_saved"] = bool(config["embed_key"])
    return result


def validated_config(payload, old):
    config = dict(DEFAULTS)
    for key in config:
        if key != "dimensions":
            value = payload.get(key, old.get(key, DEFAULTS[key]))
            if not isinstance(value, str) or len(value) > 4096:
                raise UserError("配置字段格式不正确。")
            config[key] = value.strip()
    if config["mode"] not in ("lite", "pro"):
        raise UserError("请选择基础记忆或事实记忆模式。")
    try:
        config["dimensions"] = int(payload.get("dimensions", old["dimensions"]))
    except (TypeError, ValueError) as exc:
        raise UserError("向量维度必须是整数。") from exc
    if not 1 <= config["dimensions"] <= 65536:
        raise UserError("向量维度必须在 1 到 65536 之间。")
    for prefix in ("llm", "embed"):
        url = config[f"{prefix}_url"].rstrip("/")
        if url:
            parsed = urlsplit(url)
            if (parsed.scheme not in ("https", "http") or not parsed.hostname
                    or parsed.username or parsed.password or parsed.query or parsed.fragment):
                raise UserError("服务地址应为完整的 HTTP(S) 地址，不含密钥或查询参数。")
            if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
                raise UserError("远程服务请使用 HTTPS；本机模型可以使用 HTTP。")
        config[f"{prefix}_url"] = url
        # A blank field preserves a saved key only for the same endpoint.
        if not config[f"{prefix}_key"] and url == old.get(f"{prefix}_url"):
            config[f"{prefix}_key"] = old.get(f"{prefix}_key", "")
    return config


def missing_settings(config):
    required = ["embed_url", "embed_model", "embed_key"]
    if config["mode"] == "pro":
        required += ["llm_url", "llm_model", "llm_key"]
    return [key for key in required if not config.get(key)]


def profile_id(config):
    fields = ["qdrant-v1"] + [config[key] for key in ("mode", "embed_url", "embed_model", "dimensions")]
    return hashlib.sha256(json.dumps(fields).encode()).hexdigest()[:16]


def redact(message, config):
    text = str(message)
    for key in ("llm_key", "embed_key"):
        if config.get(key):
            text = text.replace(config[key], "[密钥已隐藏]")
    return re.sub(r"sk-[A-Za-z0-9_-]+", "[密钥已隐藏]", text)[:700]


def api_post(url, key, payload):
    request = Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                      headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read(2_000_000))
    except HTTPError as exc:
        # Providers may echo request details; don't return their raw error body.
        meanings = {401: "密钥无效", 403: "没有访问权限", 404: "地址或模型不存在",
                    429: "额度不足或请求过于频繁"}
        raise UserError(f"服务返回 HTTP {exc.code}：{meanings.get(exc.code, '请检查服务配置')}。") from exc


def check_connections(config):
    if missing_settings(config):
        raise UserError("请先填写服务地址、模型名称和密钥，再测试连接。")
    result = api_post(config["embed_url"] + "/embeddings", config["embed_key"], {
        "model": config["embed_model"], "input": ["HyMemory connection test"],
        "dimensions": config["dimensions"], "encoding_format": "float",
    })
    try:
        vector = result["data"][0]["embedding"]
        if not isinstance(vector, list) or len(vector) != config["dimensions"]:
            raise ValueError()
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise UserError("嵌入服务返回的向量维度与配置不一致，请检查模型和维度。") from exc
    if config["mode"] == "pro":
        result = api_post(config["llm_url"] + "/chat/completions", config["llm_key"], {
            "model": config["llm_model"],
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 64,
            **({"reasoning_effort": "none"} if is_local_ollama(config["llm_url"]) else {}),
        })
        if not result.get("choices") or not result["choices"][0].get("message", {}).get("content"):
            raise UserError("聊天模型没有返回有效文本，请检查模型配置。")
    return {"ok": True, "message": "连接正常。现在可以写入一条记忆，再试着检索它。"}


class MemoryService:
    def __init__(self, directory: Path):
        self.directory = directory
        self.default_user_id = USER_ID
        self.store = ConfigStore(directory)
        self.config = self.store.load()
        self.client = None
        self.lock = threading.RLock()

    def close(self):
        with self.lock:
            if self.client is not None:
                client = self.client
                self.client = None
                # The pinned SDK leaves its separate search loop running. Keep
                # cleanup in this adapter rather than editing installed code.
                local_store = getattr(getattr(client, "_vector_store", None), "_client", None)
                search_loop = getattr(client, "_search_loop_thread", None)
                try:
                    client.close()
                finally:
                    if search_loop is not None and search_loop is not getattr(client, "_loop_thread", None):
                        search_loop.stop()
                    if local_store is not None:
                        local_store.close()

    def save(self, payload):
        with self.lock:
            config = validated_config(payload, self.config)
            self.store.save(config)
            self.close()
            self.config = config
            return {"ok": True, "config": public_config(config)}

    def get_client(self):
        if missing_settings(self.config):
            raise UserError("模型服务还未配置完成。请先在左侧保存地址、模型和密钥。")
        if self.client is None:
            from hy_memory import HyMemoryClient
            config = self.config
            data = self.directory / "m" / profile_id(config)
            data.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.client = HyMemoryClient.from_config({
                "mode": config["mode"], "enable_graph": False, "metrics_enabled": False,
                "llm": {"provider": "openai", "base_url": config["llm_url"] or config["embed_url"],
                        "api_key": config["llm_key"] or "unused-in-lite-mode",
                        "model": config["llm_model"] or "unused", "timeout": 180,
                        "extra_body": {"reasoning_effort": "none"} if is_local_ollama(config["llm_url"]) else {},
                        # This SDK counts LLM attempts, not retries after the first.
                        "max_retries": 1},
                "embedder": {"provider": "openai", "base_url": config["embed_url"],
                             "api_key": config["embed_key"], "model": config["embed_model"],
                             "embedding_dims": config["dimensions"], "timeout": 30,
                             "max_retries": 0},
                "vector_store": {"provider": "qdrant", "collection_name": "lm",
                                 "persist_directory": str(data / "v"),
                                 "embedding_dims": config["dimensions"]},
                "cache": {"backend": "sqlite", "db_path": str(data / "cache.db")},
                "history": {"enable": True, "db_path": str(data / "history.db")},
                "coding": {"enable": False, "db_path": str(data / "coding.db")},
            })
        return self.client

    def add(self, text, *, session_id="memory-playground", source="laurentina", meta=None, user_id=None):
        with self.lock:
            result = self.get_client().add(text, user_id=user_id or self.default_user_id, agent_id=AGENT_ID,
                                          session_id=session_id, source=source, meta=meta,
                                          scene="chat")
            if not result.get("success"):
                raise UserError("记忆写入未成功。" + redact(
                    result.get("agent_error") or result.get("error") or "请检查模型服务。", self.config))
            return {"ok": True, "result": result}

    def search(self, text, *, user_id=None):
        with self.lock:
            result = self.get_client().search(text, user_ids=[user_id or self.default_user_id], agent_ids=[AGENT_ID],
                                              scene="chat", limit=8, min_score=0.2)
            # SDK silently returns empty buckets on reader failure. Keep this distinct
            # from a successful search with no relevant memories.
            if "rewrite" not in result:
                raise UserError("检索没有正常完成，请检查嵌入服务后重试。")
            rows = []
            for channel, memories in result.get("memories", {}).items():
                for memory in memories:
                    rows.append({"channel": channel, "content": memory.get("content", ""),
                                 "score": memory.get("score"), "layer": memory.get("layer", "")})
            return {"ok": True, "memories": rows}


def is_local_ollama(url):
    parsed = urlsplit(url or "")
    return parsed.hostname in ("127.0.0.1", "localhost", "::1") and parsed.port == 11434


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows SO_REUSEADDR can let two installs bind the same endpoint and
    # receive each other's traffic. Each owner must exclusively own its port.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        # The OS already provides the numeric bound address. HTTPServer's
        # reverse DNS lookup can block an offline Mac before readiness.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]

    def __init__(self, address, service, active_scope=""):
        super().__init__(address, Handler)
        self.service = service
        self.token = secrets.token_urlsafe(32)
        self.active_scope = active_scope
        if active_scope:
            self.service.default_user_id = active_scope
        self.scope_lock = threading.RLock()
        service.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.writes = sqlite3.connect(service.directory / "hermes-writes.db", check_same_thread=False)
        self.writes.execute("CREATE TABLE IF NOT EXISTS writes(scope TEXT, turn_id TEXT, result TEXT, PRIMARY KEY(scope,turn_id))")
        self.writes.execute("CREATE TABLE IF NOT EXISTS core_memory_meta(scope TEXT, memory_id TEXT, source TEXT, category TEXT, PRIMARY KEY(scope,memory_id))")
        self.writes.commit()

    def core_scope(self, scope):
        """The private namespace cannot be selected by Hermes' 32-hex API."""
        if scope not in ("shared", "private") or not self.active_scope:
            raise UserError("请选择共享或私密记忆，并先完成共享记忆连接。")
        self.validate_scope(self.active_scope)
        if scope == "shared":
            return self.active_scope
        return "core-private:" + hashlib.sha256(("laurentina-core-private-v1:" + self.active_scope).encode()).hexdigest()

    def core_local_only(self):
        """Check both endpoints even for read/delete; never fall back to cloud."""
        config = self.service.config
        for prefix in ("llm", "embed"):
            try:
                parsed = urlsplit(config.get(prefix + "_url", ""))
                address = ipaddress.ip_address(parsed.hostname or "")
                valid = (parsed.scheme in ("http", "https") and address.is_loopback
                         and not parsed.username and not parsed.password
                         and not parsed.query and not parsed.fragment)
                parsed.port  # Reject malformed port values, too.
            except ValueError:
                valid = False
            if not valid:
                raise UserError("Core 记忆仅使用本地模型：请将聊天和嵌入服务都设为本机 IP 地址。")
        if missing_settings(config):
            raise UserError("Core 记忆的本地模型配置尚未完成。")

    @staticmethod
    def core_limit(value, maximum=100):
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
            raise UserError("记忆数量必须是 1 到 100 的整数。")
        return value

    def core_item(self, item, scope, namespace):
        if not isinstance(item, dict) or item.get("user_id") != namespace:
            raise UserError("记忆归属验证失败，操作已停止。")
        identity = item.get("memory_id") or item.get("id")
        content = item.get("content")
        if not isinstance(identity, str) or not identity or not isinstance(content, str):
            raise UserError("记忆服务返回的内容不完整。")
        metadata = item.get("meta")
        if not isinstance(metadata, list):
            metadata = (item.get("custom") or {}).get("meta", []) if isinstance(item.get("custom"), dict) else []
        combined = {}
        for entry in metadata if isinstance(metadata, list) else []:
            if isinstance(entry, dict):
                combined.update(entry)
        with self.scope_lock:
            saved = self.writes.execute("SELECT source,category FROM core_memory_meta WHERE scope=? AND memory_id=?", (namespace, identity)).fetchone()
        source = saved[0] if saved else combined.get("source") or item.get("source") or "HyMemory"
        category = saved[1] if saved else combined.get("category") or "fact"
        return {"id": identity, "content": content, "scope": scope,
                "source": str(source)[:64], "category": str(category)[:40],
                "created_at": item.get("gmt_created") or item.get("memory_at"),
                "status": item.get("status") or "active"}

    def core_call(self, operation, payload):
        service = self.service
        scope = payload.get("scope", "shared")
        with service.lock:
            namespace = self.core_scope(scope)
            self.core_local_only()
            if operation == "health":
                # Validate the actual database through its existing owner process.
                listed = service.get_client().list_memories(user_id=namespace, limit=1)
                if not isinstance(listed, dict) or not isinstance(listed.get("vdb", {}).get("memories"), list):
                    raise UserError("记忆数据库未能正常读取。")
                return {"ok": True, "version": 1, "local_only": True}
            if operation == "list":
                limit = self.core_limit(payload.get("limit", 100))
                result = service.get_client().list_memories(user_id=namespace, limit=limit)
                bucket = result.get("vdb") if isinstance(result, dict) else None
                if not isinstance(bucket, dict) or not isinstance(bucket.get("memories"), list):
                    raise UserError("记忆列表没有正常完成。")
                return {"ok": True, "items": [self.core_item(item, scope, namespace) for item in bucket["memories"][:limit]]}
            if operation == "search":
                text = payload.get("query", "")
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 12000:
                    raise UserError("请输入 1 到 12000 字的检索内容。")
                limit = self.core_limit(payload.get("limit", 8))
                result = service.get_client().search(text.strip(), user_ids=[namespace], agent_ids=[AGENT_ID],
                    scene="chat", limit=limit, min_score=0.2)
                if not isinstance(result, dict) or "rewrite" not in result:
                    raise UserError("记忆检索没有正常完成，请检查本地模型。")
                items, seen = [], set()
                for bucket in result.get("memories", {}).values():
                    for item in bucket if isinstance(bucket, list) else []:
                        normalized = self.core_item(item, scope, namespace)
                        if normalized["id"] not in seen:
                            items.append(normalized)
                            seen.add(normalized["id"])
                return {"ok": True, "items": items[:limit]}
            if operation == "remember":
                text = payload.get("content", "")
                source, category = payload.get("source", "core"), payload.get("category", "fact")
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 12000:
                    raise UserError("请输入 1 到 12000 字的记忆内容。")
                if (not isinstance(source, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", source)
                        or not isinstance(category, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,39}", category)):
                    raise UserError("记忆来源或分类格式不正确。")
                client = service.get_client()
                result = client.add_extracted(text.strip(), user_id=namespace, agent_id=AGENT_ID,
                    session_id="core-" + secrets.token_hex(12), source=source,
                    metadata={"core_scope": scope, "category": category})
                if (not isinstance(result, dict) or result.get("success") is not True
                        or result.get("agent_status") != "success"):
                    raise UserError("记忆写入未成功，请检查本地模型后重试。")
                candidates = list(result.get("memory_ids") or [])
                if result.get("memory_id"):
                    candidates.insert(0, result["memory_id"])
                stored = None
                for identity in dict.fromkeys(candidates):
                    if isinstance(identity, str) and identity:
                        item = client.get(identity)
                        if item is not None:
                            if (item.get("memory_id") or item.get("id")) != identity:
                                raise UserError("记忆编号验证失败，尚不能确认保存成功。")
                            self.core_item(item, scope, namespace)
                            stored = item
                            break
                # Reconciliation can return a successful NOOP without any IDs.
                # Only an exact, scoped existing fact can verify that outcome.
                if stored is None and not candidates:
                    listed = client.list_memories(user_id=namespace, limit=100)
                    for item in listed.get("vdb", {}).get("memories", []):
                        if item.get("content", "").strip() == text.strip():
                            self.core_item(item, scope, namespace)
                            stored = item
                            break
                if stored is None:
                    raise UserError("写入结果未找到可核验的记忆，尚不能确认保存成功。")
                identity = stored.get("memory_id") or stored.get("id")
                with self.scope_lock:
                    self.writes.execute("INSERT OR REPLACE INTO core_memory_meta VALUES(?,?,?,?)", (namespace, identity, source, category))
                    self.writes.commit()
                return {**self.core_item(stored, scope, namespace), "ok": True,
                        "memory_id": identity, "agent_status": "success"}
            if operation == "delete":
                identity = payload.get("id", "")
                if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identity):
                    raise UserError("记忆编号格式不正确。")
                client = service.get_client()
                item = client.get(identity)
                if item is None:
                    raise UserError("此记忆不存在或已经被删除。")
                if (item.get("memory_id") or item.get("id")) != identity:
                    raise UserError("记忆编号验证失败，操作已停止。")
                self.core_item(item, scope, namespace)
                # SDK delete repairs immediate evolution neighbors. Guard them
                # before invoking any mutation as well as guarding the target.
                neighbors = (item.get("supersedes") or []) + (item.get("superseded_by") or [])
                if len(neighbors) > 100:
                    raise UserError("此记忆的关联数量过多，无法安全删除。")
                for neighbor in neighbors:
                    related = client.get(neighbor)
                    if related is not None and related.get("user_id") != namespace:
                        raise UserError("关联记忆归属验证失败，操作已停止。")
                if neighbors:
                    # The SDK revives an older version when deleting a chain
                    # head. Refuse rather than call that result "forgotten".
                    raise UserError("此记忆关联了历史版本，暂时无法完整删除；为避免旧内容重新出现，操作已停止。")
                result = client.delete(identity)
                if not result.get("success") or result.get("deleted_count") != 1 or client.get(identity) is not None:
                    raise UserError("记忆删除未完成，请稍后重新检查。")
                with self.scope_lock:
                    self.writes.execute("DELETE FROM core_memory_meta WHERE scope=? AND memory_id=?", (namespace, identity))
                    self.writes.commit()
                return {"ok": True, "id": identity}
            raise UserError("Core 记忆接口不存在。")

    def validate_scope(self, scope):
        if not isinstance(scope, str) or not re.fullmatch(r"[a-f0-9]{32}", scope):
            raise UserError("Hermes 记忆作用域不正确。")
        return scope

    def hermes_add(self, payload):
        scope = self.validate_scope(payload.get("scope"))
        service = self.service
        turn_id = payload.get("turn_id", "")
        if not isinstance(turn_id, str) or not re.fullmatch(r"[a-f0-9]{64}", turn_id):
            raise UserError("Hermes 写入编号不正确。")
        user_text = payload.get("user", "")
        assistant_text = payload.get("assistant", "")
        if (not isinstance(user_text, str) or not user_text.strip() or len(user_text) > 12000
                or not isinstance(assistant_text, str) or len(assistant_text) > 24000):
            raise UserError("Hermes 对话内容为空或超过单次记忆写入限制。")
        session_id = payload.get("session_id", "")
        if not isinstance(session_id, str) or len(session_id) > 200:
            raise UserError("Hermes 会话编号不正确。")
        with service.lock:
            with self.scope_lock:
                saved = self.writes.execute("SELECT result FROM writes WHERE scope=? AND turn_id=?", (scope, turn_id)).fetchone()
            if saved:
                return {**json.loads(saved[0]), "deduplicated": True}
            messages = [{"role": "user", "content": user_text}]
            if assistant_text.strip():
                messages.append({"role": "assistant", "content": assistant_text})
            response = service.add(messages, session_id=session_id or "hermes",
                                   source="hermes", meta={"hermes_turn_id": turn_id}, user_id=scope)
            result = {"ok": True, "memory_id": response["result"].get("memory_id"),
                      "agent_status": response["result"].get("agent_status"), "deduplicated": False}
            with self.scope_lock:
                self.writes.execute("INSERT OR REPLACE INTO writes VALUES(?,?,?)", (scope, turn_id, json.dumps(result)))
                self.writes.commit()
            return result

    def close_memories(self):
        self.service.close()
        self.writes.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "HyMemoryLocal/1.0"

    def log_message(self, format, *args):
        pass  # No request bodies, secrets, or memory text in access logs.

    def reply(self, status, value, content_type="application/json; charset=utf-8"):
        data = json.dumps(value, ensure_ascii=False, default=str).encode("utf-8") if isinstance(value, dict) else value
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def trusted_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def do_GET(self):
        if not self.trusted_host():
            return self.reply(403, {"error": "请通过本机地址打开页面。"})
        path = urlsplit(self.path).path
        static = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "application/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if path in static:
            name, content_type = static[path]
            return self.reply(200, (ROOT / "web" / name).read_bytes(), content_type)
        if path == "/api/status":
            try:
                version = importlib.metadata.version("hy-memory")
            except importlib.metadata.PackageNotFoundError:
                version = None
            return self.reply(200, {"app": APP_ID, "api_version": API_VERSION, "core_memory_version": 1,
                                    "version": version, "token": self.server.token,
                                    "hermes_connected": bool(self.server.active_scope),
                                    "workspace": str(ROOT), "config": public_config(self.server.service.config),
                                    "configured": not missing_settings(self.server.service.config)})
        return self.reply(404, {"error": "页面不存在。"})

    def do_POST(self):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if (not self.trusted_host() or self.headers.get("Origin", origin) != origin
                or not secrets.compare_digest(self.headers.get("X-HyMemory-Token", ""), self.server.token)):
            return self.reply(403, {"error": "请求验证失败，请刷新页面。"})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.reply(415, {"error": "需要 JSON 请求。"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 262144:
                raise UserError("请求内容为空或过长。")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise UserError("请求格式不正确。")
            path = urlsplit(self.path).path
            service = self.server.service
            if path == "/api/config":
                result = service.save(payload)
            elif path == "/api/hermes/add":
                result = self.server.hermes_add(payload)
            elif path == "/api/hermes/search":
                text = payload.get("text", "")
                if not isinstance(text, str) or not text.strip() or len(text) > 12000:
                    raise UserError("Hermes 检索内容为空或过长。")
                result = service.search(text, user_id=self.server.validate_scope(payload.get("scope")))
            elif path == "/api/check":
                with service.lock:
                    result = check_connections(service.config)
            elif path == "/api/shared/add":
                text = payload.get("text", "")
                source = payload.get("source", "assistant")
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 12000:
                    raise UserError("请输入 1 到 12000 字的记忆内容。")
                if source not in ("codex", "chatgpt", "assistant") or not self.server.active_scope:
                    raise UserError("共享记忆来源或 Hermes 连接配置不正确。")
                result = service.add([{"role": "user", "content": "请记住以下信息：" + text.strip()}],
                    session_id="shared-" + secrets.token_hex(12), source=source,
                    meta={"shared_memory": True}, user_id=self.server.active_scope)
            elif path.startswith("/api/core/"):
                result = self.server.core_call(path.removeprefix("/api/core/"), payload)
            elif path.startswith("/api/desktop/"):
                from desktop_link import conversations, read, send
                if path == "/api/desktop/list":
                    result = conversations(payload.get("query", ""), payload.get("limit", 20))
                elif path == "/api/desktop/read":
                    result = read(payload.get("thread_id", ""), payload.get("cursor"))
                elif path == "/api/desktop/send":
                    result = send(payload.get("thread_id", ""), payload.get("message", ""))
                else:
                    raise UserError("对话桥接口不存在。")
            elif path in ("/api/add", "/api/search"):
                text = payload.get("text", "")
                if not isinstance(text, str) or not text.strip() or len(text) > 12000:
                    raise UserError("请输入 1 到 12000 字的内容。")
                result = service.add(text.strip()) if path == "/api/add" else service.search(text.strip())
            elif path == "/api/shutdown":
                self.reply(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            else:
                return self.reply(404, {"error": "接口不存在。"})
            self.reply(200, result)
        except (UserError, ValueError, TypeError) as exc:
            self.reply(400, {"error": redact(exc, self.server.service.config)})
        except Exception as exc:
            self.reply(502, {"error": "操作未完成：" + redact(exc, self.server.service.config)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    directory = DATA
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    integration = directory / "hermes-integration.json"
    active_scope = ""
    if integration.exists():
        active_scope = json.loads(integration.read_text(encoding="utf-8")).get("scope", "")
        if not re.fullmatch(r"[a-f0-9]{32}", active_scope):
            raise UserError("Hermes 本地连接配置格式不正确。")
    service = MemoryService(directory)
    server = None
    for port in range(args.port, args.port + 10):
        try:
            server = AppServer(("127.0.0.1", port), service, active_scope)
            break
        except OSError as exc:
            if getattr(exc, "winerror", None) not in (10048, 10013) and exc.errno not in (errno.EADDRINUSE, errno.EACCES, 10048, 10013):
                raise
    if server is None:
        raise RuntimeError("No available local port between 8765 and 8774.")
    connection = directory / "connection.json"
    connection.write_text(json.dumps({"url": f"http://127.0.0.1:{server.server_port}",
                                     "pid": os.getpid()}), encoding="utf-8")
    print(f"HyMemory ready: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.close_memories()
        server.server_close()


if __name__ == "__main__":
    main()
