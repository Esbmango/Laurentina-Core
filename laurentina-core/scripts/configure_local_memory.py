"""Initialize a fresh local memory profile without requiring a Hermes install."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

CORE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CORE))
from core_platform import project_home, project_data
MEMORY = project_home("memory", CORE.parent / "hy-memory-starter")


def initialize(memory=None, *, model="qwen3.5:9b", embedding="qwen3-embedding:0.6b", hermes_home=None, data_dir=None):
    # Explicit source roots in installation tests remain self-contained.
    directory = Path(data_dir) if data_dir is not None else (Path(memory) / ".local" if memory is not None else project_data("memory", MEMORY))
    memory = Path(memory or MEMORY)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / "initialize.lock").open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                if not lock.read(1): lock.write(b"0"); lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return {"created": False, "reason": "Memory initialization already in progress."}
        try:
            return _initialize(memory, directory, model=model, embedding=embedding, hermes_home=hermes_home)
        finally:
            if os.name == "nt":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _initialize(memory, directory, *, model, embedding, hermes_home):
    # Never change existing encrypted settings or re-key an existing namespace.
    config_path = directory / "config.dpapi"
    profile_path = directory / "hermes-integration.json"
    if config_path.exists() or profile_path.exists():
        return {"created": False, "reason": "Existing memory configuration preserved."}
    sys.path.insert(0, str(memory))
    import app
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    scope = (hashlib.sha256(os.path.normcase(str(Path(hermes_home).resolve())).encode()).hexdigest()[:32]
             if hermes_home else uuid.uuid4().hex)
    profile = {"scope": scope, "profile_kind": "hermes" if hermes_home else "standalone"}
    if hermes_home:
        profile["hermes_home"] = str(Path(hermes_home).resolve())
    config = {**app.DEFAULTS, "preset": "local", "mode": "pro",
              "llm_url": "http://127.0.0.1:11434/v1", "llm_model": model, "llm_key": "ollama",
              "embed_url": "http://127.0.0.1:11434/v1", "embed_model": embedding,
              "embed_key": "ollama", "dimensions": 1024}
    app.ConfigStore(directory).save(config)
    temporary = profile_path.with_suffix(".tmp")
    try:
        temporary.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        temporary.replace(profile_path)
    except BaseException:
        # Roll back only the config this fresh initialization just created.
        config_path.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)
        raise
    return {"created": True, "profile_kind": profile["profile_kind"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initialize", action="store_true", required=True)
    parser.add_argument("--model", default="qwen3.5:9b")
    parser.add_argument("--embedding", default="qwen3-embedding:0.6b")
    parser.add_argument("--hermes-home")
    args = parser.parse_args()
    print(json.dumps(initialize(model=args.model, embedding=args.embedding, hermes_home=args.hermes_home)))


if __name__ == "__main__":
    main()
