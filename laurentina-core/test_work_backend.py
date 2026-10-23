import json
from pathlib import Path
import tempfile
import unittest

import yaml

from setup_work_backend import use_local_backend


class BackendTests(unittest.TestCase):
    def test_local_change_preserves_every_other_setting_and_exact_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "hermes"
            home.mkdir()
            config = home / "config.yaml"
            raw = b'# retained comment\nterminal:\n  backend: "docker"\n  cwd: "."\napproval:\n  enabled: true\nmodel:\n  default: qwen\n'
            config.write_bytes(raw)
            result = use_local_backend(home, root / "core")
            after = yaml.safe_load(config.read_text())
            before = yaml.safe_load(raw)
            before["terminal"]["backend"] = "local"
            self.assertEqual(after, before)
            self.assertIn("# retained comment", config.read_text())
            self.assertEqual(Path(result["backup"]).read_bytes(), raw)
            second = use_local_backend(home, root / "core")
            self.assertFalse(second["changed"])
            self.assertEqual(len(list((root / "core/backups").iterdir())), 1)

    def test_invalid_mapping_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.yaml"
            config.write_text('terminal: "invalid"\n', encoding="utf-8")
            with self.assertRaises(RuntimeError):
                use_local_backend(root, root / "core")
            self.assertEqual(config.read_text(), 'terminal: "invalid"\n')
            self.assertFalse((root / "core").exists())

    def test_explicit_context_only_updates_ollama_window_and_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.yaml"
            before = {"terminal": {"backend": "local", "cwd": "."},
                      "model": {"default": "qwen3.5:9b", "base_url": "http://127.0.0.1:11434/v1"},
                      "approval": {"enabled": True}}
            config.write_text(yaml.safe_dump(before), encoding="utf-8")
            result = use_local_backend(root, root / "core", 65536)
            before["model"].update(context_length=65536, ollama_num_ctx=65536)
            self.assertEqual(yaml.safe_load(config.read_text()), before)
            self.assertTrue(result["approval_policy_unchanged"])
            with self.assertRaises(ValueError):
                use_local_backend(root, root / "core", 4096)


if __name__ == "__main__":
    unittest.main()
