/* Pixel budgets and camera framing, shared with renderer tests. */
((root) => {
  "use strict";
  const MAX_PIXELS = 2 * 1024 * 1024;
  function zoom(value = 1) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < .5 || value > 8) throw new Error("人物缩放可设置为 50% 到 800%。");
    return Math.round(value * 100) / 100;
  }
  function initialZoom(manifest) { try { return zoom(manifest?.view?.zoom ?? 1); } catch { return 1; } }
  function limits(gl) {
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const maximum = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    return { width: Math.max(1, Math.min(maximum, viewport[0])), height: Math.max(1, Math.min(maximum, viewport[1])), pixels: MAX_PIXELS };
  }
  function pixelSize(width, height, dpr = 1, budget = {}) {
    width = Math.max(1, Number(width) || 1); height = Math.max(1, Number(height) || 1);
    dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const maxWidth = budget.width || 8192, maxHeight = budget.height || 8192, pixels = budget.pixels || MAX_PIXELS;
    const ratio = Math.min(dpr, maxWidth / width, maxHeight / height, Math.sqrt(pixels / (width * height)));
    const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
    return { width: w, height: h, requestedDpr: dpr, effectiveDpr: ratio, capped: ratio < dpr };
  }
  function installSpine38Resize(renderer, modes, readDpr) {
    const original = renderer.resize, canvas = renderer.canvas, gl = renderer.context.gl, budget = limits(gl);
    function resize(mode) {
      const size = pixelSize(canvas.clientWidth, canvas.clientHeight, readDpr(), budget);
      if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (mode === modes.Expand) renderer.camera.setViewport(canvas.width, canvas.height);
      else if (mode === modes.Fit) {
        const targetWidth = renderer.camera.viewportWidth, targetHeight = renderer.camera.viewportHeight;
        const factor = targetHeight / targetWidth < canvas.height / canvas.width ? targetWidth / canvas.width : targetHeight / canvas.height;
        renderer.camera.setViewport(canvas.width * factor, canvas.height * factor);
      }
      renderer.camera.update();
    }
    renderer.resize = resize;
    return () => { if (renderer.resize === resize) renderer.resize = original; };
  }
  function frame(viewport, factor) {
    const left = Number(viewport.padLeft) || 0, right = Number(viewport.padRight) || 0;
    const top = Number(viewport.padTop) || 0, bottom = Number(viewport.padBottom) || 0;
    const width = viewport.width + left + right, height = viewport.height + top + bottom;
    return { ...viewport, x: viewport.x - left + width * (1 - 1 / factor) / 2,
      y: viewport.y - bottom + height * (1 - 1 / factor) / 2, width: width / factor, height: height / factor,
      padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
  }
  function describe(canvas, factor) {
    return { zoom: factor, canvasWidth: canvas.width, canvasHeight: canvas.height,
      cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
      devicePixelRatio: root.devicePixelRatio || 1,
      bufferScaleX: canvas.width / Math.max(1, canvas.clientWidth), bufferScaleY: canvas.height / Math.max(1, canvas.clientHeight) };
  }
  function presentationScale(value = 1) { return Math.max(1, Math.min(16, Number(value) || 1)); }
  function touchAnimation(manifest, animations) {
    const configured = manifest.stateMap?.touch;
    if (typeof configured === 'string' && animations.includes(configured)) return configured;
    if (manifest.touch_animation_explicit ?? Object.hasOwn(manifest.stateMap || {}, 'touch')) return null;
    return animations.find(name => /^interact$/i.test(name)) || animations.find(name => /touch|interact|点击|触摸/i.test(name)) || null;
  }
  function packAlpha(pixels, width, height, threshold = 16) {
    const result = new Uint8Array(Math.ceil(width * height / 8));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < threshold) continue;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
        const index = yy * width + xx; result[index >> 3] |= 1 << (index & 7);
      }
    }
    return result;
  }
  function alphaBounds(mask) {
    if (!mask || !Number.isInteger(mask.columns) || !Number.isInteger(mask.rows) ||
        mask.columns < 1 || mask.rows < 1 || mask.columns * mask.rows > 32768 ||
        ![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) ||
        mask.width <= 0 || mask.height <= 0 || typeof mask.bits !== 'string') return null;
    let bits;
    try { bits = root.atob(mask.bits); } catch { return null; }
    if (bits.length !== Math.ceil(mask.columns * mask.rows / 8)) return null;
    let left = mask.columns, right = -1, top = mask.rows, bottom = -1;
    for (let row = 0; row < mask.rows; row++) for (let column = 0; column < mask.columns; column++) {
      const index = row * mask.columns + column;
      if (!(bits.charCodeAt(index >> 3) & (1 << (index & 7)))) continue;
      left = Math.min(left, column); right = Math.max(right, column);
      top = Math.min(top, row); bottom = Math.max(bottom, row);
    }
    if (right < 0) return null;
    return { x: mask.x + left * mask.width / mask.columns, y: mask.y + top * mask.height / mask.rows,
      width: (right - left + 1) * mask.width / mask.columns,
      height: (bottom - top + 1) * mask.height / mask.rows };
  }
  function footerOffset(mask, footer, viewportHeight, currentOffset = 0) {
    const visible = alphaBounds(mask);
    if (!visible || !footer || ![footer.top, footer.bottom, viewportHeight, currentOffset].every(Number.isFinite) ||
        footer.bottom <= footer.top || viewportHeight <= 0) return null;
    const height = footer.bottom - footer.top;
    const top = Math.max(4, Math.min(visible.y + visible.height + 5, viewportHeight - height - 8));
    // The footer transform must not feed back into the next measurement or
    // change the canvas size: only the original flow position is the anchor.
    return Math.round((top - (footer.top - currentOffset)) * 100) / 100;
  }
  function hitMaskSampler(source, host, options = {}) {
    const columns = 96, rows = 128, sample = root.document.createElement('canvas'); sample.width = columns; sample.height = rows;
    const context = sample.getContext('2d', { willReadFrequently: true }); let cached = null, last = -Infinity, disposed = false;
    return {
      sample(force = false) {
        if (root.document.visibilityState === 'hidden' || root.document.body?.classList?.contains('dragging')) return;
        const now = root.performance.now(); if (disposed || !context || !force && now - last < 250) return; last = now;
        try {
          context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, columns, rows);
          if (options.contain) {
            const width = source.naturalWidth || source.videoWidth || source.width, height = source.naturalHeight || source.videoHeight || source.height;
            if (!width || !height || !host.clientWidth || !host.clientHeight) return;
            const fit = Math.min(host.clientWidth / width, host.clientHeight / height), factor = options.scale?.() || 1;
            const w = width * fit / host.clientWidth * columns * factor, h = height * fit / host.clientHeight * rows * factor;
            context.drawImage(source, (columns - w) / 2, (rows - h) / 2, w, h);
          } else context.drawImage(source, 0, 0, columns, rows);
          const packed = packAlpha(context.getImageData(0, 0, columns, rows).data, columns, rows);
          // Empty/failed readbacks are unsafe for input: preserve dragging via native fallback.
          cached = packed.some(value => value) ? root.btoa(String.fromCharCode(...packed)) : null;
        } catch { cached = null; }
      },
      get() {
        if (!cached || disposed || root.performance.now() - last > 1500) return null;
        const rect = host.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, columns, rows, bits: cached };
      },
      invalidate() { cached = null; last = -Infinity; }, dispose() { disposed = true; cached = null; }
    };
  }
  const api = Object.freeze({ MAX_PIXELS, zoom, initialZoom, limits, pixelSize, installSpine38Resize, frame, describe, presentationScale, touchAnimation, packAlpha, alphaBounds, footerOffset, hitMaskSampler });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaurentinaRenderQuality = api;
})(typeof window !== "undefined" ? window : globalThis);
