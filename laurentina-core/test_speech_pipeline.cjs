'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SentenceBuffer, SpeechQueue, cleanSpeech, VoiceActivityDetector, wavFromPCM } = require('./ui/speech_pipeline.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

class VirtualAudioClock {
  constructor() { this.time = 0; this.timers = new Map(); this.serial = 0; this.tail = 0; this.plays = []; }
  now = () => this.time;
  setTimer = (callback, ms) => { const id = ++this.serial; this.timers.set(id, { at: this.time + ms / 1000, callback }); return id; };
  clearTimer = id => this.timers.delete(id);
  delay(seconds) { return new Promise(resolve => this.setTimer(resolve, seconds * 1000)); }
  play = chunk => {
    const start = Math.max(this.time, this.tail); this.tail = start + chunk.duration;
    this.plays.push({ at: this.time, start, end: this.tail, label: chunk.label });
    return this.delay(this.tail - this.time);
  };
  async drain(queue, limit = 100) {
    let done = false; queue.done.then(() => { done = true; });
    for (let step = 0; step < 10000 && !done; step++) {
      await tick(); if (done) break;
      const at = Math.min(...[...this.timers.values()].map(item => item.at));
      assert.ok(Number.isFinite(at), 'queue deadlocked without a producer, playback, or buffer timer');
      assert.ok(at <= limit, 'queue exceeded the simulated time bound'); this.time = at;
      for (const [id, timer] of [...this.timers]) if (timer.at <= at) { this.timers.delete(id); timer.callback(); }
    }
    assert.ok(done, 'queue failed to finish');
  }
}

function timedQueue(clock, options = {}) {
  return new SpeechQueue({ clock: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    play: clock.play, ...options });
}

test('streaming speech starts at a complete sentence before the full answer arrives', () => {
  const buffer = new SentenceBuffer();
  assert.deepEqual(buffer.push('我先检查你刚才提到的问题，'), []);
  assert.deepEqual(buffer.push('然后给你一个清楚的答复。后面的内容还在生成'), ['我先检查你刚才提到的问题，然后给你一个清楚的答复。']);
  assert.deepEqual(buffer.push('', true), ['后面的内容还在生成']);
  assert.deepEqual(buffer.push('不能重复朗读', true), []);
});
test('markdown URLs and code are not read out and an unfinished code fence waits', () => {
  const buffer = new SentenceBuffer();
  assert.deepEqual(buffer.push('```python\n' + 'print(1)\n'.repeat(80)), []);
  assert.deepEqual(buffer.push('```\n', true), ['代码内容请查看文字。']);
  assert.equal(cleanSpeech('## 标题\n[项目](https://example.com) **已完成**'), '标题\n项目 已完成');
  const unfinished = new SentenceBuffer(); unfinished.push('```' + 'private_code();'.repeat(50));
  assert.deepEqual(unfinished.push('', true), ['代码内容请查看文字。']);
});

test('speech cleanup strips emoji chains while preserving text and keycap digits', () => {
  const original = '你好👩🏽‍🚀，今天有1️⃣个任务❤️！ English 🇬🇧。';
  assert.equal(cleanSpeech(original), '你好 ，今天有1个任务 ！ English 。');
  assert.ok(original.includes('👩🏽‍🚀'));
});

