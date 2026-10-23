"""Fetch public offline ASR/TTS models, verifying the source repository hashes."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen
from core_platform import project_home, project_data

HOME = project_home("core", Path(__file__).resolve().parent)
ROOT = (project_data("core", HOME) if sys.platform == "darwin" else HOME / ".local") / "models"
LOCK = Path(__file__).resolve().parent / "voice-models-lock.json"
SOURCES = [
    ("Systran/faster-whisper-base", "", "whisper-base", {"config.json", "model.bin", "tokenizer.json", "vocabulary.json", "vocabulary.txt", "preprocessor_config.json"}),
    ("rhasspy/piper-voices", "zh/zh_CN/huayan/medium", "piper", {"zh_CN-huayan-medium.onnx", "zh_CN-huayan-medium.onnx.json", "MODEL_CARD"}),
    ("rhasspy/piper-voices", "en/en_US/lessac/medium", "piper", {"en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json", "MODEL_CARD"}),
]


def read_json(url):
    with urlopen(Request(url, headers={"User-Agent": "Laurentina-Core-Setup/0.1"}), timeout=30) as response:
        return json.load(response)


def download_file(repo, revision, entry, folder, verify_only=False):
    relative = entry["path"]
    name = Path(relative).name
    if name == "MODEL_CARD":
        # Preserve both voice licenses/model cards without overwriting each other.
        name = relative.split("/")[-2] + "-" + relative.split("/")[-3] + "-MODEL_CARD.txt"
    destination = ROOT / folder / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    expected = entry.get("sha256") or entry.get("lfs", {}).get("oid")
    expected_size = entry.get("size")
    if destination.is_file() and destination.stat().st_size == expected_size:
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        if expected is None or digest == expected:
            print(f"Ready {destination.relative_to(ROOT)}", flush=True)
            return {"file": str(destination.relative_to(ROOT)), "bytes": destination.stat().st_size, "sha256": digest, "repository": repo, "revision": revision}
    if verify_only:
        raise RuntimeError(f"Missing or mismatched pinned model: {destination.relative_to(ROOT)}")
    partial = destination.with_name(destination.name + ".part")
    url = f"https://huggingface.co/{repo}/resolve/{revision}/{relative}?download=true"
    for attempt in range(3):
        try:
            digest = hashlib.sha256()
            count = 0
            with urlopen(Request(url, headers={"User-Agent": "Laurentina-Core-Setup/0.1"}), timeout=90) as response, partial.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    digest.update(chunk)
                    count += len(chunk)
            if expected_size is not None and count != expected_size:
                raise RuntimeError("Model download has an unexpected size")
            if expected and digest.hexdigest() != expected:
                raise RuntimeError("Model checksum does not match its source")
            partial.replace(destination)
            print(f"Downloaded {destination.relative_to(ROOT)} ({count // 1024} KB)", flush=True)
            return {"file": str(destination.relative_to(ROOT)), "bytes": count, "sha256": digest.hexdigest(), "repository": repo, "revision": revision}
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true", help="Check all pinned model hashes without network requests")
    args = parser.parse_args()
    tasks = []
    locked = json.loads(LOCK.read_text(encoding="utf-8"))
    for item in locked:
        repo, revision, relative = item["repository"], item["revision"], item["source_path"]
        match = next((source for source in SOURCES if source[0] == repo
                     and relative.rsplit("/", 1)[0] == source[1]
                     and Path(relative).name in source[3]), None) if "/" in relative else next((source for source in SOURCES if source[0] == repo and source[1] == "" and relative in source[3]), None)
        if not match or not re.fullmatch(r"[0-9a-f]{40}", revision) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise RuntimeError("Model lock contains an invalid source or checksum")
        tasks.append((repo, revision, {"path": relative, "size": item["bytes"], "sha256": item["sha256"]}, match[2]))
    if len(tasks) != 10:
        raise RuntimeError("The pinned model manifest is incomplete")
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda task: download_file(*task, verify_only=args.verify_only), tasks))
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "manifest.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Offline speech model setup completed", flush=True)


if __name__ == "__main__":
    main()
