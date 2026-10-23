'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createActivation, createTouchFeedback, visualState, touchAnimation } = require('./ui/companion-interaction.js');

function clock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return { now: () => now,
    schedule(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    unschedule(id) { timers.delete(id); },
    tick(ms) { const end = now + ms; for (;;) { const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = end; },
    pending: () => timers.size };
}

test('single click waits for double click window and fires once', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  a.activate(); c.tick(329); assert.deepEqual(calls, []); c.tick(1); assert.deepEqual(calls, ['touch']); c.tick(1000);
  assert.deepEqual(calls, ['touch']);
});
test('double click opens only once without single touch or third-click spill', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  a.activate(); c.tick(120); a.activate(); c.tick(30); a.activate(); c.tick(1000);
  assert.deepEqual(calls, ['open']);
});
test('native drag cancellation and disposed window never activate', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  a.activate(); a.cancel(); c.tick(1000); a.activate(); a.dispose(); c.tick(1000); a.activate(); a.keyboard();
  assert.deepEqual(calls, []); assert.equal(c.pending(), 0);
});
test('second pointer press suspends a pending click while it may become a drag', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  a.activate(); c.tick(300); a.hold(); c.tick(1000); assert.deepEqual(calls, []);
  a.cancel(); c.tick(1000); assert.deepEqual(calls, []);
});
test('delayed native finish uses pointer timestamp and out-of-order double finishes still combine', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  c.tick(500); a.activate(150); a.activate(0); c.tick(1000);
  assert.deepEqual(calls, ['open']);
});
test('keyboard touch and explicit open remain available independently', () => {
  const c = clock(), calls = [];
  const a = createActivation({ ...c, single: () => calls.push('touch'), double: () => calls.push('open') });
  a.activate(); a.keyboard(); a.keyboard(true); c.tick(1000);
  assert.deepEqual(calls, ['touch', 'open']);
});
test('touch lifecycle is bounded and duplicate start/late voice cannot revive it', () => {
  const c = clock(), changes = [], touch = createTouchFeedback({ ...c, change: item => changes.push(item.phase) });
  touch.response({ id: 'a', phase: 'start', text: '你好' }); c.tick(59000);
  touch.response({ id: 'a', phase: 'start' });
  touch.voice({ source: 'touch', touch_id: 'a', speaking: true, level: 2 });
  assert.equal(touch.get().level, 1); c.tick(1000); assert.equal(touch.get().active, false);
  assert.equal(touch.voice({ source: 'touch', touch_id: 'a', speaking: true }), false);
  assert.equal(touch.response({ id: 'a', phase: 'start' }), false);
  assert.deepEqual(changes, ['start', 'voice', 'timeout']);
});
test('old ends and foreign energy cannot interrupt a newer touch', () => {
  const c = clock(), touch = createTouchFeedback(c);
  touch.response({ id: 'a', phase: 'start' }); touch.response({ id: 'b', phase: 'start' });
  assert.equal(touch.response({ id: 'a', phase: 'end' }), false);
  assert.equal(touch.voice({ source: 'touch', touch_id: 'a', speaking: true }), false);
  assert.equal(touch.voice({ source: 'ai', touch_id: 'b', speaking: true }), false);
  assert.equal(touch.get().id, 'b'); assert.equal(touch.get().active, true);
  touch.response({ id: 'b', phase: 'end', busy: true }); assert.equal(touch.get().active, false); assert.equal(c.pending(), 0);
});
test('real recording speaking and thinking outrank touch animation and audio level', () => {
  const touch = { active: true, speaking: true, level: .9 };
  for (const [real, expected] of [[{ recording: true, speaking: true, level: .2 }, 'listening'], [{ speaking: true, level: .3 }, 'speaking'], [{ thinking: true, level: 0 }, 'thinking']]) {
    const state = visualState(real, touch); assert.equal(state.state, expected); assert.equal(state.touching, false); assert.equal(state.level, real.level);
  }
  const state = visualState({}, touch); assert.equal(state.state, 'touch'); assert.equal(state.speaking, true); assert.equal(state.level, .9);
});
test('busy and disposed feedback cannot start or retain audio', () => {
  const c = clock(), touch = createTouchFeedback(c);
  touch.response({ id: 'a', phase: 'start', busy: true }); assert.equal(touch.get().active, false);
  touch.response({ id: 'b', phase: 'start' }); touch.voice({ source: 'touch', touch_id: 'b', speaking: true, level: .5 });
  touch.dispose(); assert.equal(touch.get().speaking, false); assert.equal(c.pending(), 0);
  assert.equal(touch.response({ id: 'c', phase: 'start' }), false);
});
test('custom touch animation only uses a matching imported Live2D or Spine motion', () => {
  for (const kind of ['live2d', 'spine']) assert.equal(touchAnimation({ kind, stateMap: { touch: 'Tap:0' } }, { animations: ['Tap:0'] }), 'Tap:0');
  assert.equal(touchAnimation({ kind: 'spine', stateMap: { touch: 'missing' } }, { animations: ['Idle'] }), null);
  assert.equal(touchAnimation({ kind: 'image', stateMap: { touch: 'Tap:0' } }, { animations: ['Tap:0'] }), null);
});
test('legacy Interact suggestion uses the runtime names and preserves explicit no-touch mapping',()=>{
  const animations=['Idle','touch_extra','Interact'];
  assert.equal(touchAnimation({kind:'spine',stateMap:{idle:'Idle'}},{animations}),'Interact');
  assert.equal(touchAnimation({kind:'spine',stateMap:{touch:''}},{animations}),null);
  assert.equal(touchAnimation({kind:'spine',touch_animation_explicit:false,stateMap:{touch:''}},{animations}),'Interact');
});

