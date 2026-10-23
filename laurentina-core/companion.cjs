"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_PIXELS = 40 * 1024 * 1024;
const DEFAULT = Object.freeze({ mode: "orb", visible: false, scale: 1, artwork: null });

function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error("图片尺寸过大或无法读取，请换一张图片。");
  return { width, height };
}

function imageInfo(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("图片内容无效。");
  const invalid = () => { throw new Error("图片内容与格式不符或文件不完整。"); };
  if (mime === "image/gif") {
    if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) invalid();
    const size = dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    let offset = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    let frames = 0;
    const blocks = () => {
      let total = 0;
      while (offset < bytes.length) {
        const count = bytes[offset++];
        if (!count) return total;
        total += count;
        offset += count;
        if (offset > bytes.length) invalid();
      }
      invalid();
    };
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 0x3b) {
        if (!frames || offset !== bytes.length) invalid();
        return { ...size, animated: frames > 1 };
      }
      if (marker === 0x21) { if (offset >= bytes.length) invalid(); offset++; blocks(); continue; }
      if (marker !== 0x2c || offset + 9 > bytes.length) invalid();
      const x = bytes.readUInt16LE(offset), y = bytes.readUInt16LE(offset + 2);
      const frame = dimensions(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6));
      if (x + frame.width > size.width || y + frame.height > size.height) invalid();
      const flags = bytes[offset + 8];
      offset += 9 + ((flags & 128) ? 3 * (1 << ((flags & 7) + 1)) : 0);
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) invalid();
      offset++;
      if (!blocks()) invalid();
      frames++;
    }
    invalid();
  }
  if (mime === "image/png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) invalid();
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    let offset = 8, animated = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
      offset += length + 12;
      if (offset > bytes.length) invalid();
      if (kind === "acTL") animated = true;
      if (kind === "IEND") { if (length || offset !== bytes.length) invalid(); return { ...size, animated }; }
    }
    invalid();
  }
  if (mime === "image/webp") {
    if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
    let offset = 12, size = null, animated = false, hasImage = false, hasAnimationHeader = false;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
      offset = start + length + (length % 2);
      if (offset > bytes.length) invalid();
      if (kind === "VP8X") {
        if (length !== 10 || size) invalid();
        size = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
        animated = Boolean(bytes[start] & 2);
      } else if (kind === "VP8 ") {
        if (length < 10 || bytes.toString("hex", start + 3, start + 6) !== "9d012a") invalid();
        size ||= dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
        hasImage = true;
      } else if (kind === "VP8L") {
        if (length < 5 || bytes[start] !== 0x2f) invalid();
        const bits = bytes.readUInt32LE(start + 1);
        size ||= dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        hasImage = true;
      } else if (kind === "ANIM") {
        if (!animated || length !== 6 || hasAnimationHeader) invalid();
        hasAnimationHeader = true;
      } else if (kind === "ANMF") {
        if (!animated || !hasAnimationHeader || !size || length < 24) invalid();
        const frame = dimensions(bytes.readUIntLE(start + 6, 3) + 1, bytes.readUIntLE(start + 9, 3) + 1);
        if (bytes.readUIntLE(start, 3) * 2 + frame.width > size.width || bytes.readUIntLE(start + 3, 3) * 2 + frame.height > size.height) invalid();
        let frameOffset = start + 16, frameImage = false;
        while (frameOffset + 8 <= start + length) {
          const frameKind = bytes.toString("ascii", frameOffset, frameOffset + 4), frameLength = bytes.readUInt32LE(frameOffset + 4);
          frameOffset += 8 + frameLength + (frameLength % 2);
          if (frameOffset > start + length || !["VP8 ", "VP8L", "ALPH"].includes(frameKind)) invalid();
          if (["VP8 ", "VP8L"].includes(frameKind)) { if (!frameLength || frameImage) invalid(); frameImage = true; }
        }
        if (!frameImage || frameOffset !== start + length) invalid();
        hasImage = true;
      }
    }
    if (offset !== bytes.length || !size || !hasImage) invalid();
    return { ...size, animated };
  }
  if (mime === "image/jpeg" && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { animated: false };
  invalid();
}

function imageData(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE / 3) * 4 + 80) throw new Error("桌宠图片请控制在 25 MB 以内。");
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("桌宠支持 PNG、JPEG、WebP 或 GIF 图片。");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString("base64") !== match[2]) throw new Error("图片内容无效。");
  imageInfo(bytes, `image/${match[1]}`);
  return value;
}

