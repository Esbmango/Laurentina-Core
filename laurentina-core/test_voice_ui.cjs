'use strict';
// Behavioral checks for delayed speech: never cancel a running answer, dispatch
// a task because the composer changed, or send into a newly selected chat.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8');
const functions = source.slice(source.indexOf('async function receiveVoiceTranscript('), source.indexOf('function updateVoiceFields()'));

function fixture(change = {}) {
  const input = { value: '', focus() { calls.focus++; } };
  const state = { active: { id: 'original', mode: 'daily', mode_revision: 0 }, mode: 'daily', modeEpoch: 0, ready: true, sending: false,
    providerLoading: false, intent: 'chat', secretBusy: new Set(), pendingSecrets: new Map(),
    voice: { settings: { voice_input_mode: 'direct' } }, drafts: new Map(), conversations: [{ id: 'original' }], ...change };
  const calls = { sent: [], toast: [], rpc: [], views: [], focus: 0 };
  const context = vm.createContext({ state, $: () => input, tr: text => text, toast: text => calls.toast.push(text),
    showView: async view => calls.views.push(view), stashDraft: () => {}, resizeInput: () => {}, activeJob: () => change.job || null,
    sendMessage: async () => calls.sent.push(input.value), upsertConversation: c => state.conversations.push(c), modeName: mode => mode,
    rpc: async (name, payload) => { calls.rpc.push({ name, payload }); return { id: 'recovered', mode: payload.mode }; } });
  vm.runInContext(source.slice(source.indexOf('function draftKey('), source.indexOf('function sourceName(')), context);
  vm.runInContext(functions, context);
  return { state, calls, input, context, receive: (payload) => context.receiveVoiceTranscript(payload),
    local: (text, captured, submit) => context.receiveTranscript(text, captured, submit) };
}
const transcript = { text: '明天我们继续这个项目', submit: true, context_captured: true, conversation_id: 'original', mode: 'daily', mode_revision: 0 };

test('direct microphone input uses the ordinary send pipeline', async () => {
  const f = fixture(); await f.local('Hello 你好', { id: 'original', mode: 'daily', mode_revision: 0 }, true);
  assert.deepEqual(f.calls.sent, ['Hello 你好']);
});
test('review mode and uncaptured legacy sender keep editable transcript', async () => {
  const f = fixture(); f.state.voice.settings.voice_input_mode = 'review'; await f.receive(transcript);
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, transcript.text);
  const legacy = fixture(); await legacy.receive({ text: '旧窗口识别', submit: true });
  assert.equal(legacy.calls.sent.length, 0); assert.equal(legacy.input.value, '旧窗口识别');
});
test('busy generation does not call the send button which would stop it', async () => {
  const f = fixture({ job: { replyDone: false } }); await f.receive(transcript);
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, transcript.text);
});
test('draft, task composer, and pending mutation require manual send', async () => {
  for (const reason of ['draft', 'task', 'secret', 'not-ready']) {
    const f = fixture();
    if (reason === 'draft') f.input.value = '尚未发送的想法';
    if (reason === 'task') f.state.intent = 'task';
    if (reason === 'secret') { f.state.pendingSecrets.set('original', { id: 'secret-1' }); f.state.secretBusy.add('secret-1'); }
    if (reason === 'not-ready') f.state.ready = false;
    await f.receive(transcript);
    assert.equal(f.calls.sent.length, 0, reason); assert.ok(f.input.value.includes(transcript.text), reason);
    if (reason === 'draft') assert.ok(f.input.value.startsWith('尚未发送的想法\n'));
  }
});
test('switching chat keeps transcript with its exact original draft', async () => {
  const f = fixture({ active: { id: 'other', mode: 'private' } }); f.input.value = '当前私聊草稿';
  f.state.drafts.set('original', '原来的想法'); await f.receive(transcript);
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, '当前私聊草稿');
  assert.equal(f.state.drafts.get('original'), `原来的想法\n${transcript.text}`);
});
test('new private chat capture does not follow user to a daily conversation', async () => {
  const f = fixture(); await f.receive({ ...transcript, conversation_id: null, mode: 'private' });
  assert.equal(f.calls.sent.length, 0); assert.equal(f.calls.rpc.length, 1);
  assert.equal(f.calls.rpc[0].name, 'conversation.create'); assert.equal(f.calls.rpc[0].payload.mode, 'private');
  assert.equal(f.state.drafts.get('recovered:private'), transcript.text);
});
test('view refresh changing conversation cannot move speech into the new chat', async () => {
  const f = fixture(); f.context.showView = async () => { f.state.active = { id: 'other', mode: 'daily' }; };
  await f.receive(transcript); assert.equal(f.calls.sent.length, 0);
  assert.equal(f.state.drafts.get('original'), transcript.text); assert.equal(f.input.value, '');
});


