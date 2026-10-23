"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { CompanionStore, validate, geometry, imageData, imageInfo, dragAnchor, dragPosition, MAX_IMAGE } = require("./companion.cjs");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wfcAAAAASUVORK5CYII=";
// A looping two-frame GIF with green and lavender pixels. No external asset.
const animatedGif = Buffer.from("474946383961010001008000006bffb6e392ff21ff0b4e45545343415045322e30030100000021f90404320000002c000000000100010000020244010021f90404320000002c00000000010001000002024c01003b", "hex");

test("companion asset is separate, validated and survives restart", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "laurentina-companion-"));
  try {
    const store = new CompanionStore(folder);
    assert.equal(store.get().visible, false);
    assert.throws(() => store.save({ mode: "illustration" }));
    store.save({ artwork: png, mode: "illustration", scale: 1.5, visible: true });
    assert.deepEqual(new CompanionStore(folder).get(), store.get());
    assert.equal(store.get().artwork, png);
    assert.throws(() => store.save({ artwork: "data:image/svg+xml;base64,PHN2Zz4=" }));
    assert.throws(() => store.save({ scale: Infinity }));
    assert.throws(() => store.save({ scale: 8.01 }));
    assert.throws(() => store.save({ visible: "yes" }));
  } finally {
    const resolved = fs.realpathSync(folder);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("laurentina-companion-"));
    fs.rmSync(resolved, { recursive: true });
  }
});
test("resizing a desktop pet stays within the selected monitor work area", () => {
  const area = { x: -1200, y: 100, width: 1200, height: 700 };
  const result = geometry({ mode: "illustration", scale: 2 }, area, { x: 5000, y: 5000, width: 300, height: 450 });
  assert.ok(result.width <= area.width && result.height <= area.height);
  assert.ok(result.x >= area.x && result.x + result.width <= area.x + area.width);
  assert.ok(result.y >= area.y && result.y + result.height <= area.y + area.height);
});
test('larger desktop companion keeps the full canvas and remains bounded by the monitor', () => {
  const settings=validate({mode:'avatar',scale:4},{mode:'orb',visible:false,scale:1,artwork:null});
  const large=geometry(settings,{x:0,y:0,width:3840,height:2160});
  assert.equal(large.factor,4);
  const small=geometry(settings,{x:-1200,y:0,width:1200,height:700});
  assert.ok(small.factor<4);assert.ok(small.width<=1200&&small.height<=700);
  assert.equal(validate({scale:8}).scale,8);assert.throws(()=>validate({scale:8.01}));
});
test('beyond-screen scale keeps the window safe while actual character presentation keeps growing', () => {
  const area={x:0,y:0,width:1920,height:1080};
  const four=geometry(validate({mode:'avatar',scale:4}),area),eight=geometry(validate({mode:'avatar',scale:8}),area);
  assert.equal(four.height,1080);assert.equal(eight.height,1080);assert.equal(four.factor,eight.factor);
  assert.equal(eight.presentationScale/four.presentationScale,2);
  assert.equal(eight.factor*eight.presentationScale,8);
  assert.ok(eight.width<=area.width&&eight.height<=area.height);
});

test("animation bytes survive save and restart without flattening frames", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "laurentina-companion-motion-"));
  try {
    const artwork = `data:image/gif;base64,${animatedGif.toString("base64")}`;
    assert.deepEqual(imageInfo(animatedGif, "image/gif"), { width: 1, height: 1, animated: true });
    assert.equal(imageData(artwork), artwork);
    new CompanionStore(folder).save({ mode: "illustration", artwork });
    assert.equal(new CompanionStore(folder).get().artwork, artwork);
  } finally {
    const resolved = fs.realpathSync(folder);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("laurentina-companion-motion-"));
    fs.rmSync(resolved, { recursive: true });
  }
});

test("image containers reject truncation, disguised formats and oversized canvases", () => {
  assert.throws(() => imageInfo(animatedGif.subarray(0, -1), "image/gif"));
  assert.throws(() => imageInfo(animatedGif, "image/png"));
  assert.throws(() => imageData(`data:image/png;base64,${animatedGif.toString("base64")}`));
  const hugeGif = Buffer.from(animatedGif);
  hugeGif.writeUInt16LE(65535, 6); hugeGif.writeUInt16LE(65535, 8);
  assert.throws(() => imageInfo(hugeGif, "image/gif"), /尺寸/);
  const pngBytes = Buffer.from(png.split(",")[1], "base64");
  assert.throws(() => imageInfo(pngBytes.subarray(0, -4), "image/png"));
  const hugePng = Buffer.from(pngBytes);
  hugePng.writeUInt32BE(100000, 16); hugePng.writeUInt32BE(100000, 20);
  assert.throws(() => imageInfo(hugePng, "image/png"), /尺寸/);
  assert.equal(MAX_IMAGE, 25 * 1024 * 1024);
  assert.throws(() => imageData("data:image/gif;base64," + "A".repeat(Math.ceil(MAX_IMAGE / 3) * 4 + 81)), /25 MB/);
});

