"""A closed desktop must not leave the venv inference server behind."""
import json
import os
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
        readers = []
        stderr = bytearray()
        stderr_lock = threading.Lock()

        def drain_stderr():
            try:
                while chunk := child.stderr.read1(4096):
                    with stderr_lock:
                        stderr.extend(chunk)
                        del stderr[:-65536]
            except (OSError, ValueError):
                pass

        def diagnostic():
            with stderr_lock:
                tail = bytes(stderr).decode("utf-8", errors="replace")
            return f"Core exit status: {child.poll()}\nstderr (last 64 KiB):\n{tail or '<empty>'}"

        try:
            with tempfile.TemporaryDirectory(dir=folder) as data:
                env = {**os.environ, "LAURENTINA_CORE_HOME": str(root),
                       "LAURENTINA_MEMORY_HOME": str(root.parent / "hy-memory-starter"),
                       "LAURENTINA_CORE_DATA": data,
                       "LAURENTINA_MEMORY_DATA": str(Path(data) / "memory"),
                       # Parent-process lifecycle does not require the optional
                       # memory server. Keep its post-start health check from
                       # starting a separate service or reading user settings.
                       "LAURENTINA_MEMORY_PYTHON": str(Path(data) / "unavailable-memory-python")}
                # A startup stall must leave its actual stack in the CI log,
                # while the existing 20-second readiness deadline stays fixed.
                launcher = """
import faulthandler
import os
import sys
faulthandler.enable()
faulthandler.dump_traceback_later(10, repeat=False)
script = sys.argv.pop(1)
sys.path.insert(0, os.path.dirname(script))
import core_backend
original_init = core_backend.CoreHTTP.__init__
def initialized(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    # Core plus the bound HTTP endpoint are now ready. Leave stdout untouched.
    faulthandler.cancel_dump_traceback_later()
core_backend.CoreHTTP.__init__ = initialized
try:
    core_backend.main()
finally:
    faulthandler.cancel_dump_traceback_later()
"""
                child = subprocess.Popen([sys.executable, "-E", "-s", "-X", "utf8", "-c", launcher,
                    str(root / "core_backend.py"),
                    "--data-dir", data, "--parent-pid", str(parent.pid)], stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, creationflags=flags, env=env, cwd=root)
                output = queue.Queue()
                readers = [threading.Thread(target=lambda: output.put(child.stdout.readline(65536)), daemon=True),
                           threading.Thread(target=drain_stderr, daemon=True)]
                for reader in readers:
                    reader.start()
                try:
                    line = output.get(timeout=20)
                except queue.Empty:
                    self.fail("Core did not announce readiness within 20 seconds.\n" + diagnostic())
                try:
                    startup = json.loads(line)
                except (ValueError, UnicodeError):
                    # Wait only for already-failing process diagnostics, never
                    # to extend the readiness deadline or retry startup.
                    readers[1].join(timeout=0.2)
                    self.fail("Core exited or returned invalid startup JSON.\n" + diagnostic())
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
                for reader in readers:
                    reader.join(timeout=1)
                child.stdout.close()
                child.stderr.close()


if __name__ == "__main__":
    unittest.main()
