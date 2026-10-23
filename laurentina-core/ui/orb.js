'use strict';

const $ = (id) => document.getElementById(id);
const rpc = (action, payload = {}) => window.laurentina.request(action, payload);
let recorder = null;
let stream = null;
let timer = null;
let busy = false;
let starting = false;
let foreignRecording = false;
let statusTimer = null;
let companion = { mode: 'orb' };
let dragging = null;
let renderedArtwork = null;
let avatarAdapter = null;
let companionHitSource = null;
let companionHitTimer = null;
let companionFooterKey = null;
let companionFooterOffset = 0;
let renderVersion = 0;
let assistantState = { recording: false, speaking: false, thinking: false, level: 0 };
let mainContext = null;
let microphoneMeter = null;
let microphoneContext = null;
let voiceInputMode = 'direct';
let voiceOpenPanel = false;
let particleFrame = 0;
let touchPulseAt = -Infinity;
let touchPulseTimer = null;
let visualState = { ...assistantState, state: 'idle' };
const Interaction = window.LaurentinaCompanionInteraction;
const activation = Interaction.createActivation({ single: requestTouch, double: openMain });
const touchFeedback = Interaction.createTouchFeedback({ change(value) {
  if (value.phase === 'cancel' || value.busy) avatarAdapter?.cancelTouch?.();
  if (value.phase === 'start') {
    pulseTouch(value.busy || companionBusy());
    if (value.text && !companionBusy()) status(value.text);
    if (value.active && Interaction.touchAnimation(companion.avatar, avatarAdapter)) touchFeedback.animation(value.id, true);
  }
  renderAssistantState();
  if (['end', 'cancel', 'timeout'].includes(value.phase) && !companionBusy()) status();
} });

