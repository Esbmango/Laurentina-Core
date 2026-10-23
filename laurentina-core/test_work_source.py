"""Workspace-only installer checks; never modifies the actual Hermes home."""
import json
from pathlib import Path
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import yaml

from core_work import protect_work_key
from install_work_source import install, _put


class WorkSourceTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent / ".local/test-work"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temp.name)
        self.home, self.data = self.root / "hermes", self.root / "core"
        self.home.mkdir()
        self.data.mkdir()
        # A portable fixture exercises comments and YAML sequences without
        # reading the developer's real account configuration on CI or locally.
        self.config = '''# Preserve this user's independent model choice.
model:
  default: example-local-model
terminal:
  backend: local
  cwd: .
platform_toolsets:
  cli: [terminal, memory]
plugins:
  # Existing plugins must remain enabled.
  enabled:
  - unrelated_plugin
  disabled: []
gateway:
  api_server:
    enabled: false
    # Keep unrelated gateway options.
    timeout: 120
'''
        (self.home / "config.yaml").write_text(self.config, encoding="utf-8")
        self.key = "test-core-secret-source-only-0123456789"
        value = {"url": "http://127.0.0.1:12345", "key_dpapi": protect_work_key(self.key),
            "model_name": "laurentina-core"}
        (self.data / "hermes-api.json").write_text(json.dumps(value), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_preserves_config_comments_and_unrelated_values_and_is_idempotent(self):
        result = install(self.data, self.home)
        self.assertTrue(result["changed"])
        self.assertEqual((Path(result["backup"]) / "config.yaml").read_text(encoding="utf-8"), self.config)
        changed = (self.home / "config.yaml").read_text(encoding="utf-8")
        before, after = yaml.safe_load(self.config), yaml.safe_load(changed)
        self.assertEqual(before["model"], after["model"])
        self.assertEqual(before["terminal"], after["terminal"])
        self.assertEqual(before["platform_toolsets"], after["platform_toolsets"])
        self.assertTrue(all(line in changed for line in self.config.splitlines() if line.lstrip().startswith("#")))
        self.assertNotIn(self.key, changed)
        plugin = (self.home / "plugins/laurentina_work/__init__.py").read_text(encoding="utf-8")
        compile(plugin, "native-secret-source", "exec")
        self.assertNotIn(self.key, plugin)
        self.assertFalse(install(self.data, self.home)["changed"])

    def test_existing_other_primary_key_is_never_replaced(self):
        (self.home / ".env").write_text("API_SERVER_KEY=another-existing-user-key\n", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "不会覆盖"):
            install(self.data, self.home)
        self.assertEqual((self.home / "config.yaml").read_text(encoding="utf-8"), self.config)
        self.assertFalse((self.home / "plugins/laurentina_work").exists())

    def test_native_source_only_decrypts_own_key_for_exact_primary_profile(self):
        install(self.data, self.home)
        code = (self.home / "plugins/laurentina_work/__init__.py").read_text(encoding="utf-8")
        class Result:
            def __init__(self):
                self.secrets, self.error = {}, None
            def fail(self, error, kind):
                self.error = error
                return self
        base = ModuleType("agent.secret_sources.base")
        base.SecretSource, base.FetchResult = object, Result
        base.ErrorKind = SimpleNamespace(NOT_CONFIGURED="config", AUTH_FAILED="auth", INTERNAL="internal")
        modules = {"agent": ModuleType("agent"), "agent.secret_sources": ModuleType("agent.secret_sources"),
            "agent.secret_sources.base": base}
        context = {"__name__": "isolated_native_source"}
        with patch.dict("sys.modules", modules):
            exec(compile(code, "isolated_native_source", "exec"), context)
        source = context["LaurentinaWorkSource"]()
        config = {"connection_file": str(self.data / "hermes-api.json")}
        result = source.fetch(config, self.home)
        self.assertIsNone(result.error)
        self.assertEqual(set(result.secrets), {"API_SERVER_KEY"})
        self.assertTrue(result.secrets["API_SERVER_KEY"] == self.key)
        self.assertTrue(source.fetch(config, self.home / "profiles/other").error)
        self.assertTrue(source.fetch({"connection_file": str(self.data / "other.json")}, self.home).error)


if __name__ == "__main__":
    unittest.main(verbosity=2)
