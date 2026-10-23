"""Local workspace organization. Projects never alter model/memory boundaries."""
import json
import re
import time
import uuid


class Workspace:
    def __init__(self, db, lock):
        self.db, self.lock = db, lock
        with lock:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspace_projects (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS conversation_organization (
                    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
                    project_id TEXT REFERENCES workspace_projects(id), pinned INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS workspace_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.commit()

    def project(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r"project_[a-f0-9]{32}", identity):
            raise ValueError("项目编号无效。")
        row = self.db.execute("SELECT * FROM workspace_projects WHERE id=?", (identity,)).fetchone()
        if row is None:
            raise ValueError("项目不存在。")
        return {**dict(row), "pinned": bool(row["pinned"])}

    def get(self):
        with self.lock:
            projects = [{**dict(row), "pinned": bool(row["pinned"])} for row in self.db.execute(
                "SELECT * FROM workspace_projects ORDER BY pinned DESC,updated_at DESC,id")]
            metadata = {row["conversation_id"]: {"project_id": row["project_id"], "pinned": bool(row["pinned"])}
                        for row in self.db.execute("SELECT * FROM conversation_organization")}
            preferences = {"theme": "dark", "language": "zh"}
            preferences.update({row["key"]: json.loads(row["value"]) for row in self.db.execute("SELECT * FROM workspace_preferences")})
        return {"projects": projects, "conversation_meta": metadata, "preferences": preferences}

    def organize(self, payload, commit=True):
        identity = payload.get("id")
        with self.lock:
            if not isinstance(identity, str) or self.db.execute("SELECT 1 FROM conversations WHERE id=?", (identity,)).fetchone() is None:
                raise ValueError("对话不存在。")
            old = self.db.execute("SELECT * FROM conversation_organization WHERE conversation_id=?", (identity,)).fetchone()
            project_id = payload.get("project_id", old["project_id"] if old else None)
            if project_id is not None:
                self.project(project_id)
            pinned = payload.get("pinned", bool(old["pinned"]) if old else False)
            if type(pinned) is not bool:
                raise ValueError("置顶状态无效。")
            self.db.execute("INSERT INTO conversation_organization VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET project_id=excluded.project_id,pinned=excluded.pinned",
                            (identity, project_id, int(pinned)))
            if commit:
                self.db.commit()
        return {"id": identity, "project_id": project_id, "pinned": pinned}

    def dispatch(self, action, payload):
        if action == "workspace.get":
            return self.get()
        if action == "conversation.organize":
            return self.organize(payload)
        with self.lock:
            if action == "workspace.preferences.save":
                if not payload or set(payload) - {"theme", "language"}:
                    raise ValueError("界面偏好格式无效。")
                for key, allowed in (("theme", ("dark", "light")), ("language", ("zh", "en"))):
                    if key in payload and payload[key] not in allowed:
                        raise ValueError("请选择支持的主题或语言。")
                for key, value in payload.items():
                    self.db.execute("INSERT OR REPLACE INTO workspace_preferences VALUES (?,?)", (key, json.dumps(value)))
                self.db.commit()
                return self.get()["preferences"]
            if action in ("project.create", "project.rename"):
                name = payload.get("name")
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or re.search(r"[\x00-\x1f]", name):
                    raise ValueError("项目名称请控制在 1–80 字。")
                if action == "project.create":
                    identifier, stamp = "project_" + uuid.uuid4().hex, time.time()
                    self.db.execute("INSERT INTO workspace_projects VALUES (?,?,0,?,?)", (identifier, name.strip(), stamp, stamp))
                else:
                    identifier = self.project(payload.get("id"))["id"]
                    self.db.execute("UPDATE workspace_projects SET name=?,updated_at=? WHERE id=?", (name.strip(), time.time(), identifier))
                self.db.commit()
                return self.project(identifier)
            if action == "project.pin":
                identifier = self.project(payload.get("id"))["id"]
                if type(payload.get("pinned")) is not bool:
                    raise ValueError("置顶状态无效。")
                self.db.execute("UPDATE workspace_projects SET pinned=?,updated_at=? WHERE id=?", (int(payload["pinned"]), time.time(), identifier))
                self.db.commit()
                return self.project(identifier)
        raise ValueError("不支持这个工作区操作。")
