"""Explicit daily model providers with separate OS-protected API keys."""
from __future__ import annotations

import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import threading
import uuid
from urllib.error import HTTPError
from core_platform import protect_bytes, SecretStoreError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

BUILTINS = {
    "local": {"id": "local", "name": "本地 Ollama", "kind": "local", "model": "qwen3.5:9b", "base_url": "http://127.0.0.1:11434"},
    "openai": {"id": "openai", "name": "OpenAI", "kind": "openai", "model": "", "base_url": "https://api.openai.com/v1"},
    "deepseek": {"id": "deepseek", "name": "DeepSeek", "kind": "deepseek", "model": "", "base_url": "https://api.deepseek.com"},
}


class ProviderError(RuntimeError):
    """Only fixed, application-owned messages may cross the provider boundary."""


def _crypt(data, decrypt=False):
    try:
        return protect_bytes(data, decrypt=decrypt)
    except SecretStoreError as exc:
        raise ProviderError(str(exc)) from None


def _seal(key):
    return base64.b64encode(_crypt(key.encode("ascii"))).decode("ascii")


def _unseal(cipher):
    try:
        return _crypt(base64.b64decode(cipher, validate=True), decrypt=True).decode("ascii")
    except Exception as exc:
        raise ProviderError("API 密钥无法解密，请在保存时的本机账户中解锁安全存储或重新配置。") from exc


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProviderError("模型服务重定向已被阻止，请检查服务地址。")


class _VisibleText:
    """Suppress inline thinking tags even when split across stream packets."""
    def __init__(self):
        self.buffer, self.hidden = "", False

    def feed(self, content, final=False):
        self.buffer += content
        output = ""
        while self.buffer:
            match = re.search(r"</?(?:think|thinking|analysis)\s*>", self.buffer, re.I)
            if match:
                if not self.hidden:
                    output += self.buffer[:match.start()]
                self.hidden = not match[0].startswith("</")
                self.buffer = self.buffer[match.end():]
                continue
            tail = self.buffer.rfind("<")
            if tail >= 0 and any(tag.startswith(self.buffer[tail:].casefold()) for tag in
                ("<think>", "</think>", "<thinking>", "</thinking>", "<analysis>", "</analysis>")):
                if not self.hidden:
                    output += self.buffer[:tail]
                self.buffer = self.buffer[tail:]
                break
            if not self.hidden:
                output += self.buffer
            self.buffer = ""
        if final:
            self.buffer = ""
        return output


class _ProbeJob:
    def __init__(self):
        self.cancelled = threading.Event()
    def attach(self, response):
        self.response = response
    def detach(self, response):
        self.response = None


class _ProviderSnapshot:
    __slots__ = ("_record", "_cipher")
    def __init__(self, record, cipher):
        self._record, self._cipher = dict(record), cipher
    def __repr__(self):
        return "<ProviderSnapshot>"


