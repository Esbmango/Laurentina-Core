"""Shared stdlib OS boundary. Secrets never fall back to plaintext storage."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

__all__ = ["SecretStoreError", "project_home", "project_data", "venv_python", "python_site", "runtime_python", "voice_environment",
           "subprocess_options", "mark_owned", "terminate_owned", "protect_bytes"]
KEYCHAIN_PREFIX = b"LaurentinaKeychain:v1:"
KEYCHAIN_SERVICE = "org.laurentina.local-secrets.v1"


class SecretStoreError(RuntimeError):
    pass


def project_home(kind, source_root, *, environ=None):
    if kind not in ("core", "memory"):
        raise ValueError("Unknown project")
    env = os.environ if environ is None else environ
    override = env.get("LAURENTINA_CORE_HOME" if kind == "core" else "LAURENTINA_MEMORY_HOME")
    if not override and kind == "memory" and env.get("LAURENTINA_CORE_HOME"):
        override = str(Path(env["LAURENTINA_CORE_HOME"]).expanduser().parent / "hy-memory-starter")
    return Path(override or source_root).expanduser().resolve()


def project_data(kind, root, *, environ=None, platform=None, home=None):
    env = os.environ if environ is None else environ
    override = env.get("LAURENTINA_CORE_DATA" if kind == "core" else "LAURENTINA_MEMORY_DATA")
    if override:
        return Path(override).expanduser().resolve()
    if (platform or sys.platform) == "darwin":
        return Path(home or Path.home()) / "Library/Application Support/LaurentinaCore" / ("Core" if kind == "core" else "HyMemory")
    # Existing Windows installs and their DPAPI identities remain in place.
    return Path(root).resolve() / ".local"


def venv_python(environment, *, platform=None):
    environment = Path(environment)
    return environment / ("Scripts/python.exe" if (platform or sys.platform) == "win32" else "bin/python")


def runtime_python(kind, root, *, environ=None, platform=None):
    env = os.environ if environ is None else environ
    override = env.get("LAURENTINA_CORE_PYTHON" if kind == "core" else "LAURENTINA_MEMORY_PYTHON")
    if not override and kind == "core":
        override = env.get("LAURENTINA_MEMORY_PYTHON")
    if override:
        return Path(override).expanduser().resolve()
    environment = Path(root) / ".venv" if kind == "memory" else Path(root).parent / "hy-memory-starter/.venv"
    return venv_python(environment, platform=platform)


def voice_environment(root, name, *, data=None, platform=None):
    if name not in (".voice-venv", ".custom-voice-venv"):
        raise ValueError("Unknown voice environment")
    if (platform or sys.platform) == "darwin":
        return Path(data or project_data("core", root)) / "runtimes" / name
    return Path(root) / name


def python_site(environment, *, platform=None):
    environment = Path(environment)
    if (platform or sys.platform) == "win32":
        return environment / "Lib/site-packages"
    candidates = sorted((environment / "lib").glob("python*/site-packages"))
    return candidates[-1] if candidates else environment / f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages"


def subprocess_options(*, owned=False, platform=None):
    if (platform or sys.platform) == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {"start_new_session": True} if owned else {}


def mark_owned(process):
    """Call only for a process we started with owned=True/new session."""
    if sys.platform != "win32":
        process._laurentina_owned_group = process.pid
    return process


def _darwin_group_has_no_live_members(group):
    """Disambiguate Darwin's EPERM for groups containing only zombies."""
    try:
        snapshot = subprocess.run(["/bin/ps", "-ax", "-o", "pgid=", "-o", "stat="],
            capture_output=True, text=True, timeout=2, check=False)
        rows = snapshot.stdout.splitlines()
        if snapshot.returncode or not rows:
            return False
        for row in rows:
            values = row.split()
            if len(values) != 2:
                return False
            pgid, state = int(values[0]), values[1]
            if pgid == group and not state.startswith("Z"):
                return False
        return True
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def _signal_owned_group(process, group, signum):
    try:
        os.killpg(group, signum)
        if signum == signal.SIGKILL:
            # SIGKILL cannot be ignored. Consume the owned group once delivered
            # instead of retaining a numeric ID that may eventually be reused.
            process._laurentina_owned_group = None
        return True
    except ProcessLookupError:
        pass
    except PermissionError:
        # XNU killpg1 filters SZOMB members and returns EPERM when none remain
        # eligible. Do not hide actual permission errors or an unreadable snapshot.
        if sys.platform != "darwin" or not _darwin_group_has_no_live_members(group):
            raise
    # A nonexistent or zombie-only group cannot host inference. Forget its ID
    # so a later cleanup never signals an unrelated group after PID reuse.
    process._laurentina_owned_group = None
    return False


