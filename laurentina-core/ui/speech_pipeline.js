'use strict';

// Shared by the renderer and behavioral tests; no access to files or services.
((root) => {
  function cleanSpeech(text) {
    return String(text || '')
      .replace(/([0-9#*])\uFE0F?\u20E3/gu, '$1')
      .replace(/[\u200D\uFE00-\uFE0F\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/gu, '')
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]/gu, ' ')
      .replace(/```[\s\S]*?(?:```|$)/g, ' 代码内容请查看文字。 ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/[^\s<>]+/g, ' 链接请查看文字 ')
      .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
      .replace(/[*_`#|]/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  class SentenceBuffer {
    constructor() { this.pending = ''; this.started = false; this.closed = false; }
    push(delta = '', final = false) {
      if (this.closed) return [];
      this.pending += delta;
      const parts = [];
      while (this.pending.trim()) {
        let limit = Math.min(280, this.pending.length);
        const fence = this.pending.indexOf('```');
        let beforeCode = false;
        if (fence >= 0) {
          const end = this.pending.indexOf('```', fence + 3);
          if (fence === 0) {
            if (end < 0 && !final) break;
            this.pending = end < 0 ? '' : this.pending.slice(end + 3);
            parts.push('代码内容请查看文字。'); this.started = true; continue;
          }
          if (fence <= limit) { limit = fence; beforeCode = true; }
        }
        const minimum = this.started ? 70 : 22;
        let split = 0;
        const boundaries = /[。！？；\n]+[”’」』）)]*|[.!?]+[”’")]*\s+/g;
        let match;
        while ((match = boundaries.exec(this.pending.slice(0, limit)))) {
          const end = match.index + match[0].length;
          if (end >= minimum) { split = end; break; }
        }
        if (!split && limit >= 280) {
          const prefix = this.pending.slice(0, limit);
          const soft = Math.max(prefix.lastIndexOf('，'), prefix.lastIndexOf(','), prefix.lastIndexOf(' '));
          split = soft >= 140 ? soft + 1 : limit;
        }
        if (!split && (final || beforeCode)) split = limit || this.pending.length;
        if (!split) break;
        const raw = this.pending.slice(0, split);
        this.pending = this.pending.slice(split);
        const text = cleanSpeech(raw);
        if (text) { parts.push(text); this.started = true; }
      }
      if (final) { this.pending = ''; this.closed = true; }
      return parts;
    }
  }

  // Produce independently of playback. Two tiny PCM chunks are not enough
  // lookahead for the first chunk of the next sentence; bound by seconds and
  // chunk count instead. The caller still owns one AudioContext clock.
  class SpeechQueue {
    constructor({ prepare, play, onError = () => {}, onDone = () => {}, onMetrics = () => {},
      clock = () => performance.now() / 1000, setTimer = setTimeout, clearTimer = clearTimeout,
      maxBufferSeconds = 4, maxChunks = 24, firstBufferSeconds = 0.55, firstBufferWait = 0.18 } = {}) {
      Object.assign(this, { prepare, play, onError, onDone, onMetrics, clock });
      // Native Window timers require Window as receiver. Storing them directly
      // and calling this.setTimer() uses the queue as receiver in Chromium.
      this.setTimer = (...args) => Reflect.apply(setTimer, root, args);
      this.clearTimer = (...args) => Reflect.apply(clearTimer, root, args);
      this.maxBufferSeconds = Math.max(0.5, Math.min(8, maxBufferSeconds));
      this.maxChunks = Math.max(2, Math.min(48, maxChunks));
      this.firstBufferSeconds = Math.max(0, Math.min(1.2, firstBufferSeconds));
      this.firstBufferWait = Math.max(0, Math.min(0.3, firstBufferWait));
      this.items = []; this.active = new Set(); this.closed = false; this.cancelled = false;
      this.ready = []; this.waiters = new Set(); this.producerDone = false;
      this.startedAt = this.clock(); this.tailEnd = this.startedAt; this.played = false;
      this.targetBuffer = this.firstBufferSeconds; this.iterator = null;
      this.stats = { firstAudioMs: null, chunks: 0, audioSeconds: 0, underruns: 0, gapMs: 0,
        prebufferMs: 0, maxSupplyWaitMs: 0, maxSentenceStartMs: 0, producerWaitMs: 0,
        maxBufferedSeconds: 0, maxBufferedChunks: 0 };
      this.done = new Promise(resolve => { this.resolve = resolve; });
      this.running = false;
    }
    enqueue(text) {
      if (this.closed || this.cancelled || !text) return;
      this.items.push(text); this.notify(); this.start();
    }
    finish() { this.closed = true; this.notify(); this.start(); return this.done; }
    cancel() {
      this.cancelled = true; this.items = []; this.ready = []; this.notify(); this.resolve();
      // The caller also interrupts the local HTTP request. Returning the iterator
      // prevents a cancelled stream from preparing another sentence afterwards.
      try { Promise.resolve(this.iterator?.return?.()).catch(() => {}); } catch (_) {}
    }
    notify() { for (const wake of [...this.waiters]) wake(); }
    wait(seconds = null) {
      return new Promise(resolve => {
        let timer;
        const wake = () => { this.waiters.delete(wake); if (timer !== undefined) this.clearTimer(timer); resolve(); };
        this.waiters.add(wake);
        if (seconds !== null) timer = this.setTimer(wake, Math.max(0, seconds * 1000));
      });
    }
    duration(value) { return Number.isFinite(value?.duration) && value.duration > 0 ? value.duration : 0; }
    readySeconds() { return this.ready.reduce((sum, chunk) => sum + this.duration(chunk), 0); }
    bufferedSeconds() { return Math.max(0, this.tailEnd - this.clock()) + this.readySeconds(); }
    budgetFull() {
      const count = this.active.size + this.ready.length;
      return count >= this.maxChunks || (count > 0 && this.bufferedSeconds() >= this.maxBufferSeconds)
        || (count >= 2 && !this.bufferedSeconds()); // compatibility for non-audio callers
    }
    metrics() {
      const value = { ...this.stats, bufferedSeconds: this.bufferedSeconds(), targetBufferSeconds: this.targetBuffer,
        queuedChunks: this.ready.length, activeChunks: this.active.size, elapsedMs: (this.clock() - this.startedAt) * 1000,
        producerWaitPerAudio: this.stats.audioSeconds ? this.stats.producerWaitMs / 1000 / this.stats.audioSeconds : null };
      try { this.onMetrics(value); } catch (_) {}
      return value;
    }
    fail(error) { if (!this.cancelled) { this.cancel(); this.onError(error); } }
    start() { if (!this.running) { this.running = true; this.run(); } }
    async room() { while (!this.cancelled && this.budgetFull()) await this.wait(); }
    accept(chunk, supplyWait = 0, first = false) {
      if (this.cancelled) return;
      const duration = this.duration(chunk);
      if (first) this.stats.maxSentenceStartMs = Math.max(this.stats.maxSentenceStartMs, supplyWait * 1000);
      if (!first && duration) {
        this.stats.maxSupplyWaitMs = Math.max(this.stats.maxSupplyWaitMs, supplyWait * 1000);
        this.targetBuffer = Math.max(this.firstBufferSeconds, this.targetBuffer * 0.98, Math.min(1.2, supplyWait * 1.35));
      }
      this.ready.push(chunk);
      this.stats.maxBufferedSeconds = Math.max(this.stats.maxBufferedSeconds, this.bufferedSeconds());
      this.stats.maxBufferedChunks = Math.max(this.stats.maxBufferedChunks, this.active.size + this.ready.length);
      this.notify();
    }
    async produce() {
      try {
        while (!this.cancelled) {
          if (!this.items.length) {
            if (this.closed) break;
            await this.wait(); continue;
          }
          await this.room();
          if (this.cancelled) break;
          const prepareAt = this.clock();
          const prepared = await this.prepare(this.items.shift());
          const prepareWait = this.clock() - prepareAt;
          this.stats.producerWaitMs += prepareWait * 1000;
          if (this.cancelled) break;
          if (prepared?.[Symbol.asyncIterator]) {
            this.iterator = prepared[Symbol.asyncIterator]();
            let first = true;
            try {
              while (!this.cancelled) {
                await this.room(); if (this.cancelled) break;
                const started = this.clock(); const next = await this.iterator.next();
                const supplyWait = this.clock() - started;
                this.stats.producerWaitMs += supplyWait * 1000;
                if (next.done || this.cancelled) break;
                this.accept(next.value, supplyWait + (first ? prepareWait : 0), first); first = false;
              }
            } finally { await this.iterator.return?.(); this.iterator = null; }
          } else this.accept(prepared, prepareWait, true);
        }
      } catch (error) { this.fail(error); }
      finally { this.producerDone = true; this.notify(); }
    }
    async prebuffer() {
      if (!this.ready.length || !this.duration(this.ready[0]) || this.producerDone) return;
      const started = this.clock();
      const deadline = started + (this.played ? Math.min(0.4, this.firstBufferWait * 2) : this.firstBufferWait);
      while (!this.cancelled && !this.producerDone && this.readySeconds() < this.targetBuffer && this.clock() < deadline) {
        await this.wait(deadline - this.clock());
      }
      this.stats.prebufferMs += (this.clock() - started) * 1000;
    }
    async consume() {
      try {
        while (!this.cancelled) {
          if (!this.ready.length) {
            if (this.producerDone) break;
            await this.wait(); continue;
          }
          const now = this.clock();
          if (!this.played || this.tailEnd + 0.025 < now) await this.prebuffer();
          if (this.cancelled) break;
          const chunk = this.ready.shift(); const duration = this.duration(chunk);
          const at = this.clock();
          if (this.played && duration && at > this.tailEnd + 0.025) {
            this.stats.underruns++; this.stats.gapMs += (at - this.tailEnd) * 1000;
            this.targetBuffer = Math.min(1.2, Math.max(this.targetBuffer * 1.3, at - this.tailEnd));
          }
          if (!this.played) this.stats.firstAudioMs = (at - this.startedAt) * 1000;
          this.played = true; this.stats.chunks++; this.stats.audioSeconds += duration;
          this.tailEnd = Math.max(at, this.tailEnd) + duration;
          const completion = Promise.resolve(this.play(chunk));
          this.active.add(completion); this.notify(); this.metrics();
          completion.then(() => { this.active.delete(completion); this.notify(); }, error => {
            this.active.delete(completion); this.fail(error); this.notify();
          });
          if (!duration) while (!this.cancelled && this.active.size >= 2) await this.wait();
        }
        while (!this.cancelled && this.active.size) await this.wait();
      } catch (error) { this.fail(error); }
    }
    async run() {
      try { await Promise.all([this.produce(), this.consume()]); }
      finally { this.metrics(); this.onDone(); this.resolve(); }
    }
  }

  class VoiceActivityDetector {
    constructor(rate, { start = 0.018, interrupt = 0.045, silence = 850, minimum = 240, max = 55000 } = {}) {
      this.rate = rate; Object.assign(this, { start, interrupt, silence, minimum, max }); this.reset();
    }
    reset() { this.speaking = false; this.voiced = 0; this.quiet = 0; this.elapsed = 0; }
    process(samples, playing = false) {
      let sum = 0; for (const sample of samples) sum += sample * sample;
      const level = Math.sqrt(sum / Math.max(1, samples.length));
      const ms = samples.length * 1000 / this.rate;
      const loud = level >= (playing && !this.speaking ? this.interrupt : this.start);
      if (!this.speaking) {
        this.voiced = loud ? this.voiced + ms : 0;
        if (this.voiced >= this.minimum) { this.speaking = true; this.elapsed = this.voiced; this.quiet = 0; return { type: 'start', level }; }
      } else {
        this.elapsed += ms; this.quiet = loud ? 0 : this.quiet + ms;
        if (this.quiet >= this.silence || this.elapsed >= this.max) { this.reset(); return { type: 'end', level }; }
      }
      return { type: 'level', level };
    }
  }

  function wavFromPCM(parts, rate) {
    const frames = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new ArrayBuffer(44 + frames * 2); const view = new DataView(bytes);
    const tag = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    tag(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, frames * 2, true);
    let index = 44; for (const part of parts) for (const sample of part) { view.setInt16(index, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true); index += 2; }
    return bytes;
  }
  const api = { cleanSpeech, SentenceBuffer, SpeechQueue, VoiceActivityDetector, wavFromPCM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeechPipeline = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
