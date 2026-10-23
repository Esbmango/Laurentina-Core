"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "ui", "workspace.js"), "utf8");
const code = source.slice(source.indexOf("function avatarAnimationNames("), source.indexOf("function initializeWorkspaceUI("));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const nodes = new Map(), writes = [], feedback = [], deletions = [], modals = [];
  const node = () => ({ dataset: {}, disabled: false, value: "", children: [], replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); } });
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const backend = { active_id: "a", items: ["a", "b"].map(id => ({ id, name: id, kind: "spine", animations: ["Idle"], stateMap: { idle: "Idle" }, view: { zoom: id === "a" ? 1 : 1.2 } })) };
  const context = vm.createContext({ $, state: { avatarLibrary: structuredClone(backend) }, el: () => node(), button: () => node(), tr: text => text,
    feedback: (...args) => feedback.push(args), errorText: error => error.message,
    openModal: value => modals.push(value), renderCompanionArtwork() {},
    rpc: (action, payload) => {
      if (action === "avatar.list") return Promise.resolve(structuredClone(backend));
      if (action === "avatar.delete") {
        deletions.push(structuredClone(payload)); const activeDeleted = backend.active_id === payload.id;
        backend.items = backend.items.filter(item => item.id !== payload.id); if (activeDeleted) backend.active_id = null;
        return Promise.resolve({ id: payload.id, active_id: backend.active_id, active_deleted: activeDeleted, trashed: true });
      }
      if (action !== "avatar.configure") throw new Error(action);
      return new Promise((resolve, reject) => writes.push({ ...structuredClone(payload), reject, resolve() {
        const item = backend.items.find(item => item.id === payload.id);
        if (payload.zoom !== undefined) item.view.zoom = payload.zoom;
        for (const field of ['idle', 'speaking', 'thinking', 'touch']) if (payload[field + '_animation'] !== undefined) item.stateMap[field] = payload[field + '_animation'];
        resolve(structuredClone(item));
      } }));
    } });
  vm.runInContext(code, context); context.renderAvatarLibrary();
  return { context, $, backend, writes, feedback, deletions, modals };
}
test("rapid slider saves are serialized and retain the most recent value", async () => {
  const f = fixture(); f.$("avatar-character-zoom").value = 1.5; const first = f.context.saveAvatarZoom();
  f.$("avatar-character-zoom").value = 2.5; const second = f.context.saveAvatarZoom(); await flush();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].zoom, 1.5);
  f.writes[0].resolve(); await flush(); assert.equal(f.writes.length, 2); assert.equal(f.writes[1].zoom, 2.5);
  f.writes[1].resolve(); await Promise.all([first, second]);
  assert.equal(f.backend.items[0].view.zoom, 2.5); assert.equal(Number(f.$("avatar-character-zoom").value), 2.5);
});
test("a selection update cannot apply an old character's form value to the new one", async () => {
  const f = fixture(); f.$("avatar-character-zoom").value = 2.8;
  f.context.state.avatarLibrary.active_id = "b"; await f.context.saveAvatarZoom(); await flush(); assert.equal(f.writes.length, 0);
  f.context.renderAvatarLibrary(); assert.equal(Number(f.$("avatar-character-zoom").value), 1.2);
  f.$("avatar-character-zoom").value = 1.8; const saved = f.context.saveAvatarZoom(); await flush(); assert.equal(f.writes[0].id, "b");
  f.context.state.avatarLibrary.active_id = "a"; f.context.renderAvatarLibrary(); f.writes[0].resolve(); await saved;
  assert.equal(f.backend.items[0].view.zoom, 1); assert.equal(f.backend.items[1].view.zoom, 1.8);
  assert.equal(Number(f.$("avatar-character-zoom").value), 1);
});
test("older library responses cannot replace a more recent character selection", async () => {
  const f = fixture(), loads = []; f.context.rpc = () => new Promise(resolve => loads.push(resolve));
  const first = f.context.loadAvatarLibrary(), second = f.context.loadAvatarLibrary();
  loads[1]({ ...structuredClone(f.backend), active_id: "b" }); await second;
  loads[0](structuredClone(f.backend)); await first;
  assert.equal(f.context.state.avatarLibrary.active_id, "b"); assert.equal(f.$("avatar-character-zoom").dataset.avatarId, "b");
});
test("a save completion does not overwrite a newer drag before its change event", async () => {
  const f = fixture(); f.$("avatar-character-zoom").value = 1.5; const first = f.context.saveAvatarZoom(); await flush();
  f.$("avatar-character-zoom").value = 2.7; f.context.previewAvatarZoom(); f.writes[0].resolve(); await first;
  assert.equal(Number(f.$("avatar-character-zoom").value), 2.7); assert.equal(f.$("avatar-character-zoom-label").textContent, "270%");
  const last = f.context.saveAvatarZoom(); await flush(); assert.equal(f.writes[1].zoom, 2.7); f.writes[1].resolve(); await last;
});
test("reset updates the slider immediately and a failed old save does not block the latest one", async () => {
  const f = fixture(); f.$("avatar-character-zoom").value = 2; const first = f.context.saveAvatarZoom(); await flush();
  const reset = f.context.saveAvatarZoom(true); assert.equal(Number(f.$("avatar-character-zoom").value), 1);
  f.writes[0].reject(new Error("old request failed")); await flush(); assert.equal(f.writes[1].zoom, 1);
  f.writes[1].resolve(); await Promise.all([first, reset]); assert.equal(f.feedback.length, 0); assert.equal(f.backend.items[0].view.zoom, 1);
});
test("800 percent zoom saves through the same per-character queue", async () => {
  const f = fixture(); f.$('avatar-character-zoom').value = 8; const saved = f.context.saveAvatarZoom(); await flush();
  assert.equal(f.writes[0].zoom, 8); f.writes[0].resolve(); await saved;
  assert.equal(f.backend.items[0].view.zoom, 8); assert.equal(f.$('avatar-character-zoom-label').textContent, '800%');
});
function addMotions(f) {
  for (const item of f.backend.items) item.animations = ['Idle', 'Talk', 'Interact'];
  f.context.state.avatarLibrary = structuredClone(f.backend); f.context.renderAvatarLibrary();
}
test("touch and other unsaved animation choices survive refreshes and character switches", async () => {
  const f = fixture(); addMotions(f);
  f.$('avatar-touch-animation').value = 'Interact'; f.$('avatar-speaking-animation').value = 'Talk';
  await f.context.loadAvatarLibrary();
  assert.equal(f.$('avatar-touch-animation').value, 'Interact'); assert.equal(f.$('avatar-speaking-animation').value, 'Talk');
  f.context.state.avatarLibrary.active_id = 'b'; f.context.renderAvatarLibrary(); assert.equal(f.$('avatar-touch-animation').value, '');
  f.context.state.avatarLibrary.active_id = 'a'; f.context.renderAvatarLibrary(); assert.equal(f.$('avatar-touch-animation').value, 'Interact');
  const saved = f.context.saveAvatarAnimations(); await flush(); assert.equal(f.writes[0].touch_animation, 'Interact');
  f.writes[0].resolve(); await saved; assert.equal(f.backend.items[0].stateMap.touch, 'Interact');
});
test("animation edits made during save remain unsaved drafts after the response", async () => {
  const f = fixture(); addMotions(f); f.$('avatar-touch-animation').value = 'Interact';
  const saved = f.context.saveAvatarAnimations(); await flush(); f.$('avatar-touch-animation').value = 'Talk';
  f.writes[0].resolve(); await saved;
  assert.equal(f.backend.items[0].stateMap.touch, 'Interact'); assert.equal(f.$('avatar-touch-animation').value, 'Talk');
});
test("delete requires its modal confirmation and preserves another character's unsaved drafts", async () => {
  const f = fixture(); addMotions(f); f.$('avatar-touch-animation').value = 'Interact'; f.$('composer').value = 'unfinished chat';
  f.context.state.companionDirty = true; f.$('companion-mode').value = 'illustration';
  f.context.deleteAvatar(f.backend.items[1]); assert.equal(f.deletions.length, 0); assert.equal(f.modals.length, 1);
  await f.modals[0].onSubmit();
  assert.deepEqual(f.deletions, [{ id: 'b' }]); assert.equal(f.$('avatar-touch-animation').value, 'Interact');
  assert.equal(f.$('composer').value, 'unfinished chat'); assert.equal(f.context.state.companionDirty, true); assert.equal(f.$('companion-mode').value, 'illustration');
});
test("deleting the active avatar returns its current form to orb after queued zoom completes", async () => {
  const f = fixture(); f.$('companion-mode').value = 'avatar'; f.$('avatar-character-zoom').value = 6;
  const saving = f.context.saveAvatarZoom(); await flush(); const deleting = f.context.removeAvatarResource('a'); await flush();
  assert.equal(f.deletions.length, 0); f.writes[0].resolve(); await Promise.all([saving, deleting]);
  assert.deepEqual(f.deletions, [{ id: 'a' }]); assert.equal(f.context.state.avatarLibrary.active_id, null);
  assert.equal(f.$('companion-mode').value, 'orb'); assert.equal(f.context.state.avatarLibrary.items[0].id, 'b');
});
test("a failed delete keeps the original selection, model settings and unfinished chat", async () => {
  const f = fixture(); addMotions(f); const originalRPC = f.context.rpc;
  f.context.rpc = (action, payload) => action === 'avatar.delete' ? Promise.reject(new Error('resource busy')) : originalRPC(action, payload);
  f.$('companion-mode').value = 'avatar'; f.$('avatar-touch-animation').value = 'Interact'; f.$('composer').value = 'do not discard';
  await assert.rejects(f.context.removeAvatarResource('a'), /resource busy/);
  assert.equal(f.context.state.avatarLibrary.active_id, 'a'); assert.equal(f.$('avatar-touch-animation').value, 'Interact');
  assert.equal(f.$('composer').value, 'do not discard'); assert.equal(f.$('companion-mode').value, 'avatar');
});