test('timer callbacks use the browser global receiver rather than the queue object', async () => {
  const queue = new SpeechQueue({ prepare: async () => (async function* () { yield { duration: .01 }; await new Promise(resolve => setTimeout(resolve, 10)); yield { duration: .01 }; })(),
    play: () => Promise.resolve(),
    setTimer: function(callback, ms) { assert.equal(this, globalThis); return setTimeout(callback, ms); },
    clearTimer: function(id) { assert.equal(this, globalThis); return clearTimeout(id); } });
  queue.enqueue('native receiver'); await queue.finish();
  assert.equal(queue.metrics().chunks, 2);
});
test('long unpunctuated text is bounded without dropping characters', () => {
  const input = '一'.repeat(2200); const parts = new SentenceBuffer().push(input, true);
  assert.equal(parts.join(''), input); assert.ok(parts.every(part => part.length <= 280));
});
test('the next segment is synthesized while the previous segment is playing', async () => {
  const prepared = [], playing = [], finishes = [];
  const queue = new SpeechQueue({ prepare: async text => { prepared.push(text); return text; },
    play: value => { playing.push(value); return new Promise(resolve => finishes.push(resolve)); } });
  queue.enqueue('first'); queue.enqueue('second'); queue.enqueue('third'); queue.finish();
  await tick(); assert.deepEqual(prepared, ['first', 'second']); assert.deepEqual(playing, ['first', 'second']);
  finishes[0](); await tick(); assert.deepEqual(prepared, ['first', 'second', 'third']);
  finishes[1](); finishes[2](); await queue.done;
});
test('cancelling a pending synthesis prevents late playback and the next request', async () => {
  let release; const played = [], prepared = [];
  const queue = new SpeechQueue({ prepare: text => { prepared.push(text); return new Promise(resolve => { release = resolve; }); }, play: value => played.push(value) });
  queue.enqueue('old'); queue.enqueue('never'); await tick(); queue.cancel(); release('old'); await tick();
  assert.deepEqual(played, []); assert.deepEqual(prepared, ['old']);
});
test('failed audio preparation reports once and resolves the queue', async () => {
  const errors = [];
  const queue = new SpeechQueue({ prepare: async () => { throw new Error('offline'); }, play: () => assert.fail('must not play'), onError: error => errors.push(error.message) });
  queue.enqueue('hello'); await queue.finish(); assert.deepEqual(errors, ['offline']);
});
test('native audio chunks play before the sentence stream has finished', async () => {
  let release, ended = false; const playing = [];
  async function* stream() { yield 'first PCM chunk'; await new Promise(resolve => { release = resolve; }); yield 'last PCM chunk'; ended = true; }
  const queue = new SpeechQueue({ prepare: async () => stream(), play: chunk => { playing.push(chunk); return Promise.resolve(); } });
  queue.enqueue('one sentence'); queue.finish(); await tick();
  assert.deepEqual(playing, ['first PCM chunk']); assert.equal(ended, false);
  release(); await queue.done; assert.deepEqual(playing, ['first PCM chunk', 'last PCM chunk']);
});

test('tiny chunks prefetch the next sentence while enough previous audio remains', async () => {
  const clock = new VirtualAudioClock(); const prepared = [];
  const queue = timedQueue(clock, { maxBufferSeconds: 0.8,
    prepare: async text => {
      prepared.push({ text, at: clock.now() });
      return (async function* () {
        for (let i = 0; i < 8; i++) {
          await clock.delay(i ? [0.02, 0.025, 0.05][i % 3] : 0.12);
          yield { duration: 0.08, label: text + ':' + i };
        }
      })();
    } });
  for (const text of ['one', 'two', 'three', 'four']) queue.enqueue(text);
  queue.finish(); await clock.drain(queue);
  assert.equal(clock.plays.length, 32);
  const endOfFirst = clock.plays.find(item => item.label === 'one:7').end;
  assert.ok(prepared[1].at < endOfFirst - 0.15, 'the next synthesis must not wait for the penultimate tiny chunk to end');
  assert.equal(queue.metrics().underruns, 0);
  assert.ok(queue.metrics().firstAudioMs <= 300.1, 'first sound adds at most 180 ms after first supply at 120 ms');
  assert.ok(queue.metrics().maxBufferedSeconds <= 0.881);
});

test('bounded prebuffer absorbs uneven chunk delivery without losing or duplicating audio', async () => {
  const clock = new VirtualAudioClock();
  const queue = timedQueue(clock, { prepare: async () => (async function* () {
    for (let i = 0; i < 24; i++) {
      await clock.delay(i === 0 ? 0.02 : i % 5 === 0 ? 0.19 : 0.015);
      yield { duration: 0.1, label: String(i) };
    }
  })() });
  queue.enqueue('jitter'); queue.finish(); await clock.drain(queue);
  assert.deepEqual(clock.plays.map(item => item.label), Array.from({ length: 24 }, (_, i) => String(i)));
  assert.equal(queue.metrics().underruns, 0);
  assert.ok(queue.metrics().targetBufferSeconds >= 0.55);
});

