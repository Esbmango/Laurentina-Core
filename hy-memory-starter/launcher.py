"""Start once, then open the local page. No shell or administrator access needed."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent


def existing_url():
    try:
        connection = json.loads((ROOT / ".local" / "connection.json").read_text(encoding="utf-8"))
        url = connection["url"]
        if not url.startswith("http://127.0.0.1:"):
            return None
        with urlopen(url + "/api/status", timeout=1) as response:
            status = json.load(response)
        if status.get("app") == "Laurentina-HyMemory-Starter" and status.get("workspace") == str(ROOT):
            return url
    except (OSError, ValueError, KeyError):
        pass
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = existing_url()
    if not url:
        directory = ROOT / ".local"
        directory.mkdir(exist_ok=True)
        env = dict(os.environ)
        for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
            env.pop(key, None)
        with (directory / "server.log").open("ab") as log:
            process = subprocess.Popen([sys.executable, "-E", "-s", "-X", "utf8", str(ROOT / "app.py")], cwd=ROOT,
                                       env=env,
                                       stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        for _ in range(80):
            time.sleep(0.15)
            url = existing_url()
            if url:
                break
            if process.poll() is not None:
                raise RuntimeError("Server could not start. Check .local/server.log.")
    if not url:
        raise RuntimeError("Local server did not become ready within 12 seconds.")
    print(url)
    if not args.no_browser:
        webbrowser.open(url)


if __name__ == "__main__":
    main()
