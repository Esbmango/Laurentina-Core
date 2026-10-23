'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Q = require('./ui/avatars/render_quality.js');
const { CompanionHitTest } = require('./companion_hit_test.cjs');

function mask(lastRow = 5) {
  const columns = 8, rows = 10, bits = Buffer.alloc(Math.ceil(columns * rows / 8));
  for (let row = 2; row <= lastRow; row++) for (let column = 2; column <= 5; column++) {
    const index = row * columns + column; bits[index >> 3] |= 1 << (index & 7);
  }
  return { x: 0, y: 0, width: 300, height: 380, columns, rows, bits: bits.toString('base64') };
}

test('footer follows opaque character pixels rather than transparent canvas padding', () => {
  assert.deepEqual(Q.alphaBounds(mask()), { x: 75, y: 76, width: 150, height: 152 });
  const footer = { top: 385, bottom: 437 };
  const small = Q.footerOffset(mask(5), footer, 450);
  const large = Q.footerOffset(mask(9), footer, 450);
  assert.equal(footer.top + small, 233); assert.equal(small, -152);
  assert.equal(large, 0); assert.ok(large > small);
  assert.deepEqual(footer, { top: 385, bottom: 437 });
});

test('repeated positioning does not feed back into the canvas or drift the caption', () => {
  let offset = 0;
  for (let index = 0; index < 20; index++) {
    offset = Q.footerOffset(mask(), { top: 385 + offset, bottom: 437 + offset }, 450, offset);
    assert.equal(offset, -152);
  }
  const clipped = { ...mask(9), y: 100 };
  const bounded = Q.footerOffset(clipped, { top: 385, bottom: 437 }, 450);
  assert.equal(437 + bounded, 442); // The entire caption stays within the viewport.
});

test('empty or unavailable alpha cannot invent a visible character edge', () => {
  assert.equal(Q.alphaBounds(null), null);
  assert.equal(Q.alphaBounds({ ...mask(), bits: Buffer.alloc(10).toString('base64') }), null);
  assert.equal(Q.footerOffset({ ...mask(), bits: 'not base64' }, { top: 385, bottom: 437 }, 450), null);
});

function scene() {
  let offset = 0, current = mask(), packets = [], canvasChanges = 0;
  const rectangle = (x, y, width, height, translated = false) => ({ getBoundingClientRect() {
    const top = y + (translated ? offset : 0); return { x, y: top, top, bottom: top + height, width, height };
  } });
  const elements = {
    'companion-artwork': rectangle(0, 0, 300, 380), 'orb-open': rectangle(68, 0, 164, 164),
    'orb-name': rectangle(40, 385, 220, 16, true),
    'orb-main': rectangle(99, 408, 30, 25, true), 'orb-record': rectangle(133, 408, 30, 25, true),
    'orb-hide': rectangle(167, 408, 30, 25, true),
  };
  const context = vm.createContext({
    companion: { mode: 'avatar' }, companionFooterKey: null, companionFooterOffset: 0, renderedArtwork: 'first-character',
    companionHitSource: null, avatarAdapter: { getHitMask: () => current,
      setZoom() { canvasChanges++; }, setState() { canvasChanges++; } },
    window: { innerWidth: 300, innerHeight: 450, LaurentinaRenderQuality: Q },
    document: { visibilityState: 'visible', documentElement: { style: { setProperty(name, value) {
      assert.equal(name, '--companion-footer-offset'); offset = Number.parseFloat(value);
    } } } },
    $: id => elements[id], Uint8Array, Math, btoa,
    rpc(action, payload) { assert.equal(action, 'window.companion.hit_regions'); packets.push(payload); return Promise.resolve(); },
  });
  const source = fs.readFileSync(path.join(__dirname, 'ui/orb.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function solidCompanionMask('), source.indexOf('function draggable(')), context);
  return { context, publish: () => context.publishCompanionHitRegions(), get offset() { return offset; },
    get packet() { return packets.at(-1); }, get canvasChanges() { return canvasChanges; }, setMask: value => { current = value; } };
}

test('production footer placement publishes the moved button hitboxes without touching animation', () => {
  const s = scene(); s.publish(); assert.equal(s.offset, -152);
  for (let index = 0; index < 12; index++) s.publish();
  assert.equal(s.offset, -152); assert.equal(s.canvasChanges, 0);
  const native = new CompanionHitTest(); native.update(s.packet);
  const bounds = { x: -600, y: 30, width: 600, height: 900 };
  const cursor = point => ({ x: bounds.x + point.x * 2, y: bounds.y + point.y * 2 });
  for (const button of s.packet.regions) {
    assert.equal(button.y, 256);
    assert.equal(native.ignore(bounds, cursor({ x: button.x + 15, y: button.y + 12 })), false);
  }
  assert.equal(native.ignore(bounds, cursor({ x: 150, y: 430 })), true);
  s.setMask(mask(9)); s.publish(); assert.equal(s.offset, 0);
  assert.ok(s.packet.regions.every(button => button.y === 408));
});

test('temporary readback loss keeps the footer stable and a new character resets it safely', () => {
  const s = scene(); s.publish(); s.setMask(null); s.publish(); assert.equal(s.offset, -152);
  s.context.renderedArtwork = 'second-character'; s.publish(); assert.equal(s.offset, 0);
  s.setMask(mask()); s.publish(); assert.equal(s.offset, -152);
  s.context.companion = { mode: 'orb' }; s.publish(); assert.equal(s.offset, 0);
});

test('caption transform leaves the artwork flex allocation independent of the caption position', () => {
  const css = fs.readFileSync(path.join(__dirname, 'ui/orb.css'), 'utf8');
  assert.match(css, /\.illustration \.orb-name,\.illustration \.orb-status,\.illustration \.orb-controls\{transform:translateY\(var\(--companion-footer-offset,0px\)\)\}/);
  assert.match(css, /\.illustration-button\{[^}]*flex:1;[^}]*min-height:0;/);
});
