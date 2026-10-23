'use strict';
// Render the code-native app tile around the approved transparent brand mark.
// Run with the project Electron executable, then run build_brand_assets.py.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const root = __dirname;
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 512, height: 512, useContentSize: true,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      offscreen: true, backgroundThrottling: false } });
  try {
    const mark = fs.readFileSync(path.join(root, 'assets/logo-v1-mark.png')).toString('base64');
    const svg = fs.readFileSync(path.join(root, 'assets/logo-v1-desktop.svg'), 'utf8')
      .replace('href="logo-v1-mark.png"', `href="data:image/png;base64,${mark}"`);
    const html = '<!doctype html><style>html,body{margin:0;width:512px;height:512px;background:transparent;overflow:hidden}</style>' + svg;
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const icon = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
    if (icon.getSize().width !== 512 || icon.getSize().height !== 512) throw new Error('Unexpected icon render size');
    fs.writeFileSync(path.join(root, 'assets/logo-v1-desktop.png'), icon.toPNG());
    process.stdout.write(JSON.stringify({ rendered: 'assets/logo-v1-desktop.png', size: icon.getSize() }) + '\n');
  } finally { window.destroy(); app.quit(); }
}).catch(error => { process.stderr.write(error.message + '\n'); app.exit(1); });
