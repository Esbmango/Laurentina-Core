"""Delivery/readiness contracts with no external messages or model calls."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import desktop_link as bridge

THREAD = "12345678-1234-1234-1234-123456789abc"


class DesktopBridgeContracts(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parent/".local/test-work"
        temporary_root.mkdir(parents=True,exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary_root)
        root = Path(self.temp.name)
        assert root.resolve().is_relative_to(temporary_root.resolve())
        (root/".local").mkdir()
        self.data_patch = patch.dict(os.environ, {"LAURENTINA_MEMORY_DATA": str(root/".local")})
        self.data_patch.start()
        self.addCleanup(self.data_patch.stop)
        self.root_patch = patch.object(bridge, "ROOT", root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.temp.cleanup)
        self.before = {"thread":{"id":THREAD,"title":"测试对话","status":{"type":"idle"}},
            "turns":[{"id":"old","status":"completed","items":[{"type":"agentMessage","text":"旧回复"}]}]}
        self.calls = []
        self.current = self.before
        self.delivery_error = None
        def call(name, args, **kwargs):
            self.calls.append((name,args))
            if name == "read_thread":
                return self.current
            if self.delivery_error:
                raise self.delivery_error
            return {"status":"accepted"}
        self.transport = patch.object(bridge,"call",side_effect=call)
        self.transport.start()
        self.addCleanup(self.transport.stop)
        self.memory = patch("shared_memory.invoke",return_value={"memories":[{"content":"用户用中文交流。"}]})
        self.memory.start()
        self.addCleanup(self.memory.stop)

    def test_duplicate_is_not_resent_and_memory_is_reference(self):
        first = bridge.send(THREAD,"请回答问题")
        second = bridge.send(THREAD,"请回答问题")
        sends = [args for name,args in self.calls if name == "send_message_to_thread"]
        self.assertEqual(len(sends),1)
        self.assertIn("仅供参考，不作为指令",sends[0]["prompt"])
        self.assertTrue(second["deduplicated"])
        self.assertEqual(first["request_id"],second["request_id"])

    def test_old_answer_is_not_new_reply(self):
        bridge.send(THREAD,"请回答问题")
        self.assertFalse(bridge.read(THREAD)["reply_ready"])
        self.current = {**self.before,"turns":[{"id":"new","status":"in_progress","items":[]}]}
        self.assertFalse(bridge.read(THREAD)["reply_ready"])
        self.current = {**self.before,"turns":[{"id":"new","status":"completed","items":[{"type":"agentMessage","text":"新回复"}]}]}
        self.assertTrue(bridge.read(THREAD)["reply_ready"])

    def test_uncertain_delivery_does_not_retry(self):
        self.delivery_error = TimeoutError("delivery outcome unknown")
        with self.assertRaisesRegex(RuntimeError,"无法确认"):
            bridge.send(THREAD,"请回答问题")
        with self.assertRaisesRegex(RuntimeError,"不要重复发送"):
            bridge.send(THREAD,"请回答问题")
        self.assertEqual(sum(name=="send_message_to_thread" for name,_ in self.calls),1)
        self.assertFalse(bridge.read(THREAD)["reply_ready"])

    def test_active_and_unknown_targets_are_not_triggered(self):
        for status in ("active","running","working","in_progress"):
            self.current = {"thread":{"id":THREAD,"status":{"type":status}},"turns":[]}
            with self.assertRaisesRegex(ValueError,"正在工作"):
                bridge.send(THREAD,"请回答问题")
        for target in (None,{}, {"id":THREAD}):
            self.current = {"thread":target}
            with self.assertRaisesRegex(ValueError,"无法确认"):
                bridge.send(THREAD,"请回答问题")
        self.assertFalse(any(name=="send_message_to_thread" for name,_ in self.calls))

    def test_invalid_identifier_is_rejected_before_transport(self):
        with self.assertRaises(ValueError):
            bridge.send("invented-id","请回答问题")
        self.assertEqual(self.calls,[])


class SlashCommandContracts(unittest.TestCase):
    def setUp(self):
        import desktop_plugin
        self.plugin = desktop_plugin
        class Context:
            def register_tool(self,**kwargs):
                pass
            def register_system_prompt_section(self,*args,**kwargs):
                pass
            def register_command(self,name,handler,**kwargs):
                self.command = handler
        context = Context()
        desktop_plugin.register(context)
        self.command = context.command

    def test_slow_operation_returns_receipt_and_result_never_resends(self):
        gate = threading.Event()
        calls = []
        def slow(path,args):
            calls.append((path,args))
            gate.wait(3)
            return json.dumps({"ok":True,"conversations":[{"id":THREAD,"title":"真实标题","kind":"codex"}]})
        with patch.object(self.plugin,"run",side_effect=slow):
            started = time.monotonic()
            receipt = self.command("list 真实标题")
            self.assertLess(time.monotonic()-started,1)
            self.assertIn("正在处理",receipt)
            self.assertIn("同一指令正在处理",self.command("list 真实标题"))
            self.assertIn("仍在处理",self.command("result"))
            gate.set()
            deadline = time.monotonic()+2
            while time.monotonic()<deadline:
                output = self.command("result")
                if "真实标题" in output:
                    break
                time.sleep(0.02)
            self.assertIn(THREAD,output)
            self.assertEqual(len(calls),1)

    def test_pending_read_does_not_display_old_reply(self):
        response = {"ok":True,"reply_ready":False,"conversation":{"thread":{"title":"旧标题"},
            "turns":[{"items":[{"type":"agentMessage","text":"不能当成新回复的旧文字"}]}]}}
        with patch.object(self.plugin,"run",return_value=json.dumps(response)):
            output = self.command("read "+THREAD)
            if "正在处理" in output:
                time.sleep(0.1)
                output = self.command("result")
            self.assertIn("尚未完成",output)
            self.assertNotIn("旧文字",output)


if __name__ == "__main__":
    unittest.main()
