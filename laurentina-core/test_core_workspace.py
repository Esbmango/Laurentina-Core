import unittest
import test_core_backend as fixtures


class WorkspaceTests(unittest.TestCase):
    setUp = fixtures.CoreTests.setUp
    tearDown = fixtures.CoreTests.tearDown
    # Reuse the existing isolated Core fixture without inheriting its checks.
    def test_projects_preferences_persist_without_changing_private_history(self):
        core = self.core
        project = core.dispatch('project.create', {'name': '私人项目'})
        conv = core.dispatch('conversation.create', {'mode': 'private', 'project_id': project['id']})
        core.dispatch('conversation.organize', {'id': conv['id'], 'pinned': True})
        core.dispatch('project.pin', {'id': project['id'], 'pinned': True})
        core.dispatch('workspace.preferences.save', {'theme': 'light', 'language': 'en'})
        value = core.dispatch('workspace.get')
        self.assertEqual(value['conversation_meta'][conv['id']], {'project_id': project['id'], 'pinned': True})
        self.assertTrue(value['projects'][0]['pinned'])
        self.assertEqual(value['preferences'], {'theme': 'light', 'language': 'en'})
        self.assertEqual(core.conversation(conv['id'])['mode'], 'private')
        self.assertEqual(self.memory.items, [])
        self.assertEqual(self.model.prompts, [])
        core.dispatch('conversation.delete', {'id': conv['id']})
        self.assertNotIn(conv['id'], core.dispatch('workspace.get')['conversation_meta'])

    def test_invalid_project_and_preferences_do_not_partially_write(self):
        before = len(self.core.conversations())
        with self.assertRaises(ValueError):
            self.core.dispatch('conversation.create', {'project_id': 'project_' + 'f'*32})
        self.assertEqual(len(self.core.conversations()), before)
        with self.assertRaises(ValueError):
            self.core.dispatch('workspace.preferences.save', {'theme': 'light', 'language': 'bad'})
        self.assertEqual(self.core.dispatch('workspace.get')['preferences']['theme'], 'dark')
        conv = self.core.dispatch('conversation.create', {})
        with self.assertRaises(ValueError):
            self.core.dispatch('conversation.organize', {'id': conv['id'], 'pinned': 'true'})


if __name__ == '__main__':
    unittest.main()
