"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "ui", "orb.js"), "utf8");
const render = source.slice(source.indexOf("async function renderCompanion(value)"), source.indexOf("async function refreshCompanion()"));
function scene(create) {
  const element = { hidden: false, replaceChildren() {}, classList: { toggle() {} } };
  const context = vm.createContext({ companion: {}, avatarAdapter: null, companionHitSource: null, renderedArtwork: "", renderVersion: 0,
    document: { body: element }, $: () => element, window: { LaurentinaAvatars: { create } },
    assistantState: { state: "idle" }, touchFeedback: { cancel() {} }, applyAssistantState() {}, rpc: () => Promise.resolve(), status() {} });
  vm.runInContext(render, context); return context;
}
const manifest = zoom => ({ mode: "avatar", avatar: { id: "existing-character", kind: "spine", files: [{ path: "model.png" }], animations: ["Idle"], stateMap: { idle: "Idle" }, view: { zoom } } });

test("orb model zoom preserves an existing adapter and animation", async () => {
  let creates = 0, disposes = 0; const applied = [];
  const context = scene(async () => { creates++; return { animations: ["Idle"], setZoom(value) { applied.push(value); }, dispose() { disposes++; } }; });
  await context.renderCompanion(manifest(1)); await context.renderCompanion(manifest(2)); await context.renderCompanion(manifest(.5));
  assert.equal(creates, 1); assert.equal(disposes, 0); assert.deepEqual(applied, [1, 2, .5]);
  const changed = manifest(1); changed.avatar.stateMap.idle = "Special"; await context.renderCompanion(changed);
  assert.equal(creates, 2); assert.equal(disposes, 1);
});
test('beyond-screen presentation changes reuse the same animation adapter',async()=>{
  let creates=0;const scales=[];const context=scene(async()=>{creates++;return{animations:['Idle'],setZoom(){},setPresentationScale(value){scales.push(value)},dispose(){}}});
  await context.renderCompanion({...manifest(1),presentation_scale:1.5});await context.renderCompanion({...manifest(1),presentation_scale:3});
  assert.equal(creates,1);assert.deepEqual(scales,[1.5,3]);
});

test("zoom changes made while a model loads apply to the eventual adapter", async () => {
  let complete, creates = 0; const applied = [];
  const context = scene(() => { creates++; return new Promise(resolve => { complete = resolve; }); });
  const loading = context.renderCompanion(manifest(1)); await context.renderCompanion(manifest(2.5));
  complete({ animations: ["Idle"], setZoom(value) { applied.push(value); }, dispose() {} }); await loading;
  assert.equal(creates, 1); assert.deepEqual(applied, [2.5]);
});
