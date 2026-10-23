"""Offline mixed-mode boundaries: real SQLite and actual Core routing, no cloud calls."""
import json
import threading
import time
import unittest

from test_core_backend import offline_core, wait_until
import test_core_privacy as privacy


class ConversationModeTests(unittest.TestCase):
    setUp = privacy.PrivacyTests.setUp
    tearDown = privacy.PrivacyTests.tearDown
    conversation = privacy.PrivacyTests.conversation
    send = privacy.PrivacyTests.send

    def switch(self, conversation, mode, **values):
        return self.core.dispatch('conversation.set_mode', {'id': conversation['id'], 'mode': mode, **values})

    def restart(self):
        self.core.shutdown()
        time.sleep(.03)
        if self.core._tasks is not None:
            self.core._tasks.close()
        self.core.db.close()
        self.core = offline_core(self.directory.name, memory=self.memory, ollama=self.local,
                         providers=self.providers, work=self.work)

    def test_switch_keeps_identity_and_persists_exact_timeline_positions(self):
        conversation = self.conversation()
        self.assertFalse(conversation['has_private'])
        self.assertEqual(conversation['mode_revision'], 0)
        changed = self.switch(conversation, 'private', expected_revision=0)
        self.assertEqual(changed['conversation']['id'], conversation['id'])
        self.assertEqual(changed['conversation']['mode_revision'], 1)
        self.assertIsNone(changed['mode_events'][0]['after_message_id'])
        self.assertEqual(changed['mode_events'][0]['message_index'], 0)
        self.assertFalse(changed['conversation']['has_private'])
        unchanged = self.switch(conversation, 'private', expected_revision=1)
        self.assertEqual(unchanged, changed)
        job = self.send(conversation, 'PRIVATE_TURN')
        self.assertTrue(next(event for event in job.events if event['type'] == 'done')['conversation']['has_private'])
        changed = self.switch(conversation, 'daily', expected_revision=1)
        messages = self.core.messages(conversation['id'])
        self.assertEqual(changed['mode_events'][1]['after_message_id'], messages[-1]['id'])
        self.assertEqual(changed['mode_events'][1]['message_index'], len(messages))
        self.assertEqual(changed['conversation']['mode'], 'daily')
        self.assertTrue(changed['conversation']['has_private'])
        self.assertEqual(len(self.core.conversations()), 1)
        self.assertEqual([entry['mode'] for entry in changed['mode_events']], ['private', 'daily'])
        fetched = self.core.dispatch('conversation.get', {'id': conversation['id']})
        self.assertEqual(fetched['mode_events'], changed['mode_events'])
        self.assertEqual(fetched['messages'], messages)

    def test_daily_after_private_sends_only_public_context_to_cloud(self):
        conversation = self.conversation()
        self.memory.remember('PRIVATE_MEMORY_CANARY', scope='private')
        self.send(conversation, 'PUBLIC_OPENING_CANARY')
        self.switch(conversation, 'private')
        self.send(conversation, 'PRIVATE_SOURCE_CANARY')
        private_context = json.dumps(self.local.prompts[-1], ensure_ascii=False)
        self.assertIn('PUBLIC_OPENING_CANARY', private_context)
        self.assertIn('PRIVATE_MEMORY_CANARY', private_context)
        self.switch(conversation, 'daily')
        query_start = len(self.memory.queries)
        self.send(conversation, 'PUBLIC_FOLLOWUP_CANARY')
        cloud = json.dumps(self.providers.calls[-1]['messages'], ensure_ascii=False)
        for canary in ('PUBLIC_OPENING_CANARY', 'PUBLIC_FOLLOWUP_CANARY', 'CLOUD_PUBLIC_REPLY'):
            self.assertIn(canary, cloud)
        for canary in ('PRIVATE_SOURCE_CANARY', 'LOCAL_PRIVATE_REPLY_CANARY', 'PRIVATE_MEMORY_CANARY'):
            self.assertNotIn(canary, cloud)
        self.assertTrue(all(scope == 'shared' for _, scope in self.memory.queries[query_start:]))
        messages = self.core.messages(conversation['id'])
        self.assertEqual([item['privacy'] for item in messages], ['shared', 'shared', 'private', 'private', 'shared', 'shared'])

    def test_restart_never_reclassifies_public_turns_from_current_private_mode(self):
        conversation = self.conversation()
        self.send(conversation, 'PUBLIC_BEFORE_SWITCH')
        self.switch(conversation, 'private')
        before = self.core.messages(conversation['id'])
        self.restart()
        self.assertEqual(self.core.messages(conversation['id']), before)
        self.assertEqual(self.core.conversation(conversation['id'])['mode'], 'private')
        self.assertFalse(self.core.conversation(conversation['id'])['has_private'])
        self.send(conversation, 'PRIVATE_AFTER_RESTART')
        self.switch(conversation, 'daily')
        before = self.core.messages(conversation['id'])
        events = self.core.mode_events(conversation['id'])
        self.restart()
        self.assertEqual(self.core.messages(conversation['id']), before)
        self.assertEqual(self.core.mode_events(conversation['id']), events)
        self.assertEqual(self.core.conversation(conversation['id'])['mode_revision'], 2)
        self.assertTrue(self.core.conversation(conversation['id'])['has_private'])

    def test_long_private_section_does_not_erase_previous_public_context_window(self):
        conversation = self.conversation()
        self.send(conversation, 'PUBLIC_BEFORE_LONG_PRIVATE_SECTION')
        self.switch(conversation, 'private')
        for number in range(11):
            self.send(conversation, f'PRIVATE_SECTION_{number}')
        self.switch(conversation, 'daily')
        self.send(conversation, 'PUBLIC_AFTER_LONG_PRIVATE_SECTION')
        prompt = json.dumps(self.providers.calls[-1]['messages'], ensure_ascii=False)
        self.assertIn('PUBLIC_BEFORE_LONG_PRIVATE_SECTION', prompt)
        self.assertIn('PUBLIC_AFTER_LONG_PRIVATE_SECTION', prompt)
        self.assertNotIn('PRIVATE_SECTION_', prompt)
        self.assertNotIn('LOCAL_PRIVATE_REPLY_CANARY', prompt)

    def test_legacy_fixed_mode_rows_are_classified_once_before_mixed_modes(self):
        daily, private = self.conversation(), self.conversation('private')
        with self.core.lock:
            self.core.db.execute("DELETE FROM config WHERE key='message_privacy_v5_migrated'")
            for identity, conversation, text in [('old-public', daily, 'LEGACY_PUBLIC'), ('old-private', private, 'LEGACY_PRIVATE')]:
                self.core.db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)',
                    (identity, conversation['id'], 'user', text, '2020-01-01', 'completed'))
            self.core.db.commit()
        self.restart()
        self.assertEqual(self.core.messages(daily['id'])[0]['privacy'], 'shared')
        self.assertEqual(self.core.messages(private['id'])[0]['privacy'], 'private')
        self.assertFalse(self.core.conversation(daily['id'])['has_private'])
        self.assertTrue(self.core.conversation(private['id'])['has_private'])
        self.switch(daily, 'private')
        self.switch(private, 'daily')
        self.restart()
        self.assertEqual(self.core.messages(daily['id'])[0]['privacy'], 'shared')
        self.assertEqual(self.core.messages(private['id'])[0]['privacy'], 'private')

    def test_active_generation_cannot_change_mode_or_assistant_scope(self):
        entered, release = threading.Event(), threading.Event()
        def paused(*args):
            entered.set()
            release.wait(2)
            yield 'PRIVATE_DELAYED_REPLY'
        self.local.stream = paused
        conversation = self.conversation('private')
        result = self.core.dispatch('chat.send', {'conversation_id': conversation['id'], 'content': 'PRIVATE_SOURCE', 'expected_mode_revision': 0})
        try:
            self.assertTrue(entered.wait(1))
            self.assertTrue(result['conversation']['has_private'])
            with self.assertRaisesRegex(ValueError, '等待回答'):
                self.switch(conversation, 'daily')
            self.assertEqual(self.core.mode_events(conversation['id']), [])
        finally:
            release.set()
        wait_until(lambda: self.core.job(result['job_id']).done)
        self.assertTrue(all(message['privacy'] == 'private' for message in self.core.messages(conversation['id'])))
        self.switch(conversation, 'daily')
        self.assertTrue(self.core.conversation(conversation['id'])['has_private'])

    def test_mode_revision_rejects_delayed_speech_even_after_mode_roundtrip(self):
        conversation = self.conversation()
        self.switch(conversation, 'private')
        self.switch(conversation, 'daily')
        for invalid in (0, True, -1, '2', None):
            with self.assertRaises(ValueError):
                self.core.dispatch('chat.send', {'conversation_id': conversation['id'], 'content': 'DELAYED_SPEECH', 'expected_mode_revision': invalid})
        self.assertEqual(self.core.messages(conversation['id']), [])
        self.assertEqual(self.providers.calls, [])
        result = self.core.dispatch('chat.send', {'conversation_id': conversation['id'], 'content': 'CURRENT_SPEECH', 'expected_mode_revision': 2})
        wait_until(lambda: self.core.job(result['job_id']).done)
        self.assertEqual(len(self.providers.calls), 1)
        with self.assertRaises(ValueError):
            self.switch(conversation, 'private', expected_revision=1)
        self.assertEqual(self.core.conversation(conversation['id'])['mode'], 'daily')

    def test_switch_expires_pending_secret_without_exposing_held_content(self):
        conversation = self.conversation()
        self.send(conversation, '只存私密：HELD_SOURCE_CANARY')
        pending = self.core.pending_secret(conversation['id'])
        self.switch(conversation, 'private')
        self.assertIsNone(self.core.pending_secret(conversation['id']))
        with self.assertRaises(ValueError):
            self.core.dispatch('memory.confirm', {'conversation_id': conversation['id'], 'pending_id': pending['id'], 'decision': 'confirm'})
        self.switch(conversation, 'daily')
        self.send(conversation, '公开的新问题')
        prompt = json.dumps(self.providers.calls[-1]['messages'], ensure_ascii=False)
        self.assertNotIn('HELD_SOURCE_CANARY', prompt)
        self.assertNotIn('LOCAL_PRIVATE_REPLY_CANARY', prompt)
        self.assertTrue(all(message['memory_hold'] for message in self.core.messages(conversation['id'])[:2]))
        self.assertEqual(self.memory.items, [])

    def test_switch_during_secret_save_waits_for_exact_private_write(self):
        entered, release = threading.Event(), threading.Event()
        original = self.memory.remember
        def paused(*args, **kwargs):
            entered.set()
            release.wait(2)
            return original(*args, **kwargs)
        self.memory.remember = paused
        conversation = self.conversation()
        self.send(conversation, '只存私密：一封旧信')
        pending = self.core.pending_secret(conversation['id'])
        outcomes = []
        thread = threading.Thread(target=lambda: outcomes.append(self.core.dispatch('memory.confirm',
            {'conversation_id': conversation['id'], 'pending_id': pending['id'], 'decision': 'confirm'})))
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            with self.assertRaisesRegex(ValueError, '正在保存'):
                self.switch(conversation, 'private')
        finally:
            release.set()
            thread.join(2)
        self.assertEqual(outcomes[0]['state'], 'confirmed')
        self.assertEqual(self.memory.items[0]['scope'], 'private')
        self.switch(conversation, 'private')

    def test_private_task_origin_stays_blocked_after_returning_daily(self):
        conversation = self.conversation('private')
        private = self.send(conversation, '让Codex处理PRIVATE_TASK_CANARY')
        # Defense at restart/start as well as at offer; a persisted receipt must
        # not become public merely because the current mode later changed.
        task = self.core.tasks().offer(conversation['id'], private.user_message['id'],
            private.user_message['content'], 'codex')
        self.switch(conversation, 'daily')
        with self.assertRaises(ValueError):
            self.core.dispatch('chat.task.start', {'conversation_id': conversation['id'],
                'task_id': task['task_id'], 'target': {'kind': 'codex', 'id': 'selected-target'}})
        self.assertEqual(self.work.calls, [])
        self.send(conversation, '让Hermes整理公开任务PUBLIC_TASK_CANARY')
        self.assertEqual(len(self.work.calls), 1)
        self.assertEqual(self.work.calls[0][0], '让Hermes整理公开任务PUBLIC_TASK_CANARY')
        self.assertNotIn('PRIVATE_TASK_CANARY', self.work.calls[0][0])

    def test_delayed_fact_extraction_keeps_original_private_scope(self):
        entered, release = threading.Event(), threading.Event()
        evidence = '我把旧信藏在蓝盒里'
        def extract(model, text):
            entered.set()
            release.wait(2)
            self.assertEqual(text, evidence)
            return [{'category': 'private_fact', 'evidence': evidence}]
        self.local.extract = extract
        conversation = self.conversation('private')
        self.send(conversation, evidence)
        try:
            self.assertTrue(entered.wait(1))
            self.switch(conversation, 'daily')
        finally:
            release.set()
        wait_until(lambda: any(event['scope'] == 'private' for event in self.memory.items))
        self.assertEqual(len(self.memory.items), 1)
        self.assertTrue(all(event['scope'] == 'private' for event in self.memory.items))


if __name__ == '__main__':
    unittest.main()
