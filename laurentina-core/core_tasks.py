"""Conversation task receipts. Only explicit instructions can create a task.

This module never reads conversation history or chooses an external conversation.
The caller must enforce the private/held message boundary before offering work.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path

KINDS = {"hermes", "codex", "chatgpt"}
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}
COMMAND = re.compile(
    r"^(?:(?:请|麻烦|帮我|现在|劳纶缇娜)[，,：:\s]*)*"
    r"(?:(?:让|叫|交给|转交给|提交给|请)\s*(Hermes|Codex|ChatGPT|GPT)"
    r"|(?:ask|tell|have|delegate\s+to|send\s+to)\s+(Hermes|Codex|ChatGPT|GPT)\b)"
    r"\s*(?:(?:来|去|帮我|帮忙|处理|执行|完成|做一下|做|to)\s*)?[：:,，\s]*(.+)$",
    re.I | re.S,
)
QUOTED = re.compile(r"^[\s\"'“‘「『`]|^(?:假设|假如|比如|例如|如果|不要|别|不用|怎么|如何|能不能|是否|他说|她说|suppose|imagine|if\b|how\b|do not\b|don't\b)", re.I)


def valid_target(target):
    if not isinstance(target, dict) or set(target) - {"kind", "id"} or target.get("kind") not in KINDS:
        raise ValueError("请选择 Hermes、Codex 或 ChatGPT 执行目标。")
    result = {"kind": target["kind"]}
    identifier = target.get("id")
    if identifier is not None:
        if not isinstance(identifier, str) or not 1 <= len(identifier.strip()) <= 300:
            raise ValueError("工作目标编号无效。")
        result["id"] = identifier.strip()
    if result["kind"] == "hermes" and result.get("id", "default") != "default":
        raise ValueError("请选择已配置的 Hermes 入口。")
    return result


def detect_task(content, target=None):
    """A composer task selection is explicit; plain chat requires a leading command."""
    if not isinstance(content, str) or not content.strip():
        return None
    text = content.strip()
    match = None if QUOTED.search(text) else COMMAND.fullmatch(text)
    if target is not None:
        selected = valid_target(target)
        if match:
            named = (match[1] or match[2]).lower()
            named = "chatgpt" if named == "gpt" else named
            if named != selected["kind"]:
                raise ValueError("文字指定的执行者与所选目标不同，请统一后再发送。")
        return {"kind": selected["kind"], "content": text}
    if not match:
        return None
    kind = (match[1] or match[2]).lower()
    return {"kind": "chatgpt" if kind == "gpt" else kind, "content": text}


class ChatTasks:
    def __init__(self, data_dir):
        directory = Path(data_dir).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(directory / "chat-tasks.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
            requested_kind TEXT NOT NULL, status TEXT NOT NULL,
            run_id TEXT, run TEXT, error TEXT, created_at REAL, updated_at REAL)""")
        if 'skill_id' not in [row[1] for row in self.db.execute('PRAGMA table_info(tasks)')]:
            self.db.execute('ALTER TABLE tasks ADD COLUMN skill_id TEXT')
        # Do not submit again after a crash between remote acceptance and receipt.
        self.db.execute("UPDATE tasks SET status='unknown',error='上次提交未取得回执，请到工作列表核对，应用不会自动重发。' WHERE status='starting'")
        self.db.commit()

    @staticmethod
    def _public(row):
        value = dict(row)
        value["run"] = json.loads(value["run"]) if value["run"] else None
        return value

    def _row(self, task_id, conversation_id):
        if not isinstance(task_id, str) or not re.fullmatch(r"task_[0-9a-f]{32}", task_id):
            raise ValueError("聊天任务编号无效。")
        with self.lock:
            row = self.db.execute("SELECT * FROM tasks WHERE task_id=? AND conversation_id=?", (task_id, conversation_id)).fetchone()
        if row is None:
            raise ValueError("这段对话中没有此任务。")
        return row

    def _update(self, task_id, **values):
        if set(values) - {"status", "run_id", "run", "error"}:
            raise ValueError("任务更新无效。")
        if isinstance(values.get("run"), dict):
            values["run"] = json.dumps(values["run"], ensure_ascii=False)
        values["updated_at"] = time.time()
        with self.lock:
            self.db.execute("UPDATE tasks SET " + ",".join(key + "=?" for key in values) + " WHERE task_id=?", [*values.values(), task_id])
            self.db.commit()

    def _claim(self, task_id, states, status):
        """Atomic state transition, including across independent backend instances."""
        with self.lock:
            changed = self.db.execute("UPDATE tasks SET status=?,updated_at=? WHERE task_id=? AND status IN (" +
                ",".join("?" for _ in states) + ")", [status, time.time(), task_id, *states]).rowcount
            self.db.commit()
            return changed == 1

    def _receipt(self, task_id, receipt):
        """A delayed poll must not restore an older state over a final receipt."""
        for _ in range(4):
            with self.lock:
                row = self.db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
                if row is None:
                    return
                status = receipt.get("status", row["status"])
                if row["status"] in TERMINAL and status not in TERMINAL:
                    return
                previous = json.loads(row["run"]) if row["run"] else {}
                old_time, new_time = previous.get("updated_at"), receipt.get("updated_at")
                if isinstance(old_time, (int, float)) and isinstance(new_time, (int, float)) and new_time < old_time:
                    return
                changed = self.db.execute("UPDATE tasks SET status=?,run_id=?,run=?,error=?,updated_at=? WHERE task_id=? AND updated_at=?", (
                    status, receipt.get("run_id", row["run_id"]), json.dumps(receipt, ensure_ascii=False), receipt.get("error"), time.time(), task_id, row["updated_at"])).rowcount
                self.db.commit()
                if changed:
                    return

    def offer(self, conversation_id, message_id, content, kind, skill_id=None):
        if kind not in KINDS or not isinstance(content, str) or not 1 <= len(content.strip()) <= 12000:
            raise ValueError("工作指令请控制在 12000 字以内，并选择执行者。")
        if not isinstance(conversation_id, str) or not conversation_id or not isinstance(message_id, str) or not message_id:
            raise ValueError("任务所属对话无效。")
        if skill_id is not None and (not isinstance(skill_id, str) or not re.fullmatch(r'skill_[a-f0-9]{32}', skill_id)):
            raise ValueError('技能编号无效。')
        with self.lock:
            previous = self.db.execute("SELECT * FROM tasks WHERE message_id=?", (message_id,)).fetchone()
            if previous:
                if previous["conversation_id"] != conversation_id:
                    raise ValueError("任务所属对话无效。")
                return self._public(previous)
            stamp = time.time()
            identifier = "task_" + uuid.uuid4().hex
            self.db.execute("INSERT INTO tasks(task_id,conversation_id,message_id,content,requested_kind,status,created_at,updated_at,skill_id) VALUES (?,?,?,?,?,?,?,?,?)", (
                identifier, conversation_id, message_id, content.strip(), kind,
                "draft" if kind == "hermes" else "awaiting_target", stamp, stamp, skill_id))
            self.db.commit()
            return self._public(self._row(identifier, conversation_id))

    def list(self, conversation_id):
        with self.lock:
            rows = self.db.execute("SELECT * FROM tasks WHERE conversation_id=? ORDER BY created_at", (conversation_id,)).fetchall()
        return {"items": [self._public(row) for row in rows]}

    def start(self, task_id, conversation_id, target, runner):
        target = valid_target(target)
        with self.lock:
            row = self._row(task_id, conversation_id)
            if target["kind"] != row["requested_kind"]:
                raise ValueError("请使用这条指令指定的执行者。")
            if target["kind"] != "hermes" and not target.get("id"):
                raise ValueError("请先选择一个真实的目标对话。")
            if row["status"] not in ("draft", "awaiting_target"):
                # Idempotency: clicking twice or reopening never submits twice.
                return self._public(row)
            if not self._claim(task_id, ("draft", "awaiting_target"), "starting"):
                return self._public(self._row(task_id, conversation_id))
        try:
            receipt = runner("work.start", {"content": row["content"], "target": target,
                **({'skill_id':row['skill_id']} if row['skill_id'] else {})})
            if not isinstance(receipt, dict) or not isinstance(receipt.get("run_id"), str) or not receipt["run_id"]:
                raise RuntimeError("未取得可核验的工作回执。")
        except Exception:
            self._update(task_id, status="unknown", error="未取得提交回执，请到工作页面核对连接和任务记录。为避免重复执行，应用不会自动重发。")
            return self._public(self._row(task_id, conversation_id))
        self._receipt(task_id, receipt)
        return self._public(self._row(task_id, conversation_id))

    def poll(self, task_id, conversation_id, runner):
        row = self._row(task_id, conversation_id)
        if row["run_id"]:
            try:
                result = runner("work.poll", {"run_id": row["run_id"]})
                if not isinstance(result, dict) or result.get("run_id") != row["run_id"]:
                    raise ValueError("任务回执不匹配。")
                self._receipt(task_id, result)
            except Exception:
                self._update(task_id, error="暂时无法刷新任务，请检查工作连接后重试；任务没有重新提交。")
        return self._public(self._row(task_id, conversation_id))

    def stop(self, task_id, conversation_id, runner):
        row = self._row(task_id, conversation_id)
        if row["status"] in ("draft", "awaiting_target"):
            if self._claim(task_id, ("draft", "awaiting_target"), "cancelled"):
                return self._public(self._row(task_id, conversation_id))
            row = self._row(task_id, conversation_id)
        if not row["run_id"]:
            raise ValueError("尚未取得工作编号，请先核对工作列表。")
        receipt = self._public(row).get("run") or {}
        if not receipt.get("supports_stop"):
            raise ValueError("这个执行目标暂不支持从 Core 停止，请前往原对话操作。")
        result = runner("work.stop", {"run_id": row["run_id"]})
        if isinstance(result, dict) and result.get("run_id") == row["run_id"]:
            self._receipt(task_id, result)
        return self.poll(task_id, conversation_id, runner)

    def approve(self, task_id, conversation_id, decision, runner):
        row = self._row(task_id, conversation_id)
        if not row["run_id"]:
            raise ValueError("这个任务尚未提交。")
        result = runner("work.approve", {"run_id": row["run_id"], "decision": decision})
        if isinstance(result, dict) and result.get("run_id") == row["run_id"]:
            self._receipt(task_id, result)
        return self.poll(task_id, conversation_id, runner)

    def sync_run(self, run):
        if not isinstance(run, dict) or not run.get('run_id'):
            return
        with self.lock:
            rows = self.db.execute('SELECT task_id FROM tasks WHERE run_id=?', (run['run_id'],)).fetchall()
        for row in rows:
            self._receipt(row['task_id'], run)

    def close(self):
        with self.lock:
            self.db.close()
