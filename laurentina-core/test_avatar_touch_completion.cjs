'use strict';
// Execute the real renderer against only the SDK's public animation contracts.
// No browser, GPU allocation, model files, audio or inference is used.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'ui/avatars/avatar-renderer.js'), 'utf8');

async function fixture(kind = 'spine') {
  const frames = new Map(), calls = [], motions = new Map(); let serial = 0, widget, manager;
  const gl = new Proxy({ getParameter: () => 4096, getExtension: () => null, createTexture: () => ({}),
    getContext: () => gl }, { get: (object, key) => key in object ? object[key] : () => {} });
  class Element {
    constructor() { this.dataset = {}; this.style = {}; this.clientWidth = 300; this.clientHeight = 400; this.children = []; }
    append(value) { this.children.push(value); }
    remove() { this.removed = true; }
    getContext() { return gl; }
  }
  class SpinePlayer {
    constructor(container, options) {
      widget = this; this.canvas = new Element(); this.sceneRenderer = {};
      this.currentViewport = { x: 0, y: 0, width: 300, height: 400 };
      this.skeleton = { data: { animations: [{ name: 'Idle' }, { name: 'Interact' }, { name: 'Think' }] } };
      this.animationState = { getCurrent: () => this.entry };
      this.drawFrame = () => {}; queueMicrotask(() => options.success(this));
    }
    setAnimation(name, loop) { calls.push({ name, loop }); this.entry = { animation: { name }, listener: null }; }
    play() {}
    dispose() { this.disposed = true; }
  }
  class Motion {
    constructor(name) { this.name = name; this.loop = true; this.handler = undefined; }
    setEffectIds() {}
    getLoop() { return this.loop; }
    setLoop(value) { this.loop = value; }
    getFinishedMotionHandler() { return this.handler; }
    setFinishedMotionHandler(value) { this.handler = value; }
  }
  const noop = () => {};
  class Vector { pushBack() {} }
  const model = { loadParameters: noop, saveParameters: noop, update: noop, getCanvasWidth: () => 2, getCanvasHeight: () => 2,
    getParameterIndex: () => 0, getParameterCount: () => 1, addParameterValueById: (...args) => calls.push({ lip: args[1] }) };
  class User {
    constructor() {
      this._model = model;
      manager = this._motionManager = { current: null, isFinished: () => false,
        startMotionPriority(motion) { this.current = motion; calls.push({ name: motion.name, loop: motion.loop }); },
        updateMotion() { return true; } };
      this._expressionManager = { updateMotion: noop };
    }
    loadModel() {}
    loadMotion(buffer, length, name) { const motion = new Motion(name); motions.set(name, motion); return motion; }
    getModelMatrix() { return { setupFromLayout: noop }; }
    createRenderer() {}
    getRenderer() { return { startUp: noop, setIsPremultipliedAlpha: noop, setMvpMatrix: noop, setRenderState: noop, drawModel: noop }; }
    deleteRenderer() {}
    release() {}
  }
  const framework = { CubismFramework: { isStarted: () => true, isInitialized: () => true, getIdManager: () => ({ getId: x => x }) },
    CubismUserModel: User, csmVector: Vector, csmMap: class {}, CubismModelSettingJson: class {
      getEyeBlinkParameterCount() { return 0; } getLipSyncParameterCount() { return 0; } getLayoutMap() {}
    }, CubismEyeBlink: { create: () => ({ updateParameters: noop }) }, CubismBreath: { create: () => ({ setParameters: noop, updateParameters: noop }) },
    BreathParameterData: class {}, CubismMatrix44: class { scale() {} multiplyByMatrix() {} } };
  const data = { FileReferences: { Moc: 'model.moc3', Textures: [], Motions: { Idle: [{ File: 'idle.motion3.json' }], Tap: [{ File: 'tap.motion3.json' }], Think: [{ File: 'think.motion3.json' }] } } };
  const context = vm.createContext({ console, URL, Element, AbortController, TextDecoder, setTimeout, clearTimeout, queueMicrotask,
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    performance: { now: () => 0 }, ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer }),
    document: { currentScript: { src: 'https://fixture.invalid/ui/avatars/avatar-renderer.js' }, createElement: () => new Element(), head: {
      append(element) { if (element.src) { context.spine = { SpinePlayer, webgl: { ResizeMode: {} } }; queueMicrotask(() => element.onload()); } }
    } },
    LaurentinaCubism: framework,
    LaurentinaRenderQuality: { initialZoom: () => 1, zoom: x => x, presentationScale: x => x, frame: x => ({ ...x }), describe: () => ({}),
      limits: () => ({}), pixelSize: () => ({ width: 300, height: 400 }), installSpine38Resize: () => () => {},
      touchAnimation: manifest => manifest.stateMap.touch,
      hitMaskSampler: () => ({ sample() {}, get() {}, invalidate() {}, dispose() {} }) }
  });
  context.window = context;
  vm.runInContext(source, context);
  const manifest = kind === 'spine' ? { kind, runtime: '3.8', binary: true, entry: 'model.skel', atlas: 'model.atlas', stateMap: { idle: 'Idle', touch: 'Interact', thinking: 'Think' } }
    : { kind, entry: 'model.model3.json', files: ['model.model3.json', 'model.moc3', 'idle.motion3.json', 'tap.motion3.json', 'think.motion3.json'], stateMap: { idle: 'Idle:0', touch: 'Tap:0', thinking: 'Think:0' } };
  const adapter = await context.LaurentinaAvatars.create(new Element(), manifest, name => `https://fixture.invalid/${name}`);
  const tick = () => { const pending = [...frames]; frames.clear(); for (const [, fn] of pending) fn(16); };
  const finish = () => { if (kind === 'spine') widget.entry.listener?.complete?.(widget.entry); else { manager.current.handler?.(manager.current); tick(); } };
  return { adapter, calls, finish, tick, frames, entry: () => widget?.entry, motion: () => manager?.current, motions };
}

