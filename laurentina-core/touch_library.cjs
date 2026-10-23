'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { voiceInterpreter } = require('./desktop_platform.cjs');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ITEMS = 50, MAX_INPUT = 20 * 1024 ** 2, MAX_WAV = 3 * 1024 ** 2, MAX_CONFIG = 512 * 1024;
const line = value => { if (typeof value !== 'string' || value.length > 300 || value.includes('\0')) throw new Error('触碰台词最多 300 字。'); return value.trim(); };
function checkedItem(item) {
  if (!item || !ID.test(item.id) || typeof item.audio !== 'boolean' || typeof item.name !== 'string' || !item.name || item.name.length > 100 || item.name.includes('\0')) throw new Error('触碰回应配置无效。');
  const text = line(item.text);
  if ((!item.audio && !text) || (item.audio && (!Number.isFinite(item.duration) || item.duration < .15 || item.duration > 60))) throw new Error('触碰回应配置无效。');
  return { id: item.id, name: item.name, text, audio: item.audio, ...(item.audio ? { duration: item.duration } : {}) };
}
function wavInfo(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 44 || stat.size > MAX_WAV) throw new Error('录音无效。');
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('录音无效。');
  let format = false, size = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) throw new Error('录音无效。');
    if (name === 'fmt ') {
      if (length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 24000 || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) throw new Error('录音无效。');
      format = true;
    }
    if (name === 'data') { if (size !== null || length % 2) throw new Error('录音无效。'); size = length; }
    offset = start + length + (length & 1);
  }
  const duration = size / 48000;
  if (!format || size === null || duration < .15 || duration > 60) throw new Error('录音无效。');
  return { duration, sample_rate: 24000 };
}
class TouchLibrary {
  constructor(dataDir, { normalize } = {}) {
    this.root = path.resolve(dataDir, 'touch-audio'); fs.mkdirSync(this.root, { recursive: true });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('录音目录不能是链接。');
    this.realRoot = fs.realpathSync(this.root); this.file = path.join(this.root, 'library.json');
    this.normalize = normalize || this.decode.bind(this); this.value = { enabled: true, items: [] };
    if (fs.existsSync(this.file)) {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG) throw new Error('触碰回应配置无效。');
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof saved.enabled !== 'boolean' || !Array.isArray(saved.items) || saved.items.length > MAX_ITEMS) throw new Error('触碰回应配置无效。');
      const items = saved.items.map(checkedItem); if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('触碰回应配置无效。');
      this.value = { enabled: saved.enabled, items };
    }
  }
  ensureRoot() {
    const stat = fs.lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(this.root) !== this.realRoot) throw new Error('录音路径无效。');
  }
  save() {
    this.ensureRoot(); const temporary = path.join(this.root, `.inventory-${crypto.randomUUID()}.tmp`);
    let created = false;
    try { fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); created = true; fs.renameSync(temporary, this.file); }
    finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  public(item) { return { ...item, audio_url: item.audio ? `laurentina-touch://audio/${item.id}.wav` : null }; }
  list() { return { enabled: this.value.enabled, items: this.value.items.map(item => this.public(item)) }; }
  configure(payload) {
    if (!payload || typeof payload.enabled !== 'boolean' || Object.keys(payload).some(key => key !== 'enabled')) throw new Error('触碰开关无效。');
    const old = this.value.enabled; this.value.enabled = payload.enabled;
    try { this.save(); } catch (error) { this.value.enabled = old; throw error; } return this.list();
  }
  addText(text) { text = line(text); if (!text) throw new Error('请填写触碰台词。'); return this.add({ id: crypto.randomUUID(), name: text.slice(0, 40), text, audio: false }); }
  add(item) {
    if (this.value.items.length >= MAX_ITEMS) throw new Error('触碰回应最多 50 条，请先移除不需要的回应。');
    item = checkedItem(item); if (this.value.items.some(existing => existing.id === item.id)) throw new Error('触碰回应配置无效。');
    this.value.items.push(item); try { this.save(); } catch (error) { this.value.items.pop(); throw error; } return this.public(item);
  }
  async importFile(source, text = '') {
    this.ensureRoot(); text = line(text);
    if (this.value.items.length >= MAX_ITEMS) throw new Error('触碰回应最多 50 条，请先移除不需要的回应。');
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('请选择 20 MB 内的 WAV、MP3、FLAC 或 OGG。');
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_INPUT || !['.wav', '.mp3', '.flac', '.ogg'].includes(path.extname(source).toLowerCase())) throw new Error('请选择 20 MB 内的 WAV、MP3、FLAC 或 OGG。');
    const id = crypto.randomUUID(), output = path.join(this.root, `${id}.wav`), temporary = path.join(this.root, `${id}.import.wav`);
    if (fs.existsSync(output) || fs.existsSync(temporary)) throw new Error('录音目标已存在，请重试。');
    let normalized = false, copied = false, committed = false;
    try {
      normalized = true; const meta = await this.normalize(source, temporary); this.ensureRoot();
      if (!meta || !Number.isFinite(meta.duration) || meta.duration < .15 || meta.duration > 60) throw new Error('录音无效。');
      const actual = wavInfo(temporary); if (Math.abs(actual.duration - meta.duration) > .05) throw new Error('录音无效。');
      fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL); copied = true;
      const item = this.add({ id, name: path.basename(source).slice(0, 100), text, audio: true, duration: actual.duration }); committed = true;
      try { fs.unlinkSync(temporary); } catch { /* A leftover staging file never invalidates a committed recording. */ }
      return item;
    } catch (error) {
      this.ensureRoot();
      for (const [file, owned] of [[temporary, normalized], [output, copied && !committed]]) if (owned && fs.existsSync(file)) fs.unlinkSync(file);
      throw error;
    }
  }
  decode(source, output) {
    const python = voiceInterpreter(path.dirname(this.root));
    if (!fs.existsSync(python)) return Promise.reject(new Error('请先安装本地语音环境。'));
    return new Promise((resolve, reject) => {
      const child = spawn(python, ['-E', '-s', '-X', 'utf8', path.join(__dirname, 'touch_audio_import.py'), source, output], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let raw = ''; const timeout = setTimeout(() => child.kill(), 45000);
      child.stdout.on('data', data => { raw += data; if (raw.length > 10000) child.kill(); }); child.stderr.resume();
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); try { const value = JSON.parse(raw); if (code || value.error) throw new Error(value.error || '录音读取失败。'); resolve(value); } catch (error) { reject(error); } });
    });
  }
  asset(id) {
    this.ensureRoot(); if (!ID.test(id) || !this.value.items.some(item => item.id === id && item.audio)) throw new Error('录音不存在。');
    const file = path.join(this.root, `${id}.wav`), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WAV || path.dirname(fs.realpathSync(file)) !== this.realRoot) throw new Error('录音路径无效。');
    return file;
  }
  delete(id) {
    this.ensureRoot(); if (!ID.test(id)) throw new Error('回应不存在。');
    const index = this.value.items.findIndex(item => item.id === id); if (index < 0) throw new Error('回应不存在。');
    const item = this.value.items[index]; let source, destination;
    if (item.audio && fs.existsSync(path.join(this.root, `${id}.wav`))) {
      source = this.asset(id); const trash = path.join(this.root, '.trash');
      if (!fs.existsSync(trash)) fs.mkdirSync(trash, { mode: 0o700 });
      const stat = fs.lstatSync(trash);
      if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(trash)) !== this.realRoot) throw new Error('录音路径无效。');
      destination = path.join(trash, `${id}-${crypto.randomUUID()}.wav`); fs.renameSync(source, destination);
    }
    this.value.items.splice(index, 1);
    try { this.save(); }
    catch (error) {
      this.value.items.splice(index, 0, item);
      if (destination) { this.ensureRoot(); if (fs.existsSync(source)) throw new Error('录音恢复路径已被占用，原录音保留在本机回收区。', { cause: error }); fs.renameSync(destination, source); }
      throw error;
    }
    return { ok: true, id };
  }
  choose() {
    if (!this.value.enabled) return null;
    const items = this.value.items;
    if (!items.length) return { text: '我在。', audio: false };
    const choices = items.length > 1 ? items.filter(item => item.id !== this.lastChoice) : items;
    const item = choices[crypto.randomInt(choices.length)];
    this.lastChoice = item.id;
    return this.public(item);
  }
}
module.exports = { TouchLibrary };
