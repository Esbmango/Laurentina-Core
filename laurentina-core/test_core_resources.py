"""Resource policy checks: offline, no GPU inference or real model unload."""
import copy
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from core_resources import MIB, ResourceManager, hardware_snapshot, pressure_for


def hardware(ram=4096, vram=4096):
    return {"ram": {"available": True, "total_bytes": 16384 * MIB, "available_bytes": ram * MIB,
                    "used_percent": 100 * (1 - ram / 16384)},
            "gpus": [{"index": 0, "total_bytes": 12288 * MIB, "used_bytes": (12288 - vram) * MIB,
                      "free_bytes": vram * MIB, "utilization_percent": 0}],
            "ollama": {"available": True, "models": [{"name": "other-users-model", "size_vram": 1024}]}}


class Clock:
    value = 0
    def __call__(self): return self.value


class FakeVoice:
    def __init__(self, clock):
        self.clock = clock
        self.calls = []
        self.loaded = {"asr": True, "piper": True}
        self.last = {"asr": 0, "piper": 0}
    def release_idle(self, **kwargs):
        self.calls.append(kwargs)
        released = []
        for resource, key in (("asr", "asr"), ("piper", "tts")):
            if self.loaded[resource] and not kwargs["keep_" + key] and self.clock() - self.last[resource] >= kwargs[key + "_idle_seconds"]:
                self.loaded[resource] = False
                released.append(resource)
        return {"released": released}


