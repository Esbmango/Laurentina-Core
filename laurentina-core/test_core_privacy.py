"""Synthetic-only privacy gates and provider/task integration checks."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from core_backend import Job, secret_request
from test_core_backend import Memory, Model, TEST_ROOT, offline_core, wait_until


class Local(Model):
    def __init__(self):
        super().__init__()
        self.extractions = 0
    def stream(self, model, messages, job):
        self.prompts.append(messages)
        yield "LOCAL_PRIVATE_REPLY_CANARY"
    def extract(self, model, text):
        self.extractions += 1
        return self.facts


class Providers:
    def __init__(self):
        self.active = "cloud-a"
        self.calls = []
    def selected(self):
        return {"id": self.active, "kind": "custom", "name": self.active, "model": "example", "base_url": "https://example.invalid/v1"}
    def snapshot(self, identifier=None):
        return {"id": identifier or self.active}
    def list(self):
        return {"active_id": self.active, "items": [self.selected()]}
    def stream(self, messages, job, provider_id=None):
        self.calls.append({"messages": messages, "id": provider_id, "snapshot": job.provider_snapshot})
        yield "CLOUD_PUBLIC_REPLY"


class Work:
    def __init__(self):
        self.calls = []
    def start(self, text, **kwargs):
        self.calls.append((text, kwargs))
        return {"run_id": "work_receipt", "status": "running", "supports_stop": True}
    def poll(self, run_id, **kwargs):
        return {"run_id": run_id, "status": "completed", "text": "REAL_RECEIPT_TEXT"}


class PrivacyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="privacy-", dir=TEST_ROOT)
        self.memory, self.local, self.providers, self.work = Memory(), Local(), Providers(), Work()
        self.core = offline_core(self.directory.name, memory=self.memory, ollama=self.local, providers=self.providers, work=self.work)

    def tearDown(self):
        self.core.shutdown()
        time.sleep(0.02)
        if self.core._tasks is not None:
            self.core._tasks.close()
        self.core.db.close()
        self.directory.cleanup()

    def conversation(self, mode="daily"):
        return self.core.dispatch("conversation.create", {"mode": mode})

    def test_speech_route_metadata_follows_private_and_secret_routing_with_cloud_selected(self):
        for mode, content, local in (("daily", "你好", False), ("private", "你好", True),
                                     ("daily", "这是我们之间的秘密：我喜欢一个虚构角色", True)):
            with self.subTest(mode=mode, secret="秘密" in content):
                conversation = self.conversation(mode)
                result = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": content})
                self.assertIs(result["speech_local"], local)
                wait_until(lambda: self.core.job(result["job_id"]).done)

    def send(self, conversation, text, **payload):
        result = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": text, **payload})
        job = self.core.job(result["job_id"])
        wait_until(lambda: job.done)
        return job

    def pending(self, conversation):
        return self.core.pending_secret(conversation["id"])

    def confirm(self, conversation, pending, decision="confirm"):
        return self.core.dispatch("memory.confirm", {"conversation_id": conversation["id"], "pending_id": pending["id"], "decision": decision})

    def test_local_marker_detection_and_quoted_hypothetical_exclusions(self):
        for text in ("只存私密：我收藏了旧明信片", "这是我们之间的秘密：一封旧信", "这是我的隐私", "请保密", "Only store this privately", "keep this private", "this is my privacy", "I have a secret", '“这是我的隐私，我喜欢蓝色”', '请记住：“这是我们之间的秘密：旧信”', '"keep this private"'):
            self.assertTrue(secret_request(text), text)
        for text in ('他说“我的隐私”', '"keep this private" is an example', '假设这是我的隐私', 'For example keep this private', '如果我说只存私密会怎样？', '例如“这是我的隐私，我喜欢蓝色”', '如何设置“只存私密”功能？'):
            self.assertFalse(secret_request(text), text)

    def test_secret_streams_local_answer_with_independent_exact_preview(self):
        conversation = self.conversation()
        text = "只存私密：我喜欢蓝色，SECRET_CANARY"
        job = self.send(conversation, text)
        pending = self.pending(conversation)
        self.assertEqual(pending["preview"], text)
        self.assertEqual(pending["reason"], "content")
        self.assertEqual(self.providers.calls, [])
        self.assertEqual(len(self.local.prompts), 1)
        self.assertIn(text, json.dumps(self.local.prompts[0], ensure_ascii=False))
        self.assertIn("记忆保存由应用的独立确认控件处理", self.local.prompts[0][0]["content"])
        self.assertEqual(job.text, "LOCAL_PRIVATE_REPLY_CANARY")
        self.assertEqual(self.local.extractions, 0)
        self.assertEqual(self.memory.items, [])
        self.assertTrue(all(m["privacy"] == "private" and m["memory_hold"] for m in self.core.messages(conversation["id"])))
        secret = next(e for e in job.events if e["type"] == "secret")
        self.assertEqual(secret["pending_secret"]["preview"], text)
        self.assertLess(secret["seq"], next(e["seq"] for e in job.events if e["type"] == "delta"))
        self.assertTrue(any(e["type"] == "done" for e in job.events))

    def test_confirmation_saves_exact_private_preview_and_profile_cannot_bypass(self):
        conversation = self.conversation()
        text = "我们之间的秘密：我喜欢蓝色"
        job = self.send(conversation, text)
        result = self.confirm(conversation, self.pending(conversation))
        self.assertEqual(result["state"], "confirmed")
        self.assertEqual(len(self.memory.items), 1)
        self.assertEqual(self.memory.items[0]["content"], text)
        self.assertEqual(self.memory.items[0]["scope"], "private")
        self.local.facts = [{"category": "preference", "evidence": "我喜欢蓝色"}]
        # Even a forged new Job object cannot avoid the persisted source hold.
        self.core.process_facts(Job(conversation["id"], {"id": job.user_message["id"], "content": text}), conversation)
        self.assertEqual(self.local.extractions, 0)
        self.assertEqual(len(self.memory.items), 1)

    def test_explicit_save_phrase_confirms_current_conversation_and_failure_retryable(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：我珍藏一封旧信")
        self.memory.fail = True
        failed = self.send(conversation, "确认保存")
        self.assertEqual(failed.final_message["status"], "failed")
        self.assertEqual(self.pending(conversation)["state"], "error")
        self.assertEqual(self.memory.items, [])
        self.memory.fail = False
        completed = self.send(conversation, "确认保存")
        self.assertEqual(completed.final_message["status"], "completed")
        self.assertIn("继续聊秘密请切到私聊", completed.text)
        self.assertIsNone(self.pending(conversation))
        self.assertEqual(self.memory.items[0]["scope"], "private")
        self.assertEqual(self.providers.calls, [])

    def test_yes_and_no_are_conversation_answers_not_memory_consent(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：我珍藏一封旧信")
        original = self.pending(conversation)
        for reply in ("是", "否", "yes", "no", "确认", "好的"):
            answer = self.send(conversation, reply)
            self.assertEqual(answer.text, "LOCAL_PRIVATE_REPLY_CANARY")
            self.assertEqual(self.pending(conversation)["id"], original["id"])
            self.assertEqual(self.pending(conversation)["preview"], original["preview"])
            self.assertEqual(self.memory.items, [])
            self.assertEqual(self.local.extractions, 0)
        self.assertEqual(self.providers.calls, [])
        self.send(conversation, "不要保存")
        self.assertIsNone(self.pending(conversation))
        self.assertEqual(self.memory.items, [])

    def test_secret_event_is_available_before_slow_model_or_failed_reply(self):
        entered, release = threading.Event(), threading.Event()
        def slow_failure(model, messages, job):
            self.local.prompts.append(messages)
            entered.set()
            release.wait(2)
            raise OSError("local unavailable")
            yield  # Keep the stream lazy, matching the real local transport.
        self.local.stream = slow_failure
        conversation = self.conversation()
        sent = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "只存私密：旧明信片"})
        job = self.core.job(sent["job_id"])
        try:
            self.assertTrue(entered.wait(1))
            self.assertFalse(job.done)
            self.assertEqual(job.events[0]["type"], "secret")
            self.assertEqual(job.events[0]["pending_secret"]["id"], sent["pending_secret"]["id"])
            self.assertEqual(self.providers.calls, [])
            self.assertEqual(self.memory.items, [])
        finally:
            release.set()
        wait_until(lambda: job.done)
        self.assertEqual(job.final_message["status"], "failed")
        self.assertEqual(self.pending(conversation)["id"], sent["pending_secret"]["id"])
        self.confirm(conversation, self.pending(conversation))
        self.assertEqual(self.memory.items[0]["content"], "只存私密：旧明信片")

    def test_popup_confirmation_during_reply_never_changes_private_routing_or_extracts(self):
        entered, release = threading.Event(), threading.Event()
        def slow_stream(model, messages, job):
            self.local.prompts.append(messages)
            yield "LOCAL_PRIVATE_REPLY_CANARY"
            entered.set()
            release.wait(2)
            yield "_END"
        self.local.stream = slow_stream
        conversation = self.conversation()
        sent = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "只存私密：我喜欢蓝色"})
        job = self.core.job(sent["job_id"])
        try:
            self.assertTrue(entered.wait(1))
            self.confirm(conversation, sent["pending_secret"])
            self.assertIsNone(self.pending(conversation))
        finally:
            release.set()
        wait_until(lambda: job.done)
        self.assertEqual(job.final_message["privacy"], "private")
        self.assertTrue(job.final_message["memory_hold"])
        self.assertEqual(len(self.memory.items), 1)
        self.assertEqual(self.memory.items[0]["scope"], "private")
        self.assertEqual(self.local.extractions, 0)
        self.send(conversation, "公开问题")
        cloud = json.dumps(self.providers.calls[-1]["messages"], ensure_ascii=False)
        self.assertNotIn("我喜欢蓝色", cloud)
        self.assertNotIn("LOCAL_PRIVATE_REPLY_CANARY", cloud)

    def test_cancel_and_followup_then_daily_cloud_excludes_both_sides_of_secret(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：PRIVATE_RAW_CANARY")
        followup = self.send(conversation, "我再补充一个细节 FOLLOWUP_CANARY")
        self.assertEqual(followup.privacy, "private")
        self.assertTrue(self.local.prompts)
        self.assertEqual(self.providers.calls, [])
        self.confirm(conversation, self.pending(conversation), "cancel")
        self.send(conversation, "现在聊公开的天气")
        cloud = json.dumps(self.providers.calls[-1]["messages"], ensure_ascii=False)
        for canary in ("PRIVATE_RAW_CANARY", "FOLLOWUP_CANARY", "LOCAL_PRIVATE_REPLY_CANARY"):
            self.assertNotIn(canary, cloud)
        self.assertEqual(self.memory.items, [])
        self.assertEqual(self.core.prompt(conversation, "公开话题")[-1]["content"], "CLOUD_PUBLIC_REPLY")

    def test_switch_cancels_and_cross_conversation_confirmation_never_saves(self):
        first, second = self.conversation(), self.conversation()
        self.send(first, "只存私密：PRIVATE_CANARY")
        pending = self.pending(first)
        with self.assertRaises(ValueError):
            self.confirm(second, pending)
        self.core.dispatch("conversation.get", {"id": second["id"]})
        self.assertIsNone(self.pending(first))
        self.send(second, "是")
        self.assertEqual(self.memory.items, [])
        with self.assertRaises(ValueError):
            self.confirm(first, pending)

    def test_restart_expires_but_keeps_private_hold(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：RESTART_CANARY")
        pending = self.pending(conversation)
        reopened = offline_core(self.directory.name, memory=self.memory, ollama=self.local, providers=self.providers)
        try:
            self.assertIsNone(reopened.pending_secret(conversation["id"]))
            with self.assertRaises(ValueError):
                reopened.confirm_secret({"conversation_id": conversation["id"], "pending_id": pending["id"], "decision": "confirm"})
            self.assertNotIn("RESTART_CANARY", json.dumps(reopened.prompt(conversation, "公开话题"), ensure_ascii=False))
            self.assertTrue(all(m["privacy"] == "private" for m in reopened.messages(conversation["id"])))
            self.assertEqual(self.memory.items, [])
        finally:
            reopened.db.close()

    def test_intro_waits_for_actual_content_instead_of_saving_opening(self):
        conversation = self.conversation()
        self.send(conversation, "我有个秘密")
        opening = self.pending(conversation)
        self.assertFalse(opening["can_confirm"])
        self.assertEqual(opening["reason"], "needs_content")
        for reply in ("是", "否", "yes", "no", "好的"):
            self.send(conversation, reply)
            self.assertEqual(self.pending(conversation)["id"], opening["id"])
            self.assertFalse(self.pending(conversation)["can_confirm"])
        with self.assertRaises(ValueError):
            self.confirm(conversation, opening)
        self.send(conversation, "我珍藏着一张祖父写的明信片")
        actual = self.pending(conversation)
        self.assertTrue(actual["can_confirm"])
        self.assertNotEqual(actual["id"], opening["id"])
        self.assertEqual(actual["preview"], "我珍藏着一张祖父写的明信片")
        self.confirm(conversation, actual)
        self.assertEqual(self.memory.items[0]["content"], actual["preview"])

    def test_credentials_never_enter_confirmation_memory_or_cloud(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：密码是SYNTHETIC_NOT_REAL")
        pending = self.pending(conversation)
        self.assertEqual(pending["preview"], "")
        self.assertFalse(pending["can_confirm"])
        self.assertEqual(pending["reason"], "credentials")
        with self.assertRaises(ValueError):
            self.confirm(conversation, pending)
        self.assertEqual(self.memory.items, [])
        self.assertEqual(self.providers.calls, [])
        self.assertTrue(self.core.messages(conversation["id"])[0]["memory_hold"])

    def test_overlong_secret_collects_safe_followup_without_cloud_or_plain_yes_save(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：" + "长内容" * 1400)
        pending = self.pending(conversation)
        self.assertEqual(pending["preview"], "")
        self.assertFalse(pending["can_confirm"])
        self.assertEqual(pending["reason"], "too_long")
        self.assertEqual(self.send(conversation, "是").final_message["status"], "completed")
        self.assertEqual(self.pending(conversation)["id"], pending["id"])
        self.assertFalse(self.pending(conversation)["can_confirm"])
        self.assertEqual(self.send(conversation, "确认保存").final_message["status"], "failed")
        self.assertEqual(self.memory.items, [])
        self.send(conversation, "我珍藏一封旧信，这是较短的实际内容")
        actual = self.pending(conversation)
        self.assertTrue(actual["can_confirm"])
        self.assertNotEqual(actual["id"], pending["id"])
        self.confirm(conversation, actual)
        self.assertEqual(self.memory.items[0]["content"], "我珍藏一封旧信，这是较短的实际内容")
        self.assertEqual(self.memory.items[0]["scope"], "private")
        self.assertEqual(self.providers.calls, [])

    def test_credential_collecting_followup_is_local_and_never_echoes_credential_preview(self):
        conversation = self.conversation()
        self.send(conversation, "密码是SYNTHETIC_NOT_REAL")
        pending = self.pending(conversation)
        self.assertEqual(pending["preview"], "")
        self.send(conversation, "是")
        self.assertEqual(self.memory.items, [])
        self.send(conversation, "下一段是我珍藏的旧明信片")
        actual = self.pending(conversation)
        self.assertTrue(actual["can_confirm"])
        self.assertNotIn("SYNTHETIC_NOT_REAL", actual["preview"])
        self.assertEqual(self.providers.calls, [])
        self.assertTrue(all(m["privacy"] == "private" for m in self.core.messages(conversation["id"])))
        self.confirm(conversation, actual)
        self.assertEqual(self.memory.items[0]["content"], actual["preview"])

    def test_collecting_pending_cancel_and_restart_keep_old_content_private(self):
        conversation = self.conversation()
        self.send(conversation, "只存私密：" + "超长" * 2100)
        collecting = self.pending(conversation)
        reopened = offline_core(self.directory.name, memory=self.memory, ollama=self.local, providers=self.providers)
        try:
            self.assertIsNone(reopened.pending_secret(conversation["id"]))
            with self.assertRaises(ValueError):
                reopened.confirm_secret({"conversation_id": conversation["id"], "pending_id": collecting["id"], "decision": "confirm"})
            self.assertNotIn("超长", json.dumps(reopened.prompt(conversation, "公开话题"), ensure_ascii=False))
        finally:
            reopened.db.close()
        self.send(conversation, "密码是SECOND_SYNTHETIC_VALUE")
        self.confirm(conversation, self.pending(conversation), "cancel")
        self.send(conversation, "公开话题")
        self.assertNotIn("SECOND_SYNTHETIC_VALUE", json.dumps(self.providers.calls[-1]["messages"], ensure_ascii=False))
        self.assertEqual(self.memory.items, [])

    def test_unflagged_private_preference_still_can_share_under_existing_policy(self):
        conversation = self.conversation("private")
        self.local.facts = [{"category": "preference", "evidence": "我喜欢简短回复"}]
        job = self.send(conversation, "我喜欢简短回复")
        wait_until(lambda: any(e["type"] == "memory" for e in job.events))
        self.assertEqual(self.memory.items[0]["scope"], "shared")
        self.assertEqual(self.providers.calls, [])

    def test_task_executes_explicit_content_and_external_waits_for_actual_target(self):
        conversation = self.conversation()
        hermes = self.send(conversation, "让Hermes总结公开资料")
        self.assertTrue(any(e["type"] == "task" for e in hermes.events))
        self.assertEqual(len(self.work.calls), 1)
        self.assertEqual(self.work.calls[0][0], "让Hermes总结公开资料")
        external = self.send(conversation, "让Codex检查这个项目")
        task = next(e["task"] for e in external.events if e["type"] == "task")
        self.assertEqual(task["status"], "awaiting_target")
        self.assertEqual(len(self.work.calls), 1)
        self.assertEqual(self.providers.calls, [])
        self.assertEqual(self.core.dispatch("conversation.get", {"id": conversation["id"]})["tasks"][1]["task_id"], task["task_id"])

    def test_private_or_held_intent_never_calls_work_and_direct_work_secret_refused(self):
        conversation = self.conversation("private")
        self.send(conversation, "让Hermes处理这段内容")
        self.assertEqual(self.work.calls, [])
        daily = self.conversation()
        self.send(daily, "只存私密：让Hermes处理SECRET_CANARY")
        self.assertEqual(self.work.calls, [])
        with self.assertRaises(ValueError):
            self.core.dispatch("work.start", {"content": "keep this private: synthetic note"})
        self.assertEqual(self.work.calls, [])

    def test_provider_selection_is_snapshotted_before_prompt_work(self):
        entered, release = threading.Event(), threading.Event()
        original = self.memory.search
        def search(*args, **kwargs):
            entered.set()
            release.wait(2)
            return original(*args, **kwargs)
        self.memory.search = search
        conversation = self.conversation()
        result = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "公开问题"})
        self.assertTrue(entered.wait(1))
        self.providers.active = "cloud-b"
        release.set()
        job = self.core.job(result["job_id"])
        wait_until(lambda: job.done)
        self.assertEqual(self.providers.calls[0]["id"], "cloud-a")
        self.assertEqual(self.providers.calls[0]["snapshot"], {"id": "cloud-a"})

    def test_cancel_before_dispatch_does_not_start_work(self):
        entered, release = threading.Event(), threading.Event()
        tasks = self.core.tasks()
        offer = tasks.offer
        def paused_offer(*args, **kwargs):
            task = offer(*args, **kwargs)
            entered.set()
            release.wait(2)
            return task
        tasks.offer = paused_offer
        conversation = self.conversation()
        sent = self.core.dispatch("chat.send", {"conversation_id": conversation["id"], "content": "让Hermes总结公开资料"})
        self.assertTrue(entered.wait(1))
        self.core.dispatch("chat.cancel", {"job_id": sent["job_id"]})
        release.set()
        wait_until(lambda: tasks.list(conversation["id"])["items"][0]["status"] == "cancelled")
        self.assertEqual(self.work.calls, [])
        self.assertEqual(self.core.job(sent["job_id"]).final_message["status"], "cancelled")

    def test_cancelled_question_does_not_leave_live_memory_request(self):
        conversation = self.conversation()
        job = self.send(conversation, "只存私密：旧明信片")
        pending = self.pending(conversation)
        self.core.dispatch("chat.cancel", {"job_id": job.id})
        self.assertIsNone(self.pending(conversation))
        with self.assertRaises(ValueError):
            self.confirm(conversation, pending)
        self.assertEqual(self.memory.items, [])

    def test_concurrent_confirmation_only_one_actual_private_write(self):
        entered, release = threading.Event(), threading.Event()
        remember = self.memory.remember
        def paused_remember(*args, **kwargs):
            entered.set()
            release.wait(2)
            return remember(*args, **kwargs)
        self.memory.remember = paused_remember
        conversation = self.conversation()
        self.send(conversation, "只存私密：我珍藏旧明信片")
        pending = self.pending(conversation)
        results = []
        thread = threading.Thread(target=lambda: results.append(self.confirm(conversation, pending)))
        thread.start()
        self.assertTrue(entered.wait(1))
        with self.assertRaises(ValueError):
            self.confirm(conversation, pending)
        with self.assertRaises(ValueError):
            self.confirm(conversation, pending, "cancel")
        release.set()
        thread.join(2)
        self.assertEqual(results[0]["state"], "confirmed")
        self.assertEqual(len(self.memory.items), 1)

    def test_legacy_daily_secret_and_its_replies_are_private_on_upgrade(self):
        conversation = self.conversation()
        with self.core.lock:
            self.core.db.execute("DELETE FROM config WHERE key IN ('privacy_hold_v2_migrated','message_privacy_v5_migrated')")
            for index, (role, content) in enumerate((('user', '公开的开场'), ('assistant', '公开回复'), ('user', '“这是我的隐私：LEGACY_CANARY”'), ('assistant', 'PRIVATE_REPLY_CANARY'), ('user', '追加说明'))):
                self.core.db.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)", (f'old{index}', conversation['id'], role, content, f'old-{index}', 'completed'))
            self.core.db.commit()
        reopened = offline_core(self.directory.name, memory=self.memory, ollama=self.local, providers=self.providers)
        try:
            prompt = json.dumps(reopened.prompt(conversation, "公开问题"), ensure_ascii=False)
            self.assertIn("公开的开场", prompt)
            self.assertNotIn("LEGACY_CANARY", prompt)
            self.assertNotIn("PRIVATE_REPLY_CANARY", prompt)
            self.assertNotIn("追加说明", prompt)
            self.assertEqual([m['privacy'] for m in reopened.messages(conversation['id'])], ['shared', 'shared', 'private', 'private', 'private'])
        finally:
            reopened.db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
