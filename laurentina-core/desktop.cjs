"use strict";

const { app, BrowserWindow, ipcMain, dialog, protocol, session, shell, screen, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { CompanionStore, geometry, imageData, imageInfo, dimensions, dragAnchor, dragPosition, MAX_IMAGE } = require("./companion.cjs");
const { helpUrl } = require("./provider_help.cjs");
const { AvatarLibrary } = require("./avatar_library.cjs");
const { TouchLibrary } = require('./touch_library.cjs');
const { CompanionHitTest } = require('./companion_hit_test.cjs');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA = path.resolve(process.env.LAURENTINA_CORE_DATA || path.join(ROOT, ".local"));
const PYTHON = process.env.LAURENTINA_CORE_PYTHON || path.resolve(ROOT, "../hy-memory-starter/.venv/Scripts/python.exe");
const MAIN_URL = "laurentina://app/index.html";
// A separate origin keeps Chromium's per-origin zoom away from the main panel.
const ORB_URL = "laurentina://companion/orb.html";
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: laurentina-avatar:; media-src 'self' data: blob: laurentina-avatar:; font-src 'self'; connect-src 'self' laurentina-avatar: laurentina-touch:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const API_ACTIONS = new Set([
  "bootstrap", "health.get", "conversation.create", "conversation.get", "conversation.rename",
  "conversation.delete", "conversation.set_mode", "chat.send", "chat.poll", "chat.cancel", "settings.get", "settings.save",
  "character.get", "character.save", "memory.list", "memory.search", "memory.remember",
  "memory.delete", "profile.list", "profile.delete",
  "voice.status", "voice.settings.save", "voice.transcribe", "voice.speak", "voice.stop",
  "voice.prepare",
  "voice.start", "voice.poll",
  "voice.profiles.list", "voice.profiles.import", "voice.profiles.start", "voice.profiles.stop", "voice.profiles.use", "voice.profiles.delete",
  "work.validate", "resources.status", "resources.settings.save", "resources.continuous", "work.health", "work.targets", "work.start", "work.poll", "work.stop", "work.approve", "work.list",
  "memory.confirm", "provider.list", "provider.save", "provider.delete", "provider.select", "provider.test",
  "chat.tasks", "chat.task.start", "chat.task.poll", "chat.task.stop", "chat.task.approve",
  "workspace.get", "workspace.preferences.save", "project.create", "project.rename", "project.pin", "conversation.organize",
  "skills.list", "skills.import", "skills.read",
]);
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, "desktop"), { recursive: true });
const companion = new CompanionStore(DATA);
const avatars = new AvatarLibrary(DATA);
const touchLibrary = new TouchLibrary(DATA);
let pendingTouch = null, touchTimeout = null;
function touchEvent(value) { for (const target of [window, orbWindow]) if(target&&!target.isDestroyed()) target.webContents.send('laurentina:touch-response',value); }
function endTouch(id,busy=false) { if(pendingTouch!==id)return;clearTimeout(touchTimeout);pendingTouch=null;touchEvent({id,phase:'end',busy});if(currentVoiceState.source==='touch'&&currentVoiceState.touch_id===id){currentVoiceState={...currentVoiceState,source:null,touch_id:null,speaking:false,level:0,text:''};for(const target of [window,orbWindow])if(target&&!target.isDestroyed())target.webContents.send('laurentina:voice-state',currentVoiceState);} }
app.setName("Laurentina");
app.setPath("userData", path.join(DATA, "desktop"));
app.setAppUserModelId("local.laurentina.core");
protocol.registerSchemesAsPrivileged([
  { scheme: "laurentina", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "laurentina-avatar", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'laurentina-touch', privileges: { standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true } },
]);