test('private microphone text stays in its private draft after same-conversation daily switch', async () => {
  const f = fixture({ active: { id: 'original', mode: 'daily', mode_revision: 2 } });
  f.input.value = 'PUBLIC_DRAFT';
  await f.receive({ ...transcript, mode: 'private', mode_revision: 1 });
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, 'PUBLIC_DRAFT');
  assert.equal(f.state.drafts.get('original:private'), transcript.text);
});

test('private to daily to private roundtrip never auto-sends older captured audio', async () => {
  const f = fixture({ active: { id: 'original', mode: 'private', mode_revision: 3 } });
  await f.receive({ ...transcript, mode: 'private', mode_revision: 1 });
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, transcript.text);
});

test('legacy captured audio without a mode revision requires explicit send', async () => {
  const f = fixture(); const old = { ...transcript }; delete old.mode_revision;
  await f.receive(old); assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, transcript.text);
});

test('changing only mode while awaiting navigation retains speech in captured private draft', async () => {
  const f = fixture({ active: { id: 'original', mode: 'private', mode_revision: 1 } });
  f.context.showView = async () => { f.state.active = { id: 'original', mode: 'daily', mode_revision: 2 }; };
  await f.receive({ ...transcript, mode: 'private', mode_revision: 1 });
  assert.equal(f.calls.sent.length, 0); assert.equal(f.input.value, '');
  assert.equal(f.state.drafts.get('original:private'), transcript.text);
});

test('background orb transcript sends only into its exact private revision without navigating or focus', async () => {
  const f = fixture({ active: { id: 'original', mode: 'private', mode_revision: 7 } });
  await f.receive({ ...transcript, mode: 'private', mode_revision: 7, open_panel: false });
  assert.deepEqual(f.calls.sent, [transcript.text]); assert.deepEqual(f.calls.views, []); assert.equal(f.calls.focus, 0);
  assert.equal(f.state.active.id, 'original'); assert.equal(f.state.active.mode, 'private'); assert.equal(f.state.active.mode_revision, 7);
});

test('background orb stale revision or changed scope stays a private draft without waking the view', async () => {
  const stale = fixture({ active: { id: 'original', mode: 'private', mode_revision: 3 } });
  await stale.receive({ ...transcript, mode: 'private', mode_revision: 1, open_panel: false });
  assert.deepEqual(stale.calls.sent, []); assert.equal(stale.input.value, transcript.text);
  assert.deepEqual(stale.calls.views, []); assert.equal(stale.calls.focus, 0);
  const changed = fixture({ active: { id: 'original', mode: 'daily', mode_revision: 2 } });
  changed.input.value = 'PUBLIC_DRAFT';
  await changed.receive({ ...transcript, mode: 'private', mode_revision: 1, open_panel: false });
  assert.deepEqual(changed.calls.sent, []); assert.equal(changed.input.value, 'PUBLIC_DRAFT');
  assert.equal(changed.state.drafts.get('original:private'), transcript.text);
  assert.deepEqual(changed.calls.views, []); assert.equal(changed.calls.focus, 0);
});

test('background orb recovery creates only a private draft and explicit panel setting retains navigation', async () => {
  const hidden = fixture();
  await hidden.receive({ ...transcript, conversation_id: null, mode: 'private', open_panel: false });
  assert.deepEqual(hidden.calls.sent, []); assert.equal(hidden.calls.rpc[0].payload.mode, 'private');
  assert.equal(hidden.state.drafts.get('recovered:private'), transcript.text);
  assert.deepEqual(hidden.calls.views, []); assert.equal(hidden.calls.focus, 0);
  const visible = fixture(); await visible.receive({ ...transcript, open_panel: true });
  assert.deepEqual(visible.calls.sent, [transcript.text]); assert.deepEqual(visible.calls.views, ['chat']); assert.equal(visible.calls.focus, 1);
});