function validate(payload, current = DEFAULT) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !["mode", "visible", "scale", "artwork"].includes(key))) throw new Error("桌宠设置格式无效。");
  const result = { ...current };
  if ("mode" in payload) {
    if (!["orb", "illustration", "avatar"].includes(payload.mode)) throw new Error("请选择动态球、立绘或角色模型模式。");
    result.mode = payload.mode;
  }
  if ("visible" in payload) {
    if (typeof payload.visible !== "boolean") throw new Error("桌宠显示状态无效。");
    result.visible = payload.visible;
  }
  if ("scale" in payload) {
    if (typeof payload.scale !== "number" || !Number.isFinite(payload.scale) || payload.scale < 0.5 || payload.scale > 8) throw new Error("桌宠大小可设置为 50% 到 800%。");
    result.scale = Math.round(payload.scale * 100) / 100;
  }
  if ("artwork" in payload) result.artwork = imageData(payload.artwork);
  if (result.mode === "illustration" && !result.artwork) throw new Error("请先导入一张桌宠立绘，再切换立绘模式。");
  return result;
}

function geometry(settings, area, current = null) {
  const illustration = settings.mode === "illustration" || settings.mode === "avatar";
  const factor = Math.min(settings.scale, area.width / (illustration ? 300 : 260), area.height / (illustration ? 450 : 280));
  const width = Math.max(1, Math.round((illustration ? 300 : 260) * factor));
  const height = Math.max(1, Math.round((illustration ? 450 : 280) * factor));
  const x = current ? current.x + current.width - width : area.x + area.width - width - 30;
  const y = current ? current.y + current.height - height : area.y + area.height - height - 35;
  return { width, height, x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(y), area.y + area.height - height)), factor,
    presentationScale: settings.scale / factor };
}

// Both cursor and native window bounds are device-independent screen coordinates.
// A fixed starting anchor avoids renderer zoom and moving-window pointer feedback.
function dragAnchor(contentBounds, zoom, point) {
  if (!Number.isFinite(zoom) || zoom <= 0 || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.y < 0 || point.x * zoom > contentBounds.width || point.y * zoom > contentBounds.height) throw new Error("桌宠拖动起点无效。");
  return { x: contentBounds.x + point.x * zoom, y: contentBounds.y + point.y * zoom };
}

function dragPosition(origin, initialCursor, cursor, area) {
  const x = origin.x + cursor.x - initialCursor.x;
  const y = origin.y + cursor.y - initialCursor.y;
  if (Array.isArray(area)) {
    const areas = area.filter(rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0);
    if (!areas.length) throw new Error("暂时无法取得显示器范围，请稍后重试拖动。");
    // A window may straddle a screen seam. Clamping its whole rectangle to the
    // cursor's current monitor creates an invisible wall before the cursor can
    // reach the next monitor. Keep the fixed global anchor anywhere that remains
    // visible on the actual union, including negative and overlapping DIP areas.
    const visible = areas.some(rect => x < rect.x + rect.width && x + origin.width > rect.x &&
      y < rect.y + rect.height && y + origin.height > rect.y);
    if (visible) return { x: Math.round(x), y: Math.round(y) };
    // Monitor disconnection or an unusual pointer gap can leave no visible
    // pixels. Recover onto the nearest real work area, not a virtual bounding
    // rectangle which could itself be an invisible hole between displays.
    const centerX = x + origin.width / 2, centerY = y + origin.height / 2;
    const distance = rect => Math.hypot(Math.max(rect.x - centerX, 0, centerX - rect.x - rect.width),
      Math.max(rect.y - centerY, 0, centerY - rect.y - rect.height));
    area = areas.reduce((best, rect) => distance(rect) < distance(best) ? rect : best);
  }
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - origin.width)))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - origin.height)))),
  };
}

class CompanionStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, "companion.json");
    this.value = { ...DEFAULT };
    try {
      const stat = fs.statSync(this.file);
      if (stat.size <= MAX_IMAGE * 1.4 + 1024) this.value = validate(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch { /* An invalid saved setting cannot break application startup. */ }
  }
  get() { return { ...this.value }; }
  save(payload) {
    const value = validate(payload, this.value);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.value = value;
    return this.get();
  }
}

module.exports = { CompanionStore, validate, imageData, imageInfo, dimensions, geometry, dragAnchor, dragPosition, MAX_IMAGE, MAX_PIXELS };