class ProviderBridge:
    def __init__(self, data_dir, ollama):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.data_dir / "providers.json"
        self.secrets_path = self.data_dir / "provider-secrets.json"
        self.ollama = ollama
        self.lock = threading.RLock()
        self.opener = build_opener(ProxyHandler({}), _NoRedirect())
        self.checks = {}
        config = self._read(self.config_path, {"version": 1, "active_id": "local", "items": []})
        secrets = self._read(self.secrets_path, {"version": 1, "keys": {}})
        if not isinstance(config.get("items"), list) or not isinstance(secrets.get("keys"), dict):
            raise ProviderError("模型提供方配置格式不正确，原文件已保留。")
        self.records = deepcopy(BUILTINS)
        for item in config["items"]:
            if not isinstance(item, dict):
                raise ProviderError("模型提供方配置格式不正确，原文件已保留。")
            record = self._validate_record(item)
            self.records[record["id"]] = record
        self.keys = dict(secrets["keys"])
        self.active_id = config.get("active_id", "local")
        if self.active_id not in self.records:
            raise ProviderError("默认提供方配置不存在，请先修复模型配置。")

    @staticmethod
    def _read(path, default):
        if not path.exists():
            return deepcopy(default)
        try:
            if path.stat().st_size > 262144:
                raise ValueError()
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (OSError, ValueError) as exc:
            raise ProviderError("模型提供方配置无法读取，原文件已保留。") from exc

    @staticmethod
    def _text(value, field, limit, empty=False):
        if not isinstance(value, str) or len(value) > limit or re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError(field + "格式不正确。")
        value = value.strip()
        if not value and not empty:
            raise ValueError("请填写" + field + "。")
        return value

    @staticmethod
    def _url(kind, value):
        if kind == "local":
            if value != BUILTINS["local"]["base_url"]:
                raise ValueError("本地 Ollama 地址固定为 127.0.0.1:11434。")
            return value
        try:
            parsed = urlsplit(value)
            valid = (parsed.hostname and not parsed.username and not parsed.password
                and not parsed.query and not parsed.fragment and not re.search(r"[\s\x00-\x1f]", value))
            parsed.port
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError("模型服务地址格式不正确，不能包含密钥或查询参数。")
        if kind in ("openai", "deepseek"):
            expected = "api.openai.com" if kind == "openai" else "api.deepseek.com"
            paths = {"/v1"} if kind == "openai" else {"", "/v1"}
            if parsed.scheme != "https" or parsed.hostname != expected or parsed.port not in (None, 443) or parsed.path.rstrip("/") not in paths:
                raise ValueError("内置提供方只连接它的官方 HTTPS 服务地址。")
        elif parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname == "127.0.0.1"):
            raise ValueError("自定义远程地址必须使用 HTTPS；HTTP 只允许 127.0.0.1。")
        return value.rstrip("/")

    def _validate_record(self, item):
        kind = item.get("kind")
        identity = item.get("id")
        if kind not in ("local", "openai", "deepseek", "custom"):
            raise ValueError("请选择本地、OpenAI、DeepSeek 或自定义提供方。")
        if (kind in BUILTINS and identity != kind) or (kind == "custom" and
                (not isinstance(identity, str) or not re.fullmatch(r"custom_[a-f0-9]{32}", identity))):
            raise ValueError("模型提供方编号格式不正确。")
        return {"id": identity, "kind": kind, "name": self._text(item.get("name", ""), "提供方名称", 80),
            "model": self._text(item.get("model", ""), "模型名称", 200, empty=kind != "local"),
            "base_url": self._url(kind, self._text(item.get("base_url", ""), "服务地址", 2048))}

    def _public(self, item):
        entry = self.keys.get(item["id"])
        has_key = (isinstance(entry, dict) and bool(entry.get("cipher"))
            and entry.get("base_url") == item["base_url"])
        available = bool(item["model"]) and (has_key or item["kind"] in ("local", "custom"))
        return {**item, "has_key": has_key, "available": available,
            **self.checks.get(item["id"], {}), "auth_method": "local" if item["kind"] == "local" else "api_key",
            "oauth_supported": False}

    @staticmethod
    def _atomic(path, value):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _commit(self, records, keys, active_id):
        self._atomic(self.secrets_path, {"version": 1, "keys": keys})
        self._atomic(self.config_path, {"version": 1, "items": list(records.values()), "active_id": active_id})
        self.records, self.keys, self.active_id = records, keys, active_id

    def list(self):
        with self.lock:
            return {"items": [self._public(item) for item in self.records.values()], "active_id": self.active_id}

    def _record(self, identity):
        if not isinstance(identity, str) or identity not in self.records:
            raise ValueError("未找到所选模型提供方。")
        return dict(self.records[identity])

    def _cipher(self, item):
        entry = self.keys.get(item["id"])
        if not entry:
            return None
        # A crash between the two atomic file replacements must never send a
        # newly saved credential to the previous endpoint (or the reverse).
        if not isinstance(entry, dict) or entry.get("base_url") != item["base_url"] or not isinstance(entry.get("cipher"), str):
            raise ProviderError("密钥与服务地址不匹配，请重新保存此提供方的密钥。")
        return entry["cipher"]

    def selected(self):
        with self.lock:
            return self._public(self._record(self.active_id))

    def snapshot(self, provider_id=None):
        """Opaque in-memory job snapshot; never include this in an RPC result."""
        with self.lock:
            item = self._record(provider_id or self.active_id)
            return _ProviderSnapshot(item, self._cipher(item))

    def save(self, payload):
        if not isinstance(payload, dict) or set(payload) - {"id", "kind", "name", "model", "base_url", "api_key", "clear_key"}:
            raise ValueError("模型提供方配置字段不正确。")
        with self.lock:
            kind = payload.get("kind")
            identity = payload.get("id") or (kind if kind in BUILTINS else "custom_" + uuid.uuid4().hex)
            if payload.get("id") and identity not in self.records:
                raise ValueError("请先创建新的自定义提供方，不要指定未登记编号。")
            old = self.records.get(identity, {"id": identity, "kind": kind, "name": "自定义模型", "model": "", "base_url": ""})
            item = self._validate_record({**old, **{key: value for key, value in payload.items() if key in ("kind", "name", "model", "base_url")}, "id": identity})
            if not item["model"]:
                raise ValueError("请填写要使用的模型名称。")
            key = payload.get("api_key", "")
            if not isinstance(key, str) or len(key) > 4096 or not key.isascii() or re.search(r"[\x00-\x20\x7f]", key):
                raise ValueError("API 密钥格式不正确。")
            if not isinstance(payload.get("clear_key", False), bool):
                raise ValueError("清除密钥选项格式不正确。")
            if key and payload.get("clear_key"):
                raise ValueError("请分别选择保存新密钥或清除密钥。")
            if item["kind"] == "local" and key:
                raise ValueError("本地 Ollama 不需要 API 密钥。")
            keys = dict(self.keys)
            if key:
                keys[identity] = {"cipher": _seal(key), "base_url": item["base_url"]}
            elif payload.get("clear_key"):
                keys.pop(identity, None)
            elif old.get("base_url") != item["base_url"] and keys.get(identity):
                raise ValueError("更换服务地址时请重新填写密钥，避免把原密钥发送到其他服务。")
            records = {**self.records, identity: item}
            self._commit(records, keys, self.active_id)
            self.checks.pop(identity, None)
            return self._public(item)

    def select(self, identity):
        with self.lock:
            item = self._record(identity)
            if not self._public(item)["available"]:
                raise ValueError("请先填写模型名称和 API 密钥。")
            self._commit(dict(self.records), dict(self.keys), identity)
            return self._public(item)

    def delete(self, identity):
        with self.lock:
            self._record(identity)
            if identity == "local":
                raise ValueError("本地提供方需要保留。")
            records, keys = dict(self.records), dict(self.keys)
            if identity in BUILTINS:
                records[identity] = dict(BUILTINS[identity])
            else:
                records.pop(identity)
            keys.pop(identity, None)
            active = "local" if self.active_id == identity else self.active_id
            self._commit(records, keys, active)
            self.checks.pop(identity, None)
            return {"ok": True, "active_id": active}

    @staticmethod
    def _messages(messages):
        if not isinstance(messages, list) or not 1 <= len(messages) <= 200:
            raise ValueError("对话消息格式不正确。")
        result = []
        for item in messages:
            if not isinstance(item, dict) or item.get("role") not in ("system", "developer", "user", "assistant") or not isinstance(item.get("content"), str):
                raise ValueError("当前模型入口仅支持文字对话。")
            result.append({"role": item["role"], "content": item["content"]})
        if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 512 * 1024:
            raise ValueError("本次对话内容过长，请新建对话后重试。")
        return result

    def stream(self, messages, job, provider_id=None):
        snapshot = getattr(job, "provider_snapshot", None)
        if isinstance(snapshot, _ProviderSnapshot):
            item, cipher = dict(snapshot._record), snapshot._cipher
            if provider_id is not None and provider_id != item["id"]:
                raise ValueError("本轮模型提供方与已确认的选择不一致。")
        else:
            with self.lock:
                item = self._record(provider_id or self.active_id)
                cipher = self._cipher(item)
        messages = self._messages(messages)
        if job.cancelled.is_set():
            return
        if item["kind"] == "local":
            yield from self.ollama.stream(item["model"], messages, job)
            return
        yield from self._cloud_stream(item, cipher, messages, job)

    def _cloud_stream(self, item, cipher, messages, job, testing=False):
        if not item["model"] or (item["kind"] in ("openai", "deepseek") and not cipher):
            raise ProviderError("请先配置此提供方的模型名称和 API 密钥。")
        key = _unseal(cipher) if cipher else None
        if item["kind"] == "openai":
            endpoint = "/responses"
            body = {"model": item["model"], "input": messages, "stream": True, "store": False,
                "max_output_tokens": 256 if testing else 2048}
        else:
            endpoint = "/chat/completions"
            body = {"model": item["model"], "messages": [{**row, "role": "system" if row["role"] == "developer" else row["role"]} for row in messages],
                "stream": True, "max_tokens": 128 if testing else 2048}
            if item["kind"] == "deepseek":
                body["thinking"] = {"type": "disabled"}
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if key:
            headers["Authorization"] = "Bearer " + key
        request = Request(item["base_url"] + endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
        response = None
        visible = _VisibleText()
        seen, size = False, 0
        try:
            response = self.opener.open(request, timeout=45 if testing else 90)
            job.attach(response)
            for packet in self._sse(response, job):
                if job.cancelled.is_set():
                    return
                if item["kind"] == "openai":
                    kind = packet.get("type")
                    if kind in ("error", "response.failed", "response.incomplete"):
                        raise ProviderError("模型服务未能完成回答，已保留收到的内容。")
                    text = packet.get("delta", "") if kind in ("response.output_text.delta", "response.refusal.delta") else ""
                    complete = kind == "response.completed"
                    if complete and packet.get("response", {}).get("status") != "completed":
                        raise ProviderError("模型服务未确认回答完成。")
                    if complete and not seen:
                        text = "".join(part.get("text", "") for row in packet.get("response", {}).get("output", [])
                            if row.get("type") == "message" for part in row.get("content", []) if part.get("type") == "output_text")
                else:
                    if packet.get("_done"):
                        tail = visible.feed("", final=True)
                        if tail:
                            yield tail
                        if not seen:
                            raise ProviderError("模型服务没有返回有效回答。")
                        return
                    if packet.get("error"):
                        raise ProviderError("模型服务未能完成回答，已保留收到的内容。")
                    choices = packet.get("choices", [])
                    choice = choices[0] if choices else {}
                    if choice.get("finish_reason") in ("length", "content_filter", "tool_calls", "insufficient_system_resource"):
                        raise ProviderError("模型回答未完整结束，已保留收到的内容。")
                    delta = choice.get("delta", {})
                    text = delta.get("content") or delta.get("refusal") or ""
                    complete = False
                if isinstance(text, str) and text:
                    content = visible.feed(text)
                    size += len(content.encode("utf-8"))
                    if size > 2_000_000:
                        raise ProviderError("模型回答超过单次长度限制。")
                    if content:
                        seen = True
                        yield content
                if complete:
                    tail = visible.feed("", final=True)
                    if tail:
                        yield tail
                    if not seen:
                        raise ProviderError("模型服务没有返回有效回答。")
                    return
            if not job.cancelled.is_set():
                raise ProviderError("模型连接意外中断，已保留收到的内容。")
        except HTTPError as exc:
            code = exc.code if isinstance(exc.code, int) else 500
            exc.close()  # Never read/echo provider errors, which may contain credentials.
            meanings = {400: "模型或请求格式不受支持", 401: "API 密钥无效或尚未授权", 403: "没有访问权限",
                404: "模型或服务地址不存在", 429: "服务限流或额度不足"}
            raise ProviderError("模型服务返回 HTTP " + str(code) + "：" + meanings.get(code, "服务暂时不可用") + "。") from None
        except ProviderError:
            if not job.cancelled.is_set():
                raise
        except Exception:
            if not job.cancelled.is_set():
                raise ProviderError("模型连接或返回格式异常，请检查服务配置。") from None
        finally:
            if response is not None:
                try:
                    job.detach(response)
                except Exception:
                    pass
                try:
                    response.close()
                except Exception:
                    pass

    @staticmethod
    def _sse(response, job):
        data, frame_size, total, events = [], 0, 0, 0
        while not job.cancelled.is_set():
            line = response.readline(262145)
            if not line:
                return
            total += len(line)
            frame_size += len(line)
            if len(line) > 262144 or frame_size > 1_000_000 or total > 32_000_000:
                raise ProviderError("模型流式响应超过单次大小限制。")
            if line.strip() == b"":
                if data:
                    events += 1
                    if events > 20000:
                        raise ProviderError("模型流式响应事件过多。")
                    encoded = b"\n".join(data)
                    if encoded == b"[DONE]":
                        yield {"_done": True}
                    else:
                        packet = json.loads(encoded)
                        if not isinstance(packet, dict):
                            raise ValueError("Invalid SSE object")
                        yield packet
                data, frame_size = [], 0
            elif line.startswith(b"data:"):
                data.append(line[5:].strip())

    def test(self, identity):
        try:
            with self.lock:
                item = self._record(identity)
                cipher = self._cipher(item)
            if item["kind"] == "local":
                result = self.ollama.health(item["model"])
                result = {"ok": result.get("ok") is True, "models": result.get("models", []),
                    "method": "local-model-status", **({"error": "本地 Ollama 或所选模型暂不可用。"} if not result.get("ok") else {})}
            else:
                job = _ProbeJob()
                text = "".join(self._cloud_stream(item, cipher, [{"role": "user", "content": "Reply with OK only."}], job, testing=True))
                if not text.strip():
                    raise ProviderError("模型没有返回有效回答。")
                result = {"ok": True, "models": [item["model"]], "method": "generation"}
        except Exception as exc:
            # Our transport errors are fixed messages. Unexpected provider or
            # decryption exceptions must never carry a key/header/raw body out.
            error = str(exc) if isinstance(exc, ProviderError) else "模型连接测试未完成，请检查配置。"
            result = {"ok": False, "error": error[:300]}
        with self.lock:
            self.checks[identity] = {"connected": result["ok"], **({"error": result["error"]} if result.get("error") else {})}
        return result