let window = null;
let orbWindow = null;
let currentVoiceState = { recording: false, speaking: false, thinking: false, level: 0, text: "", conversation_id: null, mode: 'daily', context_captured: false };
let backend = null;
let backendConnection = null;
let quitting = false;
let companionDrag = null;
let companionDragNumber = 0;
let companionSize = null;
const companionHitTest = new CompanionHitTest();
let companionHitTimer = null, companionMouseIgnored = false;
function updateCompanionHitTest() {
  if (!orbWindow || orbWindow.isDestroyed() || !orbWindow.isVisible()) return;
  const ignored = companionHitTest.ignore(orbWindow.getContentBounds(), screen.getCursorScreenPoint(), { dragging: Boolean(companionDrag) });
  if (ignored !== companionMouseIgnored) {
    orbWindow.setIgnoreMouseEvents(ignored, { forward: true });
    companionMouseIgnored = ignored;
  }
}
function stopCompanionHitTest() {
  if (companionHitTimer) clearInterval(companionHitTimer);
  companionHitTimer = null; companionHitTest.reset();
  if (companionMouseIgnored && orbWindow && !orbWindow.isDestroyed()) orbWindow.setIgnoreMouseEvents(false);
  companionMouseIgnored = false;
}
function startCompanionHitTest() {
  stopCompanionHitTest();
  companionHitTimer = setInterval(updateCompanionHitTest, 40);
  companionHitTimer.unref();
}
const nativeVerification = process.env.LAURENTINA_NATIVE_VERIFY === "1" ? [] : null;

function recordNativeVerification(record) {
  if (!nativeVerification) return;
  nativeVerification.push({ at: new Date().toISOString(), ...record });
  if (nativeVerification.length > 24) nativeVerification.shift();
  // Explicit opt-in for isolated native QA only. No messages, images, tokens or
  // cursor path are collected, and ordinary app launches never write this file.
  try { fs.writeFileSync(path.join(DATA, "native-verification.json"), JSON.stringify({ events: nativeVerification }, null, 2), { encoding: "utf8", mode: 0o600 }); } catch {}
}

function endCompanionDrag(reason = "cancelled") {
  if (companionDrag) clearInterval(companionDrag.timer);
  const previous = companionDrag;
  companionDrag = null;
  if (previous) recordNativeVerification({ event: "drag-end", id: previous.id, reason,
    moved: previous.moved, origin: previous.bounds,
    final: orbWindow && !orbWindow.isDestroyed() ? orbWindow.getBounds() : null });
  return previous;
}

function updateCompanionDrag() {
  const drag = companionDrag;
  if (!drag) return;
  if (!orbWindow || orbWindow.isDestroyed() || Date.now() - drag.started > 120000) { endCompanionDrag(); return; }
  const cursor = screen.getCursorScreenPoint();
  if (Math.hypot(cursor.x - drag.cursor.x, cursor.y - drag.cursor.y) > 4) drag.moved = true;
  if (!drag.moved) return;
  const position = dragPosition(drag.bounds, drag.cursor, cursor, screen.getAllDisplays().map(display => display.workArea));
  const current = orbWindow.getBounds();
  // On fractional Windows display scaling, setPosition can feed rounded native
  // dimensions back into the next move. Reapply the same nominal size every time.
  if (current.x !== position.x || current.y !== position.y) orbWindow.setBounds({ ...position, ...drag.size });
}

function validateImportedImage(bytes, mime) {
  const info = imageInfo(bytes, mime);
  // This Electron runtime decodes PNG/JPEG through nativeImage, but not GIF/WebP.
  // The latter and animated PNG use the browser's Image.decode() before acceptance.
  if (["image/png", "image/jpeg"].includes(mime) && !info.animated) {
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw new Error("图片无法读取，请换一张图片。");
    const size = decoded.getSize();
    dimensions(size.width, size.height);
  }
  return info;
}

