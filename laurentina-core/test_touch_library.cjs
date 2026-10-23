'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { TouchLibrary } = require('./touch_library.cjs');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function wav(seconds = .25, rate = 24000) {
  const length = Math.floor(seconds * rate) * 2, bytes = Buffer.alloc(length + 44);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length, 40); return bytes;
}
function fixture(t, normalize = async (_source, target) => { fs.writeFileSync(target, wav()); return { duration: .25, sample_rate: 24000 }; }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-touch-test-'));
  t.after(() => { const absolute = path.resolve(root); if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('la-touch-test-') || fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Unsafe test cleanup'); fs.rmSync(absolute, { recursive: true }); });
  const source = path.join(root, 'recording.wav'); fs.writeFileSync(source, wav()); const library = new TouchLibrary(root, { normalize });
  return { root, source, library };
}
test('text, enabled state and imported audio persist with isolated public URLs', async t => {
  const f = fixture(t), sourceHash = hash(f.source); const text = f.library.addText('  我在。  '), audio = await f.library.importFile(f.source, '触摸回应');
  assert.equal(text.text, '我在。'); assert.equal(text.audio_url, null); assert.match(audio.audio_url, /^laurentina-touch:\/\/audio\/[0-9a-f-]+\.wav$/);
  assert.equal(audio.duration, .25); assert.deepEqual(fs.readFileSync(f.library.asset(audio.id)), wav()); assert.equal(hash(f.source), sourceHash);
  f.library.configure({ enabled: false }); assert.equal(f.library.choose(), null);
  const restarted = new TouchLibrary(f.root); assert.equal(restarted.list().items.length, 2); assert.equal(restarted.list().enabled, false);
  restarted.configure({ enabled: true }); assert.ok([text.id, audio.id].includes(restarted.choose().id));
});
test('uploaded script-like bytes are treated as inert input and never evaluated', async t => {
  let called = false; const f = fixture(t, async (source, output) => { called = true; assert.match(fs.readFileSync(source, 'utf8'), /require\(/); fs.writeFileSync(output, wav()); return { duration: .25 }; });
  const marker = path.join(f.root, 'executed.txt'); fs.writeFileSync(f.source, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  const before = hash(f.source); await f.library.importFile(f.source); assert.equal(called, true); assert.equal(fs.existsSync(marker), false); assert.equal(hash(f.source), before);
});
test('repeated touch chooses another available line without creating an automatic loop', t => {
  const f=fixture(t); f.library.addText('第一句'); f.library.addText('第二句');
  let previous=f.library.choose().id;
  for(let i=0;i<12;i++) { const next=f.library.choose().id; assert.notEqual(next,previous);previous=next; }
  assert.equal(f.library.list().items.length,2);
});
test('text and source size, extension, duration and entry count limits are enforced', async t => {
  let calls = 0; const f = fixture(t, async (_source, target) => { calls++; fs.writeFileSync(target, wav()); return { duration: .25 }; });
  for (const text of ['', ' ', 'x'.repeat(301), '\0']) assert.throws(() => f.library.addText(text));
  for (const payload of [null, {}, { enabled: 'yes' }, { enabled: true, path: '../outside' }]) assert.throws(() => f.library.configure(payload));
  await assert.rejects(f.library.importFile('relative.wav')); await assert.rejects(f.library.importFile(f.root));
  const bad = path.join(f.root, 'script.exe'); fs.writeFileSync(bad, 'not run'); await assert.rejects(f.library.importFile(bad));
  const large = path.join(f.root, 'large.wav'); fs.writeFileSync(large, ''); fs.truncateSync(large, 20 * 1024 ** 2 + 1); await assert.rejects(f.library.importFile(large)); assert.equal(calls, 0);
  for (let i = 0; i < 50; i++) f.library.addText('回应 ' + i);
  assert.throws(() => f.library.addText('超过限制')); await assert.rejects(f.library.importFile(f.source)); assert.equal(calls, 0);
});
test('invalid normalizer output never activates a recording or changes an existing file', async t => {
  const f = fixture(t), original = f.library.addText('keep'), sourceHash = hash(f.source);
  const cases = [
    { bytes: wav(), duration: .1 }, { bytes: wav(), duration: 61 }, { bytes: wav(), duration: NaN },
    { bytes: wav(), duration: 1 }, { bytes: Buffer.from('executable bytes'), duration: .25 }, { bytes: wav(.25, 44100), duration: .25 },
  ];
  for (const value of cases) {
    f.library.normalize = async (_source, target) => { fs.writeFileSync(target, value.bytes); return { duration: value.duration }; };
    await assert.rejects(f.library.importFile(f.source)); assert.equal(f.library.list().items.length, 1);
    assert.equal(f.library.list().items[0].id, original.id); assert.equal(hash(f.source), sourceHash);
    assert.deepEqual(fs.readdirSync(f.library.root), ['library.json']);
  }
});
test('failed configuration, text and audio saves restore inventory and clean only their new files', async t => {
  const f = fixture(t), existing = await f.library.importFile(f.source), existingHash = hash(f.library.asset(existing.id)), before = fs.readFileSync(f.library.file);
  f.library.save = () => { throw new Error('simulated full disk'); };
  assert.throws(() => f.library.configure({ enabled: false }), /full disk/); assert.equal(f.library.list().enabled, true);
  assert.throws(() => f.library.addText('new'), /full disk/); await assert.rejects(f.library.importFile(f.source), /full disk/);
  assert.deepEqual(fs.readFileSync(f.library.file), before); assert.equal(f.library.list().items.length, 1); assert.equal(hash(f.library.asset(existing.id)), existingHash);
  assert.deepEqual(fs.readdirSync(f.library.root).sort(), [existing.id + '.wav', 'library.json'].sort());
});
test('failed atomic rename preserves the previous inventory and does not reuse the old fixed tmp file', t => {
  const f = fixture(t); f.library.addText('saved'); const before = fs.readFileSync(f.library.file), marker = path.join(f.library.root, 'library.json.tmp'); fs.writeFileSync(marker, 'untouched');
  const rename = fs.renameSync; fs.renameSync = (from, to) => { if (to === f.library.file) throw new Error('simulated rename failure'); return rename(from, to); };
  try { assert.throws(() => f.library.addText('failed'), /rename failure/); } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(f.library.file), before); assert.equal(fs.readFileSync(marker, 'utf8'), 'untouched'); assert.equal(f.library.list().items.length, 1);
  assert.equal(fs.readdirSync(f.library.root).some(name => name.startsWith('.inventory-')), false);
});
test('UUID collisions cannot overwrite or remove an already imported recording', async t => {
  const f = fixture(t), existing = await f.library.importFile(f.source), before = hash(f.library.asset(existing.id)), randomUUID = crypto.randomUUID;
  crypto.randomUUID = () => existing.id;
  try { await assert.rejects(f.library.importFile(f.source), /已存在/); } finally { crypto.randomUUID = randomUUID; }
  assert.equal(hash(f.library.asset(existing.id)), before); assert.equal(f.library.list().items.length, 1);
});
test('audio deletion moves only its own file and preserves the original upload and other entries', async t => {
  const f = fixture(t), first = await f.library.importFile(f.source), second = await f.library.importFile(f.source), before = hash(f.source), secondHash = hash(f.library.asset(second.id));
  assert.deepEqual(f.library.delete(first.id), { ok: true, id: first.id }); assert.throws(() => f.library.asset(first.id));
  assert.equal(hash(f.source), before); assert.equal(hash(f.library.asset(second.id)), secondHash); assert.equal(new TouchLibrary(f.root).list().items.length, 1);
  assert.equal(fs.readdirSync(path.join(f.library.root, '.trash')).length, 1);
  for (const id of ['../outside', '-'.repeat(36), '', first.id]) assert.throws(() => f.library.delete(id));
});
test('delete inventory failure restores the original audio bytes and selected response inventory', async t => {
  const f = fixture(t), audio = await f.library.importFile(f.source), file = f.library.asset(audio.id), before = hash(file), inventory = fs.readFileSync(f.library.file);
  f.library.save = () => { throw new Error('simulated delete save failure'); };
  assert.throws(() => f.library.delete(audio.id), /delete save failure/); assert.equal(hash(file), before);
  assert.deepEqual(fs.readFileSync(f.library.file), inventory); assert.equal(new TouchLibrary(f.root).list().items[0].id, audio.id);
});
test('a locked recording fails deletion before changing its inventory', async t => {
  const f = fixture(t), audio = await f.library.importFile(f.source), file = f.library.asset(audio.id), before = fs.readFileSync(f.library.file), rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (from === file) throw new Error('simulated recording lock'); return rename(from, to); };
  try { assert.throws(() => f.library.delete(audio.id), /recording lock/); } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(f.library.file), before); assert.ok(fs.existsSync(file)); assert.equal(f.library.list().items[0].id, audio.id);
});
test('asset IDs, replaced root junctions and trash junctions cannot escape the recording directory', async t => {
  const f = fixture(t), audio = await f.library.importFile(f.source), outside = path.join(f.root, 'outside'), saved = path.join(f.root, 'saved-root'), type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'untouched');
  for (const id of ['../keep', '-'.repeat(36), crypto.randomUUID(), audio.id + '/..']) assert.throws(() => f.library.asset(id));
  const trash = path.join(f.library.root, '.trash'); fs.symlinkSync(outside, trash, type);
  try { assert.throws(() => f.library.delete(audio.id), /路径无效/); } finally { fs.unlinkSync(trash); }
  fs.renameSync(f.library.root, saved); fs.symlinkSync(outside, f.library.root, type);
  try {
    assert.throws(() => f.library.asset(audio.id), /路径无效/); assert.throws(() => f.library.addText('not outside'), /路径无效/);
    await assert.rejects(f.library.importFile(f.source), /路径无效/); assert.throws(() => f.library.delete(audio.id), /路径无效/);
  } finally { fs.unlinkSync(f.library.root); fs.renameSync(saved, f.library.root); }
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'untouched'); assert.deepEqual(fs.readdirSync(outside), ['keep.txt']);
});
test('saved inventories reject oversized, duplicate or malformed records', t => {
  const f = fixture(t), item = f.library.addText('valid'), record = { id: item.id, name: item.name, text: item.text, audio: false };
  for (const items of [[record, record], [{ ...record, id: '-'.repeat(36) }], [{ ...record, text: 'x'.repeat(301) }], Array(51).fill(record)]) {
    fs.writeFileSync(f.library.file, JSON.stringify({ enabled: true, items })); assert.throws(() => new TouchLibrary(f.root));
  }
  fs.writeFileSync(f.library.file, ''); fs.truncateSync(f.library.file, 512 * 1024 + 1); assert.throws(() => new TouchLibrary(f.root), /配置无效/);
});
test('the real CPU runtime normalizes the existing Chinese fixture without changing the source', { skip: !fs.existsSync(path.join(__dirname, '.voice-venv', 'Scripts', 'python.exe')) || !fs.existsSync(path.join(__dirname, '.local', 'verification', 'v06-voice', 'zh-cold.wav')) }, async t => {
  const f = fixture(t), library = new TouchLibrary(f.root), source = path.join(__dirname, '.local', 'verification', 'v06-voice', 'zh-cold.wav'), before = hash(source);
  const item = await library.importFile(source, 'CPU test'), data = fs.readFileSync(library.asset(item.id));
  assert.equal(data.readUInt32LE(24), 24000); assert.equal(data.readUInt16LE(22), 1); assert.equal(data.readUInt16LE(34), 16);
  assert.equal(hash(source), before); assert.ok(item.duration >= .15 && item.duration <= 60);
  const disguised = path.join(f.root, 'inert.wav'), marker = path.join(f.root, 'not-executed.txt');
  fs.writeFileSync(disguised, `open(${JSON.stringify(marker)}, 'w').write('not audio')`);
  await assert.rejects(library.importFile(disguised)); assert.equal(fs.existsSync(marker), false);
  assert.equal(library.list().items.length, 1);
});
