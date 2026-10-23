/* Pure interaction/state helpers shared by the desktop companion and tests. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LaurentinaCompanionInteraction = api;
})(globalThis, () => {
  'use strict';
  const level = value => Math.max(0, Math.min(1, Number(value) || 0));

  function createActivation({ single, double, delay = 330, now = () => performance.now(),
    schedule = setTimeout, unschedule = clearTimeout } = {}) {
    let pending = null, disposed = false, doubleAt = -Infinity;
    const cancel = () => { if (pending) unschedule(pending.timer); pending = null; };
    const activate = (at = now()) => {
      if (disposed || at - doubleAt >= 0 && at - doubleAt < delay) return;
      if (pending && Math.abs(at - pending.at) <= delay) {
        cancel(); doubleAt = at; double?.(); return;
      }
      if (pending) { cancel(); single?.(); }
      const item = { at, timer: null };
      pending = item;
      item.timer = schedule(() => { if (pending === item && !disposed) { pending = null; single?.(); } }, delay);
    };
    return { activate, cancel,
      hold() { if (pending) unschedule(pending.timer); },
      keyboard(open = false) { if (disposed) return; cancel(); open ? double?.() : single?.(); },
      dispose() { disposed = true; cancel(); } };
  }

  function createTouchFeedback({ change = () => {}, schedule = setTimeout, unschedule = clearTimeout,
    maximum = 60000 } = {}) {
    let state = { id: null, active: false, audioActive: false, animationActive: false, speaking: false, level: 0, text: '' }, timer = null, disposed = false;
    const get = () => ({ ...state });
    const clear = (phase = 'end', busy = false) => {
      if (!state.active) return false;
      if (timer !== null) unschedule(timer);
      timer = null;
      state = { ...state, active: false, audioActive: false, animationActive: false, speaking: false, level: 0 };
      change({ ...get(), phase, busy });
      return true;
    };
    const endAudio = (phase = 'end') => {
      if (!state.audioActive) return false;
      if (timer !== null) unschedule(timer);
      timer = null;
      state = { ...state, audioActive: false, active: state.animationActive, speaking: false, level: 0 };
      change({ ...get(), phase });
      return true;
    };
    const response = value => {
      if (disposed || !value) return false;
      if (value.phase === 'cancel') return (!value.id || state.id === value.id) && clear('cancel');
      if (typeof value.id !== 'string' || !value.id || value.id.length > 100) return false;
      if (value.phase === 'end') return state.id === value.id && (value.busy ? clear('end', true) : endAudio());
      if (value.phase !== 'start' || state.id === value.id) return false;
      const continuing = !value.busy && state.animationActive;
      if (!continuing) clear('cancel');
      if (timer !== null) unschedule(timer);
      state = { id: value.id, active: !value.busy, audioActive: !value.busy, animationActive: continuing, speaking: false, level: 0,
        text: typeof value.text === 'string' ? value.text.slice(0, 1000) : '' };
      timer = state.active ? schedule(() => endAudio('timeout'), Math.max(1, Math.min(60000, maximum))) : null;
      change({ ...get(), phase: 'start', busy: Boolean(value.busy) });
      return true;
    };
    return { get, response, cancel: () => clear('cancel'), dispose() { disposed = true; clear('cancel'); },
      animation(id, active) {
        if (disposed || state.id !== id || !state.active || state.animationActive === Boolean(active)) return false;
        state = { ...state, animationActive: Boolean(active), active: state.audioActive || Boolean(active) };
        change({ ...get(), phase: active ? 'animation-start' : 'animation-end' });
        return true;
      },
      voice(value) {
        if (disposed || !state.audioActive || value?.source !== 'touch' || value.touch_id !== state.id) return false;
        state = { ...state, speaking: Boolean(value.speaking), level: level(value.level) };
        change({ ...get(), phase: 'voice' });
        return true;
      } };
  }

  function visualState(real = {}, touch = {}) {
    const recording = Boolean(real.recording), realSpeaking = !recording && Boolean(real.speaking);
    const thinking = !recording && !realSpeaking && Boolean(real.thinking);
    const occupied = recording || realSpeaking || thinking;
    const touching = !occupied && Boolean(touch.active);
    return { state: recording ? 'listening' : realSpeaking ? 'speaking' : thinking ? 'thinking' : touching ? 'touch' : 'idle',
      recording, speaking: realSpeaking || touching && Boolean(touch.speaking), thinking, touching,
      level: occupied ? level(real.level) : touching && touch.speaking ? level(touch.level) : 0 };
  }

  function touchAnimation(manifest, adapter) {
    if (!['live2d', 'spine'].includes(manifest?.kind)) return null;
    if (typeof adapter?.touchAnimation === 'string' && adapter.animations?.includes(adapter.touchAnimation)) return adapter.touchAnimation;
    const name = manifest.stateMap?.touch;
    if (typeof name === 'string' && adapter?.animations?.includes(name)) return name;
    const explicit = manifest.touch_animation_explicit ?? Object.hasOwn(manifest.stateMap || {}, 'touch');
    if (explicit) return null;
    return adapter?.animations?.find(name => /^interact$/i.test(name)) || adapter?.animations?.find(name => /touch|interact|点击|触摸/i.test(name)) || null;
  }

  return Object.freeze({ createActivation, createTouchFeedback, visualState, touchAnimation });
});
