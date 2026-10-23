'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync(require('node:path').join(__dirname, 'ui/app.js'), 'utf8');
const SpeechPipeline = require('./ui/speech_pipeline.js');
const portion = (first, last) => app.slice(app.indexOf(first), app.indexOf(last, app.indexOf(first)));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = { state: [], received: [], published: 0, stopped: 0 }, nodes = new Map();
  const element = () => ({ classList: { toggle() {} }, setAttribute() {}, value: '', title: '' });
  const track = { stop() { calls.stopped++; }, addEventListener() {} };
  const stream = () => ({ getTracks: () => [track], getAudioTracks: () => [track] });
  const context = vm.createContext({ SpeechPipeline, Float32Array, Uint8Array, Date, setTimeout, btoa,
    voiceConversation: null, voiceRecorder: null, microphoneStarting: false, voiceTranscribing: false, foreignRecording: false, speechActive: false, speechStopBarrier: Promise.resolve(),
    state: { ready: true, intent: 'chat', active: { id: 'one', mode: 'private', mode_revision: 1 }, mode: 'private', voice: { settings: { voice_input_mode: 'direct' } } },
    $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, tr: text => text,
    navigator: { mediaDevices: { getUserMedia: async () => stream() } },
    showView: async () => {}, rpc: async () => ({}), errorText: error => error.message, toast() {},
    currentModeRevision: () => 1, stopSpeaking: () => {}, activeJob: () => null, cancelJob: async () => {}, delay: async () => {},
    voiceState: (...args) => calls.state.push(args), publishAssistantState: () => { calls.published++; },
    receiveTranscript: async (...args) => calls.received.push(args),
  });
  context.window = { AudioContext: class {
    constructor() { this.sampleRate = 24000; }
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  } };
  vm.runInContext(portion('function updateConversationVoiceControl()', 'async function receiveVoiceTranscript('), context);
  return { context, calls };
}
test('late initialization error from an old microphone session cannot close the new session', async () => {
  const { context, calls } = fixture(); let rejectFirst, count = 0;
  const Base = context.window.AudioContext;
  context.window.AudioContext = class extends Base { resume() { if (++count === 1) return new Promise((_, reject) => { rejectFirst = reject; }); return Promise.resolve(); } };
  const first = context.toggleVoiceConversation(); await tick();
  const original = context.voiceConversation; context.stopVoiceConversation();
  await context.toggleVoiceConversation(); const replacement = context.voiceConversation;
  assert.notEqual(replacement, original); assert.ok(replacement.node);
  rejectFirst(new Error('old context closed')); await first;
  assert.equal(context.voiceConversation, replacement); assert.equal(replacement.closed, false);
  context.stopVoiceConversation(); assert.ok(calls.stopped >= 2);
});
test('transcription completion does not clear already-started assistant speech state', async () => {
  const { context, calls } = fixture();
  context.rpc = async () => ({ text: '你好' });
  context.receiveTranscript = async (...args) => { calls.received.push(args); context.speechActive = true; };
  const session = { context: { sampleRate: 24000 }, destination: { id: 'one', mode: 'private', mode_revision: 1 },
    detector: { reset() {} }, interruption: Promise.resolve(), processing: false };
  context.voiceConversation = session;
  await context.processVoiceTurn(session, [new Float32Array(2400)]);
  assert.equal(calls.received.length, 1); assert.equal(calls.published, 1);
  assert.equal(calls.state.some(args => args[0] === '正在聆听…'), false);
});
test('closing the microphone while recognition is pending never sends the late transcript', async () => {
  const { context, calls } = fixture(); let finish;
  context.rpc = async action => action === 'resources.continuous' ? {} : new Promise(resolve => { finish = resolve; });
  const session = { context: { sampleRate: 24000, close: async () => {} }, destination: { id: 'one', mode: 'private', mode_revision: 1 },
    detector: { reset() {} }, interruption: Promise.resolve(), processing: false };
  context.voiceConversation = session;
  const pending = context.processVoiceTurn(session, [new Float32Array(2400)]);
  await tick(); context.stopVoiceConversation(); finish({ text: 'PRIVATE_LATE_FIXTURE' }); await pending;
  assert.equal(calls.received.length, 0); assert.equal(context.voiceTranscribing, false);
});
test('continuous voice waits for old synthesis cancellation before preparing its model', async () => {
  const { context } = fixture(); let stopped; const requested = [];
  context.speechStopBarrier = new Promise(resolve => { stopped = resolve; });
  context.rpc = async action => { requested.push(action); return {}; };
  const starting = context.toggleVoiceConversation(); await tick();
  assert.deepEqual(requested, []);
  stopped(); await starting;
  assert.deepEqual(requested, ['resources.continuous', 'voice.prepare']); assert.ok(context.voiceConversation.node);
  context.stopVoiceConversation();
});
test('streamed and final-only replies speak once, and an old generation cannot restart', () => {
  const f = fixture(), queued = []; let finishes = 0;
  Object.assign(f.context, { speechGeneration: 0, beginSpeech: () => ({ generation: ++f.context.speechGeneration, queue: { enqueue: text => queued.push(text), finish: () => { finishes++; } } }) });
  vm.runInContext(portion('function feedJobSpeech(', 'async function toggleRecording('), f.context);
  const job = { conversationId: 'one', text: '' };
  const delta = '这是一句足够完整的回答，我们会在后面的内容生成之前开始朗读。';
  job.text = delta; f.context.feedJobSpeech(job, delta); f.context.feedJobSpeech(job, '', true, delta);
  assert.deepEqual(queued, [delta]); assert.equal(finishes, 1);
  const finalOnly = { conversationId: 'one', text: '' }; f.context.feedJobSpeech(finalOnly, '', true, '没有分词事件的最终回答。');
  assert.equal(queued.at(-1), '没有分词事件的最终回答。');
  const count = queued.length; f.context.speechGeneration++;
  f.context.feedJobSpeech(job, delta); assert.equal(queued.length, count);
});

