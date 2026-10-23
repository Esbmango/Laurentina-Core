'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { dragPosition } = require('./companion.cjs');
const source = fs.readFileSync(path.join(__dirname, 'desktop.cjs'), 'utf8');

test('native drag samples the full monitor union and keeps nominal dimensions across a seam', () => {
  const origin = { x: 1500, y: 200, width: 450, height: 675 }, cursorAtStart = { x: 1650, y: 300 };
  let cursor = { ...cursorAtStart }, actual = { ...origin }, monitorSamples = 0;
  const sizes = [];
  const screen = {
    getCursorScreenPoint: () => cursor,
    getAllDisplays: () => { monitorSamples++; return [
      { scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { scaleFactor: 1.5, workArea: { x: 1920, y: -80, width: 1536, height: 824 } },
    ]; },
    getDisplayNearestPoint: () => { throw new Error('A single-monitor drag clamp creates an air wall'); },
  };
  const context = vm.createContext({ screen, dragPosition,
    companionDrag: { cursor: cursorAtStart, bounds: origin, size: { width: 450, height: 675 }, started: Date.now(), moved: false },
    orbWindow: { isDestroyed: () => false, getBounds: () => ({ ...actual }), setBounds: value => { actual = { ...value }; sizes.push({ width: value.width, height: value.height }); } },
    endCompanionDrag: () => { throw new Error('A live drag must remain active'); },
  });
  vm.runInContext(source.slice(source.indexOf('function updateCompanionDrag('), source.indexOf('function validateImportedImage(')), context);
  for (let delta = 15; delta <= 900; delta += 15) {
    cursor = { x: cursorAtStart.x + delta, y: cursorAtStart.y };
    context.updateCompanionDrag();
    assert.equal(actual.x, origin.x + delta, `window stops following the cursor at ${cursor.x}`);
    assert.equal(actual.y, origin.y);
  }
  for (let delta = 885; delta >= -600; delta -= 15) {
    cursor = { x: cursorAtStart.x + delta, y: cursorAtStart.y };
    context.updateCompanionDrag(); assert.equal(actual.x, origin.x + delta);
  }
  assert.ok(monitorSamples > 100);
  assert.ok(sizes.every(size => size.width === 450 && size.height === 675));
});
