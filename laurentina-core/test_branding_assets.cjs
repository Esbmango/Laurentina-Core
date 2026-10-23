'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const root = __dirname, read = name => fs.readFileSync(path.join(root, name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceSha = '0089164f40737d3645e8352b6babc22dc9abc0557995395928679bec8a6f74ab';
function pngHeader(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), depth: bytes[24], color: bytes[25] };
}

test('V1 original keeps the user-selected PNG bytes and all shipped formats have verifiable fingerprints', () => {
  const manifest = JSON.parse(read('assets/logo-v1.json'));
  assert.equal(manifest.logo_version, 'V1'); assert.equal(sha(read(manifest.original.path)), sourceSha);
  assert.equal(manifest.original.sha256, sourceSha);
  for (const name of ['original', 'cutout', 'desktop', 'png', 'ui_png', 'ico']) assert.equal(sha(read(manifest[name].path)), manifest[name].sha256);
  assert.deepEqual(pngHeader(read(manifest.original.path)), { width: 1254, height: 1254, depth: 8, color: 2 });
});
test('desktop tile and UI mark are distinct assets with square RGBA framing', () => {
  const native = read('assets/icon.png'), ui = read('ui/logo-v1.png');
  assert.deepEqual(pngHeader(native), { width: 512, height: 512, depth: 8, color: 6 });
  assert.deepEqual(pngHeader(ui), { width: 512, height: 512, depth: 8, color: 6 });
  assert.notDeepEqual(ui, native);
  const svg = read('assets/icon.svg').toString('utf8');
  assert.match(svg, /<image href="icon\.png"/); assert.doesNotMatch(svg, /<(?:path|ellipse|rect|circle)\b/);
});
function rgbaPixels(bytes) {
  const { width, height, color, depth } = pngHeader(bytes); assert.equal(color, 6); assert.equal(depth, 8);
  const idat = []; for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length)); offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4, output = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    for (let col = 0; col < stride; col++) {
      const at = row * stride + col, left = col >= 4 ? output[at - 4] : 0, up = row ? output[at - stride] : 0, corner = row && col >= 4 ? output[at - stride - 4] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      assert.ok(predictor !== undefined); output[at] = (raw[row * (stride + 1) + 1 + col] + predictor) & 255;
    }
  }
  return { width, height, output };
}
test('rendered logo contains only blue opaque pixels and genuine empty background, not a gray white or checkerboard tile', () => {
  const { output, width, height } = rgbaPixels(read('ui/logo-v1.png'));
  let transparent = 0, opaque = 0, blue = 0;
  for (let at = 0; at < output.length; at += 4) {
    const [r, g, b, a] = output.subarray(at, at + 4); if (!a) transparent++;
    if (a >= 240) { opaque++; if (b > g * 1.2 && b > r * 1.5) blue++; }
  }
  assert.ok(transparent / (width * height) > .5); assert.ok(opaque > 10000); assert.ok(blue / opaque > .995);
  for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [256, 256]]) assert.equal(output[(y * width + x) * 4 + 3], 0);
});
test('desktop icon retains an opaque warm-white app tile with genuinely transparent outer corners', () => {
  const { output, width, height } = rgbaPixels(read('assets/icon.png'));
  const pixel = (x, y) => [...output.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [256, 2], [2, 256]]) assert.equal(pixel(x, y)[3], 0);
  for (const [x, y] of [[256, 32], [32, 256], [480, 256], [256, 480]]) {
    const [r, g, b, a] = pixel(x, y); assert.equal(a, 255); assert.ok(r > 245 && g > 245 && b > 240);
  }
  let white = 0, blue = 0;
  for (let at = 0; at < output.length; at += 4) {
    const [r, g, b, a] = output.subarray(at, at + 4);
    if (a > 240 && r > 245 && g > 245 && b > 240) white++;
    if (a > 240 && b > r * 1.5 && b > g * 1.2) blue++;
  }
  assert.ok(white > width * height * .65); assert.ok(blue > 10000);
  assert.deepEqual(read('assets/logo-v1-desktop.ico'), read('assets/icon.ico'));
});
test('Windows ICO contains valid standard image sizes and bounded PNG entries', () => {
  const bytes = read('assets/icon.ico');
  assert.equal(bytes.readUInt16LE(0), 0); assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4), sizes = [];
  assert.equal(count, 7);
  for (let i = 0; i < count; i++) {
    const start = 6 + i * 16, width = bytes[start] || 256, height = bytes[start + 1] || 256;
    const length = bytes.readUInt32LE(start + 8), offset = bytes.readUInt32LE(start + 12);
    assert.equal(width, height); assert.ok(offset >= 6 + count * 16 && offset + length <= bytes.length);
    const png = pngHeader(bytes.subarray(offset, offset + length));
    assert.equal(png.width, width); assert.equal(png.height, height); sizes.push(width);
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);
});
test('app branding occupies only sidebar startup and about areas, preserving character avatar hosts', () => {
  const html = read('ui/index.html').toString('utf8'), stack = [], logos = [], ids = new Set();
  const voids = new Set(['input', 'img', 'meta', 'link', 'br', 'hr', 'source']);
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)(\s[^<>]*?)?\s*\/?>/gi)) {
    const [raw, tag, rest = ''] = match;
    if (raw.startsWith('</')) { assert.equal(stack.pop()?.tag, tag); continue; }
    const attrs = Object.fromEntries([...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    if (attrs.id) { assert.equal(ids.has(attrs.id), false); ids.add(attrs.id); }
    if (attrs.class === 'brand-logo') logos.push({ ...attrs, parent: stack.at(-1)?.attrs });
    if (!voids.has(tag) && !raw.endsWith('/>')) stack.push({ tag, attrs });
  }
  assert.equal(stack.length, 0); assert.equal(logos.length, 3);
  assert.ok(logos.some(logo => logo.parent.id === 'brand-home'));
  assert.ok(logos.some(logo => logo.parent.id === 'startup-overlay'));
  assert.ok(logos.some(logo => logo.parent.class === 'app-version'));
  assert.ok(logos.every(logo => logo.src === 'logo-v1.png'));
  for (const id of ['welcome-avatar', 'character-avatar', 'companion-artwork-preview', 'avatar-library']) assert.equal(ids.has(id), true);
  assert.match(html, /<link rel="icon" type="image\/png" href="logo-v1\.png">/);
});
