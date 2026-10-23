/* Laurentina's data-only avatar adapters. All vendor code is pinned and local. */
(() => {
  "use strict";
  const base = new URL(".", document.currentScript.src), scripts = new Map(), spineRuntimes = new Map();
  let spineQueue = Promise.resolve();
  const script = (name, local = false) => {
    const key = local ? name : `vendor/${name}`;
    if (!scripts.has(key)) scripts.set(key, new Promise((resolve, reject) => {
      const el = document.createElement("script"); el.src = new URL(key, base).href;
      el.onload = resolve; el.onerror = () => { scripts.delete(key); el.remove(); reject(new Error("角色播放器文件未加载成功。")); }; document.head.append(el);
    }));
    return scripts.get(key);
  };
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = new URL("avatar-renderer.css", base).href; document.head.append(css);
  const filesFor = manifest => new Set(manifest.files.map(f => typeof f === "string" ? f : f.path));
  const join = (entry, relative) => entry.includes("/") ? `${entry.slice(0, entry.lastIndexOf("/") + 1)}${relative}` : relative;
  function resources(manifest, assetURL) {
    const files = filesFor(manifest), controller = new AbortController();
    const url = name => { if (!files.has(name)) throw new Error("角色资源没有包含所需文件。"); return assetURL(name); };
    const buffer = async name => { const response = await fetch(url(name), { signal: controller.signal }); if (!response.ok) throw new Error("角色资源读取失败。"); return response.arrayBuffer(); };
    return { url, buffer, json: async name => JSON.parse(new TextDecoder().decode(await buffer(name))), abort: () => controller.abort() };
  }
  function mount(host) { const el = document.createElement("div"); el.className = "la-avatar-renderer"; host.append(el); return el; }
  const levelOf = options => Math.min(1, Math.max(0, Number(options?.level) || 0));

  async function media(host, manifest, assetURL) {
    const container = mount(host), element = document.createElement(manifest.kind === "video" ? "video" : "img");
    element.className = "la-avatar-media"; element.draggable = false; element.setAttribute("aria-hidden", "true");
    if (manifest.kind === "video") { element.autoplay = true; element.loop = true; element.muted = true; element.playsInline = true; element.disablePictureInPicture = true; }
    const loaded = new Promise((resolve, reject) => { element.addEventListener(manifest.kind === "video" ? "loadeddata" : "load", resolve, { once: true }); element.addEventListener("error", () => reject(new Error("图片或 WebM 无法解码，请检查资源格式。")), { once: true }); });
    element.src = assetURL(manifest.entry); container.append(element);
    try { await loaded; if (manifest.kind === "video") await element.play(); } catch (error) { container.remove(); throw error; }
    const Q = window.LaurentinaRenderQuality; let zoom = Q.initialZoom(manifest), presentation = 1, hitFrame = 0, disposed = false;
    const hit = Q.hitMaskSampler(element, container, { contain: true, scale: () => zoom * presentation });
    const applyScale = () => { element.style.transform = `scale(${zoom * presentation})`; element.style.transformOrigin = "50% 50%"; hit.invalidate(); };
    const setZoom = value => { zoom = Q.zoom(value); applyScale(); return zoom; };
    setZoom(zoom);
    const tickHit = () => { if (disposed) return; hit.sample(); hitFrame = requestAnimationFrame(tickHit); }; hitFrame = requestAnimationFrame(tickHit);
    return { kind: manifest.kind, animations: [], setZoom, setPresentationScale(value) { presentation = Q.presentationScale(value); applyScale(); }, getHitMask: () => hit.get(), setState(state) { container.dataset.state = state; }, setAnimation() { return false; }, setExpression() { return false; }, getRenderInfo() { return { kind: manifest.kind, zoom, presentationScale: presentation, naturalWidth: element.naturalWidth || element.videoWidth, naturalHeight: element.naturalHeight || element.videoHeight }; }, dispose() { disposed = true; cancelAnimationFrame(hitFrame); hit.dispose(); if (element.pause) element.pause(); element.removeAttribute("src"); element.load?.(); container.remove(); } };
  }

  async function spine(host, manifest, assetURL) {
    const names = { "3.8": "spine-player-3.8.js", "4.0": "spine-player-4.0.31.min.js", "4.1": "spine-player-4.1.56.min.js", "4.2": "spine-player-4.2.120.min.js" };
    if (!names[manifest.runtime]) throw new Error("此 Spine 版本暂未提供匹配播放器。");
    // Old and new official runtimes use the same global; isolate their exports.
    if (!spineRuntimes.has(manifest.runtime)) spineRuntimes.set(manifest.runtime, spineQueue = spineQueue.catch(() => {}).then(async () => { const prior = window.spine; window.spine = undefined; try { await script(names[manifest.runtime]); const runtime = window.spine; if (!runtime?.SpinePlayer) throw new Error("Spine 播放器不完整。"); return runtime; } finally { window.spine = prior; } }));
    const runtime = await spineRuntimes.get(manifest.runtime), container = mount(host); let player, disposed = false, current = "";
    const destroy = widget => { if (!widget) return; if (typeof widget.dispose === "function") { widget.dispose(); return; } widget.stopRendering?.(); requestAnimationFrame(() => { try { widget.assetManager?.dispose(); widget.sceneRenderer?.dispose(); widget.context?.dispose(); widget.context?.gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {} }); };
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { destroy(player); container.remove(); reject(new Error("Spine 加载超时，请检查导出的骨骼和纹理。")); }, 25000);
      const config = {
        atlas: assetURL(manifest.atlas), atlasUrl: assetURL(manifest.atlas), skeleton: assetURL(manifest.entry),
        ...(manifest.binary ? { binaryUrl: assetURL(manifest.entry), skelUrl: assetURL(manifest.entry) } : { jsonUrl: assetURL(manifest.entry) }),
        animation: manifest.stateMap?.idle || undefined, alpha: true, backgroundColor: "#00000000", fullScreenBackgroundColor: "#00000000", showControls: false,
        interactive: false, showLoading: false, preserveDrawingBuffer: true,
        success(widget) { clearTimeout(timeout); player = widget; resolve(widget); },
        error(widget) { clearTimeout(timeout); destroy(widget); container.remove(); reject(new Error("Spine 资源与播放器版本不匹配，或纹理、骨骼无法读取。")); }
      };
      try { player = new runtime.SpinePlayer(container, config); } catch (error) { clearTimeout(timeout); container.remove(); reject(error); }
    });
    const Q = window.LaurentinaRenderQuality;
    const restoreResize = manifest.runtime === "3.8" ? Q.installSpine38Resize(result.sceneRenderer, runtime.webgl.ResizeMode, () => window.devicePixelRatio || 1) : () => {};
    let zoom = Q.initialZoom(manifest), baseViewport, presentation = 1;
    const hit = Q.hitMaskSampler(result.canvas, container), originalDraw = result.drawFrame;
    result.drawFrame = function (...args) { const value = originalDraw.apply(this, args); if (!disposed) hit.sample(); return value; };
    const applyZoom = () => { if (baseViewport) result.currentViewport = Q.frame(baseViewport, zoom * presentation); hit.invalidate(); };
    const setZoom = value => { zoom = Q.zoom(value); applyZoom(); result.previousViewport = null; return zoom; };
    const animations = (result.skeleton?.data?.animations || []).map(a => a.name);
    const touch = Q.touchAnimation(manifest, animations);
    let touchRun = null;
    const cancelTouch = () => { if (!touchRun) return false; const run = touchRun; touchRun = null; if (run.entry.listener === run.listener) run.entry.listener = run.previous; run.onComplete = null; return true; };
    const play = (name, loop = true, force = false) => { if (disposed || !animations.includes(name)) return false; if (current === name && !force) return true; current = name; result.setAnimation(name, loop); baseViewport = { ...result.currentViewport }; applyZoom(); result.play?.(); return true; };
    const setAnimation = name => { const cancelled = cancelTouch(); return play(name, true, cancelled); };
    const playTouch = (name, options) => {
      if (disposed || !animations.includes(name)) return false;
      if (touchRun?.name === name) { touchRun.onComplete = options?.onComplete; return true; }
      cancelTouch(); play(name, false, true);
      const entry = result.animationState?.getCurrent(0);
      if (!entry) { play(idle, true, true); return false; }
      const run = { name, entry, previous: entry.listener, onComplete: options?.onComplete };
      run.listener = { ...run.previous, complete(completed) {
        if (disposed || touchRun !== run || completed !== entry) return;
        run.previous?.complete?.(completed);
        if (disposed || touchRun !== run) return;
        const complete = run.onComplete; cancelTouch();
        try { complete?.(); } finally { if (!disposed && !touchRun && current === name) play(idle, true, true); }
      } };
      entry.listener = run.listener; touchRun = run;
      return true;
    };
    const idle = manifest.stateMap?.idle || animations.find(n => /idle|待机|default|normal/i.test(n)) || animations[0]; if (idle) setAnimation(idle);
    container.dataset.ready = "true";
    return { kind: "spine", animations, touchAnimation: touch, setAnimation, setZoom, setPresentationScale(value) { presentation = Q.presentationScale(value); applyZoom(); result.previousViewport = null; }, getHitMask: () => hit.get(), setExpression() { return false; }, getRenderInfo() { return { kind: "spine", runtime: manifest.runtime, ...Q.describe(result.canvas, zoom), presentationScale: presentation, animation: current, viewport: { ...result.currentViewport } }; }, setState(state, options) {
      container.dataset.state = state;
      if (state === 'touch') return playTouch(options?.animation || touch, options);
      if (touchRun && (state === 'idle' || state === 'speaking')) return true;
      return setAnimation(manifest.stateMap?.[state] || idle);
    }, cancelTouch() { const cancelled = cancelTouch(); if (cancelled && !disposed) play(idle, true, true); }, dispose() { if (disposed) return; cancelTouch(); disposed = true; hit.dispose(); result.drawFrame = originalDraw; restoreResize(); destroy(result); container.remove(); } };
  }

  async function live2d(host, manifest, assetURL) {
    await script("live2dcubismcore-5.2.min.js"); await script("cubism-framework-5-r.4.min.js");
    const F = window.LaurentinaCubism;
    if (!F.CubismFramework.isStarted()) { const options = new F.Option(); options.logFunction = () => {}; F.CubismFramework.startUp(options); }
    if (!F.CubismFramework.isInitialized()) F.CubismFramework.initialize();
    const container = mount(host), canvas = document.createElement("canvas"); canvas.className = "la-avatar-canvas"; container.append(canvas);
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) { container.remove(); throw new Error("Live2D 播放需要 WebGL，请检查显卡加速。" ); }
    const Q = window.LaurentinaRenderQuality, pixelBudget = Q.limits(gl);
    let zoom = Q.initialZoom(manifest), presentation = 1;
    const hit = Q.hitMaskSampler(canvas, container);
    const res = resources(manifest, assetURL), user = new F.CubismUserModel(), textures = [], motions = new Map(), expressions = new Map();
    let frame = 0, disposed = false, previous = performance.now(), chosen = "", state = "idle", level = 0, age = 0, blink, breath, settings, lips = [], animation = "", touchRun = null;
    const cancelTouch = () => { if (!touchRun) return false; const run = touchRun; touchRun = null; run.motion.setFinishedMotionHandler(run.previous); run.motion.setLoop(run.loop); run.onComplete = null; return true; };
    const cleanup = () => { if (disposed) return; cancelTouch(); disposed = true; cancelAnimationFrame(frame); hit.dispose(); res.abort(); observer?.disconnect(); try { user.deleteRenderer(); user.release(); } catch {} for (const texture of textures) gl.deleteTexture(texture); gl.getExtension("WEBGL_lose_context")?.loseContext(); container.remove(); };
    const observer = new ResizeObserver(() => resize());
    function resize() { const size = Q.pixelSize(container.clientWidth, container.clientHeight, window.devicePixelRatio || 1, pixelBudget); if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; } }
    const relative = name => join(manifest.entry, name);
    try {
      const settingBuffer = await res.buffer(manifest.entry); settings = new F.CubismModelSettingJson(settingBuffer, settingBuffer.byteLength);
      const data = await res.json(manifest.entry), refs = data.FileReferences;
      user.loadModel(await res.buffer(relative(refs.Moc)), true); if (!user._model) throw new Error("moc3 与当前 Cubism 版本不兼容或已损坏。");
      const model = user._model, ids = F.CubismFramework.getIdManager(), eyeIds = new F.csmVector(), lipIds = new F.csmVector();
      for (let i = 0; i < settings.getEyeBlinkParameterCount(); i++) eyeIds.pushBack(settings.getEyeBlinkParameterId(i));
      for (let i = 0; i < settings.getLipSyncParameterCount(); i++) { const id = settings.getLipSyncParameterId(i); lipIds.pushBack(id); lips.push(id); }
      if (!lips.length && model.getParameterIndex(ids.getId("ParamMouthOpenY")) < model.getParameterCount()) lips = [ids.getId("ParamMouthOpenY")];
      blink = F.CubismEyeBlink.create(settings); breath = F.CubismBreath.create();
      breath.setParameters(new F.csmVector());
      const params = new F.csmVector(); params.pushBack(new F.BreathParameterData(ids.getId("ParamBreath"), .5, .5, 3.2345, 1)); breath.setParameters(params);
      if (refs.Physics) { const b = await res.buffer(relative(refs.Physics)); user.loadPhysics(b, b.byteLength); }
      if (refs.Pose) { const b = await res.buffer(relative(refs.Pose)); user.loadPose(b, b.byteLength); }
      for (const [group, list] of Object.entries(refs.Motions || {})) for (let i = 0; i < list.length; i++) { const b = await res.buffer(relative(list[i].File)), name = `${group}:${i}`, motion = user.loadMotion(b, b.byteLength, name, undefined, undefined, settings, group, i); if (!motion) throw new Error("Live2D 动作格式无法读取。"); motion.setEffectIds(eyeIds, lipIds); motions.set(name, motion); }
      for (const e of refs.Expressions || []) { const b = await res.buffer(relative(e.File)), expression = user.loadExpression(b, b.byteLength, e.Name); if (!expression) throw new Error("Live2D 表情格式无法读取。"); expressions.set(e.Name, expression); }
      const layout = new F.csmMap(); settings.getLayoutMap(layout); user.getModelMatrix().setupFromLayout(layout);
      user.createRenderer(); const renderer = user.getRenderer(); renderer.startUp(gl); renderer.setIsPremultipliedAlpha(true);
      for (let i = 0; i < refs.Textures.length; i++) {
        const image = new Image(); image.crossOrigin = "anonymous";
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Live2D 纹理无法读取。")); image.src = res.url(relative(refs.Textures[i])); });
        if (image.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error("纹理超过显卡支持的尺寸。");
        const texture = gl.createTexture(); textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); renderer.bindTexture(i, texture);
      }
      gl.bindTexture(gl.TEXTURE_2D, null); resize(); observer.observe(container);
      const idle = manifest.stateMap?.idle || [...motions.keys()].find(n => /^idle:/i.test(n)) || [...motions.keys()][0]; animation = idle;
      const touch = Q.touchAnimation(manifest, [...motions.keys()]);
      const start = name => { if (!motions.has(name)) return false; chosen = name; user._motionManager.startMotionPriority(motions.get(name), false, 3); return true; };
      const playTouch = (name, options) => {
        if (disposed || !motions.has(name)) return false;
        if (touchRun?.name === name) { touchRun.onComplete = options?.onComplete; return true; }
        cancelTouch();
        const motion = motions.get(name), run = { name, motion, loop: motion.getLoop(), previous: motion.getFinishedMotionHandler(), onComplete: options?.onComplete, finished: false };
        motion.setLoop(false);
        motion.setFinishedMotionHandler((...args) => { if (disposed || touchRun !== run) return; run.previous?.(...args); if (!disposed && touchRun === run) run.finished = true; });
        touchRun = run; animation = name; return start(name);
      };
      function tick(now) {
        if (disposed) return; const dt = Math.min(.05, Math.max(0, (now - previous) / 1000)); previous = now; age += dt;
        model.loadParameters(); if (user._motionManager.isFinished() && animation && !touchRun) start(animation);
        const updated = user._motionManager.updateMotion(model, dt); model.saveParameters();
        if (touchRun?.finished) {
          const run = touchRun, complete = run.onComplete; cancelTouch();
          try { complete?.(); } finally { if (!disposed && !touchRun && animation === run.name) { animation = idle; start(idle); } }
        }
        if (!updated) blink.updateParameters(model, dt); user._expressionManager.updateMotion(model, dt); breath.updateParameters(model, dt); user._physics?.evaluate(model, dt); user._pose?.updateParameters(model, dt);
        for (const id of lips) model.addParameterValueById(id, state === "speaking" || state === "touch" ? level : 0, 1);
        model.update();
        resize(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const projection = new F.CubismMatrix44(), aspect = canvas.width / canvas.height, ratio = model.getCanvasWidth() / model.getCanvasHeight();
        // Fit the full Cubism canvas while preserving the model's exported layout.
        const scale = Math.min(1, aspect / ratio) * .96 * zoom * presentation; projection.scale(scale / aspect, scale);
        projection.multiplyByMatrix(user.getModelMatrix()); renderer.setMvpMatrix(projection); renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]); renderer.drawModel(); hit.sample();
        container.dataset.ready = "true"; frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
      return { kind: "live2d", animations: [...motions.keys()], expressions: [...expressions.keys()], touchAnimation: touch, setZoom(value) { zoom = Q.zoom(value); hit.invalidate(); return zoom; }, setPresentationScale(value) { presentation = Q.presentationScale(value); hit.invalidate(); }, getHitMask: () => hit.get(), getRenderInfo() { return { kind: "live2d", ...Q.describe(canvas, zoom), presentationScale: presentation, animation }; }, setAnimation(name) { if (!motions.has(name)) return false; cancelTouch(); animation = name; return start(name); }, setExpression(name) { if (!expressions.has(name)) return false; user._expressionManager.startMotionPriority(expressions.get(name), false, 3); return true; }, setState(next, options) {
        if (disposed) return false;
        state = next; level = levelOf(options); container.dataset.state = next;
        if (next === 'touch') return playTouch(options?.animation || touch, options);
        if (touchRun && (next === 'idle' || next === 'speaking')) return true;
        const cancelled = cancelTouch(), name = manifest.stateMap?.[next] || idle;
        if (name && (animation !== name || cancelled)) { animation = name; return start(name); }
        return true;
      }, cancelTouch() { const cancelled = cancelTouch(); if (cancelled && !disposed) { animation = idle; start(idle); } }, dispose: cleanup };
    } catch (error) { cleanup(); throw error; }
  }
  async function create(host, manifest, assetURL) {
    if (!(host instanceof Element) || !manifest || typeof assetURL !== "function") throw new Error("角色播放器参数无效。");
    if (!window.LaurentinaRenderQuality) await script("render_quality.js", true);
    if (["image", "video"].includes(manifest.kind)) return media(host, manifest, assetURL);
    if (manifest.kind === "live2d") return live2d(host, manifest, assetURL);
    if (manifest.kind === "spine") return spine(host, manifest, assetURL);
    throw new Error("未知的角色格式。");
  }
  window.LaurentinaAvatars = Object.freeze({ create, supported: ["image", "video", "live2d", "spine"] });
})();
