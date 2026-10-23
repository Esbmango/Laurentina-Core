"""Configure the already-installed local models and restart only this app."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import Request, urlopen

import app
from launcher import existing_url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-home", required=True)
    args = parser.parse_args()
    home = Path(args.hermes_home).resolve()
    if not (home / "config.yaml").is_file():
        raise ValueError("The selected Hermes profile has no config.yaml")
    directory = app.DATA
    directory.mkdir(parents=True, exist_ok=True)
    store = app.ConfigStore(directory)
    current = store.load()
    scope = hashlib.sha256(os.path.normcase(str(home)).encode()).hexdigest()[:32]
    config = {**app.DEFAULTS, "preset": "local", "mode": "pro",
              "llm_url": "http://127.0.0.1:11434/v1", "llm_model": "qwen3.5:9b", "llm_key": "ollama",
              "embed_url": "http://127.0.0.1:11434/v1", "embed_model": "qwen3-embedding:0.6b",
              "embed_key": "ollama", "dimensions": 1024}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if store.path.exists() and current != config:
        backup = directory / "backups" / stamp
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(store.path, backup / "config.dpapi")
    url = existing_url()
    if url:
        with urlopen(url + "/api/status", timeout=3) as response:
            status = json.load(response)
        request = Request(url + "/api/shutdown", data=b"{}", headers={
            "Content-Type": "application/json", "X-HyMemory-Token": status["token"]})
        with urlopen(request, timeout=30) as response:
            json.load(response)
        for _ in range(100):
            if not existing_url():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("The previous local service did not stop")
    store.save(config)
    (directory / "hermes-integration.json").write_text(json.dumps({"scope": scope, "hermes_home": str(home)}, indent=2), encoding="utf-8")
    subprocess.run([sys.executable, "-B", "-X", "utf8", str(app.ROOT / "launcher.py"), "--no-browser"], check=True)
    print(json.dumps({"configured": "local Qwen + local Qwen Embedding", "scope": scope}), flush=True)


if __name__ == "__main__":
    main()
