'use strict';

const path = require('node:path');
const fs = require('node:fs');

function desktopPaths({ root, appData, resourcesPath, platform = process.platform, env = process.env, exists = fs.existsSync }) {
  const data = path.resolve(env.LAURENTINA_CORE_DATA || (platform === 'darwin'
    ? path.join(appData, 'LaurentinaCore', 'Core') : path.join(root, '.local')));
  const bundled = resourcesPath && path.join(resourcesPath, 'python', 'bin', 'python3');
  const python = env.LAURENTINA_CORE_PYTHON || (platform === 'darwin' && bundled && exists(bundled)
    ? bundled : path.resolve(root, '../hy-memory-starter/.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
  return { data, python, avatarRuntimes: path.join(data, 'avatar-runtimes') };
}

function backendEnvironment({ root, data, python, env = process.env, exists = fs.existsSync }) {
  const value = { ...env };
  for (const key of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', '__PYVENV_LAUNCHER__', 'ELECTRON_RUN_AS_NODE']) delete value[key];
  value.LAURENTINA_CORE_HOME = root;
  value.LAURENTINA_MEMORY_HOME = value.LAURENTINA_MEMORY_HOME || path.resolve(root, '../hy-memory-starter');
  value.LAURENTINA_CORE_DATA = data;
  value.LAURENTINA_CORE_PYTHON = python;
  value.LAURENTINA_MEMORY_PYTHON = value.LAURENTINA_MEMORY_PYTHON || python;
  // Standalone Python uses certifi's pinned, installed CA store for HTTPS.
  const ca = path.resolve(path.dirname(python), '../lib/python3.12/site-packages/certifi/cacert.pem');
  if (!value.SSL_CERT_FILE && exists(ca)) value.SSL_CERT_FILE = ca;
  return value;
}

function closeKeepsRunning(platform = process.platform) { return platform === 'darwin'; }

function voiceInterpreter(data, {root = __dirname, platform = process.platform, env = process.env} = {}) {
  return env.LAURENTINA_VOICE_PYTHON || (platform === 'darwin'
    ? path.join(data, 'runtimes/.voice-venv/bin/python') : path.join(root, '.voice-venv/Scripts/python.exe'));
}

module.exports = { desktopPaths, backendEnvironment, closeKeepsRunning, voiceInterpreter };