function log(message) {
  // Technical lifecycle events only. Never log RPC payloads, responses or tokens.
  try { fs.appendFileSync(path.join(DATA, "desktop.log"), `${new Date().toISOString()} ${message}\n`); } catch {}
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ["PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__", "ELECTRON_RUN_AS_NODE"]) delete env[key];
    backend = spawn(PYTHON, ["-E", "-s", "-X", "utf8", path.join(ROOT, "core_backend.py"), "--data-dir", DATA, "--parent-pid", String(process.pid)], {
      cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("本地服务启动超时，请重新打开劳纶缇娜。")), 30000);
    const finish = (error, connection) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else { backendConnection = connection; resolve(connection); }
    };
    const lines = readline.createInterface({ input: backend.stdout });
    lines.on("line", line => {
      if (settled) return;
      try {
        const value = JSON.parse(line);
        if (Number.isInteger(value.port) && value.port > 0 && value.port < 65536 && typeof value.token === "string" && value.token.length >= 24) {
          finish(null, { port: value.port, token: value.token });
        }
      } catch { /* stdout may contain a dependency startup notice */ }
    });
    backend.stderr.on("data", () => { /* backend owns its bounded diagnostic log; no raw trace copying */ });
    backend.once("error", () => finish(new Error("本地服务无法启动，请检查项目环境。")));
    backend.once("exit", code => {
      log(`backend exit ${Number.isInteger(code) ? code : "signal"}`);
      backendConnection = null;
      finish(new Error("本地服务启动失败，请查看数据目录中的运行记录。"));
      if (!quitting && window && !window.isDestroyed()) {
        dialog.showMessageBox(window, { type: "error", title: "本地服务已停止", message: "请重新打开劳纶缇娜。", detail: "已保存的对话仍保存在本机。" });
      }
    });
  });
}

function rpc(action, payload) {
  return new Promise((resolve, reject) => {
    if (!backendConnection) { reject(new Error("本地服务尚未就绪，请稍后再试。")); return; }
    const body = Buffer.from(JSON.stringify({ action, payload }));
    if (body.length > 12 * 1024 * 1024) { reject(new Error("操作内容过大。")); return; }
    const req = http.request({
      host: "127.0.0.1", port: backendConnection.port, path: "/rpc", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length, "X-Core-Token": backendConnection.token },
    }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) { res.destroy(); reject(new Error("返回内容过大。")); }
        else chunks.push(chunk);
      });
      res.on("error", () => reject(new Error("本地服务连接中断，请重试。")));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!result.ok) reject(new Error(String(result.error || "操作没有完成。").slice(0, 700)));
          else resolve(result.result);
        } catch (error) { reject(error instanceof SyntaxError ? new Error("本地服务返回了无效结果。") : error); }
      });
    });
    req.setTimeout(200000, () => req.destroy(new Error("本地操作超时。")));
    req.on("error", () => reject(new Error("无法连接本地服务，请重新打开应用。")));
    req.end(body);
  });
}

function validSender(event) {
  return [[window, MAIN_URL], [orbWindow, ORB_URL]].some(([target, url]) => target && !target.isDestroyed() &&
    event.sender === target.webContents && event.senderFrame === target.webContents.mainFrame && event.senderFrame.url === url);
}

function showMain() {
  if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
}

function activeAvatar() {
  const library = avatars.list();
  return library.items.find(item => item.id === library.active_id) || null;
}

