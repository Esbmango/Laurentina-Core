"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Q = require("./ui/avatars/render_quality.js");
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test("render backing store follows fractional DPR and page zoom within a pixel budget", () => {
  for (const dpr of [1, 1.25, 2, 3]) {
    const size = Q.pixelSize(270, 320, dpr);
    assert.equal(size.width, Math.floor(270 * dpr)); assert.equal(size.height, Math.floor(320 * dpr)); assert.equal(size.capped, false);
  }
  const large = Q.pixelSize(2000, 2000, 3);
  assert.ok(large.width * large.height <= Q.MAX_PIXELS); assert.equal(large.capped, true);
  const limited = Q.pixelSize(270, 320, 3, { width: 512, height: 512, pixels: Q.MAX_PIXELS });
  assert.ok(limited.width <= 512 && limited.height <= 512);
});

test("Spine 3.8 instance resize follows changing DPR without reallocating identical frames", () => {
  let dpr = 1, writes = 0, w = 270, h = 320;
  const canvas = { clientWidth: 270, clientHeight: 320, get width() { return w; }, set width(value) { w = value; writes++; }, get height() { return h; }, set height(value) { h = value; writes++; } };
  const gl = { MAX_VIEWPORT_DIMS: 1, MAX_RENDERBUFFER_SIZE: 2, getParameter(key) { return key === 1 ? [4096, 4096] : 4096; }, viewport(...args) { this.lastViewport = args; } };
  const camera = { setViewport(width, height) { this.viewportWidth = width; this.viewportHeight = height; }, update() {} };
  const original = () => {}, renderer = { canvas, context: { gl }, camera, resize: original };
  const untouched = { resize: original }, modes = { Expand: 1, Fit: 2 };
  const restore = Q.installSpine38Resize(renderer, modes, () => dpr);
  renderer.resize(modes.Expand); assert.equal(writes, 0); assert.equal(untouched.resize, original);
  dpr = 2; renderer.resize(modes.Expand);
  assert.deepEqual([w, h], [540, 640]); assert.deepEqual(gl.lastViewport, [0, 0, 540, 640]); assert.equal(writes, 2);
  renderer.resize(modes.Expand); assert.equal(writes, 2);
  dpr = 1.25; renderer.resize(modes.Expand); assert.deepEqual([w, h], [337, 400]);
  restore(); assert.equal(renderer.resize, original);
});

test("model zoom adjusts a centered camera frame with asymmetric padding", () => {
  const viewport = { x: -100, y: -50, width: 800, height: 1000, padLeft: 10, padRight: 30, padTop: 40, padBottom: 20 };
  const center = [-110 + 840 / 2, -70 + 1060 / 2];
  for (const zoom of [.5, 1, 2, 3, 8]) {
    const frame = Q.frame(viewport, zoom);
    assert.equal(frame.width, 840 / zoom); assert.equal(frame.height, 1060 / zoom);
    assert.ok(Math.abs(frame.x + frame.width / 2 - center[0]) < 1e-9); assert.ok(Math.abs(frame.y + frame.height / 2 - center[1]) < 1e-9);
    assert.equal(frame.padLeft + frame.padRight + frame.padTop + frame.padBottom, 0);
  }
  assert.equal(viewport.padLeft, 10);
});

test("invalid or legacy saved zoom cannot break avatar startup", () => {
  for (const value of [0, .49, 8.01, NaN, Infinity, "2", null]) assert.throws(() => Q.zoom(value));
  assert.equal(Q.zoom(8), 8);
  assert.equal(Q.initialZoom({}), 1); assert.equal(Q.initialZoom({ view: { zoom: -10 } }), 1);
  assert.equal(Q.initialZoom({ view: { zoom: 1.376 } }), 1.38);
});
test('alpha masks use LSB-first bits, alpha16 and one-cell dilation without filling transparent space',()=>{
  const pixels=new Uint8Array(5*5*4);pixels[(2*5+2)*4+3]=16;pixels[3]=15;
  const mask=Q.packAlpha(pixels,5,5);const on=index=>Boolean(mask[index>>3]&(1<<(index&7)));
  assert.equal(on(0),false);assert.equal(on(24),false);
  assert.equal(Array.from({length:25},(_,i)=>on(i)).filter(Boolean).length,9);assert.equal(on(6),true);assert.equal(on(18),true);
});
test('legacy missing touch mappings suggest exact Interact while explicit disabled/custom choices stay intact',()=>{
  const names=['Idle','touch_extra','interact','Special'];
  assert.equal(Q.touchAnimation({stateMap:{idle:'Idle'}},names),'interact');
  assert.equal(Q.touchAnimation({stateMap:{touch:''}},names),null);
  assert.equal(Q.touchAnimation({touch_animation_explicit:false,stateMap:{touch:''}},names),'interact');
  assert.equal(Q.touchAnimation({touch_animation_explicit:true,stateMap:{touch:'Special'}},names),'Special');
  assert.equal(Q.touchAnimation({touch_animation_explicit:true,stateMap:{touch:'missing'}},names),null);
});
test('alpha readback is cached at four hertz, never performed by a hit query, and pauses when hidden or dragging',()=>{
  let now=0,reads=0,dragging=false;
  const pixels=new Uint8Array(96*128*4);pixels[3]=255;
  const context={setTransform(){},clearRect(){},drawImage(){},getImageData(){reads++;return{data:pixels};}};
  const browser={document:{visibilityState:'visible',body:{classList:{contains:()=>dragging}},createElement:()=>({getContext:()=>context})},performance:{now:()=>now},btoa:value=>Buffer.from(value,'binary').toString('base64')};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'ui/avatars/render_quality.js'),'utf8'),{window:browser});
  const sampler=browser.LaurentinaRenderQuality.hitMaskSampler({}, {getBoundingClientRect:()=>({x:0,y:0,width:300,height:380})});
  sampler.sample();for(let n=0;n<12;n++){now+=15;sampler.sample();sampler.get();}assert.equal(reads,1);
  now=300;browser.document.visibilityState='hidden';sampler.sample();assert.equal(reads,1);
  browser.document.visibilityState='visible';dragging=true;sampler.sample();assert.equal(reads,1);
  dragging=false;sampler.sample();assert.equal(reads,2);assert.equal(sampler.get().columns,96);
  sampler.invalidate();assert.equal(sampler.get(),null);sampler.sample();assert.equal(reads,3);
  sampler.dispose();now=1000;sampler.sample();assert.equal(reads,3);assert.equal(sampler.get(),null);
});