class FakeProfiles:
    def __init__(self, clock):
        self.clock, self.loaded, self.busy = clock, True, False
        self.calls = []
    def release_idle(self, idle_seconds=300, keep_loaded=False):
        self.calls.append({"idle_seconds": idle_seconds, "keep_loaded": keep_loaded})
        released = self.loaded and not self.busy and not keep_loaded and self.clock() >= idle_seconds
        if released:
            self.loaded = False
        return {"released": released}


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="resources-")
        self.clock = Clock()
        self.sample = hardware()
        self.reads = 0
        def snapshot():
            self.reads += 1
            return copy.deepcopy(self.sample)
        self.manager = ResourceManager(self.temp.name, snapshotter=snapshot, clock=self.clock)
    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def test_settings_persist_and_invalid_settings_preserve_preset(self):
        self.assertEqual(self.manager.settings(), {"preset": "balanced"})
        self.manager.save_settings({"preset": "low_memory"})
        for payload in ({"preset": "fast"}, {"prompt": "PRIVATE"}, None):
            with self.assertRaises(ValueError):
                self.manager.save_settings(payload)
        other = ResourceManager(self.temp.name)
        self.assertEqual(other.settings(), {"preset": "low_memory"})

    def test_hardware_cache_is_five_seconds_and_results_are_copied(self):
        first = self.manager.status()
        first["hardware"]["ollama"]["models"].clear()
        self.assertEqual(len(self.manager.status()["hardware"]["ollama"]["models"]), 1)
        self.assertEqual(self.reads, 1)
        self.clock.value = 5
        self.manager.status()
        self.assertEqual(self.reads, 2)

    def test_ram_and_vram_are_independent_budgets_unavailable_is_not_zero(self):
        self.assertEqual(pressure_for(hardware(ram=400))["reasons"], ["ram_low"])
        self.assertEqual(pressure_for(hardware(vram=200))["reasons"], ["vram_low"])
        self.assertEqual(pressure_for(hardware(ram=400, vram=200))["level"], "critical")
        self.assertEqual(pressure_for({"ram": {"available": False}, "gpus": []}), {"level": "unknown", "reasons": []})

    def test_runner_conflicts_warn_in_balanced_and_wait_in_low_memory(self):
        work = self.manager.begin("work", owner="hermes", model="owned-work:latest")
        self.assertTrue(self.manager.admission("chat", model="qwen3.5:9b")["allowed"])
        self.manager.save_settings({"preset": "low_memory"})
        result = self.manager.admission("chat", model="qwen3.5:9b")
        self.assertFalse(result["allowed"])
        self.assertEqual(result["choices"], ["wait", "retry"])
        self.clock.value = 100000
        self.assertFalse(self.manager.admission("chat", model="qwen3.5:9b")["allowed"], "long-running leases must not expire")
        self.manager.end(work)
        self.assertTrue(self.manager.admission("chat", model="qwen3.5:9b")["allowed"])

    def test_review_busy_is_independent_of_completed_work_lease(self):
        self.manager.save_settings({"preset": "low_memory"})
        work = self.manager.begin("work")
        self.manager.end(work)
        result = self.manager.admission("chat", background={"known": True, "idle": False})
        self.assertFalse(result["allowed"])
        self.assertIn("background_review_busy", result["reasons"])

    def test_continuous_protects_both_voice_caches_and_custom_voice(self):
        voice, profiles = FakeVoice(self.clock), FakeProfiles(self.clock)
        self.manager.save_settings({"preset": "low_memory"})
        self.clock.value = 10000
        self.manager.set_continuous(True)
        self.assertEqual(self.manager.maintain(voice, profiles)["released"], [])
        self.assertTrue(voice.calls[-1]["keep_asr"])
        self.assertTrue(voice.calls[-1]["keep_tts"])
        self.assertTrue(profiles.calls[-1]["keep_loaded"])
        self.manager.set_continuous(False)
        self.assertEqual(set(self.manager.maintain(voice, profiles)["released"]), {"asr", "piper", "custom_tts"})

    def test_low_memory_reclaims_idle_caches_with_ttl_not_every_sentence(self):
        voice, profiles = FakeVoice(self.clock), FakeProfiles(self.clock)
        self.manager.save_settings({"preset": "low_memory"})
        self.clock.value = 89
        self.assertEqual(self.manager.maintain(voice, profiles)["released"], [])
        self.clock.value = 100
        self.assertEqual(self.manager.maintain(voice, profiles)["released"], ["asr"])
        self.clock.value = 180
        self.assertEqual(self.manager.maintain(voice, profiles)["released"], ["piper"])
        self.clock.value = 300
        self.assertEqual(self.manager.maintain(voice, profiles)["released"], ["custom_tts"])

    def test_critical_pressure_keeps_custom_warm_grace_and_busy_profiles(self):
        profiles = FakeProfiles(self.clock)
        self.sample = hardware(ram=100, vram=100)
        self.manager.save_settings({"preset": "low_memory"})
        self.clock.value = 80
        self.assertEqual(self.manager.maintain(profiles=profiles)["released"], [])
        self.assertGreaterEqual(profiles.calls[-1]["idle_seconds"], 90)
        self.clock.value = 100
        profiles.busy = True
        self.assertEqual(self.manager.maintain(profiles=profiles)["released"], [])
        profiles.busy = False
        self.assertEqual(self.manager.maintain(profiles=profiles)["released"], ["custom_tts"])

    def test_active_stage_preserves_its_cache(self):
        voice = FakeVoice(self.clock)
        lease = self.manager.begin("asr")
        self.clock.value = 10000
        self.assertEqual(self.manager.maintain(voice=voice)["released"], ["piper"])
        self.manager.end(lease)
        self.assertEqual(self.manager.maintain(voice=voice)["released"], ["asr"])

    def test_low_memory_allocator_policy_applies_to_next_voice_request(self):
        voice = FakeVoice(self.clock)
        policies = []
        voice.set_resource_preset = policies.append
        self.manager.save_settings({"preset": "low_memory"})
        self.manager.maintain(voice=voice)
        self.assertEqual(policies, ["low_memory"])

    def test_unknown_custom_release_is_deferred_never_call_unsafe_stop(self):
        class OldProfiles:
            def stop_service(self): raise AssertionError("unsafe stop must not run")
        result = self.manager.maintain(profiles=OldProfiles())
        self.assertIn("custom_tts_safe_release_unavailable", result["deferred"])

    def test_unowned_nonexclusive_unknown_review_and_active_models_not_unloaded(self):
        with patch("core_resources._local_json", return_value={"done": True, "done_reason": "unload"}) as request:
            self.assertFalse(self.manager.release_owned_model("other-users-model")["released"])
            self.manager.register_owned_model("shared", exclusive=False)
            self.assertFalse(self.manager.release_owned_model("shared", {"known": True, "idle": True})["released"])
            self.manager.register_owned_model("dedicated", exclusive=True)
            self.assertEqual(self.manager.release_owned_model("dedicated")["reason"], "background_state_unknown")
            self.assertFalse(self.manager.release_owned_model("dedicated", {"known": True, "idle": False})["released"])
            lease = self.manager.begin("chat")
            self.assertFalse(self.manager.release_owned_model("dedicated", {"known": True, "idle": True})["released"])
            request.assert_not_called()
            self.manager.end(lease)
            self.assertTrue(self.manager.release_owned_model("dedicated", {"known": True, "idle": True})["released"])
            request.assert_called_once_with("/api/generate", {"model": "dedicated", "keep_alive": 0})

    def test_maintenance_never_automatically_unloads_ollama(self):
        self.clock.value = 100000
        self.manager.register_owned_model("dedicated", exclusive=True)
        with patch("core_resources._local_json") as request:
            self.manager.maintain(background={"known": True, "idle": True})
            request.assert_not_called()

    def test_metadata_has_no_text_content_and_owner_validation_rejects_payloads(self):
        for owner in ("a secret sentence", "line\nbreak", {"text": "private"}):
            with self.assertRaises(ValueError):
                self.manager.begin("chat", owner=owner)
        self.manager.begin("chat", owner="core", model="qwen3.5:9b")
        activity = self.manager.status()["activities"][0]
        self.assertEqual(set(activity), {"stage", "owner", "model", "elapsed_seconds"})

    def test_daemon_maintains_without_opening_settings_and_closes(self):
        event = threading.Event()
        class Voice:
            def release_idle(self, **kwargs):
                event.set()
                return {"released": []}
        self.manager.start(voice_provider=lambda: Voice(), interval=0.05)
        self.assertTrue(event.wait(2))
        self.manager.close()
        self.assertFalse(self.manager.thread.is_alive())

    def test_telemetry_queries_are_read_only_bounded_and_project_only_metadata(self):
        from types import SimpleNamespace
        with patch("core_resources.shutil.which", return_value="nvidia-smi"), \
             patch("core_resources.subprocess.run", return_value=SimpleNamespace(stdout="0,12288,1000,11288,1\n")) as run, \
             patch("core_resources._local_json", return_value={"models": [{"name": "model", "size_vram": 100, "context_length": 16384, "prompt": "PRIVATE_CANARY"}]} ) as request:
            result = hardware_snapshot()
        self.assertEqual(request.call_args.args, ("/api/ps",))
        self.assertEqual(run.call_args.kwargs["timeout"], 2)
        self.assertNotIn("PRIVATE_CANARY", repr(result))
        self.assertEqual(set(result["ollama"]["models"][0]), {"name", "size_vram", "context_length"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
