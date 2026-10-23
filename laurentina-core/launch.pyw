"""Start Laurentina with a project-local runtime or an explicit override."""
from pathlib import Path
import os
import subprocess
import sys
from core_platform import project_home, project_data, runtime_python, subprocess_options

ROOT = project_home("core", Path(__file__).resolve().parent)
DATA = project_data("core", ROOT)
DATA.mkdir(parents=True, exist_ok=True)


def runtime_paths(root=ROOT, environ=None):
    """Prefer portable installs; keep legacy discovery for existing desktops."""
    environ = os.environ if environ is None else environ
    local_app = Path(environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    explicit = environ.get("LAURENTINA_ELECTRON")
    if sys.platform == "darwin":
        portable = [root / "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
                    root / ".runtime/electron/Electron.app/Contents/MacOS/Electron"]
    elif sys.platform == "win32":
        portable = [root / "node_modules/electron/dist/electron.exe", root / ".runtime/electron/electron.exe",
                    local_app / "hermes/hermes-agent/apps/desktop/node_modules/electron/dist/electron.exe"]
    else:
        portable = [root / "node_modules/electron/dist/electron", root / ".runtime/electron/electron"]
    candidates = ([Path(explicit).expanduser()] if explicit else []) + portable
    runtime = next((item for item in candidates if item.is_file()), None)
    if explicit and not Path(explicit).expanduser().is_file():
        raise RuntimeError("LAURENTINA_ELECTRON points to a missing file.")
    python = runtime_python("core", root, environ=environ)
    if not runtime:
        raise RuntimeError("Desktop runtime missing. Run Setup.cmd or Setup.command first. / 请先安装桌面运行环境。")
    if not python.is_file():
        raise RuntimeError("Python environment missing. Run Setup.cmd or Setup.command first. / 请先安装 Python 运行环境。")
    return runtime, python


def main():
    # Refresh only when launched from an authenticated desktop executor; a
    # normal shortcut never guesses an app connection or reads other accounts.
    if os.environ.get("CODEX_APP_TOOLS_PIPE_PATH") and os.environ.get("CODEX_THREAD_ID"):
        try:
            sys.path.insert(0, str(project_home("memory", ROOT.parent / "hy-memory-starter")))
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
                         **subprocess_options(), close_fds=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        (DATA / "launch-error.txt").write_text(str(error), encoding="utf-8")
        sys.exit(1)
