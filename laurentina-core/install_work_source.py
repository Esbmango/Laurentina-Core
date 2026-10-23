"""Opt in one native Hermes DPAPI secret source, preserving unrelated settings."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

import yaml

from core_work import WorkBridge

ROOT = Path(__file__).resolve().parent
NAME = "laurentina_work"


def _header(lines, path):
    stack = []
    for index, line in enumerate(lines):
        match = re.match(r"^( *)([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)", line)
        if not match:
            continue
        indent, key = len(match[1]), match[2]
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, key))
        if tuple(item[1] for item in stack) == path:
            return index, indent
    return None


def _put(text, path, value, mapping=False):
    lines = text.splitlines(keepends=True)
    found = _header(lines, path)
    if found:
        index, indent = found
        # Replacing a leaf sequence only removes its data rows; comments stay.
        end = index + 1
        while end < len(lines):
            line = lines[end]
            if not line.strip() or line.lstrip().startswith("#"):
                end += 1
                continue
            item_indent = len(line) - len(line.lstrip())
            # YAML permits a leaf sequence's '-' rows at the key's own
            # indentation. They belong to this value, not the next mapping key.
            indentless_item = (not mapping and item_indent == indent
                               and re.match(r"^\s*-(?:\s|$)", line))
            if item_indent < indent or (item_indent == indent and not indentless_item):
                break
            if mapping:
                raise RuntimeError("现有工作配置结构不兼容，原配置未修改。")
            end += 1
        comments = [line for line in lines[index + 1:end] if not line.strip() or line.lstrip().startswith("#")]
        rendered = "" if mapping else " " + json.dumps(value, ensure_ascii=False)
        lines[index:end] = [" " * indent + path[-1] + ":" + rendered + "\n", *comments]
    else:
        if len(path) == 1:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.extend(["\n", path[-1] + ":\n"])
            text = "".join(lines)
            return text if mapping else _put(text, path, value)
        parent = _header(lines, path[:-1])
        if parent is None:
            text = _put(text, path[:-1], None, mapping=True)
            return _put(text, path, value, mapping=mapping)
        index, indent = parent
        # Parents are mappings in the supported native config format.
        suffix = lines[index].split(":", 1)[1].split("#", 1)[0].strip()
        if suffix not in ("", "{}"):
            raise RuntimeError("现有配置不是普通 YAML 映射，原配置未修改。")
        if suffix == "{}":
            lines[index] = " " * indent + path[-2] + ":\n"
        rendered = "" if mapping else " " + json.dumps(value, ensure_ascii=False)
        lines.insert(index + 1, " " * (indent + 2) + path[-1] + ":" + rendered + "\n")
    return "".join(lines)


def _plugin_source(home, connection):
    return '''"""Native scoped source for this Core's Windows-account encrypted API key."""
import json
from pathlib import Path
import sys
from agent.secret_sources.base import SecretSource, FetchResult, ErrorKind

CORE = Path(CORE_LITERAL)
PRIMARY = Path(HOME_LITERAL)
CONNECTION = Path(CONNECTION_LITERAL)

class LaurentinaWorkSource(SecretSource):
    name = "laurentina_work"
    label = "Laurentina local work key"
    shape = "bulk"

    def fetch(self, cfg, home_path):
        result = FetchResult()
        try:
            if Path(home_path).resolve() != PRIMARY.resolve():
                return result.fail("Work key is only available to its configured primary profile.", ErrorKind.NOT_CONFIGURED)
            if Path(cfg.get("connection_file", "")).resolve() != CONNECTION.resolve():
                return result.fail("Work connection location mismatch.", ErrorKind.NOT_CONFIGURED)
            data = json.loads(CONNECTION.read_text(encoding="utf-8"))
            if data.get("key") or not data.get("key_dpapi"):
                return result.fail("Work key must use Windows account encryption.", ErrorKind.NOT_CONFIGURED)
            if str(CORE) not in sys.path:
                sys.path.insert(0, str(CORE))
            from core_work import unprotect_work_key
            key = unprotect_work_key(data["key_dpapi"])
            if not 16 <= len(key) <= 512 or "\\n" in key or "\\r" in key:
                return result.fail("Invalid work key.", ErrorKind.AUTH_FAILED)
            result.secrets = {"API_SERVER_KEY": key}
            return result
        except Exception:
            return result.fail("The local encrypted work key could not be loaded.", ErrorKind.INTERNAL)

