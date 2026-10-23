'use strict';
// Exercise the actual native IPC/protocol callbacks without starting Electron.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { AvatarLibrary } = require('./avatar_library.cjs');
const { CompanionHitTest } = require('./companion_hit_test.cjs');
const source = fs.readFileSync(path.join(__dirname, 'desktop.cjs'), 'utf8');

function ipcFixture() {
  const calls = [], opens = [];
  function fakeWindow(url, name) {
    return { isDestroyed: () => false, webContents: { mainFrame: { url },
      send: (channel, value) => calls.push({ name, channel, value: structuredClone(value) }) } };
  }
  const main = fakeWindow('laurentina://app/index.html', 'main');
  const orb = fakeWindow('laurentina://companion/orb.html', 'orb');
  let handler;
  const context = vm.createContext({ window: main, orbWindow: orb,
    MAIN_URL: main.webContents.mainFrame.url, ORB_URL: orb.webContents.mainFrame.url,
    API_ACTIONS: new Set(), ipcMain: { handle: (_channel, callback) => { handler = callback; } },
    companionHitTest: new CompanionHitTest(), updateCompanionHitTest: () => {},
    currentVoiceState: { recording: false, speaking: false, context_captured: false },
    showMain: () => opens.push(true), log: () => {} });
  vm.runInContext(source.slice(source.indexOf('function validSender('), source.indexOf('function showMain(')), context);
  vm.runInContext(source.slice(source.indexOf('function installIPC('), source.indexOf('async function createWindow(')), context);
  context.installIPC();
  return { calls, opens, context, main, orb, invokeRaw: handler, invoke: (owner, action, payload) => handler({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, action, payload) };
}

test('native voice bridge retains main private capture when orb reports audio levels', async () => {
  const f = ipcFixture();
  await f.invoke(f.main, 'ui.voice_state', { conversation_id: 'private-original', mode: 'private', mode_revision: 3, thinking: true });
  await f.invoke(f.orb, 'ui.voice_state', { recording: true, level: 0.75, conversation_id: 'wrong', mode: 'daily', mode_revision: 99, thinking: false });
  const value = f.calls.at(-1).value;
  assert.equal(value.conversation_id, 'private-original'); assert.equal(value.mode, 'private');
  assert.equal(value.context_captured, true); assert.equal(value.thinking, true);
  assert.equal(value.mode_revision, 3);
  assert.equal(value.recording, true); assert.equal(value.level, 0.75);
  assert.equal(f.calls.at(-1).name, 'main');
});
test('transparent hit masks are accepted only from the companion main frame', async () => {
  const f=ipcFixture(), value={width:200,height:200,regions:[{x:70,y:160,width:60,height:30}],alpha:{x:30,y:10,width:140,height:130,columns:2,rows:2,bits:'CQ=='}};
  await assert.rejects(()=>f.invoke(f.main,'window.companion.hit_regions',value),/桌宠/);
  await f.invoke(f.orb,'window.companion.hit_regions',value);
  assert.equal(f.context.companionHitTest.packet.alpha.bits[0],9);
  await assert.rejects(()=>f.invoke(f.orb,'window.companion.hit_regions',{...value,width:Infinity}),/无效/);
  await assert.rejects(()=>f.invokeRaw({sender:f.orb.webContents,senderFrame:{url:f.orb.webContents.mainFrame.url}},'window.companion.hit_regions',value),/来源/);
});

test('orb recording clears the old touch source without changing private ownership', async () => {
  const f = ipcFixture();
  await f.invoke(f.main, 'ui.voice_state', { source: 'touch', touch_id: 'old-touch', speaking: true,
    conversation_id: 'private-original', mode: 'private', mode_revision: 3 });
  await f.invoke(f.orb, 'ui.voice_state', { recording: true, level: .5, source: 'touch', touch_id: 'forged',
    conversation_id: 'wrong', mode: 'daily', mode_revision: 99 });
  const value = f.calls.at(-1).value;
  assert.equal(value.source, null); assert.equal(value.touch_id, null); assert.equal(value.recording, true);
  assert.equal(value.conversation_id, 'private-original'); assert.equal(value.mode, 'private'); assert.equal(value.mode_revision, 3);
});

test('ending an old touch never clears a real response which already took priority', () => {
  const events = [], sends = [];
  const real = { source: null, touch_id: null, speaking: true, level: .6, text: 'REAL_REPLY',
    conversation_id: 'private-original', mode: 'private', mode_revision: 3 };
  const context = vm.createContext({ pendingTouch: 'old-touch', touchTimeout: null,
    currentVoiceState: { ...real }, clearTimeout() {}, touchEvent: event => events.push(event),
    window: { isDestroyed: () => false, webContents: { send: (...args) => sends.push(args) } }, orbWindow: null });
  vm.runInContext(source.slice(source.indexOf('function endTouch('), source.indexOf('app.setName(')), context);
  context.endTouch('old-touch');
  assert.deepEqual(structuredClone(context.currentVoiceState), real);
  assert.equal(events[0].phase, 'end'); assert.equal(sends.length, 0);
});

test('another touch advances its line while a real reply remains protected', async () => {
  const f=ipcFixture(), ended=[], started=[];
  Object.assign(f.context,{pendingTouch:'old',touchTimeout:null,
    currentVoiceState:{source:'touch',speaking:true,recording:false,thinking:false},
    touchLibrary:{choose:()=>({id:'clip',text:'next'})},crypto:{randomUUID:()=> 'new'},
    setTimeout:()=>({unref(){}}),endTouch:id=>{ended.push(id);f.context.pendingTouch=null;},touchEvent:value=>started.push(value)});
  const value=await f.invoke(f.orb,'companion.touch',{});
  assert.equal(value.id,'new');assert.deepEqual(ended,['old']);assert.equal(started[0].phase,'start');
  f.context.currentVoiceState={source:null,speaking:true,recording:false,thinking:false};
  assert.equal((await f.invoke(f.orb,'companion.touch',{})).busy,true);
  assert.equal(started.length,1);
});

test('disabling touch broadcasts global cancellation even after its audio id has ended', async () => {
  const f=ipcFixture(), events=[];
  Object.assign(f.context,{pendingTouch:null,touchLibrary:{configure:()=>({enabled:false,items:[]})},touchEvent:value=>events.push(value)});
  assert.equal((await f.invoke(f.main,'touch.configure',{enabled:false})).enabled,false);
  assert.deepEqual(structuredClone(events),[{phase:'cancel'}]);
  await assert.rejects(f.invoke(f.orb,'touch.configure',{enabled:false}),/主面板/);
});

test('native transcript forwards exact captured conversation, private mode, and explicit submit', async () => {
  const f = ipcFixture();
  const payload = { text: 'SYNTHETIC_PRIVATE_TRANSCRIPT', submit: true, context_captured: true,
    conversation_id: 'private-original', mode: 'private', mode_revision: 7 };
  await f.invoke(f.orb, 'ui.transcript', payload);
  assert.deepEqual(f.calls[0], { name: 'main', channel: 'laurentina:transcript', value: { ...payload, open_panel: true } });
  assert.equal(f.opens.length, 1, 'Legacy sender without the new preference keeps its previous behavior');
  await assert.rejects(f.invoke(f.orb, 'ui.transcript', { ...payload, conversation_id: {} }));
  await assert.rejects(f.invoke(f.orb, 'ui.transcript', { ...payload, mode_revision: -1 }));
  assert.equal(f.calls.length, 1);
});

test('orb transcript can stay in the background while private captured ownership remains exact', async () => {
  const f = ipcFixture();
  const payload = { text: 'SYNTHETIC_PRIVATE_TRANSCRIPT', submit: true, context_captured: true,
    conversation_id: 'private-original', mode: 'private', mode_revision: 7, open_panel: false };
  await f.invoke(f.orb, 'ui.transcript', payload);
  assert.deepEqual(f.calls[0], { name: 'main', channel: 'laurentina:transcript', value: payload });
  assert.equal(f.opens.length, 0, 'No show/focus side effect for open_panel=false');
  await assert.rejects(f.invoke(f.orb, 'ui.transcript', { ...payload, conversation_id: {} }));
  await assert.rejects(f.invoke(f.orb, 'ui.transcript', { ...payload, mode_revision: -1 }));
  assert.equal(f.calls.length, 1); assert.equal(f.opens.length, 0);
});

test('native voice IPC rejects subframes and unrelated renderer owners', async () => {
  const f = ipcFixture();
  await assert.rejects(f.invoke({ webContents: { mainFrame: { url: f.main.webContents.mainFrame.url } } }, 'ui.transcript', { text: 'x' }));
  await assert.rejects(f.invokeRaw({ sender: f.main.webContents, senderFrame: { url: f.main.webContents.mainFrame.url } }, 'ui.transcript', { text: 'x' }));
  assert.equal(f.calls.length, 0);
});

test('missing persisted avatar falls back to a visible orb without breaking the main app', async () => {
  let settings = { mode: 'avatar', avatar: null, visible: true, scale: 1.5 }, visible = false;
  const sends = [];
  const orbWindow = { isDestroyed: () => false, getBounds: () => ({ x: 10, y: 20, width: 100, height: 100 }),
    setBounds: () => {}, setTitle: () => {}, show: () => { visible = true; }, focus: () => {},
    webContents: { setZoomFactor: () => {}, send: (channel, value) => sends.push({ channel, value }) } };
  const context = vm.createContext({ orbWindow, endCompanionDrag: () => {}, startCompanionHitTest: () => {},
    companionPublic: () => ({ ...settings }), companion: { save: patch => { settings = { ...settings, ...patch }; } },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }) },
    geometry: () => ({ x: 10, y: 20, width: 100, height: 100, factor: 1 }),
    nativeVerification: null, companionSize: null, recordNativeVerification: () => {}, log: () => {} });
  vm.runInContext(source.slice(source.indexOf('async function showOrb('), source.indexOf('function publishCompanion(')), context);
  await context.showOrb();
  assert.equal(settings.mode, 'orb'); assert.equal(settings.scale, 1.5); assert.equal(settings.visible, true);
  assert.equal(visible, true); assert.equal(sends[0].value.mode, 'orb');
});

