"""Give Hermes a real 64K Ollama model alias without altering daily Qwen."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from urllib.request import ProxyHandler, Request, build_opener

import yaml

from core_work import _NoRedirect
from install_work_source import _put

ROOT = Path(__file__).resolve().parent
SOURCE = "qwen3.5:9b"
ALIAS = "laurentina-work-qwen35-64k:latest"


def configure(home, data_dir):
    home, data_dir = Path(home).resolve(), Path(data_dir).resolve()
    config, connection = home / "config.yaml", data_dir / "hermes-api.json"
    original = config.read_text(encoding="utf-8-sig")
    before = yaml.safe_load(original)
    model = before.get("model", {}) if isinstance(before, dict) else {}
    if (model.get("default") not in (SOURCE, ALIAS)
            or str(model.get("base_url", "")).rstrip("/") != "http://127.0.0.1:11434/v1"):
        raise RuntimeError("此辅助设置仅适用于现有本地 Qwen 工作连接，原配置未改动。")
    opener = build_opener(ProxyHandler({}), _NoRedirect())

    def request(path, payload):
        req = Request("http://127.0.0.1:11434" + path,
                      data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with opener.open(req, timeout=60) as response:
            return json.loads(response.read(2_000_000))

    source = request("/api/show", {"model": SOURCE})
    if "tools" not in source.get("capabilities", []):
        raise RuntimeError("当前本地 Qwen 没有声明工具能力，未创建工作别名。")
    # Ollama's OpenAI transport ignores per-request context size. Persist the
    # parameter in a separate manifest which reuses the existing local weights.
    created = request("/api/create", {"model": ALIAS, "from": SOURCE,
                                      "parameters": {"num_ctx": 65536}, "stream": False})
    if created.get("status") != "success":
        raise RuntimeError("本地工作模型别名创建失败，Hermes 配置未改动。")
    alias = request("/api/show", {"model": ALIAS})
    if not any(line.split() == ["num_ctx", "65536"] for line in alias.get("parameters", "").splitlines()):
        raise RuntimeError("工作模型上下文未通过读回检查，Hermes 配置未改动。")
    expected = deepcopy(before)
    expected["model"].update(default=ALIAS, context_length=65536, ollama_num_ctx=65536)
    updated = original
    for key in ("default", "context_length", "ollama_num_ctx"):
        updated = _put(updated, ("model", key), expected["model"][key])
    if yaml.safe_load(updated) != expected:
        raise RuntimeError("配置保留检查失败，Hermes 配置未改动。")
    own = json.loads(connection.read_text(encoding="utf-8"))
    metadata = {**own, "model": ALIAS, "provider": "Hermes · 本地 Qwen（64K 工作窗口）"}
    if expected == before and metadata == own:
        return {"ok": True, "changed": False, "model": ALIAS, "context_tokens": 65536}
    backup = data_dir / "backups" / ("hermes-work-model-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(config, backup / "config.yaml")
    shutil.copy2(connection, backup / "hermes-api.json")
    temporary = config.with_name("config.laurentina-model.tmp")
    temporary.write_text(updated, encoding="utf-8")
    temporary.replace(config)
    temporary = connection.with_suffix(".tmp")
    temporary.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    temporary.replace(connection)
    return {"ok": True, "changed": True, "model": ALIAS, "context_tokens": 65536,
            "source_model": SOURCE, "backup_directory": str(backup),
            "daily_model_unchanged": True, "approval_policy_unchanged": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", default=str(Path.home() / "AppData/Local/hermes"))
    parser.add_argument("--data-dir", default=str(ROOT / ".local"))
    args = parser.parse_args()
    print(json.dumps(configure(args.home, args.data_dir), ensure_ascii=False))
