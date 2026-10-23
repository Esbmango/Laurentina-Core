"""Explicitly select the existing native local Hermes terminal, preserving policy."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

import yaml

from install_work_source import _put

ROOT = Path(__file__).resolve().parent


def use_local_backend(home, data_dir, context_tokens=None):
    home, data_dir = Path(home).resolve(), Path(data_dir).resolve()
    config = home / "config.yaml"
    raw = config.read_bytes()
    original = raw.decode("utf-8-sig")
    before = yaml.safe_load(original)
    if not isinstance(before, dict) or not isinstance(before.get("terminal"), dict):
        raise RuntimeError("Hermes 终端配置结构无效，原配置未改动。")
    previous = before["terminal"].get("backend")
    if context_tokens is not None and (type(context_tokens) is not int or context_tokens not in (65536, 131072)):
        raise ValueError("工作上下文请选择 65536 或 131072 tokens。")
    expected = deepcopy(before)
    expected["terminal"]["backend"] = "local"
    updated = _put(original, ("terminal", "backend"), "local")
    if context_tokens is not None:
        model = expected.get("model")
        if not isinstance(model, dict):
            raise RuntimeError("Hermes 模型配置结构无效，原配置未改动。")
        model.update(ollama_num_ctx=context_tokens, context_length=context_tokens)
        updated = _put(updated, ("model", "ollama_num_ctx"), context_tokens)
        updated = _put(updated, ("model", "context_length"), context_tokens)
    if yaml.safe_load(updated) != expected:
        raise RuntimeError("配置保留检查失败，原配置未改动。")
    if expected == before:
        return {"ok": True, "changed": False, "backend": "local", "context_tokens": context_tokens}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = data_dir / "backups" / ("hermes-terminal-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(config, backup / "config.yaml")
    temporary = config.with_name("config.laurentina-terminal.tmp")
    temporary.write_text(updated, encoding="utf-8")
    temporary.replace(config)
    result = {"ok": True, "changed": True, "previous_backend": previous,
              "backend": "local", "backup": str(backup / "config.yaml"),
              "context_tokens": context_tokens,
              "original_sha256": hashlib.sha256(raw).hexdigest(),
              "config_sha256": hashlib.sha256(config.read_bytes()).hexdigest(),
              "approval_policy_unchanged": True,
              "note": "Local commands execute on this computer; existing command approvals remain in force."}
    (backup / "change.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description="Explicitly use Hermes's existing local terminal instead of Docker.")
    parser.add_argument("--local", action="store_true", required=True)
    parser.add_argument("--home", default=str(Path.home() / "AppData/Local/hermes"))
    parser.add_argument("--data-dir", default=str(ROOT / ".local"))
    parser.add_argument("--context-tokens", type=int, choices=(65536, 131072))
    args = parser.parse_args()
    print(json.dumps(use_local_backend(args.home, args.data_dir, args.context_tokens), ensure_ascii=False))


if __name__ == "__main__":
    main()