function applyAssistantState(value) {
  const touch = touchFeedback.get();
  if (value?.source === 'touch' || touch.active && value?.touch_id === touch.id) { touchFeedback.voice({ ...value, source: 'touch' }); return; }
  assistantState = { ...assistantState, ...value, level: Math.max(0, Math.min(1, Number(value?.level) || 0)) };
  if (assistantState.recording || assistantState.speaking || assistantState.thinking) touchFeedback.cancel();
  renderAssistantState();
}
function renderAssistantState() {
  const touch = touchFeedback.get();
  visualState = Interaction.visualState(assistantState, touch);
  document.body.classList.toggle('speaking', visualState.speaking);
  document.body.classList.toggle('thinking', visualState.thinking);
  document.body.classList.toggle('listening', visualState.recording);
  document.body.classList.toggle('touching', visualState.touching);
  const custom = Interaction.touchAnimation(companion.avatar, avatarAdapter);
  document.body.classList.toggle('touch-custom', Boolean(custom));
  const animated = visualState.touching && custom && touch.animationActive;
  const state = visualState.touching && !animated ? (visualState.speaking ? 'speaking' : 'idle') : visualState.state;
  const accepted = avatarAdapter?.setState(state, { level: visualState.level, ...(animated ? {
    animation: custom, touch_id: touch.id, onComplete: () => touchFeedback.animation(touch.id, false)
  } : {}) });
  if (animated && accepted === false) touchFeedback.animation(touch.id, false);
}
function companionBusy() {
  return Boolean(busy || starting || foreignRecording || recorder || assistantState.recording || assistantState.speaking || assistantState.thinking);
}
function pulseTouch(occupied = false) {
  clearTimeout(touchPulseTimer);
  document.body.classList.remove('touch-pulse', 'touch-busy');
  // Restart a small visual acknowledgement without replaying the model or
  // changing its scale/camera. A busy assistant only gets a subtle glow.
  void document.body.offsetWidth;
  document.body.classList.add(occupied ? 'touch-busy' : 'touch-pulse');
  if (!occupied) touchPulseAt = performance.now();
  touchPulseTimer = setTimeout(() => document.body.classList.remove('touch-pulse', 'touch-busy'), 850);
}
async function requestTouch() {
  try {
    const result = await rpc('companion.touch', { source: 'orb', mode: companion.mode });
    if (result?.busy || result?.disabled) pulseTouch(Boolean(result.busy || companionBusy()));
  }
  catch (error) { pulseTouch(companionBusy()); status(error.message || '暂时无法回应轻触', true); }
}
function startParticleOrb() {
  const canvas = $('orb-particles');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2, size = 164, center = size / 2;
  const noise = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); };
  // Curved energy paths rather than a dotted globe: each lane has its own
  // inclination, broken technical traces, and points advecting along its path.
  const lanes = Array.from({ length: 28 }, (_, i) => ({
    tilt: (noise(i + 1) - .5) * 2.8, twist: (noise(i + 50) - .5) * 1.3,
    phase: noise(i + 91) * tau, width: .18 + noise(i + 100) * .32,
    speed: (.18 + noise(i + 130) * .4) * (i % 3 === 0 ? -1 : 1),
    radius: .86 + noise(i + 170) * .16,
  }));
  const filaments = Array.from({ length: 15 }, (_, i) => ({ phase: noise(i + 290) * tau,
    turn: .75 + noise(i + 330) * 1.8, extent: .52 + noise(i + 410) * .43 }));
  let previous = 0, smoothedLevel = 0;
  const draw = (now) => {
    particleFrame = requestAnimationFrame(draw);
    if (now - previous < 30 || companion.mode !== 'orb' || document.hidden) return;
    previous = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);
    const actualLevel = visualState.speaking || visualState.recording ? visualState.level : 0;
    smoothedLevel += (actualLevel - smoothedLevel) * .34;
    const time = reducedMotion.matches ? 0 : now / 1000;
    const turn = time * (visualState.thinking ? .29 : .13);
    const pulseAge = (now - touchPulseAt) / 700;
    const aggregation = !reducedMotion.matches && pulseAge >= 0 && pulseAge <= 1 ? Math.sin(Math.PI * pulseAge) : 0;
    const radius = (59 + smoothedLevel * 5) * (1 - aggregation * .16);
    const glow = context.createRadialGradient(center, center, 0, center, center, 81);
    glow.addColorStop(0, `rgba(13,105,190,${.38 + smoothedLevel * .25})`);
    glow.addColorStop(.28, 'rgba(3,40,83,.38)');
    glow.addColorStop(.64, 'rgba(2,25,57,.28)');
    glow.addColorStop(.83, 'rgba(0,104,210,.09)');
    glow.addColorStop(1, 'rgba(0,53,136,0)');
    context.fillStyle = glow; context.fillRect(0, 0, size, size);
    const project = (x, y, z, tilt = 0) => {
      const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(turn), sy = Math.sin(turn);
      const py = y * ct - z * st, pz = y * st + z * ct;
      const px = x * cy + pz * sy, depth = pz * cy - x * sy;
      const perspective = 1 + depth * .13;
      return { x: center + px * radius * perspective, y: center + py * radius * perspective,
        z: depth, depth: (depth + 1.2) / 2.4 };
    };
    const line = (points, color, width, front) => {
      context.beginPath(); let joined = false;
      for (const point of points) {
        if ((point.z >= 0) !== front || point.gap) { joined = false; continue; }
        if (joined) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
        joined = true;
      }
      context.strokeStyle = color; context.lineWidth = width; context.stroke();
    };
    const paths = lanes.map((lane, index) => {
      const phase = lane.phase + time * lane.speed;
      const points = Array.from({ length: 127 }, (_, j) => {
        const angle = j / 126 * tau;
        const latitude = Math.sin(angle * 2 + phase) * lane.twist;
        const rr = Math.cos(latitude) * lane.radius;
        const point = project(Math.cos(angle) * rr, Math.sin(latitude) * lane.radius, Math.sin(angle) * rr, lane.tilt);
        point.gap = (j + index * 13 + Math.floor(phase * 5)) % 47 < 4;
        return point;
      });
      return { lane, phase, points };
    });
    // Back surface first, then the flowing inner threads and the near surface.
    for (const { lane, points } of paths) line(points, 'rgba(5,100,220,.23)', lane.width, false);
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < filaments.length; i++) {
      const filament = filaments[i], angle = filament.phase + time * (i % 2 ? -.26 : .32);
      context.beginPath();
      for (let step = 0; step <= 60; step++) {
        const distance = step / 60, wave = angle + Math.pow(distance, .68) * filament.turn * tau;
        const curl = Math.sin(distance * 20 + time * .9 + i) * .018 * distance;
        const point = project(Math.cos(wave) * (distance * filament.extent + curl),
          Math.sin(wave) * distance * filament.extent * .77, Math.sin(distance * 5 + i) * .23);
        if (!step) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
      }
      context.lineWidth = .22 + (i % 3) * .12;
      context.strokeStyle = `rgba(27,${157 + i % 4 * 20},255,${.23 + smoothedLevel * .4})`; context.stroke();
    }
    for (const { lane, phase, points } of paths) {
      line(points, `rgba(0,118,255,${.11 + smoothedLevel * .12})`, lane.width + 1.3, true);
      line(points, `rgba(20,156,255,${.43 + smoothedLevel * .3})`, lane.width + .16, true);
      for (let j = 0; j < 25; j++) {
        const part = ((j / 25 + phase / tau) % 1 + 1) % 1;
        const point = points[Math.floor(part * 126)], front = Math.max(0, point.z);
        const fade = .2 + point.depth * .65;
        context.fillStyle = `rgba(${37 + front * 135},${163 + front * 80},255,${fade})`;
        const extent = .38 + front * .7 + smoothedLevel * .3;
        context.fillRect(point.x, point.y, extent, extent);
        if (j % 4 === 0 && point.z > 0) {
          const previous = points[(Math.floor(part * 126) + 124) % 126];
          context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x, point.y);
          context.strokeStyle = `rgba(114,221,255,${.3 + front * .45})`; context.lineWidth = .64; context.stroke();
        }
        if (j % 9 === 0 && point.z > -.1) {
          context.fillStyle = `rgba(75,192,255,${.35 + front * .4})`;
          context.fillRect(point.x + 1.4, point.y, 2.2 + noise(j + phase) * 2, .35);
          context.fillRect(point.x + 1.4, point.y + 1.1, 1.1, .35);
        }
      }
    }
    // Broken spherical arcs, short radial ticks and moving heads give the
    // hologram its mechanical structure without introducing readable UI text.
    for (let ring = 0; ring < 7; ring++) {
      const offset = ring * .61 + time * (ring % 2 ? -.14 : .21), r = 1.01 + ring % 3 * .045;
      const points = [];
      for (let j = 0; j <= 150; j++) {
        const angle = j / 150 * tau + offset;
        const point = project(Math.cos(angle) * r, Math.sin(angle) * r, 0, .42 + ring * .41);
        point.gap = (j + ring * 9) % 39 < 9; points.push(point);
      }
      line(points, 'rgba(27,144,255,.17)', .5, false);
      line(points, `rgba(56,190,255,${.35 + smoothedLevel * .4})`, ring % 3 === 0 ? .7 : .38, true);
      for (let j = 0; j < 28; j++) {
        const angle = j / 28 * tau + offset;
        const a = project(Math.cos(angle) * r, Math.sin(angle) * r, 0, .42 + ring * .41);
        const b = project(Math.cos(angle) * (r + .027), Math.sin(angle) * (r + .027), 0, .42 + ring * .41);
        if (a.z < -.1) continue;
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
        context.strokeStyle = 'rgba(66,194,255,.48)'; context.lineWidth = .42; context.stroke();
        if (j % 7 === 0 && ring % 2 === 0) {
          const c = project(Math.cos(angle) * (r + .1), Math.sin(angle) * (r + .1), 0, .42 + ring * .41);
          context.beginPath(); context.moveTo(b.x, b.y); context.lineTo(c.x, c.y); context.lineTo(c.x + 2.2, c.y);
          context.strokeStyle = 'rgba(45,164,255,.43)'; context.lineWidth = .35; context.stroke();
        }
      }
    }
    const core = context.createRadialGradient(center, center, 0, center, center, 17 + smoothedLevel * 6);
    core.addColorStop(0, `rgba(179,241,255,${.6 + smoothedLevel * .3})`);
    core.addColorStop(.17, 'rgba(60,196,255,.42)'); core.addColorStop(.5, 'rgba(0,116,255,.13)'); core.addColorStop(1, 'rgba(0,80,255,0)');
    context.fillStyle = core; context.fillRect(center - 25, center - 25, 50, 50);
    for (let i = 0; i < 3; i++) {
      context.beginPath(); context.ellipse(center, center, 5 + i * 3 + smoothedLevel * 2, 2 + i * 1.8, turn * 4 + i, .3, Math.PI * 1.75);
      context.strokeStyle = 'rgba(125,224,255,.75)'; context.lineWidth = .6; context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  };
  particleFrame = requestAnimationFrame(draw);
}
function stopMicrophoneMeter() {
  if (microphoneMeter) { cancelAnimationFrame(microphoneMeter.frame); microphoneMeter.source.disconnect(); microphoneMeter.analyser.disconnect(); microphoneMeter = null; }
}
async function startMicrophoneMeter(input) {
  stopMicrophoneMeter();
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    microphoneContext ||= new Context(); await microphoneContext.resume();
    if (input !== stream) return;
    const analyser = microphoneContext.createAnalyser(); analyser.fftSize = 512;
    const source = microphoneContext.createMediaStreamSource(input); source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const meter = { analyser, source, frame: 0, lastPublish: 0 }; microphoneMeter = meter;
    const measure = (now) => {
      if (microphoneMeter !== meter) return;
      analyser.getByteTimeDomainData(samples);
      let square = 0; for (const value of samples) square += ((value - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(square / samples.length) * 5.5);
      applyAssistantState({ recording: true, speaking: false, thinking: false, level });
      if (now - meter.lastPublish >= 80) { meter.lastPublish = now; publish('正在录音', true, level); }
      meter.frame = requestAnimationFrame(measure);
    };
    meter.frame = requestAnimationFrame(measure);
  } catch (_) { stopMicrophoneMeter(); }
}