test('orb microphone captures private context before a delayed voice-status request', async () => {
  const orbSource = fs.readFileSync(path.join(__dirname, 'ui/orb.js'), 'utf8');
  let resolveVoice, recorder;
  const pendingVoice = new Promise(resolve => { resolveVoice = resolve; }), transcripts = [];
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { recorder = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; return this.onstop(); }
  }
  const context = vm.createContext({ recorder: null, busy: false, starting: false, foreignRecording: false,
    mainContext: { conversation_id: 'private-at-click', mode: 'private', mode_revision: 1 }, stream: null, timer: null, voiceInputMode: 'direct', voiceOpenPanel: false,
    activation: { cancel() {} }, touchFeedback: { cancel() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    MediaRecorder: Recorder, Blob, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    rpc: async (action, payload) => {
      if (action === 'voice.status') return pendingVoice;
      if (action === 'voice.transcribe') return { text: 'SYNTHETIC_PRIVATE_SPEECH' };
      if (action === 'ui.transcript') transcripts.push(structuredClone(payload));
    },
    updateControls: () => {}, status: () => {}, publish: () => {}, applyAssistantState: () => {},
    startMicrophoneMeter: () => {}, stopMicrophoneMeter: () => {}, setInterval: () => 1, clearInterval: () => {} });
  vm.runInContext(orbSource.slice(orbSource.indexOf('async function toggleRecording('), orbSource.indexOf('function openMain(')), context);
  const started = context.toggleRecording();
  context.mainContext = { conversation_id: 'daily-after-click', mode: 'daily', mode_revision: 2 };
  resolveVoice({ settings: { voice_input_mode: 'direct' } });
  await started;
  recorder.ondataavailable({ data: new Blob(['audio']) });
  await recorder.stop();
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].conversation_id, 'private-at-click'); assert.equal(transcripts[0].mode, 'private');
  assert.equal(transcripts[0].mode_revision, 1);
  assert.equal(transcripts[0].context_captured, true); assert.equal(transcripts[0].submit, true);
  assert.equal(transcripts[0].open_panel, false);
});

function protocolFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-v04-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('la-v04-test-') || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Unsafe integration-test cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const input = path.join(root, 'synthetic.png');
  fs.copyFileSync(path.join(__dirname, 'assets/icon.png'), input);
  const avatars = new AvatarLibrary(root), item = avatars.importFile(input);
  let handler;
  const context = vm.createContext({ avatars, fs, URL, Response, protocol: { handle: (_scheme, callback) => { handler = callback; } } });
  vm.runInContext(source.slice(source.indexOf("protocol.handle('laurentina-avatar'"), source.indexOf('protocol.handle("laurentina",')), context);
  return { item, bytes: fs.readFileSync(input), request: (suffix = item.entry, options = {}) => handler(new Request(`laurentina-avatar://${item.id}/${suffix}`, options)) };
}

test('native avatar scheme serves only library allowlisted files and rejects unsafe requests', async t => {
  const f = protocolFixture(t);
  const allowed = await f.request(); assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), f.bytes);
  for (const name of ['library.json', '../library.json', '%2e%2e%2flibrary.json', `${f.item.entry}?x=1`]) assert.equal((await f.request(name)).status, 404, name);
  assert.equal((await f.request(f.item.entry, { method: 'POST' })).status, 404);
});

test('native avatar scheme returns real media ranges and header-only requests', async t => {
  const f = protocolFixture(t);
  const part = await f.request(f.item.entry, { headers: { Range: 'bytes=2-7' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-length'), '6');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), f.bytes.subarray(2, 8));
  const head = await f.request(f.item.entry, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(f.bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await f.request(f.item.entry, { headers: { Range: 'bytes=9999999999-' } })).status, 416);
});
