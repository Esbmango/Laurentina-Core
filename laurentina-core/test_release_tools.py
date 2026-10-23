"""Release privacy, installation preservation and independent launcher tests."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parent


def module(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    loaded = importlib.util.module_from_spec(spec)
    loader.exec_module(loaded)
    return loaded


PACK = module("release_packer", ROOT / "scripts/pack_release.py")
MEMORY = module("release_memory_initializer", ROOT / "scripts/configure_local_memory.py")
SDK = module("release_sdk_installer", ROOT / "scripts/install_avatar_runtimes.py")


class ReleaseToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self):
        core = self.base / "live/core"
        core.mkdir(parents=True)
        (core / "scripts").mkdir()
        (core / "docs").mkdir()
        (core.parent / "hy-memory-starter").mkdir()
        (core / "package.json").write_text('{"version":"0.9.1"}')
        (core / "README.md").write_text("public readme")
        (core / "docs/HYMEMORY.md").write_text("public memory docs")
        (core / "core_safe.py").write_text("print('public')")
        (core / ".local").mkdir()
        (core / ".local/secret.txt").write_text("must never ship")
        manifest = {"core": ["core_*.py", "package.json", "README.md", "docs/*.md"], "memory": [],
                    "root_files": {"README.md": "README.md"}, "excluded": ["private data"]}
        (core / "scripts/release_manifest.json").write_text(json.dumps(manifest))
        (core / ".gitignore").write_text(".local/\n")
        return core

    def test_actual_allowlist_excludes_private_files_and_sdk_binaries(self):
        files, _ = PACK.collect(ROOT)
        self.assertIn(".github/workflows/ci.yml", files)
        self.assertIn("laurentina-core/scripts/release/github/workflows/ci.yml", files)
        self.assertIn("laurentina-core/package-lock.json", files)
        self.assertEqual(files["hy-memory-starter/README.md"], ROOT / "docs/HYMEMORY.md")
        for relative in files:
            self.assertFalse(set(Path(relative).parts) & PACK.BLOCKED, relative)
            self.assertNotIn("ui/avatars/vendor/", relative)
            self.assertNotIn("DELIVERY", relative)
        self.assertIn("laurentina-core/assets/vendor/avatar-runtimes.json", files)

    def test_staging_is_independent_hashed_and_refuses_overwrite(self):
        core = self.fixture()
        target = self.base / "release/Laurentina-Core-v0.9.1-source"
        before = (core / "core_safe.py").read_bytes()
        result = PACK.build(target, core)
        self.assertEqual(result["version"], "0.9.1")
        self.assertEqual(Path(result["archive"]).resolve(), Path(str(target) + ".zip").resolve())
        manifest = json.loads((target / "RELEASE-MANIFEST.json").read_text())
        for entry in manifest["files"]:
            payload = (target / entry["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(payload).hexdigest(), entry["sha256"])
            self.assertNotIn(".local/", entry["path"])
        self.assertEqual(before, (core / "core_safe.py").read_bytes())
        self.assertEqual((target / "hy-memory-starter/README.md").read_text(), "public memory docs")
        with zipfile.ZipFile(result["archive"]) as archive:
            self.assertTrue(all(name.startswith(target.name + "/") for name in archive.namelist()))
        with self.assertRaises(ValueError):
            PACK.build(target, core)
        with self.assertRaises(ValueError):
            PACK.build(core / "release", core)

    def test_sensitive_code_aborts_before_creating_stage(self):
        core = self.fixture()
        (core / "core_safe.py").write_text('root = "C:' + '\\Users\\' + 'somebody\\private"')
        output = self.base / "release/private-leak"
        with self.assertRaisesRegex(ValueError, "personal absolute path"):
            PACK.build(output, core)
        self.assertFalse(output.exists())

    def test_explicit_bad_paths_rejected(self):
        path = self.base / "safe.py"
        path.write_text("# source")
        for relative in (Path(".local/x.py"), Path("sources/x.py"), Path("node_modules/x.py")):
            with self.assertRaises(ValueError):
                PACK.audit(path, relative)

    def test_memory_initializer_preserves_existing_configuration(self):
        memory = self.base / "memory"
        (memory / ".local").mkdir(parents=True)
        saved = memory / ".local/config.dpapi"
        saved.write_bytes(b"existing encrypted settings")
        result = MEMORY.initialize(memory)
        self.assertFalse(result["created"])
        self.assertEqual(saved.read_bytes(), b"existing encrypted settings")
        self.assertFalse((memory / ".local/hermes-integration.json").exists())

    def test_memory_initializer_creates_standalone_scope_and_rolls_back_failure(self):
        memory = self.base / "memory"

        class Store:
            def __init__(self, directory):
                self.directory = directory

            def save(self, config):
                self.directory.joinpath("config.dpapi").write_text(json.dumps(config))

        fake_app = types.SimpleNamespace(DEFAULTS={}, ConfigStore=Store)
        with mock.patch.dict("sys.modules", {"app": fake_app}):
            result = MEMORY.initialize(memory)
        self.assertTrue(result["created"])
        profile = json.loads((memory / ".local/hermes-integration.json").read_text())
        self.assertEqual(profile["profile_kind"], "standalone")
        self.assertEqual(len(profile["scope"]), 32)
        self.assertNotIn("hermes_home", profile)
        # A failed profile write must not leave a half-initialized encrypted config.
        another = self.base / "another"
        original_replace = Path.replace

        def failed_replace(path, target):
            if path.name == "hermes-integration.tmp":
                raise OSError("simulated rename failure")
            return original_replace(path, target)

        with mock.patch.dict("sys.modules", {"app": fake_app}), mock.patch.object(Path, "replace", failed_replace):
            with self.assertRaises(OSError):
                MEMORY.initialize(another)
        self.assertFalse((another / ".local/config.dpapi").exists())

    def test_launcher_prefers_project_electron_and_preserves_explicit_python(self):
        with mock.patch.dict(os.environ, {"LAURENTINA_CORE_DATA": str(self.base / "data")}):
            launcher = module("portable_launcher", ROOT / "launch.pyw")
        core = self.base / "core"
        binary = core / "node_modules/electron/dist/electron.exe"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"test")
        python = self.base / "custom/python.exe"
        python.parent.mkdir()
        python.write_bytes(b"test")
        runtime, interpreter = launcher.runtime_paths(core, {"LOCALAPPDATA": str(self.base), "LAURENTINA_CORE_PYTHON": str(python)})
        self.assertEqual(runtime, binary)
        self.assertEqual(interpreter, python)
        with self.assertRaisesRegex(RuntimeError, "missing file"):
            launcher.runtime_paths(core, {"LAURENTINA_ELECTRON": str(self.base / "missing.exe")})

    def test_sdk_mismatch_leaves_existing_runtime_untouched(self):
        core = self.base / "sdk"
        (core / "assets/vendor").mkdir(parents=True)
        target = core / "ui/avatars/vendor/spine-player-3.8.js"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"existing")
        lock = {"runtimes": [{"file": "ui/avatars/vendor/spine-player-3.8.js", "source": "https://example.invalid/spine.js", "sha256": "0" * 64}]}
        (core / "assets/vendor/avatar-runtimes.json").write_text(json.dumps(lock))
        with mock.patch.object(SDK, "fetch", return_value=b"wrong bytes"):
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                SDK.install(core)
        self.assertEqual(target.read_bytes(), b"existing")


if __name__ == "__main__":
    unittest.main()