test("drag remains anchored to the native cursor through downward movement and reversal", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const origin = { x: 600, y: 200, width: 450, height: 675 };
  const anchor = { x: 750, y: 300 };
  assert.deepEqual(dragPosition(origin, anchor, { x: 750, y: 400 }, area), { x: 600, y: 300 });
  // Calling again with the same global cursor cannot accumulate another offset.
  assert.deepEqual(dragPosition(origin, anchor, { x: 750, y: 400 }, area), { x: 600, y: 300 });
  assert.deepEqual(dragPosition(origin, anchor, { x: 750, y: 800 }, area), { x: 600, y: 405 });
  assert.deepEqual(dragPosition(origin, anchor, { x: 750, y: 350 }, area), { x: 600, y: 250 });
  assert.deepEqual(dragPosition(origin, anchor, { x: 750, y: 300 }, area), { x: 600, y: 200 });
});

test("native drag can cross monitors with negative origins and clamps large windows", () => {
  const origin = { x: 20, y: 100, width: 300, height: 450 };
  const area = { x: -1280, y: -100, width: 1280, height: 1024 };
  assert.deepEqual(dragPosition(origin, { x: 150, y: 250 }, { x: -400, y: 500 }, area), { x: -530, y: 350 });
  assert.deepEqual(dragPosition({ ...origin, width: 2000, height: 1200 }, { x: 0, y: 0 }, { x: -500, y: -500 }, area), { x: -1280, y: -100 });
});

test("pointerdown client location gives an immediate DIP anchor despite delayed IPC", () => {
  const bounds = { x: 1246, y: 647, width: 390, height: 345 };
  const anchor = dragAnchor(bounds, 1.5, { x: 100, y: 60 });
  assert.deepEqual(anchor, { x: 1396, y: 737 });
  // Even if the cursor has already moved before start IPC is handled, the
  // original event position remains the anchor, so an immediate end still moves.
  assert.deepEqual(dragPosition(bounds, anchor, { x: 1336, y: 677 }, { x: 0, y: 0, width: 1920, height: 1080 }), { x: 1186, y: 587 });
  assert.throws(() => dragAnchor(bounds, 1.5, { x: Infinity, y: 60 }));
  assert.throws(() => dragAnchor(bounds, 1.5, { x: -1, y: 60 }));
  assert.throws(() => dragAnchor(bounds, 1.5, { x: 300, y: 60 }));
  assert.throws(() => dragAnchor(bounds, 0, { x: 100, y: 60 }));
});

test("connected-screen seams preserve every pixel of drag in both directions", () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1536, height: 824 }];
  const origin = { x: 1500, y: 200, width: 450, height: 675 }, anchor = { x: 1650, y: 300 };
  for (let delta = 0; delta <= 900; delta += 15) {
    const result = dragPosition(origin, anchor, { x: anchor.x + delta, y: anchor.y }, areas);
    assert.deepEqual(result, { x: origin.x + delta, y: origin.y });
  }
  const reverse = { ...origin, x: 2100 };
  for (let delta = 0; delta >= -900; delta -= 15) {
    assert.equal(dragPosition(reverse, { x: 2250, y: 300 }, { x: 2250 + delta, y: 300 }, areas).x, 2100 + delta);
  }
});

test("negative, overlapping and vertically arranged work areas allow straddling", () => {
  const origin = { x: 10, y: 200, width: 300, height: 450 }, anchor = { x: 160, y: 300 };
  const left = [{ x: -1536, y: -100, width: 1536, height: 864 }, { x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(dragPosition(origin, anchor, { x: 110, y: 300 }, left), { x: -40, y: 200 });
  assert.deepEqual(dragPosition(origin, anchor, { x: -20, y: 300 }, left), { x: -170, y: 200 });
  const vertical = [{ x: -100, y: -900, width: 1600, height: 900 }, { x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(dragPosition(origin, anchor, { x: 160, y: -10 }, vertical), { x: 10, y: -110 });
  const overlap = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1800, y: 100, width: 1536, height: 864 }];
  assert.deepEqual(dragPosition({ ...origin, x: 1600 }, { x: 1750, y: 300 }, { x: 1850, y: 300 }, overlap), { x: 1700, y: 200 });
});

test("a disconnected screen or empty display gap recovers to a real work area", () => {
  const areas = [{ x: -1280, y: 0, width: 1280, height: 900 }, { x: 700, y: 0, width: 1280, height: 900 }];
  const origin = { x: 0, y: 100, width: 300, height: 450 };
  assert.deepEqual(dragPosition(origin, { x: 0, y: 0 }, { x: 250, y: 0 }, areas), { x: 700, y: 100 });
  assert.deepEqual(dragPosition(origin, { x: 0, y: 0 }, { x: 5000, y: 3000 }, areas), { x: 1680, y: 450 });
  assert.throws(() => dragPosition(origin, { x: 0, y: 0 }, { x: 1, y: 1 }, []), /显示器/);
});