def terminate_owned(process):
    """Terminate only an explicitly owned child/session, never discovered PIDs."""
    if process is None:
        return
    group = getattr(process, "_laurentina_owned_group", None)
    if sys.platform != "win32" and group == process.pid and group != os.getpgrp():
        if _signal_owned_group(process, group, signal.SIGTERM):
            try:
                process.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                pass
            # A leader can exit before its children. Reclaim any descendants
            # even after the leader has been reaped.
            _signal_owned_group(process, group, signal.SIGKILL)
    elif process.poll() is None:
        process.kill()
    try:
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _dpapi(data, decrypt):
    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    backing = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(backing, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes, kernel.LocalFree.restype = [ctypes.c_void_p], ctypes.c_void_p
    method = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    method.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p if decrypt else ctypes.c_wchar_p,
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(Blob)]
    method.restype = ctypes.c_int
    if not method(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise SecretStoreError("Windows 账户无法处理加密数据，请使用保存时的账户。")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


class _Keychain:
    """Native Security.framework: no shell, CLI arguments, or temporary secret."""
    def __init__(self):
        try:
            self.cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            self.sec = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
        except OSError:
            raise SecretStoreError("macOS Keychain 不可用；未保存明文凭据。") from None
        pointer = ctypes.c_void_p
        self.cf.CFStringCreateWithCString.argtypes = [pointer, ctypes.c_char_p, ctypes.c_uint32]
        self.cf.CFStringCreateWithCString.restype = pointer
        self.cf.CFDataCreate.argtypes = [pointer, pointer, ctypes.c_long]
        self.cf.CFDataCreate.restype = pointer
        self.cf.CFDictionaryCreate.argtypes = [pointer, ctypes.POINTER(pointer), ctypes.POINTER(pointer), ctypes.c_long, pointer, pointer]
        self.cf.CFDictionaryCreate.restype = pointer
        self.cf.CFRelease.argtypes = [pointer]
        self.cf.CFRelease.restype = None
        self.cf.CFDataGetLength.argtypes, self.cf.CFDataGetLength.restype = [pointer], ctypes.c_long
        self.cf.CFDataGetBytePtr.argtypes, self.cf.CFDataGetBytePtr.restype = [pointer], pointer
        self.sec.SecItemAdd.argtypes = [pointer, ctypes.POINTER(pointer)]
        self.sec.SecItemAdd.restype = ctypes.c_int32
        self.sec.SecItemCopyMatching.argtypes = [pointer, ctypes.POINTER(pointer)]
        self.sec.SecItemCopyMatching.restype = ctypes.c_int32
        self.sec.SecItemDelete.argtypes, self.sec.SecItemDelete.restype = [pointer], ctypes.c_int32

    def _constant(self, library, name):
        return ctypes.c_void_p.in_dll(library, name).value

    def _dictionary(self, account, data=None, read=False):
        owned = []
        def string(value):
            result = self.cf.CFStringCreateWithCString(None, value.encode("utf-8"), 0x08000100)
            if not result:
                raise SecretStoreError("Keychain 请求无法创建。")
            owned.append(result)
            return result
        entries = [("kSecClass", self._constant(self.sec, "kSecClassGenericPassword")),
                   ("kSecAttrService", string(KEYCHAIN_SERVICE)), ("kSecAttrAccount", string(account))]
        if data is not None:
            backing = ctypes.create_string_buffer(data)
            value = self.cf.CFDataCreate(None, backing, len(data))
            if not value:
                raise SecretStoreError("Keychain 请求无法创建。")
            owned.append(value)
            entries.append(("kSecValueData", value))
        if read:
            entries.extend([("kSecReturnData", self._constant(self.cf, "kCFBooleanTrue")),
                            ("kSecMatchLimit", self._constant(self.sec, "kSecMatchLimitOne"))])
        pointer = ctypes.c_void_p
        keys = (pointer * len(entries))(*(self._constant(self.sec, key) for key, _ in entries))
        values = (pointer * len(entries))(*(value for _, value in entries))
        try:
            result = self.cf.CFDictionaryCreate(None, keys, values, len(entries),
                ctypes.addressof(ctypes.c_byte.in_dll(self.cf, "kCFTypeDictionaryKeyCallBacks")),
                ctypes.addressof(ctypes.c_byte.in_dll(self.cf, "kCFTypeDictionaryValueCallBacks")))
            if not result:
                raise SecretStoreError("Keychain 请求无法创建。")
            return result
        finally:
            for item in owned:
                self.cf.CFRelease(item)

    def add(self, account, data):
        query = self._dictionary(account, data=data)
        try:
            status = self.sec.SecItemAdd(query, None)
        finally:
            self.cf.CFRelease(query)
        if status:
            raise SecretStoreError(f"Keychain 保存失败（系统代码 {status}）；未写入明文凭据。")

    def read(self, account):
        query = self._dictionary(account, read=True)
        value = ctypes.c_void_p()
        try:
            status = self.sec.SecItemCopyMatching(query, ctypes.byref(value))
            if status or not value.value:
                raise SecretStoreError(f"Keychain 无法读取凭据（系统代码 {status}），请解锁或重新配置。")
            length = self.cf.CFDataGetLength(value)
            if not 1 <= length <= 1024 * 1024:
                raise SecretStoreError("Keychain 数据格式不正确。")
            return ctypes.string_at(self.cf.CFDataGetBytePtr(value), length)
        finally:
            self.cf.CFRelease(query)
            if value.value:
                self.cf.CFRelease(value)

    def delete(self, account):
        # Used only for an exact, app-owned random account, e.g. native CI test.
        query = self._dictionary(account)
        try:
            status = self.sec.SecItemDelete(query)
            if status not in (0, -25300):
                raise SecretStoreError(f"Keychain 删除失败（系统代码 {status}）。")
        finally:
            self.cf.CFRelease(query)


def protect_bytes(data, decrypt=False):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 1024 * 1024:
        raise SecretStoreError("加密数据格式不正确。")
    if sys.platform == "win32":
        if decrypt and data.startswith(KEYCHAIN_PREFIX):
            raise SecretStoreError("这是另一台 Mac 的 Keychain 引用，请在本机重新配置。")
        return _dpapi(data, decrypt)
    if sys.platform == "darwin":
        if decrypt:
            if not data.startswith(KEYCHAIN_PREFIX):
                raise SecretStoreError("此数据不是本机 Keychain 引用，Windows 加密数据需在原账户导出后重新配置。")
            account = data[len(KEYCHAIN_PREFIX):].decode("ascii", errors="replace")
            if not re.fullmatch(r"[a-f0-9]{32}", account):
                raise SecretStoreError("Keychain 引用格式不正确。")
            return _Keychain().read(account)
        account = uuid.uuid4().hex
        _Keychain().add(account, data)
        return KEYCHAIN_PREFIX + account.encode("ascii")
    raise SecretStoreError("当前系统尚未配置安全凭据存储；不会使用明文保存密钥。")