function status(text = '随时在这里', error = false) {
  clearTimeout(statusTimer);
  $('orb-status').textContent = window.tr ? tr(text) : text;
  $('orb-status').classList.toggle('error', error);
  $('orb-status').title = window.tr ? tr(text) : text;
  if (error) statusTimer = setTimeout(() => status(), 9000);
}
async function refreshLocale() {
  try {
    const workspace = await rpc('workspace.get');
    window.I18n?.setLanguage(workspace.preferences?.language || 'zh');
  } catch (_) { /* Companion remains usable if workspace settings are unavailable. */ }
}
function publish(text, recording = false, level = 0) {
  rpc('ui.voice_state', { text, recording, level, speaking: false, thinking: false }).catch(() => {});
}
function updateControls() {
  const recording = recorder?.state === 'recording';
  document.body.classList.toggle('recording', Boolean(recording));
  $('orb-record').setAttribute('aria-label', recording ? '停止录音并识别' : '录音输入');
  $('orb-record').title = recording ? '停止录音并识别' : '录音输入';
  $('orb-record').disabled = busy || starting || foreignRecording;
}
async function refreshCharacter() {
  try {
    const character = await rpc('character.get');
    $('orb-name').textContent = character.name || '劳纶缇娜';
    $('orb-avatar').replaceChildren();
    // The animated orb and full-body artwork are independent from the cropped chat avatar.
    $('orb-open').classList.remove('has-avatar');
  } catch (error) { status(error.message || '暂时无法连接主面板', true); }
}
async function renderCompanion(value) {
  companion = value || { mode: 'orb' };
  if (companion.touch_enabled === false) touchFeedback.cancel();
  const presentation = Math.max(1, Math.min(16, Number(companion.presentation_scale) || 1));
  document.documentElement?.style?.setProperty('--companion-presentation-scale', presentation);
  const illustration = companion.mode === 'illustration' || companion.mode === 'avatar';
  document.body.classList.toggle('illustration', illustration);
  $('orb-open').hidden = illustration;
  $('companion-artwork').hidden = !illustration;
  const manifest = companion.mode === 'avatar' ? companion.avatar : null;
  // Camera zoom updates in place: never restart a model's animation to change its size.
  const model = manifest ? Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'view')) : null;
  const renderKey = JSON.stringify({ mode: companion.mode, manifest: model, artwork: companion.artwork });
  if (renderedArtwork === renderKey) { avatarAdapter?.setZoom?.(manifest?.view?.zoom ?? 1); avatarAdapter?.setPresentationScale?.(presentation); return; }
  const version = ++renderVersion;
  renderedArtwork = renderKey;
  touchFeedback.cancel();
  avatarAdapter?.dispose(); avatarAdapter = null;
  companionHitSource?.dispose(); companionHitSource = null;
  $('companion-artwork').replaceChildren();
  if (!illustration) return;
  if (manifest && window.LaurentinaAvatars) {
    try {
      const adapter = await window.LaurentinaAvatars.create($('companion-artwork'), manifest, (relative) => `laurentina-avatar://${manifest.id}/${relative.split('/').map(encodeURIComponent).join('/')}`);
      if (version !== renderVersion) { adapter.dispose(); return; }
      avatarAdapter = adapter; adapter.setZoom?.(companion.avatar?.view?.zoom ?? 1); adapter.setPresentationScale?.(Math.max(1, Number(companion.presentation_scale) || 1)); applyAssistantState(assistantState);
      if (manifest.kind === 'spine' && manifest.binary && adapter.animations?.length &&
          JSON.stringify(manifest.animations || []) !== JSON.stringify(adapter.animations)) {
        rpc('avatar.configure', {id:manifest.id,animations:adapter.animations}).catch(error=>status(error.message,true));
      }
    } catch (error) { if (version === renderVersion) { $('companion-artwork').textContent = '角色无法加载，请检查资源包'; status(error.message || '角色无法加载', true); } }
    return;
  }
  if (typeof companion.artwork === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(companion.artwork)) {
    const source = companion.artwork;
    const image = document.createElement('img'); image.src = source; image.alt = '桌面形象'; image.draggable = false;
    try {
      await image.decode();
      if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth * image.naturalHeight > 40 * 1024 * 1024) throw new Error('图片尺寸过大');
      if (version === renderVersion) {
        $('companion-artwork').replaceChildren(image);
        companionHitSource = window.LaurentinaRenderQuality?.hitMaskSampler(image, $('companion-artwork'), { contain: true, scale: () => Math.max(1, Number(companion.presentation_scale) || 1) });
      }
    } catch { if (version === renderVersion) { $('companion-artwork').textContent = '图片无法播放，请重新导入'; status('桌宠图片无法读取', true); } }
  } else if (illustration) $('companion-artwork').textContent = '请先在角色设置中导入立绘或动图';
}
async function refreshCompanion() { try { renderCompanion(await rpc('companion.get')); } catch (error) { status(error.message, true); } }