function speechFixture() {
  const f = fixture(), queued = []; let starts = 0, finishes = 0;
  Object.assign(f.context, { speechGeneration: 0, beginSpeech: () => { starts++; return { generation: ++f.context.speechGeneration,
    queue: { enqueue: text => queued.push(text), finish: () => { finishes++; } } }; } });
  vm.runInContext(portion('function feedJobSpeech(', 'async function toggleRecording('), f.context);
  return { ...f, queued, counts: () => ({ starts, finishes }) };
}
const answer = '这是一句足够完整的回答，我们会在后面的内容生成之前开始朗读。';
test('save-memory local replies do not start speech inference until generation is finished, without retaining token copies', () => {
  const f = speechFixture(), job = { conversationId: 'one', speechLocal: true, resourcePreset: 'low_memory', text: answer };
  f.context.feedJobSpeech(job, answer);
  assert.deepEqual(f.counts(), { starts: 0, finishes: 0 });
  assert.equal(job.speechDeferred, true); assert.equal(job.speechBuffer, undefined);
  f.context.feedJobSpeech(job, '', true, answer);
  f.context.feedJobSpeech(job, '', true, answer); // repeated final receipts must not speak twice
  assert.deepEqual(f.queued, [answer]); assert.deepEqual(f.counts(), { starts: 1, finishes: 1 });
});
test('cloud and balanced local replies keep streamed speech, while secret-held private replies always defer in save-memory', () => {
  for (const [preset, local, privacy, deferred] of [
    ['balanced', true, 'shared', false], ['low_memory', false, 'shared', false], ['low_memory', false, 'private', true],
  ]) {
    const f = speechFixture(), job = { conversationId: 'one', resourcePreset: preset, speechLocal: local, userMessage: { privacy }, text: answer };
    f.context.feedJobSpeech(job, answer);
    assert.equal(f.counts().starts, deferred ? 0 : 1, `${preset}/${local}/${privacy}`);
    f.context.feedJobSpeech(job, '', true, answer);
    assert.deepEqual(f.queued, [answer]);
  }
});
test('deferred final speech cannot restart after cancellation, auto-read off, chat switch, mode revision change or a manual read', () => {
  for (const interruption of ['cancel', 'disabled', 'chat', 'mode', 'manual']) {
    const f = speechFixture(), job = { conversationId: 'one', speechLocal: true, resourcePreset: 'low_memory', speechModeRevision: 1, text: answer };
    f.context.feedJobSpeech(job, answer);
    if (interruption === 'cancel' || interruption === 'manual') job.speechStopped = true;
    if (interruption === 'disabled') f.context.state.voice.settings.auto_speak = false;
    if (interruption === 'chat') f.context.state.active.id = 'other';
    if (interruption === 'mode') f.context.currentModeRevision = () => 2;
    f.context.feedJobSpeech(job, '', true, answer);
    assert.deepEqual(f.queued, [], interruption); assert.equal(f.counts().starts, 0, interruption);
  }
});
test('save-memory final-only local reply still speaks once after completion', () => {
  const f = speechFixture(), job = { conversationId: 'one', speechLocal: true, resourcePreset: 'low_memory', text: '' };
  f.context.feedJobSpeech(job, '', true, answer);
  assert.deepEqual(f.queued, [answer]); assert.deepEqual(f.counts(), { starts: 1, finishes: 1 });
});
