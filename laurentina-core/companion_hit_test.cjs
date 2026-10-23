'use strict';

const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 32768;
function rect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => finite(value[key])) || value.width < 0 || value.height < 0) throw new Error('桌宠命中区域无效。');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]]));
}
const contains = (box, x, y) => x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
function normalize(payload) {
  if (!payload || !finite(payload.width) || !finite(payload.height) || payload.width <= 0 || payload.height <= 0 || !Array.isArray(payload.regions) || payload.regions.length > 16) throw new Error('桌宠命中区域无效。');
  const result = { width: payload.width, height: payload.height, regions: payload.regions.map(rect), alpha: null };
  if (payload.alpha != null) {
    const alpha = payload.alpha;
    if (!Number.isInteger(alpha.columns) || !Number.isInteger(alpha.rows) || alpha.columns < 1 || alpha.rows < 1 || alpha.columns * alpha.rows > 32768 || typeof alpha.bits !== 'string' || alpha.bits.length > 5500 || !/^[A-Za-z0-9+/]*={0,2}$/.test(alpha.bits)) throw new Error('桌宠透明区域无效。');
    const bits = Buffer.from(alpha.bits, 'base64');
    if (bits.length !== Math.ceil(alpha.columns * alpha.rows / 8) || bits.toString('base64') !== alpha.bits) throw new Error('桌宠透明区域无效。');
    result.alpha = { ...rect(alpha), columns: alpha.columns, rows: alpha.rows, bits };
    if (!alpha.width || !alpha.height) throw new Error('桌宠透明区域无效。');
  }
  return result;
}

class CompanionHitTest {
  constructor(clock = Date.now) { this.clock = clock; this.reset(); }
  reset() { this.packet = null; this.updatedAt = 0; }
  update(payload) { const packet = normalize(payload); this.packet = packet; this.updatedAt = this.clock(); }
  ignore(bounds, point, { dragging = false } = {}) {
    const data = this.packet;
    // Missing/stale snapshots fail open so controls and dragging stay recoverable.
    if (dragging || !data || this.clock() - this.updatedAt > 1800 || !bounds.width || !bounds.height) return false;
    const x = (point.x - bounds.x) * data.width / bounds.width;
    const y = (point.y - bounds.y) * data.height / bounds.height;
    if (data.regions.some(region => contains(region, x, y))) return false;
    const mask = data.alpha;
    if (!mask || !contains(mask, x, y)) return true;
    const column = Math.floor((x - mask.x) * mask.columns / mask.width);
    const row = Math.floor((y - mask.y) * mask.rows / mask.height);
    const index = row * mask.columns + column;
    return !(mask.bits[index >> 3] & (1 << (index & 7)));
  }
}
module.exports = { CompanionHitTest, normalize };
