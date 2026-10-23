"""A closed desktop must not leave the venv inference server behind."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest


class LifecycleTests(unittest.TestCase):
    def test_real_core_exits_when_owned_desktop_parent_exits(self):
        root = Path(__file__).resolve().parent
        folder = root / ".local" / "test-work"
        folder.mkdir(parents=True, exist_ok=True)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        parent = subprocess.Popen([sys.executable, "-E", "-s", "-c", "import sys;sys.stdin.buffer.read(1)"],
                                  stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        child = None
        try:
            with tempfile.TemporaryDirectory(dir=folder) as data:
                child = subprocess.Popen([sys.executable, "-E", "-s", "-X", "utf8", str(root / "core_backend.py"),
                    "--data-dir", data, "--parent-pid", str(parent.pid)], stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, creationflags=flags)
                output = queue.Queue()
                threading.Thread(target=lambda: output.put(child.stdout.readline()), daemon=True).start()
                startup = json.loads(output.get(timeout=20))
                self.assertGreater(startup["port"], 0)
                parent.stdin.close()
                self.assertEqual(parent.wait(timeout=5), 0)
                self.assertEqual(child.wait(timeout=15), 0)
        finally:
            if parent.poll() is None:
                parent.stdin.close()
                parent.wait(timeout=5)
            if child is not None:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                child.stdout.close()
                child.stderr.close()


if __name__ == "__main__":
    unittest.main()
