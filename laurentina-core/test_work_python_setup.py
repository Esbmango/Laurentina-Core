from pathlib import Path
import tempfile
import unittest

import yaml

from setup_work_python import install


class WorkPythonSetupTests(unittest.TestCase):
    def test_native_fallback_preserves_other_init_files_and_approval_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home, data = root / "hermes", root / "core"
            home.mkdir()
            python = root / "runtime with spaces/python.exe"
            python.parent.mkdir()
            python.write_bytes(b"test-only-file-not-executed")
            before = {"terminal": {"backend": "local", "shell_init_files": ["existing.sh"], "cwd": "."},
                      "approval": {"enabled": True}, "model": {"default": "qwen"}}
            (home / "config.yaml").write_text(yaml.safe_dump(before), encoding="utf-8")
            result = install(home, data, python)
            after = yaml.safe_load((home / "config.yaml").read_text())
            before["terminal"]["shell_init_files"].append(str(data / "work-runtime/python-env.sh"))
            self.assertEqual(after, before)
            self.assertEqual(yaml.safe_load((Path(result["backup_directory"]) / "config.yaml").read_text())["approval"], {"enabled": True})
            self.assertTrue((data / "work-runtime/bin/python3").is_file())
            self.assertFalse(install(home, data, python)["changed"])
            self.assertTrue(result["windows_path_unchanged"])

    def test_container_backend_remains_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python = root / "python.exe"
            python.write_bytes(b"test-only")
            config = root / "config.yaml"
            raw = 'terminal:\n  backend: docker\n'
            config.write_text(raw, encoding="utf-8")
            with self.assertRaises(RuntimeError):
                install(root, root / "core", python)
            self.assertEqual(config.read_text(), raw)
            self.assertFalse((root / "core").exists())


if __name__ == "__main__":
    unittest.main()
