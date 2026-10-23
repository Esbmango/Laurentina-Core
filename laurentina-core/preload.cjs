"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const actions = new Set([
  'window.companion.hit_regions',
  'avatar.delete','touch.list','touch.configure','touch.add_text','touch.import','touch.delete','companion.touch','companion.touch.end','window.main.hide',
  "bootstrap", "health.get", "conversation.create", "conversation.get",
  "conversation.rename", "conversation.delete", "conversation.set_mode", "chat.send", "chat.poll", "chat.cancel",
  "settings.get", "settings.save", "character.get", "character.save",
  "memory.list", "memory.search", "memory.remember", "memory.delete",
  "profile.list", "profile.delete", "window.minimize", "window.maximize", "window.close",
  "file.work_root", "file.persona", "file.avatar", "app.open_data",
  "voice.status", "voice.settings.save", "voice.transcribe", "voice.speak", "voice.stop",
  "voice.prepare",
  "voice.start", "voice.poll",
  "voice.profiles.list", "voice.profiles.import", "voice.profiles.start", "voice.profiles.stop", "voice.profiles.use", "voice.profiles.delete",
  "work.validate", "resources.status", "resources.settings.save", "resources.continuous", "work.health", "work.targets", "work.start", "work.poll", "work.stop", "work.approve", "work.list",
  "window.orb", "window.main", "window.orb.hide", "ui.transcript", "ui.voice_state",
  "memory.confirm", "provider.list", "provider.save", "provider.delete", "provider.select", "provider.test",
  "chat.tasks", "chat.task.start", "chat.task.poll", "chat.task.stop", "chat.task.approve",
  "companion.get", "companion.save", "file.companion", "window.companion.move", "provider.open_help",
  "workspace.get", "workspace.preferences.save", "project.create", "project.rename", "project.pin", "conversation.organize",
  "skills.list", "skills.import", "skills.read", "avatar.list", "avatar.import", "avatar.select", "avatar.configure",
]);

contextBridge.exposeInMainWorld("laurentina", Object.freeze({
  version: "0.9.1",
  onTouchRequest(callback) { if(typeof callback!=='function')return ()=>{};const handler=(_,payload)=>callback(payload);ipcRenderer.on('laurentina:touch-request',handler);return ()=>ipcRenderer.removeListener('laurentina:touch-request',handler); },
  onTouchResponse(callback) { if(typeof callback!=='function')return ()=>{};const handler=(_,payload)=>callback(payload);ipcRenderer.on('laurentina:touch-response',handler);return ()=>ipcRenderer.removeListener('laurentina:touch-response',handler); },
  request(action, payload = {}) {
    if (!actions.has(action)) return Promise.reject(new Error("暂不支持这项操作。"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Promise.reject(new Error("操作内容无效。"));
    }
    return ipcRenderer.invoke("laurentina:request", action, payload);
  },
  onTranscript(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on("laurentina:transcript", handler);
    return () => ipcRenderer.removeListener("laurentina:transcript", handler);
  },
  onVoiceState(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on("laurentina:voice-state", handler);
    return () => ipcRenderer.removeListener("laurentina:voice-state", handler);
  },
  onAvatarState(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on("laurentina:avatar-state", handler);
    return () => ipcRenderer.removeListener("laurentina:avatar-state", handler);
  },
  onCompanionState(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on("laurentina:companion-state", handler);
    return () => ipcRenderer.removeListener("laurentina:companion-state", handler);
  },
}));
