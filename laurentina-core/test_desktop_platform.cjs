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

test('Mac native window verification observes hide and reopen while its renderer and backend stay alive', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname,'desktop.cjs'),'utf8'), records=[];
  class Window {
    constructor() {
      this.events=new Map();this.visible=false;
      this.webContents={on(){},setWindowOpenHandler(){},isDestroyed:()=>false};
    }
    on(name,callback){this.events.set(name,callback);}
    once(name,callback){this.on(name,callback);}
    async loadURL() { this.events.get('ready-to-show')(); }
    show(){this.visible=true;this.events.get('show')?.();}
    hide(){this.visible=false;this.events.get('hide')?.();}
    isVisible(){return this.visible;}
    focus(){}
    close(){this.events.get('close')({preventDefault:()=>{this.closePrevented=true;}});}
  }
  const context=vm.createContext({window:null,ROOT:__dirname,MAIN_URL:'laurentina://app/index.html',
    path,BrowserWindow:Window,screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1440,height:900}})},
    backend:{killed:false},quitting:false,closeKeepsRunning:()=>true,
    recordNativeVerification:value=>records.push(structuredClone(value)),log(){}});
  vm.runInContext(source.slice(source.indexOf('async function createWindow('),source.indexOf('if (!app.requestSingleInstanceLock()')),context);
  await context.createWindow();
  context.window.close();context.window.show();
  assert.equal(context.window.closePrevented,true);
  assert.deepEqual(records.map(item=>[item.event,item.visible,item.renderer_alive,item.backend_alive]),[
    ['main-shown',true,true,true],['main-hidden',false,true,true],['main-shown',true,true,true],
  ]);
});
test('Mac touch audio uses the writable optional voice runtime, preserving Windows installs', () => {
  const root = path.resolve('Applications/Laurentina.app/Contents/Resources/app'), data = path.resolve('home/data');
  assert.equal(voiceInterpreter(data, {root, platform:'darwin', env:{}}), path.join(data,'runtimes/.voice-venv/bin/python'));
  assert.equal(voiceInterpreter(data, {root, platform:'win32', env:{}}), path.join(root,'.voice-venv/Scripts/python.exe'));
});
