"""Start Laurentina with a project-local runtime or an explicit override."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("LAURENTINA_CORE_DATA", ROOT / ".local")).resolve()
DATA.mkdir(parents=True, exist_ok=True)


def runtime_paths(root=ROOT, environ=None):
    """Prefer portable installs; keep legacy discovery for existing desktops."""
    environ = os.environ if environ is None else environ
    local_app = Path(environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    explicit = environ.get("LAURENTINA_ELECTRON")
    candidates = ([Path(explicit).expanduser()] if explicit else []) + [
        root / "node_modules/electron/dist/electron.exe",
        root / ".runtime/electron/electron.exe",
        local_app / "hermes/hermes-agent/apps/desktop/node_modules/electron/dist/electron.exe",
    ]
    runtime = next((item for item in candidates if item.is_file()), None)
    if explicit and not Path(explicit).expanduser().is_file():
        raise RuntimeError("LAURENTINA_ELECTRON points to a missing file.")
    python = Path(environ.get("LAURENTINA_CORE_PYTHON") or
                  root.parent / "hy-memory-starter/.venv/Scripts/python.exe").expanduser()
    if not runtime:
        raise RuntimeError("Desktop runtime missing. Run Setup.cmd first. / 请先运行 Setup.cmd。")
    if not python.is_file():
        raise RuntimeError("Python environment missing. Run Setup.cmd first. / 请先运行 Setup.cmd。")
    return runtime, python


def main():
    # Refresh only when launched from an authenticated desktop executor; a
    # normal shortcut never guesses an app connection or reads other accounts.
    if os.environ.get("CODEX_APP_TOOLS_PIPE_PATH") and os.environ.get("CODEX_THREAD_ID"):
        try:
            sys.path.insert(0, str(ROOT.parent / "hy-memory-starter"))
            from desktop_link import capture_context
            capture_context()
        except Exception:
            pass  # Native Core/Hermes remain usable if the desktop bridge is offline.
    runtime, python = runtime_paths()
    env = dict(os.environ)
    for key in ("ELECTRON_RUN_AS_NODE", "PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
        env.pop(key, None)
    env["LAURENTINA_CORE_PYTHON"] = str(python.resolve())
    with (DATA / "launch.log").open("ab") as log:
        subprocess.Popen([str(runtime), str(ROOT)], cwd=ROOT, env=env,
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        (DATA / "launch-error.txt").write_text(str(error), encoding="utf-8")
        sys.exit(1)
