"""Bounded, explicit, local read-only artifact checks. Never executes code."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat

MAX_FILE = 16 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024
MAX_CSV = 4 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_CHECKS = 16
DENIED_PARTS = {".git", ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".codex", ".hermes", ".local", "voice-profiles"}
DENIED_FILES = {"core.sqlite3", "work.sqlite3", "chat-tasks.sqlite3", "hermes-api.json", "voice-settings.json",
                "providers.json", "provider-settings.json", "credentials.json", "credentials", "id_rsa", "id_ed25519",
                "auth.json", "config.toml", "tokens.json", "token.json", "accounts.json", "passwords.csv"}
DENIED_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".pfx", ".dpapi"}


class ValidationError(ValueError):
    pass


def _text(value, name, limit=2000):
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValidationError(f"{name}无效。")
    return value


def _reparse(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def _no_reparse(path):
    for part in [*reversed(path.parents), path]:
        if part.exists() or part.is_symlink():
            if _reparse(part):
                raise ValidationError("成果核验不读取符号链接或目录联接。")


def _root(value):
    value = _text(value, "成果目录")
    path = Path(value)
    if not path.is_absolute() or value.startswith(("\\\\", "//")) or path == Path(path.anchor) or path == Path.home():
        raise ValidationError("请选择明确的本机任务目录。")
    try:
        _no_reparse(path)
        resolved = path.resolve(strict=True)
    except OSError:
        raise ValidationError("成果目录不存在或无法读取。") from None
    if not resolved.is_dir():
        raise ValidationError("成果目录必须是已存在的文件夹。")
    own_data = Path(__file__).resolve().parent / ".local"
    if resolved.is_relative_to(own_data) and not resolved.is_relative_to(own_data / "verification"):
        raise ValidationError("不能把 Core 的聊天、声音或连接数据目录作为成果目录。")
    sensitive_ancestors = DENIED_PARTS - {".codex", ".local"}
    if resolved.name.casefold() in DENIED_PARTS or any(part.casefold() in sensitive_ancestors for part in resolved.parts):
        raise ValidationError("不能把凭据或内部数据目录作为成果目录。")
    return resolved


def _relative(value):
    text = _text(value, "成果相对路径", 1000).replace("\\", "/")
    path = PurePosixPath(text)
    if path.is_absolute() or ":" in text or any(part in ("", ".", "..") for part in text.split("/")):
        raise ValidationError("成果路径必须位于选定目录内，不能包含上级目录。")
    lowered = [part.casefold() for part in path.parts]
    name = lowered[-1]
    if (any(part in DENIED_PARTS or part.startswith(".env") for part in lowered)
            or name in DENIED_FILES or Path(name).suffix in DENIED_EXTENSIONS
            or any(term in name for term in ("api-key", "api_key", "secret-key", "private-key"))):
        raise ValidationError("成果核验不读取凭据、私密聊天数据库或内部配置。")
    return path.as_posix()


def _pointer(value):
    if not isinstance(value, str) or len(value) > 500 or not value.startswith("/") or len(value.split("/")) > 17:
        raise ValidationError("JSON 字段应使用 /字段名 格式，最多 16 层。")
    if re.search(r"~(?![01])", value):
        raise ValidationError("JSON 字段转义格式无效。")
    return value


def _number(value):
    if type(value) not in (int, float) or isinstance(value, float) and not math.isfinite(value):
        raise ValidationError("核验数字必须是有限的数字。")
    if len(str(value)) > 100:
        raise ValidationError("核验数字过大。")
    return value


def normalize_spec(spec):
    if not isinstance(spec, dict) or set(spec) != {"root", "checks"}:
        raise ValidationError("成果核验需要明确的目录和检查项目。")
    root = _root(spec["root"])
    items = spec["checks"]
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_CHECKS:
        raise ValidationError("请选择 1–16 项成果检查。")
    checks = []
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError("成果检查格式无效。")
        kind = item.get("kind")
        label = {"label": _text(item["label"], "检查名称", 80)} if "label" in item else {}
        if kind == "file":
            if set(item) - {"kind", "path", "label", "min_bytes", "max_bytes", "sha256"}:
                raise ValidationError("文件检查含有不支持的设置。")
            lower, upper = item.get("min_bytes", 1), item.get("max_bytes", MAX_FILE)
            if type(lower) is not int or type(upper) is not int or not 0 <= lower <= upper <= MAX_FILE:
                raise ValidationError("文件大小检查须在 0–16 MiB 范围内。")
            check = {"kind": kind, "path": _relative(item.get("path")), "min_bytes": lower, "max_bytes": upper, **label}
            if "sha256" in item:
                if not isinstance(item["sha256"], str) or not re.fullmatch(r"[a-fA-F0-9]{64}", item["sha256"]):
                    raise ValidationError("文件 SHA-256 无效。")
                check["sha256"] = item["sha256"].lower()
        elif kind == "json_number":
            if set(item) - {"kind", "path", "label", "pointer", "equals", "tolerance"}:
                raise ValidationError("JSON 数字检查含有不支持的设置。")
            tolerance = _number(item.get("tolerance", 0))
            if tolerance < 0:
                raise ValidationError("数字误差范围不能小于零。")
            check = {"kind": kind, "path": _relative(item.get("path")), "pointer": _pointer(item.get("pointer")),
                     "equals": _number(item.get("equals")), "tolerance": tolerance, **label}
        elif kind == "csv_json_totals":
            fields = {"kind", "csv", "json", "label", "category_column", "amount_column", "row_count_pointer", "total_pointer", "by_category_pointer"}
            if set(item) - fields:
                raise ValidationError("CSV 汇总检查含有不支持的设置。")
            check = {"kind": kind, "csv": _relative(item.get("csv")), "json": _relative(item.get("json")), **label}
            for field, default in (("category_column", "category"), ("amount_column", "amount_cents")):
                check[field] = _text(item.get(field, default), "CSV 列名", 80)
            for field, default in (("row_count_pointer", "/row_count"), ("total_pointer", "/grand_total_cents"), ("by_category_pointer", "/by_category_cents")):
                check[field] = _pointer(item.get(field, default))
        else:
            raise ValidationError("只支持文件、JSON 数字与 CSV 汇总核验，不会运行脚本或命令。")
        checks.append(check)
    return {"root": str(root), "checks": checks}


def pending_result():
    return {"status": "pending", "phase": "waiting_for_execution", "checks": [], "summary": "等待执行结束后核验指定成果。"}


def not_requested_result():
    return {"status": "not_requested", "checks": [], "summary": "未指定成果核验；执行结束不代表成果正确。"}


def _opened_path(file, fallback):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        import msvcrt
        method = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
        method.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
        method.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(32768)
        length = method(msvcrt.get_osfhandle(file.fileno()), buffer, len(buffer), 0)
        if not 0 < length < len(buffer):
            raise ValidationError("无法确认成果文件的实际位置。")
        value = buffer.value
        if value.startswith("\\\\?\\"):
            value = value[4:]
        return Path(value)
    descriptor = Path(f"/proc/self/fd/{file.fileno()}")
    return descriptor.resolve() if descriptor.exists() else fallback.resolve(strict=True)


class _Reader:
    def __init__(self, root, cancelled):
        self.root, self.cancelled, self.total = root, cancelled, 0

    def read(self, relative, maximum, contents=True):
        relative = _relative(relative)
        path = self.root / relative
        _no_reparse(path)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError:
            raise ValidationError("成果文件不存在或无法读取。") from None
        with os.fdopen(descriptor, "rb") as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > maximum or info.st_nlink != 1:
                raise ValidationError("成果不是独立的普通文件或超过核验大小限制。")
            actual = _opened_path(file, path)
            if not actual.is_relative_to(self.root) or os.path.normcase(str(actual)) != os.path.normcase(str(path)):
                raise ValidationError("成果文件已移动或指向选定目录之外。")
            digest, data, size = hashlib.sha256(), [], 0
            while True:
                if self.cancelled():
                    raise InterruptedError("成果核验已暂停。")
                chunk = file.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                self.total += len(chunk)
                if size > maximum or self.total > MAX_TOTAL:
                    raise ValidationError("成果读取超过核验大小限制。")
                digest.update(chunk)
                if contents:
                    data.append(chunk)
            after = os.fstat(file.fileno())
            if (info.st_size, info.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or after.st_size != size:
                raise ValidationError("成果仍在写入，请等写入完成后重新核验。")
            return b"".join(data), {"path": relative, "bytes": size, "sha256": digest.hexdigest()}


def _json(raw):
    def invalid(_value):
        raise ValueError("Non-finite JSON")
    try:
        return json.loads(raw.decode("utf-8-sig"), parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError):
        raise ValidationError("成果不是有效的 UTF-8 JSON。") from None


def _field(data, pointer):
    try:
        for part in pointer[1:].split("/"):
            key = part.replace("~1", "/").replace("~0", "~")
            data = data[int(key)] if isinstance(data, list) and key.isdecimal() else data[key]
        return data
    except (KeyError, IndexError, TypeError, ValueError):
        raise ValidationError("成果缺少指定 JSON 字段。") from None


def _check(reader, check):
    kind = check["kind"]
    if kind == "file":
        _raw, metadata = reader.read(check["path"], check["max_bytes"], contents=False)
        if metadata["bytes"] < check["min_bytes"]:
            raise ValidationError("成果文件小于要求的大小。")
        if check.get("sha256") and metadata["sha256"] != check["sha256"]:
            raise ValidationError("成果文件 SHA-256 与指定值不一致。")
        return {"detail": "文件存在，大小及指定指纹检查通过。", "artifact": metadata}
    if kind == "json_number":
        raw, metadata = reader.read(check["path"], MAX_JSON)
        value = _number(_field(_json(raw), check["pointer"]))
        if abs(Decimal(str(value)) - Decimal(str(check["equals"]))) > Decimal(str(check["tolerance"])):
            raise ValidationError("成果 JSON 数字与指定值不一致。")
        return {"detail": "指定 JSON 数字检查通过。", "artifact": metadata, "actual": value}
    raw, source = reader.read(check["csv"], MAX_CSV)
    result_raw, artifact = reader.read(check["json"], MAX_JSON)
    try:
        rows = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
        if not rows.fieldnames or len(rows.fieldnames) != len(set(rows.fieldnames)) or not all(column in rows.fieldnames for column in (check["category_column"], check["amount_column"])):
            raise ValidationError("CSV 缺少指定列或包含重复列。")
        total, count, groups = 0, 0, {}
        for row in rows:
            count += 1
            if count > 100000:
                raise ValidationError("CSV 记录数超过核验限制。")
            category, amount = row[check["category_column"]], row[check["amount_column"]]
            if not isinstance(category, str) or not 1 <= len(category) <= 160 or not isinstance(amount, str) or not re.fullmatch(r"[+-]?\d{1,18}", amount.strip()):
                raise ValidationError("CSV 分类或整数金额格式无效。")
            amount = int(amount)
            total += amount
            groups[category] = groups.get(category, 0) + amount
        data = _json(result_raw)
        actual_count, actual_total, actual_groups = (_field(data, check[key]) for key in ("row_count_pointer", "total_pointer", "by_category_pointer"))
        if type(actual_count) is not int or type(actual_total) is not int or not isinstance(actual_groups, dict) or any(type(number) is not int for number in actual_groups.values()):
            raise ValidationError("汇总 JSON 的记录数、金额或分类格式不正确。")
        if actual_count != count or actual_total != total or actual_groups != groups:
            raise ValidationError("汇总 JSON 与 CSV 独立复算结果不一致。")
        return {"detail": "记录数、整数金额及分类汇总通过独立复算。", "source": source, "artifact": artifact,
                "row_count": count, "grand_total": total, "category_count": len(groups)}
    except (UnicodeError, csv.Error, KeyError, TypeError):
        raise ValidationError("CSV 文件无法按指定列读取。") from None


def validate_artifacts(spec, cancelled=lambda: False):
    normalized = normalize_spec(spec)
    reader = _Reader(Path(normalized["root"]), cancelled)
    results = []
    for check in normalized["checks"]:
        if cancelled():
            raise InterruptedError("成果核验已暂停。")
        result = {key: check[key] for key in ("kind", "path", "csv", "json", "label") if key in check}
        try:
            result.update(status="passed", **_check(reader, check))
        except InterruptedError:
            raise
        except (ValidationError, OSError, InvalidOperation) as error:
            # Do not expose file contents, exception paths, credentials or JSON
            # parser excerpts. Only our bounded, user-facing reasons are shown.
            result.update(status="failed", detail=str(error) if isinstance(error, ValidationError) else "成果无法读取或核验未完成。")
        results.append(result)
    passed = all(check["status"] == "passed" for check in results)
    return {"status": "passed" if passed else "failed", "phase": "finished", "checks": results,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "summary": "已通过指定的成果检查。" if passed else "部分成果未通过指定检查，请核对详情。"}
