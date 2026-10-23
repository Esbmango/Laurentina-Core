'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { desktopPaths, backendEnvironment, closeKeepsRunning, voiceInterpreter } = require('./desktop_platform.cjs');

test('Mac app writes data outside the bundle and selects the bundled interpreter', () => {
  const root = path.resolve('Applications/Laurentina.app/Contents/Resources/app');
  const resourcesPath = path.dirname(root), appData = path.resolve('home/Library/Application Support');
  const result = desktopPaths({ root, resourcesPath, appData, platform: 'darwin', env: {}, exists: () => true });
  assert.equal(result.data, path.join(appData, 'LaurentinaCore/Core'));
  assert.equal(result.python, path.join(resourcesPath, 'python/bin/python3'));
  assert.equal(result.data.startsWith(root), false);
});
test('source Mac and Windows keep their own virtual environment layout', () => {
  const root = path.resolve('workspace/laurentina-core');
  const opts = { root, appData: 'unused', env: {}, exists: () => false };
  assert.equal(desktopPaths({ ...opts, platform: 'darwin' }).python, path.resolve(root, '../hy-memory-starter/.venv/bin/python'));
  const win = desktopPaths({ ...opts, platform: 'win32' });
  assert.equal(win.python, path.resolve(root, '../hy-memory-starter/.venv/Scripts/python.exe'));
  assert.equal(win.data, path.join(root, '.local'));
});
test('explicit runtime/data overrides and caller environment survive without mutation', () => {
  const env = { LAURENTINA_CORE_DATA: path.resolve('test-data'), LAURENTINA_CORE_PYTHON: 'explicit-python', PYTHONPATH: 'inherited', SSL_CERT_FILE: 'explicit-ca' };
  const paths = desktopPaths({ root: path.resolve('core'), appData: 'unused', platform: 'darwin', env });
  const value = backendEnvironment({ root: path.resolve('core'), data: paths.data, python: paths.python, env, exists: () => true });
  assert.equal(paths.python, 'explicit-python');
  assert.equal(value.PYTHONPATH, undefined);
  assert.equal(value.LAURENTINA_MEMORY_PYTHON, 'explicit-python');
  assert.equal(value.SSL_CERT_FILE, 'explicit-ca');
  assert.equal(env.PYTHONPATH, 'inherited');
});
test('Mac close keeps background tasks and companion alive; Windows close exits', () => {
  assert.equal(closeKeepsRunning('darwin'), true);
  assert.equal(closeKeepsRunning('win32'), false);
});
test('Mac touch audio uses the writable optional voice runtime, preserving Windows installs', () => {
  const root = path.resolve('Applications/Laurentina.app/Contents/Resources/app'), data = path.resolve('home/data');
  assert.equal(voiceInterpreter(data, {root, platform:'darwin', env:{}}), path.join(data,'runtimes/.voice-venv/bin/python'));
  assert.equal(voiceInterpreter(data, {root, platform:'win32', env:{}}), path.join(root,'.voice-venv/Scripts/python.exe'));
});
