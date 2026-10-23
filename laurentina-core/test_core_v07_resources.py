"""Check user-visible boundaries between Core and its resource manager."""
import tempfile
import unittest
from pathlib import Path

from core_backend import Core
from core_resources import ResourceManager
from test_core_backend import Memory, Model


class ResourceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.core = Core(Path(self.directory.name), memory=Memory(), ollama=Model())
        self.manager = ResourceManager(self.directory.name, snapshotter=lambda: {
            'ram': {'available': True, 'total_bytes': 16 * 1024**3, 'available_bytes': 8 * 1024**3},
            'gpus': [], 'ollama': {'available': False, 'models': []}})
        self.core._resources = self.manager

    def tearDown(self):
        self.core.shutdown()
        self.core.db.close()
        self.directory.cleanup()

    def test_old_microphone_cleanup_cannot_release_new_session(self):
        action = lambda name, enabled: self.core.dispatch('resources.continuous', {'session_id': name, 'enabled': enabled})
        action('old', True)
        action('new', True)
        action('old', False)
        self.assertTrue(self.manager.status()['continuous'])
        action('old', True)  # Late start acknowledgment for an already closed mic.
        action('new', False)
        self.assertFalse(self.manager.status()['continuous'])

    def test_stop_before_start_does_not_keep_a_closed_microphone_warm(self):
        self.core.dispatch('resources.continuous', {'session_id': 'closed', 'enabled': False})
        self.core.dispatch('resources.continuous', {'session_id': 'closed', 'enabled': True})
        self.assertFalse(self.manager.status()['continuous'])

    def test_memory_preference_reaches_the_next_voice_request_without_waiting_for_maintenance(self):
        calls=[]
        class Voice:
            def set_resource_preset(self, value): calls.append(value)
        self.core._voice=Voice()
        self.core.dispatch('resources.settings.save', {'preset':'low_memory'})
        self.core.dispatch('resources.settings.save', {'preset':'balanced'})
        self.assertEqual(calls,['low_memory','balanced'])

    def test_recognition_failure_still_releases_its_activity(self):
        manager = self.manager
        class BrokenVoice:
            def transcribe(self, *_):
                self.stages = [item['stage'] for item in manager.status()['activities']]
                raise ValueError('invalid fixture audio')
        voice = self.core._voice = BrokenVoice()
        with self.assertRaisesRegex(ValueError, 'fixture'):
            self.core.dispatch('voice.transcribe', {'audio_base64': 'bad', 'mime_type': 'audio/wav'})
        self.assertEqual(voice.stages, ['asr'])
        self.assertEqual(manager.status()['activities'], [])

    def test_low_memory_defers_local_work_without_submitting_or_switching_models(self):
        self.manager.save_settings({'preset': 'low_memory'})
        self.manager.begin('chat', owner='fixture', model='qwen')
        class Runner:
            calls = 0
            def start(self, *_args, **_kwargs):
                self.calls += 1
                return {'run_id': 'external', 'status': 'running'}
        runner = self.core._work = Runner()
        with self.assertRaisesRegex(ValueError, '等它结束'):
            self.core.dispatch('work.start', {'content': 'Write a shared test report.', 'target': {'kind': 'hermes'}})
        self.assertEqual(runner.calls, 0)
        # Explicitly selected external work is still permitted; no implicit route.
        self.core.dispatch('work.start', {'content': 'Write a shared test report.', 'target': {'kind': 'codex', 'id': 'fixture'}})
        self.assertEqual(runner.calls, 1)


if __name__ == '__main__':
    unittest.main()
