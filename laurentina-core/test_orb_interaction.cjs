'use strict';
// Execute the actual companion script against a small DOM/native/recorder fixture.
// No microphone permission, inference, window opening or user files are involved.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const interaction = fs.readFileSync(path.join(__dirname, 'ui/companion-interaction.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'ui/orb.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function scene(settings = {}) {
  let now = 0, serial = 0, native = { moved: false, cancelled: false }, touchResult = {};
  const calls = [], timers = new Map(), elements = new Map(), recorders = [], subscriptions = {};
  class Element {
    constructor() { this.hidden = false; this.textContent = ''; this.dataset = {}; this.listeners = {}; this.capture = null;
      const classes = new Set(); this.classList = { add: (...items) => items.forEach(item => classes.add(item)),
        remove: (...items) => items.forEach(item => classes.delete(item)), contains: item => classes.has(item),
        toggle: (item, enabled) => enabled ? classes.add(item) : classes.delete(item) }; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    async emit(name, change = {}) { const event = { button: 0, pointerId: 1, clientX: 50, clientY: 60, detail: 1,
      preventDefault() { this.prevented = true; }, ...change }; for (const fn of this.listeners[name] || []) await fn(event); return event; }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren() {}
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; }
    getContext() { return null; }
  }
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { if (this.state !== 'recording') return; this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['recording']) }); this.stopped = Promise.resolve(this.onstop?.()); }
  }
  const schedule = (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; };
  const context = vm.createContext({ console, Blob, Uint8Array, btoa, MediaRecorder: Recorder,
    performance: { now: () => now }, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    setInterval: () => ++serial, clearInterval() {}, requestAnimationFrame: () => ++serial, cancelAnimationFrame() {},
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { body: new Element(), getElementById: element, hidden: false },
    matchMedia: () => ({ matches: false }), addEventListener(name, fn) { subscriptions[name] = fn; },
    laurentina: {
      async request(action, payload = {}) { calls.push({ action, payload });
        if (action === 'window.companion.move') return payload.phase === 'start' ? { id: 'native-drag' } : { ...native };
        if (action === 'workspace.get') return { preferences: { language: 'zh' } };
        if (action === 'character.get') return { name: '劳纶缇娜' };
        if (action === 'companion.get') return { mode: 'orb' };
        if (action === 'voice.status') return { settings };
        if (action === 'voice.transcribe') return { text: '  保留原来的私聊上下文  ' };
        if (action === 'companion.touch') return touchResult;
        return {};
      },
      onVoiceState(callback) { subscriptions.voice = callback; }, onCompanionState(callback) { subscriptions.companion = callback; },
      onTouchResponse(callback) { subscriptions.touch = callback; }
    } });
  context.window = context;
  vm.runInContext(interaction, context); vm.runInContext(source, context); await flush();
  return { context, calls, element, recorders,
    voice: value => subscriptions.voice(value), touch: value => subscriptions.touch(value),
    native: value => { native = value; },
    touchResult: value => { touchResult = value; },
    async tick(ms) { const end = now + ms; for (;;) { const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush(); } now = end; await flush(); },
    async pointer(id = 'orb-open') { await element(id).emit('pointerdown'); await element(id).emit('pointerup'); await element(id).emit('click'); },
    actions: action => calls.filter(item => item.action === action),
    classes: context.document.body.classList,
  };
}