test('audio end and timeout leave an unfinished model action alive until its own completion', () => {
  for (const ending of ['end', 'timeout']) {
    const c = clock(), touch = createTouchFeedback(c);
    touch.response({ id: 'a', phase: 'start' }); touch.animation('a', true);
    touch.voice({ source: 'touch', touch_id: 'a', speaking: true, level: .8 });
    ending === 'end' ? touch.response({ id: 'a', phase: 'end' }) : c.tick(60000);
    assert.equal(touch.get().active, true); assert.equal(touch.get().animationActive, true);
    assert.equal(touch.get().audioActive, false); assert.equal(touch.get().speaking, false); assert.equal(c.pending(), 0);
    assert.equal(touch.voice({ source: 'touch', touch_id: 'a', speaking: true, level: 1 }), false);
    assert.equal(touch.get().speaking, false);
    touch.animation('a', false); assert.equal(touch.get().active, false);
  }
});

test('new touch retains a running action and completion of an older touch cannot end its replacement', () => {
  const c = clock(), touch = createTouchFeedback(c);
  touch.response({ id: 'a', phase: 'start' }); touch.animation('a', true);
  touch.response({ id: 'a', phase: 'end' });
  touch.response({ id: 'b', phase: 'start' });
  assert.equal(touch.get().animationActive, true); assert.equal(touch.get().audioActive, true);
  assert.equal(touch.animation('a', false), false);
  touch.animation('b', false); assert.equal(touch.get().active, true);
  touch.response({ id: 'b', phase: 'end' }); assert.equal(touch.get().active, false);
  assert.equal(c.pending(), 0);
});

test('cancel and dispose clear both lifecycles without a scheduled next line', () => {
  const c = clock(), touch = createTouchFeedback(c);
  touch.response({ id: 'a', phase: 'start' }); touch.animation('a', true); touch.cancel();
  assert.equal(touch.get().animationActive, false); assert.equal(touch.get().audioActive, false);
  assert.equal(touch.animation('a', false), false); assert.equal(c.pending(), 0);
  touch.response({ id: 'b', phase: 'start' }); touch.animation('b', true); touch.dispose();
  assert.equal(c.pending(), 0); c.tick(120000); assert.equal(touch.get().active, false);
});

test('native disable can cancel a completed-audio action without knowing its old audio id', () => {
  const c = clock(), touch = createTouchFeedback(c);
  touch.response({ id: 'a', phase: 'start' }); touch.animation('a', true);
  touch.response({ id: 'a', phase: 'end' }); assert.equal(touch.get().animationActive, true);
  assert.equal(touch.response({ phase: 'cancel' }), true);
  assert.equal(touch.get().active, false); assert.equal(c.pending(), 0);
});
