"""Provide Hermes Git Bash a real Python fallback without changing Windows PATH."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import shutil

import yaml

from install_work_source import _put

ROOT = Path(__file__).resolve().parent


def _same_init_path(value, expected):
    """Recognize native absolute aliases without changing user-written paths."""
    try:
        candidate = Path(value).expanduser()
        return candidate.is_absolute() and candidate.resolve() == expected.resolve()
    except (OSError, RuntimeError, ValueError):
        return False


def install(home, data_dir, python):
    home, data_dir, python = Path(home).resolve(), Path(data_dir).resolve(), Path(python).resolve()
    if not python.is_file() or python.name.lower() != "python.exe":
        raise ValueError("请选择已经存在的本机 Python 解释器。")
    config = home / "config.yaml"
    original = config.read_text(encoding="utf-8-sig")
    before = yaml.safe_load(original)
    if not isinstance(before, dict) or before.get("terminal", {}).get("backend") != "local":
        raise RuntimeError("此辅助设置仅用于明确选择的本机终端，原配置未改动。")
    existing = before["terminal"].get("shell_init_files", [])
    if not isinstance(existing, list) or not all(isinstance(value, str) for value in existing):
        raise RuntimeError("现有终端初始化设置格式不兼容，原配置未改动。")
    directory = data_dir / "work-runtime"
    bin_dir = directory / "bin"
    init = directory / "python-env.sh"
    files = list(existing)
    if not any(_same_init_path(value, init) for value in files):
        files.append(str(init))
    expected = deepcopy(before)
    expected["terminal"]["shell_init_files"] = files
    updated = _put(original, ("terminal", "shell_init_files"), files)
    if yaml.safe_load(updated) != expected:
        raise RuntimeError("配置保留检查失败，原配置未改动。")
    # A task which activates its own virtual environment retains that choice.
    launcher = ("#!/usr/bin/env bash\n"
                'if [ -n "${VIRTUAL_ENV:-}" ]; then\n'
                '  if [ -f "$VIRTUAL_ENV/Scripts/python.exe" ]; then exec "$VIRTUAL_ENV/Scripts/python.exe" "$@"; fi\n'
                '  if [ -f "$VIRTUAL_ENV/bin/python" ]; then exec "$VIRTUAL_ENV/bin/python" "$@"; fi\n'
                'fi\nexec ' + shlex.quote(python.as_posix()) + ' "$@"\n')
    # cygpath produces a colon-safe MSYS path; this runs only inside Git Bash.
    source = ('_laurentina_python_bin=$(cygpath -u ' + shlex.quote(bin_dir.as_posix()) + ')\n'
              'export PATH="$_laurentina_python_bin:$PATH"\nunset _laurentina_python_bin\n')
    changed = (expected != before or not init.is_file() or init.read_text(encoding="utf-8") != source
               or any(not (bin_dir / name).is_file() or (bin_dir / name).read_text(encoding="utf-8") != launcher
                      for name in ("python", "python3")))
    if not changed:
        return {"ok": True, "changed": False, "python": str(python)}
    backup = data_dir / "backups" / ("hermes-python-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(config, backup / "config.yaml")
    if directory.is_dir():
        shutil.copytree(directory, backup / "work-runtime")
    bin_dir.mkdir(parents=True, exist_ok=True)
    for name in ("python", "python3"):
        path = bin_dir / name
        path.write_text(launcher, encoding="utf-8", newline="\n")
        path.chmod(0o755)
    init.write_text(source, encoding="utf-8", newline="\n")
    temporary = config.with_name("config.laurentina-python.tmp")
    temporary.write_text(updated, encoding="utf-8")
    temporary.replace(config)
    return {"ok": True, "changed": True, "python": str(python), "shell_init_file": str(init),
            "backup_directory": str(backup), "windows_path_unchanged": True,
            "approval_policy_unchanged": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", default=str(Path.home() / "AppData/Local/hermes"))
    parser.add_argument("--data-dir", default=str(ROOT / ".local"))
    parser.add_argument("--python", default=str(ROOT.parent / "hy-memory-starter/.venv/Scripts/python.exe"))
    args = parser.parse_args()
    print(json.dumps(install(args.home, args.data_dir, args.python), ensure_ascii=False))
