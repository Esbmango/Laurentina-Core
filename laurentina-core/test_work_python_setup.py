from pathlib import Path
import os
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
            before["terminal"]["shell_init_files"].append(str((data / "work-runtime/python-env.sh").resolve()))
            self.assertEqual(after, before)
            self.assertEqual(yaml.safe_load((Path(result["backup_directory"]) / "config.yaml").read_text())["approval"], {"enabled": True})
            self.assertTrue((data / "work-runtime/bin/python3").is_file())
            self.assertFalse(install(home, data, python)["changed"])
            self.assertTrue(result["windows_path_unchanged"])

    def test_equivalent_absolute_init_path_is_preserved_without_duplicate_or_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home, data = root / "Hermes profile with spaces", root / "Core data with spaces"
            home.mkdir()
            python = root / "python.exe"
            python.write_bytes(b"test-only-file-not-executed")
            config = home / "config.yaml"
            config.write_text(yaml.safe_dump({"terminal": {"backend": "local", "shell_init_files": ["existing.sh"]},
                                             "approval": {"enabled": True}}), encoding="utf-8")
            install(home, data, python)
            init = (data / "work-runtime/python-env.sh").resolve()
            aliases = [str(init.parent) + os.sep + ".." + os.sep + "work-runtime" + os.sep + init.name]
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes
                short_path = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
                short_path.argtypes = (wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD)
                short_path.restype = wintypes.DWORD
                buffer = ctypes.create_unicode_buffer(32768)
                count = short_path(str(init), buffer, len(buffer))
                self.assertGreater(count, 0)
                self.assertLess(count, len(buffer))
                self.assertTrue(Path(buffer.value).samefile(init))
                aliases.append(buffer.value)
            expected_init = init.read_bytes()
            backups = sorted((data / "backups").iterdir())
            for alias in aliases:
                with self.subTest(alias=alias):
                    saved = yaml.safe_load(config.read_text(encoding="utf-8"))
                    saved["terminal"]["shell_init_files"] = ["existing.sh", alias]
                    config.write_text(yaml.safe_dump(saved), encoding="utf-8")
                    original = config.read_bytes()
                    result = install(home, data, python)
                    self.assertFalse(result["changed"])
                    self.assertEqual(config.read_bytes(), original)
                    self.assertEqual(init.read_bytes(), expected_init)
                    self.assertEqual(sorted((data / "backups").iterdir()), backups)

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
