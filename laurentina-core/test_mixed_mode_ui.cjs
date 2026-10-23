'use strict';
// Execute the shipped UI functions with deterministic RPC/DOM boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8');
const workspace = fs.readFileSync(path.join(__dirname, 'ui/workspace.js'), 'utf8');

function portion(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing production function: ${start}`);
  return source.slice(from, to);
}
function element(tag = 'div', className = '', text = '') {
  return { tag, className, textContent: text, children: [], attrs: {}, dataset: {}, value: '', hidden: false,
    checked: false, disabled: false, classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attrs[key] = value; }, focus() {} };
}
function content(node) { return [node.textContent || '', ...(node.children || []).map(content)].join(''); }
function fixture({ mode = 'private', hasPrivate = true, settings = { auto_speak: true, voice_input_mode: 'direct' } } = {}) {
  const nodes = new Map(), calls = { rpc: [], stopped: 0, spoken: [], sent: [], toasts: [] };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const conversation = { id: 'one-chat', mode, mode_revision: 0, has_private: hasPrivate, title: 'User title' };
  const state = { active: conversation, conversations: [conversation], mode, modeEpoch: 0, ready: true,
    view: 'chat', loadVersion: 0, drafts: new Map(), modeEvents: new Map(), messages: [],
    pendingSecrets: new Map(), resolvedSecrets: new Set(), secretBusy: new Set(), tasksByConversation: new Map(),
    switchingMode: false, creating: false, sending: false, jobs: new Map(), intent: 'chat', providerLoading: false,
    voice: { settings: { ...settings } }, voiceSettingsVersion: 0, voicePreferenceSaving: false };
  const backend = { conversation: { ...conversation }, modeEvents: [], settings: { ...settings }, failSave: false, failMode: false,
    onRpc: null, poll: null, status: null };
  const context = vm.createContext({ state, $, el: element, tr: value => value, svg: name => element('svg', name),
    document: { createTextNode: text => element('text', '', text) },
    activeJob: () => state.jobs.get(state.active?.id), errorText: error => error.message,
    toast: (...args) => calls.toasts.push(args), stopSpeaking: () => { calls.stopped++; }, stopVoiceConversation() {},
    speakText: text => calls.spoken.push(text), resizeInput() {}, updateHeader() {}, updateComposer() {},
    scrollToEnd() {}, sortConversations() {}, renderConversations() {}, isNearBottom: () => true,
    assistantNode: message => element('article', 'assistant', message.content), buildTaskCard: () => element(),
    shouldPollTask: () => false, pollChatTask() {}, showView: async () => {},
    sendMessage: async () => calls.sent.push($('chat-input').value),
    voiceRecorder: null, microphoneStarting: false, voiceTranscribing: false,
    feedback() {}, updateVoiceFields() {}, renderMemoryActivity() {}, upsertTask() {}, loadProfile() {}, loadMemories() {}, delay: async () => {},
    rpc: async (action, payload) => {
      calls.rpc.push({ action, payload: structuredClone(payload) });
      if (backend.onRpc) return backend.onRpc(action, payload);
      if (action === 'conversation.set_mode') {
        if (backend.failMode) throw new Error('mode failed');
        assert.equal(payload.expected_revision, backend.conversation.mode_revision);
        backend.conversation = { ...backend.conversation, mode: payload.mode, mode_revision: backend.conversation.mode_revision + 1 };
        backend.modeEvents.push({ id: `mode-${backend.modeEvents.length}`, mode: payload.mode, after_message_id: state.messages.at(-1)?.id || null });
        return { conversation: { ...backend.conversation }, mode_events: structuredClone(backend.modeEvents), pending_secret: null };
      }
      if (action === 'voice.settings.save') {
        if (backend.failSave) throw new Error('save failed');
        backend.settings = { ...backend.settings, ...payload };
        return { ...backend.settings };
      }
      if (action === 'voice.status') return backend.status || { settings: { ...backend.settings }, voices: [], tts_ready: true, asr_ready: true };
      if (action === 'chat.poll') return backend.poll;
      if (action === 'conversation.get') return { conversation: { ...backend.conversation }, messages: state.messages, mode_events: backend.modeEvents, pending_secret: null };
      throw new Error(`Unexpected action: ${action}`);
    } });
  for (const [start, end] of [
    ['function modeName(', 'function sourceName('],
    ['function absorbConversationExtras(', 'function renderSecretConfirmation('],
    ['function upsertConversation(', 'function renderConversations('],
    ['async function selectMode(', 'async function openConversation('],
    ['function renderMessages(', 'function resizeInput('],
    ['async function receiveVoiceTranscript(', 'function updateVoiceFields('],
    ['function updateAutoSpeakControl(', 'function previewVoice('],
    ['async function pollJob(', 'function openModal('],
  ]) vm.runInContext(portion(app, start, end), context);
  vm.runInContext(portion(workspace, 'function workspaceConversationRow(', 'function renderWorkspaceConversations('), context);
  context.button = (text, className, _action, icon) => { const node = element('button', className, text); node.icon = icon; return node; };
  return { $, state, backend, calls, context };
}

test('daily/private switches retain one conversation and isolate unsent drafts', async () => {
  const f = fixture(); f.$('chat-input').value = 'PRIVATE_DRAFT_CANARY';
  await f.context.selectMode('daily');
  assert.equal(f.state.active.id, 'one-chat'); assert.equal(f.$('chat-input').value, '');
  assert.equal(f.state.drafts.get('one-chat:private'), 'PRIVATE_DRAFT_CANARY');
  f.$('chat-input').value = 'PUBLIC_DRAFT';
  await f.context.selectMode('private');
  assert.equal(f.$('chat-input').value, 'PRIVATE_DRAFT_CANARY');
  assert.equal(f.state.drafts.get('one-chat'), 'PUBLIC_DRAFT');
  assert.equal(f.state.active.mode_revision, 2); assert.equal(f.state.active.has_private, true);
  assert.deepEqual(f.calls.rpc.map(call => call.action), ['conversation.set_mode', 'conversation.set_mode']);
});

test('active reply blocks mode mutation without losing input or stopping speech', async () => {
  const f = fixture(); f.state.jobs.set('one-chat', { replyDone: false }); f.$('chat-input').value = 'keep';
  await f.context.selectMode('daily');
  assert.equal(f.calls.rpc.length, 0); assert.equal(f.calls.stopped, 0);
  assert.equal(f.$('chat-input').value, 'keep'); assert.equal(f.state.active.mode, 'private');
});

test('failed mode save keeps current private draft and mode', async () => {
  const f = fixture(); f.backend.failMode = true; f.$('chat-input').value = 'private';
  await f.context.selectMode('daily');
  assert.equal(f.state.active.mode, 'private'); assert.equal(f.$('chat-input').value, 'private');
  assert.equal(f.state.switchingMode, false); assert.equal(f.calls.toasts.at(-1)[1], true);
});

test('switch markers render in transcript order and sidebar retains private badge after daily switch', () => {
  const f = fixture({ mode: 'daily' });
  f.state.messages = [{ id: 'u1', role: 'user', content: 'PUBLIC' }, { id: 'u2', role: 'user', content: 'PRIVATE', privacy: 'private' }];
  f.state.modeEvents.set('one-chat', [{ id: 'e0', mode: 'daily', after_message_id: null },
    { id: 'e1', mode: 'private', after_message_id: 'u1' }, { id: 'e2', mode: 'daily', after_message_id: 'u2' }]);
  f.context.renderMessages();
  assert.deepEqual(f.$('messages').children.map(content), ['已切换到日常模式', 'PUBLIC', '已切换到私聊模式', 'PRIVATE仅本地', '已切换到日常模式']);
  assert.equal(f.$('welcome').hidden, true);
  const row = f.context.workspaceConversationRow(f.state.active);
  assert.equal(row.children[0].icon, 'lock'); assert.ok(content(row).includes('含私聊'));
});

test('private to daily delayed transcript stays in private draft and never auto-sends', async () => {
  const f = fixture(); const captured = { id: 'one-chat', mode: 'private', mode_revision: 0 };
  await f.context.selectMode('daily'); f.$('chat-input').value = 'PUBLIC_CURRENT';
  await f.context.receiveTranscript('PRIVATE_AUDIO', captured, true);
  assert.equal(f.$('chat-input').value, 'PUBLIC_CURRENT'); assert.equal(f.state.drafts.get('one-chat:private'), 'PRIVATE_AUDIO');
  assert.deepEqual(f.calls.sent, []);
});

test('private daily private roundtrip invalidates old audio despite matching ID and mode', async () => {
  const f = fixture(); const captured = { id: 'one-chat', mode: 'private', mode_revision: 0 };
  await f.context.selectMode('daily'); await f.context.selectMode('private');
  await f.context.receiveTranscript('OLD_PRIVATE_AUDIO', captured, true);
  assert.equal(f.$('chat-input').value, 'OLD_PRIVATE_AUDIO'); assert.equal(f.state.active.mode_revision, 2);
  assert.deepEqual(f.calls.sent, []);
});

test('automatic speech defaults enabled, disabling stops playback and persists false across refresh', async () => {
  const f = fixture(); f.context.updateAutoSpeakControl();
  assert.equal(f.$('toggle-auto-speak').attrs['aria-pressed'], 'true');
  await f.context.toggleAutoSpeak();
  assert.equal(f.calls.stopped, 1); assert.equal(f.state.voice.settings.auto_speak, false);
  assert.equal(f.backend.settings.auto_speak, false); assert.equal(f.$('auto-speak').checked, false);
  assert.deepEqual(f.calls.rpc[0], { action: 'voice.settings.save', payload: { auto_speak: false } });
  await f.context.refreshVoice();
  assert.equal(f.$('toggle-auto-speak').attrs['aria-pressed'], 'false'); assert.equal(f.$('auto-speak').checked, false);
  await f.context.toggleAutoSpeak();
  assert.equal(f.backend.settings.auto_speak, true); assert.equal(f.calls.stopped, 1);
});

test('failed speech preference save restores controls and previous setting', async () => {
  const f = fixture(); f.backend.failSave = true;
  await f.context.toggleAutoSpeak();
  assert.equal(f.calls.stopped, 1); assert.equal(f.state.voice.settings.auto_speak, true);
  assert.equal(f.$('toggle-auto-speak').attrs['aria-pressed'], 'true'); assert.equal(f.state.voicePreferenceSaving, false);
  assert.equal(f.calls.toasts.at(-1)[1], true);
});

test('late voice status cannot override newer disabled preference', async () => {
  const f = fixture(); let resolveStatus;
  f.backend.status = new Promise(resolve => { resolveStatus = resolve; });
  const refresh = f.context.refreshVoice();
  await f.context.toggleAutoSpeak();
  resolveStatus({ settings: { auto_speak: true }, voices: [], asr_ready: true, tts_ready: true });
  await refresh;
  assert.equal(f.state.voice.settings.auto_speak, false); assert.equal(f.$('toggle-auto-speak').attrs['aria-pressed'], 'false');
  assert.equal(f.$('refresh-voice').disabled, false);
});

test('turn completing after auto-speech disabled does not speak but preserves the answer', async () => {
  const f = fixture({ mode: 'daily' });
  const job = { id: 'running', conversationId: 'one-chat', replyDone: false, memoryPending: false, after: 0, pollFailures: 0, text: '' };
  f.state.jobs.set('one-chat', job);
  await f.context.toggleAutoSpeak();
  f.backend.poll = { done: true, events: [{ seq: 1, type: 'done', message: { id: 'a1', role: 'assistant', content: 'ANSWER', status: 'completed' } }] };
  await f.context.pollJob(job);
  assert.deepEqual(f.calls.spoken, []); assert.equal(job.replyDone, true);
  assert.equal(f.state.messages[0].content, 'ANSWER');
});

function fillVoiceForm(f, autoSpeak) {
  f.$('auto-speak').checked = autoSpeak;
  f.$('tts-provider').value = 'piper'; f.$('tts-voice').value = 'auto';
  f.$('voice-input-mode').value = 'direct';
}

test('settings form owns speech preference while saving and blocks duplicate form or shortcut writes', async () => {
  const f = fixture(); let settle;
  fillVoiceForm(f, false);
  f.backend.onRpc = async (action, payload) => {
    if (action === 'voice.settings.save') {
      await new Promise(resolve => { settle = resolve; });
      f.backend.settings = { ...f.backend.settings, ...payload }; return f.backend.settings;
    }
    if (action === 'voice.status') return { settings: f.backend.settings, voices: [] };
    throw new Error(`Unexpected action ${action}`);
  };
  const saving = f.context.saveVoiceSettings({ preventDefault() {} });
  assert.equal(f.state.voicePreferenceSaving, true); assert.equal(f.state.voice.settings.auto_speak, false);
  assert.equal(f.calls.stopped, 1); assert.equal(f.$('toggle-auto-speak').disabled, true); assert.equal(f.$('save-voice').disabled, true);
  await f.context.toggleAutoSpeak(); await f.context.saveVoiceSettings({ preventDefault() {} });
  assert.equal(f.calls.rpc.filter(call => call.action === 'voice.settings.save').length, 1);
  settle(); await saving; await Promise.resolve();
  assert.equal(f.state.voicePreferenceSaving, false); assert.equal(f.backend.settings.auto_speak, false);
  assert.equal(f.$('toggle-auto-speak').disabled, false); assert.equal(f.$('save-voice').disabled, false);
  assert.equal(f.$('auto-speak').checked, false);
});

test('shortcut speech save blocks a simultaneous settings form submission', async () => {
  const f = fixture(); let settle;
  f.backend.onRpc = async (action, payload) => {
    assert.equal(action, 'voice.settings.save');
    await new Promise(resolve => { settle = resolve; });
    f.backend.settings = { ...f.backend.settings, ...payload }; return f.backend.settings;
  };
  const saving = f.context.toggleAutoSpeak();
  fillVoiceForm(f, true);
  await f.context.saveVoiceSettings({ preventDefault() {} });
  assert.equal(f.calls.rpc.length, 1); assert.equal(f.$('save-voice').disabled, true);
  settle(); await saving;
  assert.equal(f.backend.settings.auto_speak, false); assert.equal(f.$('auto-speak').checked, false);
});

test('failed settings form save restores prior disabled preference and releases both controls', async () => {
  const f = fixture({ settings: { auto_speak: false, voice_input_mode: 'direct' } });
  fillVoiceForm(f, true); f.backend.failSave = true;
  await f.context.saveVoiceSettings({ preventDefault() {} });
  assert.equal(f.state.voice.settings.auto_speak, false); assert.equal(f.$('auto-speak').checked, false);
  assert.equal(f.$('toggle-auto-speak').attrs['aria-pressed'], 'false');
  assert.equal(f.state.voicePreferenceSaving, false); assert.equal(f.$('save-voice').disabled, false);
});

test('status refresh started during pending settings save cannot re-enable automatic speech', async () => {
  const f = fixture(); let settle;
  fillVoiceForm(f, false);
  f.backend.onRpc = async (action, payload) => {
    if (action === 'voice.settings.save') {
      await new Promise(resolve => { settle = resolve; });
      f.backend.settings = { ...f.backend.settings, ...payload }; return f.backend.settings;
    }
    if (action === 'voice.status') return { settings: { ...f.backend.settings }, voices: [] };
    throw new Error(`Unexpected action ${action}`);
  };
  const saving = f.context.saveVoiceSettings({ preventDefault() {} });
  await f.context.refreshVoice();
  const interim = f.state.voice.settings.auto_speak;
  settle(); await saving;
  assert.equal(interim, false);
});