def register(context):
    context.register_secret_source(LaurentinaWorkSource())
'''.replace("CORE_LITERAL", repr(str(ROOT))).replace("HOME_LITERAL", repr(str(home))).replace("CONNECTION_LITERAL", repr(str(connection)))


def install(data_dir, hermes_home=None):
    data_dir = Path(data_dir).resolve()
    home = Path(hermes_home or Path.home() / "AppData/Local/hermes").resolve()
    path = home / "config.yaml"
    original = path.read_text(encoding="utf-8-sig")
    before = yaml.safe_load(original)
    if not isinstance(before, dict):
        raise RuntimeError("Hermes 配置格式不正确，原文件未修改。")
    bridge = WorkBridge(data_dir, auto_start=False)
    try:
        own = bridge._connection()
    finally:
        bridge.close()
    # A primary API key the user already configured is never silently replaced.
    env_path = home / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            match = re.match(r"^\s*(?:export\s+)?API_SERVER_KEY\s*=\s*(.*?)\s*$", line)
            if match and match[1].strip("'\"") and match[1].strip("'\"") != own["key"]:
                raise RuntimeError("Hermes 已有独立 API 凭据，本次不会覆盖；请先检查原 API 配置。")
    expected = deepcopy(before)
    plugins = expected.setdefault("plugins", {})
    enabled = plugins.get("enabled", [])
    disabled = plugins.get("disabled", [])
    if not isinstance(enabled, list) or not isinstance(disabled, list) or NAME in disabled:
        raise RuntimeError("此插件被明确禁用，或插件配置格式不兼容；原配置未修改。")
    if NAME not in enabled:
        enabled = [*enabled, NAME]
    plugins["enabled"] = enabled
    source = {"enabled": True, "override_existing": False, "connection_file": str(data_dir / "hermes-api.json")}
    old_source = expected.setdefault("secrets", {}).get(NAME)
    if old_source and old_source != source:
        raise RuntimeError("已有不同的 Laurentina 工作凭据来源，本次不会替换。")
    expected["secrets"][NAME] = source
    api = expected.setdefault("gateway", {}).setdefault("api_server", {})
    if api.get("key") or (isinstance(api.get("extra"), dict) and api["extra"].get("key")):
        raise RuntimeError("Hermes 已有 API 密钥配置，本次不会替换。")
    changes = {"enabled": True, "host": "127.0.0.1", "port": urlsplit(own["url"]).port, "model_name": own["model_name"]}
    api.update(changes)
    updated = original
    updated = _put(updated, ("plugins", "enabled"), enabled)
    for key, value in source.items():
        updated = _put(updated, ("secrets", NAME, key), value)
    for key, value in changes.items():
        updated = _put(updated, ("gateway", "api_server", key), value)
    if yaml.safe_load(updated) != expected:
        raise RuntimeError("配置保留检查未通过，Hermes 原配置未修改。")
    plugin = home / "plugins" / NAME
    code = _plugin_source(home, data_dir / "hermes-api.json")
    manifest = "name: laurentina_work\nversion: 0.1.0\ndescription: Native scoped source for the user's local DPAPI-encrypted Hermes work API key.\n"
    changed = updated != original or not (plugin / "__init__.py").is_file() or (plugin / "__init__.py").read_text(encoding="utf-8") != code
    backup = None
    if changed:
        backup = data_dir / "backups" / ("hermes-work-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        backup.mkdir(parents=True, exist_ok=False)
        shutil.copy2(path, backup / "config.yaml")
        if plugin.is_dir():
            shutil.copytree(plugin, backup / NAME)
        plugin.mkdir(parents=True, exist_ok=True)
        (plugin / "__init__.py").write_text(code, encoding="utf-8")
        (plugin / "plugin.yaml").write_text(manifest, encoding="utf-8")
        if updated != original:
            temporary = path.with_suffix(".core-work.tmp")
            temporary.write_text(updated, encoding="utf-8")
            temporary.replace(path)
    return {"ok": True, "changed": changed, "backup": str(backup) if backup else None,
        "preserved_unrelated_config": True, "plugin": NAME}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(ROOT / ".local"))
    parser.add_argument("--hermes-home")
    args = parser.parse_args()
    print(json.dumps(install(args.data_dir, args.hermes_home), ensure_ascii=False))