test('actual orb single touch is delayed and double click opens only the main window', async () => {
  const s = await scene(); await s.pointer(); await s.tick(329); assert.equal(s.actions('companion.touch').length, 0);
  await s.tick(1); assert.equal(s.actions('companion.touch').length, 1); assert.equal(s.actions('window.main').length, 0);
  const d = await scene(); await d.pointer(); await d.tick(100); await d.pointer(); await d.tick(1000);
  assert.equal(d.actions('companion.touch').length, 0); assert.equal(d.actions('window.main').length, 1);
});
test('native drag and cancellation suppress all companion activation including a pending first tap', async () => {
  for (const native of [{ moved: true }, { cancelled: true }]) {
    const s = await scene(); await s.pointer(); await s.tick(200);
    await s.element('orb-open').emit('pointerdown'); await s.tick(1000);
    assert.equal(s.actions('companion.touch').length, 0);
    s.native(native); await s.element('orb-open').emit('pointerup'); await s.tick(500);
    assert.equal(s.actions('companion.touch').length, 0); assert.equal(s.actions('window.main').length, 0);
    assert.equal(s.classes.contains('dragging'), false);
  }
});
test('illustration uses the same gestures and keyboard provides touch plus explicit open', async () => {
  const s = await scene(); await s.pointer('companion-artwork'); await s.tick(330);
  assert.equal(s.actions('companion.touch').length, 1);
  await s.element('orb-open').emit('click', { detail: 0 });
  const key = await s.element('orb-open').emit('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(key.prevented, true); assert.equal(s.actions('companion.touch').length, 2); assert.equal(s.actions('window.main').length, 1);
});
test('touch voice animates speaking while its energy cannot overwrite real recording or AI output', async () => {
  const s = await scene(); s.touch({ id: 'touch-a', phase: 'start', text: '我在。' });
  assert.equal(s.classes.contains('touch-pulse'), true); assert.equal(s.classes.contains('touching'), true);
  s.voice({ source: 'touch', touch_id: 'touch-a', speaking: true, level: .8 }); assert.equal(s.classes.contains('speaking'), true);
  s.voice({ recording: true, speaking: false, thinking: false, level: .2 });
  assert.equal(s.classes.contains('listening'), true); assert.equal(s.classes.contains('speaking'), false);
  s.voice({ source: 'touch', touch_id: 'touch-a', speaking: true, level: 1 });
  s.touch({ id: 'touch-a', phase: 'end' });
  assert.equal(s.classes.contains('listening'), true); assert.equal(s.classes.contains('touching'), false);
  s.voice({ recording: false, speaking: true, thinking: false, level: .3, text: '回答中' });
  s.touch({ id: 'touch-b', phase: 'start', text: '不可覆盖' });
  assert.equal(s.classes.contains('touch-busy'), true); assert.equal(s.element('orb-status').textContent, '回答中');
  assert.equal(vm.runInContext('assistantState.level', s.context), .3);
});
test('mapped avatar waits for animation completion after audio ends without creating a new renderer', async () => {
  const s = await scene(), states = []; let creates = 0, complete;
  s.context.LaurentinaAvatars = { create: async () => { creates++; return { animations: ['Idle', 'Tap'], setZoom() {}, dispose() {}, setState(state, options) { states.push(state); if (state === 'touch') complete = options.onComplete; return true; } }; } };
  await s.context.renderCompanion({ mode: 'avatar', avatar: { id: 'character', kind: 'spine', animations: ['Idle', 'Tap'], stateMap: { idle: 'Idle', touch: 'Tap' } } });
  s.touch({ id: 'a', phase: 'start' }); s.voice({ source: 'touch', touch_id: 'a', speaking: true, level: .8 });
  assert.equal(states.at(-1), 'touch'); assert.equal(s.classes.contains('touch-custom'), true);
  assert.equal(s.classes.contains('speaking'), true);
  s.touch({ id: 'a', phase: 'end' }); assert.equal(states.at(-1), 'touch'); assert.equal(s.classes.contains('speaking'), false);
  complete(); assert.equal(states.at(-1), 'idle'); assert.equal(creates, 1);
  assert.equal(s.actions('companion.touch').length, 0);
});

test('repeated touch replaces only its line while the current action continues and old ends are ignored', async () => {
  const s = await scene(), states = []; let complete;
  s.context.LaurentinaAvatars = { create: async () => ({ animations: ['Idle', 'Tap'], setZoom() {}, dispose() {},
    setState(state, options) { states.push(state); if (state === 'touch') complete = options.onComplete; return true; } }) };
  await s.context.renderCompanion({ mode: 'avatar', avatar: { id: 'character', kind: 'spine', stateMap: { touch: 'Tap' } } });
  s.touch({ id: 'a', phase: 'start' }); const stale = complete;
  s.touch({ id: 'b', phase: 'start' }); s.touch({ id: 'a', phase: 'end' }); stale();
  assert.equal(states.at(-1), 'touch');
  s.touch({ id: 'b', phase: 'end' }); assert.equal(states.at(-1), 'touch');
  complete(); assert.equal(states.at(-1), 'idle');
  await s.tick(60000); assert.equal(s.actions('companion.touch').length, 0);
});

test('hide and real recording cancel an unfinished touch action and stale completion never revives it', async () => {
  const s = await scene(); let complete, cancelled = 0;
  s.context.LaurentinaAvatars = { create: async () => ({ animations: ['Idle', 'Tap'], setZoom() {}, dispose() {}, cancelTouch() { cancelled++; },
    setState(state, options) { if (state === 'touch') complete = options.onComplete; return true; } }) };
  await s.context.renderCompanion({ mode: 'avatar', avatar: { id: 'character', kind: 'spine', stateMap: { touch: 'Tap' } } });
  s.touch({ id: 'a', phase: 'start' }); await s.element('orb-hide').emit('click');
  assert.equal(cancelled, 1); assert.equal(s.classes.contains('touching'), false); complete();
  s.touch({ id: 'b', phase: 'start' }); s.voice({ recording: true });
  assert.equal(cancelled, 2); assert.equal(s.classes.contains('listening'), true); complete();
  assert.equal(s.classes.contains('listening'), true); assert.equal(s.classes.contains('touching'), false);
});
test('touch timeout returns to idle even without a main-window end event', async () => {
  const s = await scene(); s.touch({ id: 'a', phase: 'start' }); s.voice({ source: 'touch', touch_id: 'a', speaking: true, level: .4 });
  await s.tick(60000); assert.equal(s.classes.contains('touching'), false); assert.equal(s.classes.contains('speaking'), false);
});
test('native busy or disabled touch acknowledges without creating speech or opening chat', async () => {
  for (const result of [{ busy: true }, { disabled: true }]) {
    const s = await scene(); s.touchResult(result); await s.pointer(); await s.tick(330);
    assert.equal(s.classes.contains(result.busy ? 'touch-busy' : 'touch-pulse'), true);
    assert.equal(s.classes.contains('speaking'), false); assert.equal(s.actions('window.main').length, 0);
  }
});
test('touch playback updates capture context without overwriting the real assistant state', async () => {
  const s = await scene(); s.voice({ context_captured: true, conversation_id: 'old', mode: 'daily', mode_revision: 1 });
  s.touch({ id: 'a', phase: 'start' });
  s.voice({ source: 'touch', touch_id: 'a', speaking: true, level: .4, context_captured: true, conversation_id: 'new-private', mode: 'private', mode_revision: 3 });
  assert.equal(vm.runInContext('mainContext.conversation_id', s.context), 'new-private');
  assert.equal(vm.runInContext('mainContext.mode', s.context), 'private');
  assert.equal(vm.runInContext('mainContext.mode_revision', s.context), 3);
  assert.equal(vm.runInContext('assistantState.speaking', s.context), false);
});
test('actual microphone transcript keeps captured private mode revision and defaults to no panel wake', async () => {
  for (const open_panel of [undefined, false, true]) {
    const s = await scene({ voice_input_mode: 'direct', ...(open_panel === undefined ? {} : { voice_orb_open_panel: open_panel }) });
    s.voice({ context_captured: true, conversation_id: 'original', mode: 'private', mode_revision: 7 });
    await s.context.toggleRecording();
    s.voice({ context_captured: true, conversation_id: 'other', mode: 'daily', mode_revision: 8 });
    const recorder = s.recorders[0]; recorder.stop(); await recorder.stopped; await flush();
    const sent = s.actions('ui.transcript'); assert.equal(sent.length, 1);
    const payload = sent[0].payload;
    assert.equal(payload.text, '保留原来的私聊上下文'); assert.equal(payload.conversation_id, 'original');
    assert.equal(payload.mode, 'private'); assert.equal(payload.mode_revision, 7); assert.equal(payload.context_captured, true);
    assert.equal(payload.submit, true); assert.equal(payload.open_panel, open_panel === true);
    assert.equal(s.actions('window.main').length, 0);
  }
});