function companionPublic() {
  const value = companion.get();
  const area = orbWindow && !orbWindow.isDestroyed() ? screen.getDisplayMatching(orbWindow.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
  return { ...value, avatar: activeAvatar(), presentation_scale: geometry(value, area).presentationScale || 1 };
}

function publishAvatar() {
  const value = activeAvatar();
  for (const target of [window, orbWindow]) if (target && !target.isDestroyed()) target.webContents.send('laurentina:avatar-state', value);
  publishCompanion();
  return value;
}

async function showOrb() {
  endCompanionDrag();
  let settings = companionPublic();
  if (settings.mode === 'avatar' && !settings.avatar) {
    companion.save({ mode: 'orb' });
    settings = companionPublic();
    log('Selected avatar unavailable; companion restored to orb.');
  }
  const area = orbWindow && !orbWindow.isDestroyed() ? screen.getDisplayMatching(orbWindow.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
  const bounds = geometry(settings, area, orbWindow && !orbWindow.isDestroyed() ? orbWindow.getBounds() : null);
  settings = { ...settings, presentation_scale: bounds.presentationScale || 1 };
  if (nativeVerification && (!orbWindow || orbWindow.isDestroyed())) {
    bounds.x = area.x + Math.min(80, Math.max(0, area.width - bounds.width));
    bounds.y = area.y + Math.min(80, Math.max(0, area.height - bounds.height));
  }
  companionSize = { width: bounds.width, height: bounds.height };
  if (!orbWindow || orbWindow.isDestroyed()) {
    orbWindow = new BrowserWindow({
      width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
      frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false, title: "Laurentina · 悬浮球",
      icon: path.join(ROOT, "assets", "icon.png"),
      webPreferences: { preload: path.join(ROOT, "preload.cjs"), contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, webviewTag: false, devTools: false, spellcheck: false, backgroundThrottling: false },
    });
    orbWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    orbWindow.webContents.on("will-navigate", (event, url) => { if (url !== ORB_URL) event.preventDefault(); });
    orbWindow.webContents.on("will-attach-webview", event => event.preventDefault());
    orbWindow.on("closed", () => { endCompanionDrag("closed"); stopCompanionHitTest(); orbWindow = null; });
    orbWindow.on("hide", () => { endCompanionDrag("hidden"); stopCompanionHitTest(); });
    orbWindow.on("blur", () => endCompanionDrag("blurred"));
    await orbWindow.loadURL(ORB_URL);
    orbWindow.webContents.send("laurentina:voice-state", currentVoiceState);
  }
  orbWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  orbWindow.webContents.setZoomFactor(bounds.factor);
  orbWindow.setTitle(settings.mode === "orb" ? "Laurentina · 悬浮球" : "Laurentina · 桌宠");
  orbWindow.webContents.send("laurentina:companion-state", settings);
  orbWindow.show(); orbWindow.focus();
  startCompanionHitTest();
  recordNativeVerification({ event: "companion-shown", mode: settings.mode, bounds: orbWindow.getBounds() });
}

function publishCompanion() {
  const value = companionPublic();
  for (const target of [window, orbWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send("laurentina:companion-state", value);
  }
  return value;
}

async function importFile(type) {
  const persona = type === "persona";
  const illustration = type === "companion";
  const result = await dialog.showOpenDialog(window, {
    title: persona ? "导入人设文档" : illustration ? "导入桌宠图片或动图" : "导入角色头像", properties: ["openFile"],
    filters: persona ? [{ name: "人设文档", extensions: ["md", "txt"] }] : [{ name: illustration ? "静态图片与动图" : "角色图片", extensions: illustration ? ["png", "jpg", "jpeg", "webp", "gif"] : ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  const file = result.filePaths[0];
  const ext = path.extname(file).toLowerCase();
  const allowed = persona ? [".md", ".txt"] : illustration ? [".png", ".jpg", ".jpeg", ".webp", ".gif"] : [".png", ".jpg", ".jpeg", ".webp"];
  const stat = await fs.promises.stat(file);
  if (!allowed.includes(ext) || !stat.isFile()) throw new Error("请选择支持的文件格式。");
  if (stat.size > (persona ? 128 * 1024 : illustration ? MAX_IMAGE : 20 * 1024 * 1024)) throw new Error(persona ? "人设文档请控制在 128 KB 以内。" : illustration ? "桌宠图片请控制在 25 MB 以内。" : "头像原图请控制在 20 MB 以内。");
  const bytes = await fs.promises.readFile(file);
  if (persona) {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    return { filename: path.basename(file), content };
  }
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext];
  validateImportedImage(bytes, mime);
  return { filename: path.basename(file), data_url: `data:${mime};base64,${bytes.toString("base64")}` };
}

function installIPC() {
  ipcMain.handle("laurentina:request", async (event, action, payload) => {
    if (!validSender(event)) throw new Error("操作来源无效。");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("操作内容无效。");
    if (action === 'skills.import' && event.sender !== window?.webContents) throw new Error('请从主面板导入技能。');
    if (API_ACTIONS.has(action)) return rpc(action, payload);
    if (action === 'window.companion.hit_regions') {
      if (event.sender !== orbWindow?.webContents) throw new Error('只能由桌宠更新透明区域。');
      companionHitTest.update(payload);
      updateCompanionHitTest();
      return { ok: true };
    }
    if(action.startsWith('touch.') || action==='companion.touch' || action==='companion.touch.end') {
      const fromMain=event.sender===window?.webContents;
      if(action==='companion.touch.end') {if(!fromMain)throw new Error('来源无效。');endTouch(payload.id,payload.busy===true);return {ok:true};}
      if(action==='companion.touch') {
        if(currentVoiceState.recording || currentVoiceState.thinking || (currentVoiceState.speaking && currentVoiceState.source!=='touch'))return {busy:true};
        const item=fromMain&&payload.clip_id ? touchLibrary.list().items.find(x=>x.id===payload.clip_id) : touchLibrary.choose();
        if(!item)return {disabled:true};
        if(pendingTouch)endTouch(pendingTouch);
        const id=crypto.randomUUID();pendingTouch=id;touchEvent({id,text:item.text,phase:'start',duration_ms:item.duration?item.duration*1000:undefined});
        touchTimeout=setTimeout(()=>endTouch(id),65000);touchTimeout.unref();
        window.webContents.send('laurentina:touch-request',{...item,id});return {id};
      }
      if(!fromMain)throw new Error('请从主面板管理触碰回应。');
      if(action==='touch.list')return touchLibrary.list();
      if(action==='touch.configure') {
        const value=touchLibrary.configure(payload);
        if(!value.enabled) { if(pendingTouch)endTouch(pendingTouch,true);touchEvent({phase:'cancel'}); }
        return value;
      }
      if(action==='touch.add_text')return touchLibrary.addText(payload.text);
      if(action==='touch.delete')return touchLibrary.delete(payload.id);
      if(action==='touch.import') {const picked=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Audio',extensions:['wav','mp3','flac','ogg']}]});if(picked.canceled)return {cancelled:true};return touchLibrary.importFile(picked.filePaths[0],payload.text||'');}
      throw new Error('不支持这个回应操作。');
    }
    if (action.startsWith('avatar.')) {
      const discovery = action === 'avatar.configure' && event.sender === orbWindow?.webContents &&
        Object.keys(payload).every(key=>['id','animations'].includes(key)) && Array.isArray(payload.animations) && payload.id === activeAvatar()?.id;
      if (event.sender !== window?.webContents && action !== 'avatar.list' && !discovery) throw new Error('请从主面板管理角色。');
      if (action === 'avatar.list') return avatars.list();
      if (action === 'avatar.import') {
        const chosen = await dialog.showOpenDialog(window, {title:'导入角色资源包或媒体',properties:['openFile'],filters:[
          {name:'角色与动态媒体',extensions:['zip','png','apng','jpg','jpeg','webp','gif','webm']} ]});
        if (chosen.canceled || !chosen.filePaths[0]) return {cancelled:true};
        return await avatars.importFile(chosen.filePaths[0], payload.name ? {name:payload.name} : {});
      }
      if (action === 'avatar.select') {
        const selected = await avatars.select(payload.id);
        companion.save({mode:selected ? 'avatar' : 'orb'});
        if (companion.get().visible) await showOrb();
        publishAvatar();
        return selected;
      }
      if (action === 'avatar.configure') {
        const configured = await avatars.configure(payload);
        publishAvatar();
        return configured;
      }
      if(action==='avatar.delete') {const result=avatars.delete(payload.id);if(result.active_deleted)companion.save({mode:'orb'});if(companion.get().visible)await showOrb();publishAvatar();return result;}
      throw new Error('不支持这个角色操作。');
    }
    if (action === "window.minimize") window.minimize();
    else if (action === "window.maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === "window.close") window.close();
    else if(action==='window.main.hide') {await showOrb();window.hide();}
    else if (action === "file.work_root") {
      if (event.sender !== window?.webContents) throw new Error("Only the main window can select a work folder");
      const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return result.canceled ? { cancelled: true } : { path: result.filePaths[0] };
    }
    else if (action === "file.persona") return importFile("persona");
    else if (action === "file.avatar") return importFile("avatar");
    else if (action === "file.companion") return importFile("companion");
    else if (action === "provider.open_help") {
      if (event.sender !== window?.webContents) throw new Error("请从主面板打开连接指南。");
      await shell.openExternal(helpUrl(payload.provider, payload.page || "docs"));
    }
    else if (action === "app.open_data") { await shell.openPath(DATA); }
    else if (action === "companion.get") return companionPublic();
    else if (action === "companion.save") {
      if (payload.mode === 'avatar' && !activeAvatar()) throw new Error('请先导入并选择一个角色。');
      if (payload.artwork) {
        imageData(payload.artwork);
        const separator = payload.artwork.indexOf(";base64,");
        validateImportedImage(Buffer.from(payload.artwork.slice(separator + 8), "base64"), payload.artwork.slice(5, separator));
      }
      const saved = companion.save(payload);
      if (saved.visible) await showOrb();
      else if (orbWindow && !orbWindow.isDestroyed()) orbWindow.hide();
      return publishCompanion();
    }
    else if (action === "window.orb") { companion.save({ visible: true }); await showOrb(); publishCompanion(); }
    else if (action === "window.main") showMain();
    else if (action === "window.orb.hide") { companion.save({ visible: false }); if (orbWindow) orbWindow.hide(); publishCompanion(); showMain(); }
    else if (action === "window.companion.move") {
      if (!orbWindow || orbWindow.isDestroyed() || event.sender !== orbWindow.webContents || !["start", "end", "cancel"].includes(payload.phase)) throw new Error("桌宠移动操作无效。");
      if (payload.phase === "start") {
        if (companionMouseIgnored) { orbWindow.setIgnoreMouseEvents(false); companionMouseIgnored = false; }
        // Capture the pointerdown location, not a later cursor position after IPC.
        // CSS pixels * page zoom become DIP; monitor DPI is already handled by Electron.
        const cursor = dragAnchor(orbWindow.getContentBounds(), orbWindow.webContents.getZoomFactor(), payload);
        endCompanionDrag();
        const bounds = orbWindow.getBounds();
        companionDrag = { id: ++companionDragNumber, cursor, bounds,
          size: { ...(companionSize || { width: bounds.width, height: bounds.height }) }, moved: false, started: Date.now() };
        recordNativeVerification({ event: "drag-start", id: companionDrag.id, origin: companionDrag.bounds });
        companionDrag.timer = setInterval(updateCompanionDrag, 16);
        return { id: companionDrag.id };
      }
      if (!companionDrag || payload.id !== companionDrag.id) return { moved: true, cancelled: true };
      if (payload.phase === "end") updateCompanionDrag();
      const completed = endCompanionDrag(payload.phase);
      return { moved: completed?.moved !== false, cancelled: payload.phase === "cancel" };
    }
    else if (action === "ui.transcript") {
      if (typeof payload.text !== "string" || payload.text.length > 20000) throw new Error("录音内容过长。");
      const openPanel = payload.open_panel !== false;
      if(openPanel) showMain();
      if (payload.conversation_id !== undefined && payload.conversation_id !== null && (typeof payload.conversation_id !== 'string' || payload.conversation_id.length > 100)) throw new Error('语音所属对话无效。');
      if (payload.mode_revision != null && (!Number.isSafeInteger(payload.mode_revision) || payload.mode_revision < 0)) throw new Error('语音所属模式无效。');
      if (window) window.webContents.send("laurentina:transcript", { text: payload.text, submit:payload.submit === true,
        context_captured:payload.context_captured === true, conversation_id:payload.conversation_id ?? null,
        mode:payload.mode === 'private' ? 'private' : 'daily', mode_revision:payload.mode_revision ?? null, open_panel:openPanel });
    }
    else if (action === "ui.voice_state") {
      const fromMain = event.sender === window?.webContents;
      const value = { ...currentVoiceState, recording: payload.recording === true, speaking: payload.speaking === true,
        thinking: fromMain ? payload.thinking === true : currentVoiceState.thinking,
        level:typeof payload.level === 'number' && Number.isFinite(payload.level) ? Math.max(0,Math.min(1,payload.level)) : 0,
        text: typeof payload.text === "string" ? payload.text.slice(0, 160) : "" };
      if (fromMain) {
        value.source = payload.source === 'touch' ? 'touch' : null;
        value.touch_id = value.source === 'touch' && typeof payload.touch_id==='string' ? payload.touch_id : null;
        value.conversation_id = typeof payload.conversation_id === 'string' && payload.conversation_id.length <= 100 ? payload.conversation_id : null;
        value.mode = payload.mode === 'private' ? 'private' : 'daily';
        value.mode_revision = Number.isSafeInteger(payload.mode_revision) && payload.mode_revision >= 0 ? payload.mode_revision : null;
        value.context_captured = true;
      }
      if(!fromMain){value.source=null;value.touch_id=null;}
      if (value.recording && !currentVoiceState.recording) log("voice recording started");
      if (value.speaking && value.text.startsWith("正在朗读") && value.text !== currentVoiceState.text) log("voice playback started");
      if (!value.recording && !value.speaking && (currentVoiceState.recording || currentVoiceState.speaking)) log("voice idle");
      currentVoiceState = value;
      for (const target of [window, orbWindow]) {
        if (target && !target.isDestroyed() && target.webContents !== event.sender) target.webContents.send("laurentina:voice-state", value);
      }
    }
    else throw new Error("暂不支持这项操作。");
    return { ok: true };
  });
}

async function createWindow() {
  const display = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    width: Math.min(1320, display.width), height: Math.min(870, display.height),
    minWidth: 960, minHeight: 660, frame: false, backgroundColor: "#18191b",
    icon: path.join(ROOT, "assets", "icon.png"),
    title: "Laurentina · 劳纶缇娜", show: false,
    webPreferences: { preload: path.join(ROOT, "preload.cjs"), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false, devTools: false, backgroundThrottling:false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (url !== MAIN_URL) event.preventDefault(); });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("render-process-gone", (_, detail) => log(`renderer exited ${detail.reason}`));
  window.once("ready-to-show", () => { window.show(); window.focus(); });
  window.on("closed", () => { window = null; if (orbWindow && !orbWindow.isDestroyed()) orbWindow.destroy(); app.quit(); });
  await window.loadURL(MAIN_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    protocol.handle('laurentina-touch',async request=>{try{const url=new URL(request.url);if(request.method!=='GET'||url.host!=='audio'||url.search||url.hash||!/^\/[0-9a-f-]{36}\.wav$/.test(url.pathname))return new Response('',{status:404});return new Response(await fs.promises.readFile(touchLibrary.asset(url.pathname.slice(1,-4))),{headers:{'Content-Type':'audio/wav','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});}catch{return new Response('',{status:404})}});
    protocol.handle('laurentina-avatar', async request => {
      try {
        const url = new URL(request.url);
        if (!['GET','HEAD'].includes(request.method) || url.search || url.hash) return new Response('Not found',{status:404});
        const asset = avatars.resolveAsset(url.hostname, decodeURIComponent(url.pathname.slice(1)));
        const info = await fs.promises.stat(asset.path);
        const headers = {'Content-Type':asset.mime,'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes',
          'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
        const range=request.headers.get('range');
        let start=0,end=info.size-1,status=200;
        if (range) {
          const match=/^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});
          if (!match[1]) start=Math.max(0,info.size-Number(match[2]));
          else { start=Number(match[1]); if (match[2]) end=Math.min(end,Number(match[2])); }
          if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=info.size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});
          status=206; headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
        }
        headers['Content-Length']=String(Math.max(0,end-start+1));
        const body=request.method==='HEAD' ? null : (await fs.promises.readFile(asset.path)).subarray(start,end+1);
        return new Response(body,{status,headers});
      } catch { return new Response('Not found',{status:404}); }
    });
    protocol.handle("laurentina", async request => {
      const url = new URL(request.url);
      const files = url.host === "app" ? { "/index.html": "text/html; charset=utf-8", "/logo-v1.png": "image/png", "/app.js": "text/javascript; charset=utf-8", "/styles.css": "text/css; charset=utf-8", '/i18n.js':'text/javascript; charset=utf-8','/workspace.js':'text/javascript; charset=utf-8','/speech_pipeline.js':'text/javascript; charset=utf-8','/voice_capture_worklet.js':'text/javascript; charset=utf-8' } :
        url.host === "companion" ? { "/orb.html": "text/html; charset=utf-8", "/orb.js": "text/javascript; charset=utf-8", "/companion-interaction.js": "text/javascript; charset=utf-8", "/orb.css": "text/css; charset=utf-8", '/i18n.js':'text/javascript; charset=utf-8' } : {};
      if (['app','companion'].includes(url.host) && url.pathname.startsWith('/avatars/')) {
        const ownPath=decodeURIComponent(url.pathname.slice(1));
        const resolved=path.resolve(ROOT,'ui',ownPath);
        const prefix=path.resolve(ROOT,'ui','avatars')+path.sep;
        const mime={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css; charset=utf-8','.wasm':'application/wasm'}[path.extname(resolved)];
        if (resolved.startsWith(prefix) && mime) files[url.pathname]=mime;
      }
      if (request.method !== "GET" || !files[url.pathname]) return new Response("Not found", { status: 404 });
      try {
        const bytes = await fs.promises.readFile(path.join(ROOT, "ui", url.pathname.slice(1)));
        return new Response(bytes, { headers: { "Content-Type": files[url.pathname], "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
      } catch { return new Response("Unable to load application", { status: 500 }); }
    });
    const ownContents = contents => [window, orbWindow].some(target => target && !target.isDestroyed() && target.webContents === contents);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const allowed = permission === "media" && ownContents(contents) &&
        [MAIN_URL, ORB_URL].includes(contents.getURL()) && (details.mediaTypes || []).every(type => type === "audio");
      callback(allowed);
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
      permission === "media" && ownContents(contents) && [MAIN_URL, ORB_URL].includes(contents.getURL()) && details.mediaType !== "video");
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith("laurentina://app/") && !details.url.startsWith("laurentina://companion/") && !details.url.startsWith('laurentina-avatar://') && !details.url.startsWith('laurentina-touch://audio/') && !details.url.startsWith("data:") && !details.url.startsWith("blob:laurentina://app/") && !details.url.startsWith("blob:laurentina://companion/") && details.url !== "about:blank" });
    });
    installIPC();
    await startBackend();
    await createWindow();
    if (companion.get().visible) await showOrb();
    log("desktop ready");
  }).catch(error => {
    log("startup failed");
    dialog.showErrorBox("劳纶缇娜未能启动", String(error.message || "请检查本地环境。"));
    app.quit();
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { quitting = true; endCompanionDrag(); stopCompanionHitTest(); if (backend && !backend.killed) backend.kill(); });