function solidCompanionMask(target, circle = false) {
  const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
  const columns = circle ? 96 : 1, rows = circle ? 96 : 1, bits = new Uint8Array(Math.ceil(columns * rows / 8));
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (circle && Math.hypot((x + .5) / columns - .5, (y + .5) / rows - .5) > .5) continue;
    const index = y * columns + x; bits[index >> 3] |= 1 << (index & 7);
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, columns, rows, bits: btoa(String.fromCharCode(...bits)) };
}
function publishCompanionHitRegions() {
  if (document.visibilityState === 'hidden' || !window.innerWidth || !window.innerHeight) return;
  companionHitSource?.sample();
  const illustration = companion.mode === 'avatar' || companion.mode === 'illustration';
  if (!illustration || companionFooterKey !== renderedArtwork) {
    companionFooterKey = renderedArtwork; companionFooterOffset = 0;
    document.documentElement?.style?.setProperty('--companion-footer-offset', '0px');
  }
  const target = $(illustration ? 'companion-artwork' : 'orb-open');
  const visibleMask = illustration ? avatarAdapter?.getHitMask?.() || companionHitSource?.get() : null;
  if (visibleMask && window.LaurentinaRenderQuality?.footerOffset) {
    const name = $('orb-name').getBoundingClientRect(), controls = $('orb-hide').getBoundingClientRect();
    const offset = window.LaurentinaRenderQuality.footerOffset(visibleMask,
      { top: name.top, bottom: controls.bottom + 4 }, window.innerHeight, companionFooterOffset);
    if (offset !== null && Math.abs(offset - companionFooterOffset) >= 1) {
      companionFooterOffset = offset;
      document.documentElement?.style?.setProperty('--companion-footer-offset', `${offset}px`);
    }
  }
  const alpha = illustration ? visibleMask || solidCompanionMask(target) : solidCompanionMask(target, true);
  const regions = ['orb-main', 'orb-record', 'orb-hide'].map(id => {
    const rect = $(id).getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  rpc('window.companion.hit_regions', { width: window.innerWidth, height: window.innerHeight, regions, alpha }).catch(() => {});
}

function draggable(target, interactive = true) {
  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || dragging) return;
    event.preventDefault();
    if (interactive) activation.hold(); else activation.cancel();
    const drag = { pointerId: event.pointerId, target, interactive,
      started: rpc('window.companion.move', { phase: 'start', x: event.clientX, y: event.clientY }) };
    dragging = drag;
    document.body.classList.add('dragging');
    target.setPointerCapture(event.pointerId);
    drag.started.catch((error) => { activation.cancel(); if (dragging === drag) { dragging = null; document.body.classList.remove('dragging'); } status(error.message, true); });
  });
  const finish = async (event, cancelled) => {
    const at = performance.now();
    const drag = dragging;
    if (!drag || drag.target !== target || drag.pointerId !== event.pointerId) return;
    dragging = null;
    document.body.classList.remove('dragging');
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    try {
      const start = await drag.started;
      const result = await rpc('window.companion.move', { phase: cancelled ? 'cancel' : 'end', id: start.id });
      if (cancelled || result.cancelled || result.moved) activation.cancel();
      else if (drag.interactive) activation.activate(at);
    } catch (error) { activation.cancel(); status(error.message, true); }
  };
  target.addEventListener('pointerup', (event) => finish(event, false));
  target.addEventListener('pointercancel', (event) => finish(event, true));
  target.addEventListener('lostpointercapture', (event) => finish(event, true));
  target.addEventListener('dragstart', (event) => event.preventDefault());
  // Only a native end result can create a pointer click. Keyboard activation
  // is independent of pointer capture; Shift+Enter opens the full conversation.
  if (interactive) {
    target.addEventListener('click', (event) => { if (event.detail === 0) activation.keyboard(); });
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); activation.keyboard(true); }
    });
  }
}
async function toggleRecording() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (busy || starting || foreignRecording) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { status('当前窗口暂时无法录音', true); return; }
  try {
    starting = true;
    activation.cancel(); touchFeedback.cancel();
    const capturedContext = mainContext ? { ...mainContext } : null;
    updateControls();
    const voice = await rpc('voice.status');
    voiceInputMode = voice.settings?.voice_input_mode === 'review' ? 'review' : 'direct';
    voiceOpenPanel = voice.settings?.voice_orb_open_panel === true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('当前录音格式不受支持');
    const chunks = [];
    let size = 0;
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
    recorder.ondataavailable = (event) => { if (event.data.size) { chunks.push(event.data); size += event.data.size; } if (size > 8 * 1024 * 1024 && recorder?.state === 'recording') recorder.stop(); };
    recorder.onerror = () => { status('录音中断，请重试', true); if (recorder?.state === 'recording') recorder.stop(); };
    recorder.onstop = async () => {
      clearInterval(timer);
      stopMicrophoneMeter();
      stream?.getTracks().forEach((track) => track.stop());
      recorder = null;
      stream = null;
      busy = true;
      updateControls();
      status('正在识别录音…');
      publish('正在识别录音…');
      try {
        if (size > 8 * 1024 * 1024) throw new Error('录音过大，请分段录音');
        const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
        const result = await rpc('voice.transcribe', { audio_base64: btoa(binary), mime_type: mimeType });
        if (!result.text?.trim()) throw new Error('没有听清楚，请再说一次');
        await rpc('ui.transcript', { text: result.text.trim(), submit: voiceInputMode === 'direct', open_panel: voiceOpenPanel,
          context_captured: Boolean(capturedContext), conversation_id: capturedContext?.conversation_id || null, mode: capturedContext?.mode || 'daily',
          ...(Number.isInteger(capturedContext?.mode_revision) ? { mode_revision: capturedContext.mode_revision } : {}) });
        status(voiceInputMode === 'direct' && capturedContext ? '已发送，正在等待回答' : '已转为文字，请在主面板确认');
      } catch (error) { status(error.message || '录音识别失败', true); }
      finally { busy = false; updateControls(); publish(''); applyAssistantState({ recording: false, level: 0 }); }
    };
    recorder.start(250);
    startMicrophoneMeter(stream);
    starting = false;
    const started = Date.now();
    status('正在录音 0:00');
    publish('正在录音', true);
    updateControls();
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      status(`正在录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (seconds >= 59 && recorder?.state === 'recording') recorder.stop();
    }, 500);
  } catch (error) {
    stopMicrophoneMeter();
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
    starting = false;
    updateControls();
    status(error.name === 'NotAllowedError' ? '请允许麦克风录音' : (error.message || '无法使用麦克风'), true);
    publish('');
  }
}
function openMain() {
  activation.cancel();
  if (starting) { status('正在开启麦克风，请稍等…'); return; }
  if (recorder?.state === 'recording') recorder.stop();
  rpc('window.main').catch((error) => status(error.message, true));
}
draggable($('orb-open'));
draggable($('companion-artwork'));
$('orb-main').addEventListener('click', openMain);
$('orb-hide').addEventListener('click', async () => { activation.cancel(); touchFeedback.cancel(); if (recorder?.state === 'recording') recorder.stop(); try { await rpc('window.orb.hide'); } catch (error) { status(error.message, true); } });
$('orb-record').addEventListener('click', toggleRecording);
if (window.laurentina.onVoiceState) window.laurentina.onVoiceState((value) => {
  if (value?.context_captured) mainContext = { conversation_id: value.conversation_id || null, mode: value.mode === 'private' ? 'private' : 'daily',
    ...(Number.isInteger(value.mode_revision) && value.mode_revision >= 0 ? { mode_revision: value.mode_revision } : {}) };
  if (value?.source === 'touch') { touchFeedback.voice(value); return; }
  if (recorder || busy) return;
  foreignRecording = Boolean(value?.recording);
  updateControls();
  applyAssistantState(value);
  if (value?.speaking || value?.recording) status(value.text || (value.recording ? '主面板正在录音' : '正在朗读'));
  else if (value?.thinking) status('正在想一想…');
  else status();
});
if (window.laurentina.onTouchResponse) window.laurentina.onTouchResponse((value) => {
  if (value?.phase === 'start' && companionBusy()) { pulseTouch(true); return; }
  touchFeedback.response(value);
});
if (window.laurentina.onCompanionState) window.laurentina.onCompanionState(renderCompanion);
document.addEventListener?.('visibilitychange', () => { if (document.hidden) { activation.cancel(); touchFeedback.cancel(); } });
// Settings changes arrive through onCompanionState. Refetching a large GIF on
// every pointer focus stalls the very drag that brought the companion forward.
window.addEventListener('focus', () => { refreshCharacter(); refreshLocale(); });
window.addEventListener('beforeunload', () => { activation.dispose(); touchFeedback.dispose(); clearTimeout(touchPulseTimer); clearInterval(timer); clearInterval(companionHitTimer); companionHitSource?.dispose(); cancelAnimationFrame(particleFrame); stopMicrophoneMeter(); avatarAdapter?.dispose(); stream?.getTracks().forEach((track) => track.stop()); });
companionHitTimer = setInterval(publishCompanionHitRegions, 250);
startParticleOrb();
window.I18n?.start(document.body);
refreshLocale();
refreshCharacter();
refreshCompanion();
