"""Synthetic, offline cross-layer checks for v0.4 workspace/skill integration."""
import io
import unittest
import zipfile

from core_backend import Core
import test_core_privacy as privacy


class V04IntegrationTests(unittest.TestCase):
    setUp = privacy.PrivacyTests.setUp
    tearDown = privacy.PrivacyTests.tearDown
    conversation = privacy.PrivacyTests.conversation
    send = privacy.PrivacyTests.send

    def import_skill(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("synthetic-main/skills/report/SKILL.md", "---\nname: Report helper\ndescription: Synthetic skill\n---\nSKILL_INSTRUCTION_CANARY: produce a short report.\n")
            package.writestr("synthetic-main/skills/report/references/example.txt", "SYNTHETIC_RESOURCE")
        return self.core.skills().import_archive(
            archive.getvalue(), "https://github.com/example/synthetic/tree/" + "a" * 40,
            "a" * 40,
        )["items"][0]["id"]

    def restart(self):
        self.core.shutdown()
        if self.core._tasks is not None:
            self.core._tasks.close()
        self.core.db.close()
        self.core = Core(self.directory.name, memory=self.memory, ollama=self.local,
                         providers=self.providers, work=self.work)

    def test_selected_skill_reaches_work_without_private_or_previous_history(self):
        skill = self.import_skill()
        conversation = self.conversation()
        self.send(conversation, "只存私密：HISTORY_PRIVATE_CANARY")
        pending = self.core.pending_secret(conversation["id"])
        self.core.dispatch("memory.confirm", {"conversation_id": conversation["id"],
                           "pending_id": pending["id"], "decision": "cancel"})
        self.send(conversation, "PUBLIC_PREVIOUS_CANARY")
        model_calls = len(self.providers.calls)
        task_content = "整理这份公开报告 EXPLICIT_TASK_CANARY\n输出格式：只回复 PUBLIC_RESULT_MARKER。"
        self.send(conversation, task_content,
                  task_target={"kind": "hermes"}, skill_id=skill)
        self.assertEqual(len(self.work.calls), 1)
        body, kwargs = self.work.calls[0]
        self.assertIn("SKILL_INSTRUCTION_CANARY", body)
        self.assertIn("EXPLICIT_TASK_CANARY", body)
        self.assertIn("<selected_skill>", body)
        self.assertIn('<selected_skill>\n' + self.core.skills().read(skill)['content'] + '\n</selected_skill>', body)
        self.assertTrue(body.endswith('<user_task>\n' + task_content + '\n</user_task>'))
        self.assertNotIn("HISTORY_PRIVATE_CANARY", body)
        self.assertNotIn("PUBLIC_PREVIOUS_CANARY", body)
        self.assertEqual(kwargs["target"], {"kind": "hermes"})
        self.assertEqual(len(self.providers.calls), model_calls)

    def test_skill_selection_does_not_bypass_private_or_secret_hold(self):
        skill = self.import_skill()
        private = self.conversation("private")
        self.send(private, "PRIVATE_TASK_CANARY", task_target={"kind": "hermes"}, skill_id=skill)
        daily = self.conversation()
        self.send(daily, "只存私密：HELD_TASK_CANARY", task_target={"kind": "hermes"}, skill_id=skill)
        self.assertEqual(self.work.calls, [])
        self.assertEqual(self.core.tasks().list(private["id"])["items"], [])
        self.assertEqual(self.core.tasks().list(daily["id"])["items"], [])
        self.assertEqual(self.providers.calls, [])
        self.assertTrue(all(message["privacy"] == "private" for message in self.core.messages(private["id"])))
        self.assertTrue(all(message["memory_hold"] for message in self.core.messages(daily["id"])))

    def test_delayed_external_task_retains_skill_after_restart_and_workspace_edits(self):
        skill = self.import_skill()
        project = self.core.dispatch("project.create", {"name": "Synthetic project"})
        conversation = self.core.dispatch("conversation.create", {"mode": "daily", "project_id": project["id"]})
        self.send(conversation, "让Codex整理公开报告", skill_id=skill)
        task = self.core.tasks().list(conversation["id"])["items"][0]
        self.assertEqual(task["status"], "awaiting_target")
        self.assertEqual(self.work.calls, [])
        before = self.core.messages(conversation["id"])
        self.core.dispatch("conversation.organize", {"id": conversation["id"], "pinned": True})
        self.core.dispatch("project.pin", {"id": project["id"], "pinned": True})
        self.core.dispatch("workspace.preferences.save", {"theme": "light", "language": "en"})
        self.restart()
        workspace = self.core.dispatch("workspace.get")
        self.assertEqual(workspace["preferences"], {"theme": "light", "language": "en"})
        self.assertEqual(workspace["conversation_meta"][conversation["id"]], {"project_id": project["id"], "pinned": True})
        self.assertEqual(self.core.messages(conversation["id"]), before)
        self.assertEqual(self.core.tasks().list(conversation["id"])["items"][0]["skill_id"], skill)
        request = {"conversation_id": conversation["id"], "task_id": task["task_id"],
                   "target": {"kind": "codex", "id": "explicit-user-selected-chat"}}
        self.core.dispatch("chat.task.start", request)
        self.core.dispatch("chat.task.start", request)
        self.assertEqual(len(self.work.calls), 1)
        self.assertIn("SKILL_INSTRUCTION_CANARY", self.work.calls[0][0])
        self.assertEqual(self.work.calls[0][1]["target"]["id"], request["target"]["id"])
        self.assertEqual(self.core.messages(conversation["id"]), before)


if __name__ == "__main__":
    unittest.main()