for (const kind of ['spine', 'live2d']) {
  test(`${kind}: touch runs once and ordinary idle/energy updates cannot truncate its real completion`, async () => {
    const f = await fixture(kind), completed = [];
    const touchName = kind === 'spine' ? 'Interact' : 'Tap:0';
    assert.equal(f.adapter.setState('touch', { onComplete: () => completed.push('done') }), true);
    assert.equal(f.calls.at(-1).name, touchName); assert.equal(f.calls.at(-1).loop, false);
    for (let n = 0; n < 5; n++) { f.adapter.setState('touch', { level: .6, onComplete: () => completed.push('done') }); f.adapter.setState('idle'); }
    assert.equal(f.calls.filter(call => call.name === touchName).length, 1); assert.deepEqual(completed, []);
    f.finish(); assert.deepEqual(completed, ['done']); assert.match(f.calls.filter(call => call.name).at(-1).name, /Idle/);
    f.adapter.dispose();
  });
  test(`${kind}: another click continues the current motion and only latest completion is delivered`, async () => {
    const f = await fixture(kind), completed = [];
    f.adapter.setState('touch', { touch_id: 'a', onComplete: () => completed.push('a') });
    f.adapter.setState('touch', { touch_id: 'b', onComplete: () => completed.push('b') });
    f.finish(); assert.deepEqual(completed, ['b']); f.adapter.dispose();
  });
  test(`${kind}: real work preempts touch and detached completion is ignored`, async () => {
    const f = await fixture(kind), completed = [];
    f.adapter.setState('touch', { onComplete: () => completed.push('touch') });
    const entry = f.entry(), stale = kind === 'spine' ? () => entry.listener?.complete?.(entry) : f.motion().handler;
    f.adapter.setState('thinking'); stale?.(); f.tick();
    assert.deepEqual(completed, []); assert.match(f.adapter.getRenderInfo().animation, /Think/);
    f.adapter.dispose();
  });
  test(`${kind}: cancellation and disposal remove completion hooks and do not leave a new timer`, async () => {
    const f = await fixture(kind), completed = [];
    f.adapter.setState('touch', { onComplete: () => completed.push('touch') });
    const entry = f.entry(), motion = f.motion(), stale = kind === 'spine' ? entry.listener.complete : motion.handler;
    f.adapter.cancelTouch(); stale?.(entry); f.tick(); assert.deepEqual(completed, []);
    if (motion) { assert.equal(motion.handler, undefined); assert.equal(motion.loop, true); }
    f.adapter.setState('touch', { onComplete: () => completed.push('touch2') });
    f.adapter.dispose(); f.finish(); assert.deepEqual(completed, []);
    assert.equal(f.frames.size, 0);
  });
}
