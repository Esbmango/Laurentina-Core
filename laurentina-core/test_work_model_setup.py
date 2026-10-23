import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yaml

from setup_ollama_work_model import ALIAS, configure


class Opener:
    def __init__(self, valid=True):
        self.calls = []
        self.valid = valid

    def open(self, req, timeout):
        payload = json.loads(req.data)
        self.calls.append((req.full_url, payload))
        if req.full_url.endswith("/create"):
            result = {"status": "success"}
        elif payload["model"] == ALIAS:
            result = {"parameters": "num_ctx 65536" if self.valid else "num_ctx 4096"}
        else:
            result = {"capabilities": ["tools", "completion"]}
        return io.BytesIO(json.dumps(result).encode())


class WorkModelSetupTests(unittest.TestCase):
    def test_local_alias_preserves_credentials_approvals_and_daily_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home, data = root / "hermes", root / "core"
            home.mkdir()
            data.mkdir()
            before = {"model": {"default": "qwen3.5:9b", "base_url": "http://127.0.0.1:11434/v1"},
                      "terminal": {"backend": "local"}, "approval": {"enabled": True}}
            (home / "config.yaml").write_text(yaml.safe_dump(before), encoding="utf-8")
            own = {"key_dpapi": "encrypted-test-opaque", "url": "http://127.0.0.1:12345", "model_name": "laurentina-core"}
            (data / "hermes-api.json").write_text(json.dumps(own), encoding="utf-8")
            opener = Opener()
            with patch("setup_ollama_work_model.build_opener", return_value=opener):
                result = configure(home, data)
            after = yaml.safe_load((home / "config.yaml").read_text())
            before["model"].update(default=ALIAS, context_length=65536, ollama_num_ctx=65536)
            self.assertEqual(after, before)
            metadata = json.loads((data / "hermes-api.json").read_text())
            self.assertEqual({k: metadata[k] for k in own}, own)
            self.assertEqual(metadata["model"], ALIAS)
            create = next(body for url, body in opener.calls if url.endswith("/create"))
            self.assertEqual(create["from"], "qwen3.5:9b")
            self.assertEqual(create["parameters"], {"num_ctx": 65536})
            self.assertTrue(result["daily_model_unchanged"])

    def test_wrong_endpoint_never_contacts_ollama_or_changes_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = 'model:\n  default: qwen3.5:9b\n  base_url: https://cloud.example/v1\n'
            (root / "config.yaml").write_text(raw, encoding="utf-8")
            with patch("setup_ollama_work_model.build_opener") as factory:
                with self.assertRaises(RuntimeError):
                    configure(root, root / "core")
                factory.assert_not_called()
            self.assertEqual((root / "config.yaml").read_text(), raw)


if __name__ == "__main__":
    unittest.main()
