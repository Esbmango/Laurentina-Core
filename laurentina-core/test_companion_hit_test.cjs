'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { CompanionHitTest, normalize } = require('./companion_hit_test.cjs');
const packet = () => ({ width: 200, height: 200, regions: [{ x: 80, y: 170, width: 40, height: 25 }], alpha: { x: 50, y: 30, width: 100, height: 120, columns: 2, rows: 2, bits: Buffer.from([0b1001]).toString('base64') } });
const bounds = { x: -1200, y: 50, width: 400, height: 400 };
const cursor = (x, y) => ({ x: bounds.x + x * 2, y: bounds.y + y * 2 });
test('transparent padding and alpha holes pass through while opaque artwork and controls stay clickable', () => {
  const hit = new CompanionHitTest(); hit.update(packet());
  assert.equal(hit.ignore(bounds, cursor(100, 10)), true);
  assert.equal(hit.ignore(bounds, cursor(60, 40)), false);
  assert.equal(hit.ignore(bounds, cursor(130, 40)), true);
  assert.equal(hit.ignore(bounds, cursor(130, 130)), false);
  assert.equal(hit.ignore(bounds, cursor(100, 180)), false);
});
test('DIP translation stays correct on a negative-origin screen and after moving/resizing', () => {
  const hit = new CompanionHitTest(); hit.update(packet());
  assert.equal(hit.ignore(bounds, cursor(60, 40)), false);
  assert.equal(hit.ignore({ x: 2000, y: -900, width: 100, height: 100 }, { x: 2030, y: -880 }), false);
});
test('drag and stale or missing masks retain interaction rather than locking the pet out', () => {
  let now = 100; const hit = new CompanionHitTest(() => now);
  assert.equal(hit.ignore(bounds, cursor(100, 10)), false);
  hit.update(packet()); assert.equal(hit.ignore(bounds, cursor(100, 10), { dragging: true }), false);
  now += 1801; assert.equal(hit.ignore(bounds, cursor(100, 10)), false);
  hit.update(packet()); hit.reset(); assert.equal(hit.ignore(bounds, cursor(100, 10)), false);
});
test('malformed or excessive renderer packets fail without replacing the last usable mask', () => {
  const hit = new CompanionHitTest(); hit.update(packet());
  for (const update of [{ ...packet(), width: NaN }, { ...packet(), regions: Array(17).fill(packet().regions[0]) }, { ...packet(), alpha: { ...packet().alpha, bits: 'AA' } }, { ...packet(), alpha: { ...packet().alpha, columns: 32769 } }]) assert.throws(() => hit.update(update));
  assert.equal(hit.ignore(bounds, cursor(100, 10)), true);
});
test('stored packets own their data and an alpha-free fallback preserves only explicit hit regions', () => {
  const value = packet(), hit = new CompanionHitTest(); hit.update(value); value.regions[0].width = 0;
  assert.equal(hit.ignore(bounds, cursor(100, 180)), false);
  hit.update({ width: 200, height: 200, regions: [{ x: 10, y: 10, width: 150, height: 170 }] });
  assert.equal(hit.ignore(bounds, cursor(50, 50)), false); assert.equal(hit.ignore(bounds, cursor(190, 190)), true);
  assert.ok(normalize(packet()).alpha.bits instanceof Buffer);
});
