"""OS boundary checks. No personal secrets, downloads, or model inference."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import core_platform
from core_voice import VoiceBridge
from core_voice_profiles import VoiceProfiles

platform = core_platform._module


class PathsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="platform-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_mac_bundle_uses_explicit_homes_and_interpreter_without_writing_bundle(self):
        env = {"LAURENTINA_CORE_HOME": str(self.root / "App.app/Contents/Resources/app"),
               "LAURENTINA_MEMORY_HOME": str(self.root / "App.app/Contents/Resources/hy-memory-starter"),
               "LAURENTINA_MEMORY_PYTHON": str(self.root / "App.app/Contents/Resources/python/bin/python3")}
        self.assertEqual(platform.project_home("core", self.root, environ=env), Path(env["LAURENTINA_CORE_HOME"]))
        self.assertEqual(platform.project_home("memory", self.root, environ=env), Path(env["LAURENTINA_MEMORY_HOME"]))
        self.assertEqual(platform.runtime_python("memory", self.root, environ=env, platform="darwin"), Path(env["LAURENTINA_MEMORY_PYTHON"]))
        data = platform.project_data("core", self.root, environ={}, platform="darwin", home=self.root / "user")
        self.assertEqual(data, self.root / "user/Library/Application Support/LaurentinaCore/Core")
        self.assertEqual(platform.voice_environment(self.root, ".voice-venv", data=data, platform="darwin"), data / "runtimes/.voice-venv")
        self.assertFalse((self.root / "App.app").exists())

    def test_windows_defaults_and_legacy_voice_paths_remain_unchanged(self):
        self.assertEqual(platform.project_data("core", self.root, environ={}, platform="win32"), self.root / ".local")
        self.assertEqual(platform.venv_python(self.root / ".venv", platform="win32"), self.root / ".venv/Scripts/python.exe")
        self.assertEqual(platform.voice_environment(self.root, ".custom-voice-venv", data=self.root / "elsewhere", platform="win32"), self.root / ".custom-voice-venv")
        self.assertEqual(platform.python_site(self.root, platform="win32"), self.root / "Lib/site-packages")

    def test_mac_voice_metadata_uses_user_runtime_and_models(self):
        with patch.object(platform.sys, "platform", "darwin"):
            voice = VoiceBridge(self.root / "private-data", root_dir=self.root / "readonly-bundle")
            profiles = VoiceProfiles(self.root / "private-data", root_dir=self.root / "readonly-bundle")
            self.assertEqual(voice.python, self.root / "private-data/runtimes/.voice-venv/bin/python")
            self.assertEqual(profiles.python, self.root / "private-data/runtimes/.custom-voice-venv/bin/python")
            self.assertEqual(voice.asr_model, self.root / "private-data/models/whisper-base")
            self.assertEqual(profiles.model_path.parent, self.root / "private-data/models")
        self.assertFalse((self.root / "readonly-bundle").exists())

    def test_mac_electron_bundle_discovery_ignores_windows_executable(self):
        source = Path(__file__).resolve().parent / "launch.pyw"
        loader = importlib.machinery.SourceFileLoader("platform_launch_test", str(source))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        launch = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"LAURENTINA_CORE_DATA": str(self.root / "launch-data")}):
            loader.exec_module(launch)
        root = self.root / "portable"
        binary = root / "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
        python = root.parent / "hy-memory-starter/.venv/bin/python"
        for file in (binary, python, root / "node_modules/electron/dist/electron.exe"):
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"test-only")
        with patch.object(platform.sys, "platform", "darwin"):
            actual = launch.runtime_paths(root, {})
        self.assertEqual(actual, (binary, python))

    def test_mac_ram_snapshot_uses_page_size_and_does_not_double_count_purgeable(self):
        import core_resources
        output = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages inactive: 20.\nPages speculative: 3.\nPages purgeable: 11.\n"
        with patch.object(platform.sys, "platform", "darwin"), patch("core_resources.subprocess.run", side_effect=[
            SimpleNamespace(stdout=str(16 * 1024 ** 3)), SimpleNamespace(stdout=output)]):
            snapshot = core_resources._ram_snapshot()
        self.assertEqual(snapshot["available_bytes"], 33 * 16384)
        self.assertTrue(snapshot["unified_memory"])
        self.assertTrue(snapshot["estimated"])

    def test_default_mac_initialization_stays_in_user_data_and_preserves_existing_config(self):
        path = Path(__file__).resolve().parent / "scripts/configure_local_memory.py"
        spec = importlib.util.spec_from_file_location("platform_memory_initialize_test", path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        directory = self.root / "user-data"
        stored = []
        class Store:
            def __init__(self, root): self.root = root
            def save(self, value):
                stored.append(value)
                (self.root / "config.dpapi").write_bytes(b"test-encrypted-marker")
        fake = SimpleNamespace(DEFAULTS={}, ConfigStore=Store)
        with patch.dict("sys.modules", {"app": fake}), patch.object(module, "project_data", return_value=directory):
            first = module.initialize()
            profile = (directory / "hermes-integration.json").read_bytes()
            second = module.initialize()
        self.assertTrue(first["created"]); self.assertFalse(second["created"])
        self.assertEqual(len(stored), 1)
        self.assertEqual((directory / "hermes-integration.json").read_bytes(), profile)
        self.assertEqual(stored[0]["llm_url"], "http://127.0.0.1:11434/v1")
        self.assertEqual(stored[0]["embed_url"], "http://127.0.0.1:11434/v1")

    def test_installed_hermes_transport_preserves_bundled_python_and_user_data(self):
        source = Path(__file__).resolve().parent.parent / "hy-memory-starter/hermes_plugin/__init__.py"
        spec = importlib.util.spec_from_file_location("platform_hermes_adapter_test", source)
        module = importlib.util.module_from_spec(spec)
        fake = SimpleNamespace(MemoryProvider=object, RecallStatus=object, spawn_context_thread=lambda *a, **k: None)
        with patch.dict("sys.modules", {"agent.memory_provider": fake, "platform_support": platform}):
            spec.loader.exec_module(module)
            transport = module.LocalTransport(self.root / "Bundle.app/Contents/Resources/hy-memory-starter",
                python=self.root / "Bundle.app/Contents/Resources/python/bin/python3", data_dir=self.root / "private-memory")
        self.assertEqual(transport.python, self.root / "Bundle.app/Contents/Resources/python/bin/python3")
        self.assertEqual(transport.connection, self.root / "private-memory/connection.json")


class SecretTests(unittest.TestCase):
    def test_mac_secret_roundtrip_has_no_plaintext_or_cli_and_cannot_read_legacy_windows_blob(self):
        storage = {}
        fake = SimpleNamespace(add=lambda account, data: storage.__setitem__(account, data), read=lambda account: storage[account])
        data = b"platform-test-fixture-no-real-credential"
        with patch.object(platform.sys, "platform", "darwin"), patch.object(platform, "_Keychain", return_value=fake), patch("subprocess.Popen") as spawn, patch("subprocess.run") as run:
            sealed = platform.protect_bytes(data)
            self.assertNotIn(data, sealed)
            self.assertTrue(sealed.startswith(platform.KEYCHAIN_PREFIX))
            self.assertEqual(platform.protect_bytes(sealed, decrypt=True), data)
            with self.assertRaises(platform.SecretStoreError):
                platform.protect_bytes(b"old-windows-dpapi-fixture", decrypt=True)
            spawn.assert_not_called(); run.assert_not_called()

    def test_keychain_failure_is_closed_and_never_returns_plaintext(self):
        broken = SimpleNamespace(add=lambda *args: (_ for _ in ()).throw(platform.SecretStoreError("locked")))
        with patch.object(platform.sys, "platform", "darwin"), patch.object(platform, "_Keychain", return_value=broken):
            with self.assertRaises(platform.SecretStoreError):
                platform.protect_bytes(b"fixture-key")
            for reference in (platform.KEYCHAIN_PREFIX + b"../other", platform.KEYCHAIN_PREFIX + b"A" * 32):
                with self.assertRaises(platform.SecretStoreError):
                    platform.protect_bytes(reference, decrypt=True)

    def test_windows_cipher_format_is_not_rewrapped_or_migrated(self):
        with patch.object(platform.sys, "platform", "win32"), patch.object(platform, "_dpapi", return_value=b"legacy-dpapi-bytes") as crypt:
            self.assertEqual(platform.protect_bytes(b"fixture"), b"legacy-dpapi-bytes")
            crypt.assert_called_once_with(b"fixture", False)
            with self.assertRaises(platform.SecretStoreError):
                platform.protect_bytes(platform.KEYCHAIN_PREFIX + b"a" * 32, decrypt=True)

    @unittest.skipUnless(sys.platform == "win32", "Native Windows DPAPI")
    def test_native_windows_dpapi_current_user_roundtrip(self):
        source = b"Laurentina platform CI fixture"
        sealed = platform.protect_bytes(source)
        self.assertNotIn(source, sealed)
        self.assertEqual(platform.protect_bytes(sealed, decrypt=True), source)

    @unittest.skipUnless(sys.platform == "darwin", "Native macOS Keychain")
    def test_native_mac_keychain_roundtrip_and_exact_cleanup(self):
        source = b"Laurentina platform CI fixture"
        sealed = platform.protect_bytes(source)
        try:
            self.assertNotIn(source, sealed)
            self.assertEqual(platform.protect_bytes(sealed, decrypt=True), source)
        finally:
            platform._Keychain().delete(sealed[len(platform.KEYCHAIN_PREFIX):].decode("ascii"))


class ProcessTests(unittest.TestCase):
    def test_successful_group_kill_consumes_ownership_before_repeated_cleanup(self):
        process = SimpleNamespace(pid=47301, _laurentina_owned_group=47301,
            wait=Mock(return_value=0), poll=Mock(return_value=0))
        with patch.object(platform.sys, "platform", "darwin"), \
                patch.object(platform.signal, "SIGKILL", 9, create=True), \
                patch.object(platform.os, "getpgrp", return_value=19, create=True), \
                patch.object(platform.os, "killpg", create=True) as killpg, \
                patch.object(platform.subprocess, "run") as snapshot:
            platform.terminate_owned(process)
            self.assertEqual(process._laurentina_owned_group, None)
            self.assertEqual([call.args for call in killpg.call_args_list],
                [(47301, platform.signal.SIGTERM), (47301, platform.signal.SIGKILL)])
            platform.terminate_owned(process)
            self.assertEqual(killpg.call_count, 2)
            snapshot.assert_not_called()

    def test_darwin_cleanup_accepts_only_confirmed_zombie_or_absent_groups(self):
        for first_signal, output in ((False, "47301 Z\n19 S\n"), (True, "19 S\n")):
            with self.subTest(first_signal=first_signal):
                process = SimpleNamespace(pid=47301, _laurentina_owned_group=47301,
                    wait=Mock(return_value=0), poll=Mock(return_value=0))
                denied = PermissionError(1, "Operation not permitted")
                signals = [denied] if first_signal else [None, denied]
                with patch.object(platform.sys, "platform", "darwin"), \
                        patch.object(platform.signal, "SIGKILL", 9, create=True), \
                        patch.object(platform.os, "getpgrp", return_value=19, create=True), \
                        patch.object(platform.os, "killpg", side_effect=signals, create=True) as killpg, \
                        patch.object(platform.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)) as snapshot:
                    platform.terminate_owned(process)
                    self.assertEqual(process._laurentina_owned_group, None)
                    self.assertEqual([call.args[0] for call in killpg.call_args_list], [47301] * len(signals))
                    self.assertEqual(killpg.call_args_list[-1].args[1], platform.signal.SIGTERM if first_signal else platform.signal.SIGKILL)
                    snapshot.assert_called_once_with(["/bin/ps", "-ax", "-o", "pgid=", "-o", "stat="],
                        capture_output=True, text=True, timeout=2, check=False)
                    platform.terminate_owned(process)
                    self.assertEqual(killpg.call_count, len(signals), "dead group ID reused on repeated cleanup")

    def test_darwin_cleanup_does_not_hide_live_group_permission_or_snapshot_failure(self):
        snapshots = [SimpleNamespace(returncode=0, stdout="47301 S\n47301 Z\n"),
                     SimpleNamespace(returncode=1, stdout=""),
                     SimpleNamespace(returncode=0, stdout="unparseable\n"),
                     subprocess.TimeoutExpired("/bin/ps", 2)]
        for snapshot in snapshots:
            with self.subTest(snapshot=snapshot):
                process = SimpleNamespace(pid=47301, _laurentina_owned_group=47301,
                    wait=Mock(return_value=0), poll=Mock(return_value=0))
                result = {"side_effect": snapshot} if isinstance(snapshot, Exception) else {"return_value": snapshot}
                with patch.object(platform.sys, "platform", "darwin"), \
                        patch.object(platform.os, "getpgrp", return_value=19, create=True), \
                        patch.object(platform.os, "killpg", side_effect=PermissionError(1, "Operation not permitted"), create=True), \
                        patch.object(platform.subprocess, "run", **result):
                    with self.assertRaises(PermissionError):
                        platform.terminate_owned(process)
                self.assertEqual(process._laurentina_owned_group, 47301)

    def test_posix_cleanup_never_signals_current_or_unowned_groups(self):
        for owned_group in (None, 19):
            process = SimpleNamespace(pid=19, _laurentina_owned_group=owned_group,
                wait=Mock(return_value=0), poll=Mock(return_value=0))
            with patch.object(platform.sys, "platform", "darwin"), \
                    patch.object(platform.os, "getpgrp", return_value=19, create=True), \
                    patch.object(platform.os, "killpg", create=True) as killpg:
                platform.terminate_owned(process)
                killpg.assert_not_called()

    def test_real_worker_disables_bytecode_before_importing_source(self):
        from core_voice import ResidentWorker
        with tempfile.TemporaryDirectory(prefix="signed-source-") as directory:
            root = Path(directory)
            (root / "bundle_fixture.py").write_text("VALUE = 17\n", encoding="utf-8")
            script = root / "worker.py"
            script.write_text("\n".join([
                "import json,sys,bundle_fixture",
                "for line in sys.stdin:",
                " request=json.loads(line)",
                " print(json.dumps({'request_id':request['request_id'],'ok':True,'dont_write_bytecode':sys.dont_write_bytecode,'value':bundle_fixture.VALUE}),flush=True)",
            ]), encoding="utf-8")
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            worker = ResidentWorker(Path(sys.executable), script, root, "speak")
            try:
                reply = worker.request({}, 15)
                self.assertTrue(reply["dont_write_bytecode"])
                self.assertEqual(reply["value"], 17)
            finally:
                worker.cancel(close=True)
            self.assertEqual({path.name: path.read_bytes() for path in root.iterdir()}, before)

    def test_only_owned_posix_processes_request_a_new_session(self):
        self.assertEqual(platform.subprocess_options(owned=True, platform="darwin"), {"start_new_session": True})
        self.assertEqual(platform.subprocess_options(owned=False, platform="darwin"), {})
        self.assertNotIn("start_new_session", platform.subprocess_options(owned=True, platform="win32"))

    @unittest.skipIf(sys.platform == "win32", "Native POSIX process group")
    def test_owned_group_termination_reclaims_inference_grandchild(self):
        for ignores_term in (False, True):
            with self.subTest(ignores_term=ignores_term), tempfile.TemporaryDirectory(prefix="owned-session-") as directory:
                heartbeat = Path(directory) / "heartbeat"
                child = "import pathlib,signal,time; p=pathlib.Path(" + repr(str(heartbeat)) + ")\n"
                if ignores_term:
                    child += "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                child += "while True: p.write_text(str(time.monotonic())); time.sleep(.03)"
                parent = "import subprocess,sys,time; c=subprocess.Popen([sys.executable,'-c'," + repr(child) + "]);print(c.pid,flush=True);time.sleep(60)"
                process = platform.mark_owned(subprocess.Popen([sys.executable, "-c", parent], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **platform.subprocess_options(owned=True)))
                try:
                    grandchild_pid = int(process.stdout.readline())
                    self.assertGreater(grandchild_pid, 0)
                    deadline = time.monotonic() + 3
                    while not heartbeat.exists() and time.monotonic() < deadline:
                        time.sleep(.03)
                    self.assertTrue(heartbeat.exists())
                    platform.terminate_owned(process)
                    self.assertIsNotNone(process.poll())
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        state = subprocess.run(["/bin/ps", "-p", str(grandchild_pid), "-o", "stat="],
                            capture_output=True, text=True, timeout=2).stdout.strip()
                        if not state or state.startswith("Z"):
                            break
                        time.sleep(.03)
                    self.assertTrue(not state or state.startswith("Z"), "inference grandchild survived group cleanup")
                    before = heartbeat.read_bytes(); time.sleep(.15)
                    self.assertEqual(heartbeat.read_bytes(), before, "grandchild still running after owner cleanup")
                finally:
                    platform.terminate_owned(process)
                    process.stdout.close()

    @unittest.skipIf(sys.platform == "win32", "Native POSIX parent-death watchdog")
    def test_voice_worker_exits_after_abrupt_parent_death_without_loading_a_model(self):
        root = Path(__file__).resolve().parent
        script = "\n".join([
            "import pathlib,sys,time",
            "sys.path.insert(0," + repr(str(root)) + ")",
            "from core_voice import ResidentWorker",
            "worker=ResidentWorker(pathlib.Path(sys.executable),pathlib.Path(" + repr(str(root / "core_voice_worker.py")) + "),pathlib.Path(" + repr(str(root)) + "),'speak')",
            "reply=worker.request({'action':'unsupported-test-only'},10)",
            "assert reply['ok'] is False",
            "print(worker.process.pid,flush=True)",
            "while True:time.sleep(1)",
        ])
        parent = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        worker_pid = None
        try:
            worker_pid = int(parent.stdout.readline())
            self.assertGreater(worker_pid, 1)
            parent.kill(); parent.wait(timeout=3)
            deadline = time.monotonic() + 4
            state = "alive"
            while time.monotonic() < deadline:
                state = subprocess.run(["/bin/ps", "-p", str(worker_pid), "-o", "stat="], capture_output=True, text=True, timeout=2).stdout.strip()
                if not state or state.startswith("Z"):
                    break
                time.sleep(.1)
            self.assertTrue(not state or state.startswith("Z"), "owned idle worker survived abrupt Core exit")
        finally:
            if parent.poll() is None:
                parent.kill(); parent.wait(timeout=3)
            parent.stdout.close()
            if worker_pid:
                import signal
                try: os.killpg(worker_pid, signal.SIGKILL)
                except ProcessLookupError: pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