test('slower than realtime synthesis reports underruns instead of claiming smooth playback', async () => {
  const clock = new VirtualAudioClock();
  const queue = timedQueue(clock, { prepare: async () => (async function* () {
    for (let i = 0; i < 30; i++) { await clock.delay(0.16); yield { duration: 0.08, label: String(i) }; }
  })() });
  queue.enqueue('slow'); queue.finish(); await clock.drain(queue);
  const metrics = queue.metrics();
  assert.equal(clock.plays.length, 30);
  assert.ok(metrics.underruns > 0); assert.ok(metrics.gapMs > 0);
  assert.ok(metrics.producerWaitPerAudio > 1, 'diagnostics must expose a source slower than realtime');
  assert.ok(metrics.targetBufferSeconds > 0.55 && metrics.targetBufferSeconds <= 1.2, 'recovery buffer adapts within its cap');
  assert.ok(metrics.firstAudioMs <= 340.1);
  assert.ok(metrics.maxBufferedSeconds <= 4.081);
});

test('fast producer remains bounded by seconds and chunks during long playback', async () => {
  const clock = new VirtualAudioClock();
  const queue = timedQueue(clock, { maxBufferSeconds: 1, maxChunks: 16,
    prepare: async () => (async function* () {
      for (let i = 0; i < 100; i++) { await clock.delay(0.001); yield { duration: 0.1, label: String(i) }; }
    })() });
  queue.enqueue('long'); queue.finish(); await clock.drain(queue);
  assert.equal(clock.plays.length, 100);
  assert.ok(queue.metrics().maxBufferedSeconds <= 1.101);
  assert.ok(queue.metrics().maxBufferedChunks <= 16);
});

test('cancelling during prebuffer discards ready audio and does not prepare later sentences', async () => {
  const clock = new VirtualAudioClock(); const prepared = [];
  const queue = timedQueue(clock, { prepare: async text => {
    prepared.push(text);
    return (async function* () { yield { duration: 0.01 }; await clock.delay(1); yield { duration: 0.1 }; })();
  } });
  queue.enqueue('old'); queue.enqueue('never'); queue.finish(); await tick();
  assert.equal(clock.plays.length, 0);
  queue.cancel(); await queue.done;
  for (const timer of [...clock.timers.values()]) timer.callback();
  await tick();
  assert.equal(clock.plays.length, 0); assert.deepEqual(prepared, ['old']);
});
test('VAD requires sustained speech, ends on silence, and has a higher interruption threshold', () => {
  const frame = level => new Float32Array(1600).fill(level);
  const detector = new VoiceActivityDetector(16000);
  assert.equal(detector.process(frame(0.03)).type, 'level');
  detector.process(frame(0)); assert.equal(detector.speaking, false);
  detector.process(frame(0.03)); detector.process(frame(0.03)); assert.equal(detector.process(frame(0.03)).type, 'start');
  for (let i = 0; i < 8; i++) assert.equal(detector.process(frame(0)).type, 'level');
  assert.equal(detector.process(frame(0)).type, 'end');
  for (let i = 0; i < 8; i++) detector.process(frame(0.03), true);
  assert.equal(detector.speaking, false);
  detector.process(frame(0.08), true); detector.process(frame(0.08), true); assert.equal(detector.process(frame(0.08), true).type, 'start');
});
test('PCM microphone turns produce bounded mono WAV with valid frame counts', () => {
  const bytes = wavFromPCM([new Float32Array([0, 0.5, -0.5]), new Float32Array([1, -1])], 24000);
  const raw = Buffer.from(bytes); assert.equal(raw.subarray(0, 4).toString(), 'RIFF');
  assert.equal(raw.readUInt32LE(24), 24000); assert.equal(raw.readUInt32LE(40), 10); assert.equal(raw.length, 54);
  assert.equal(raw.readInt16LE(50), 32767); assert.equal(raw.readInt16LE(52), -32767);
});
