"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), zlib = require("node:zlib");
const { AvatarLibrary, unzip, safePath, crc32, describe, spineBinaryVersion } = require("./avatar_library.cjs");
const png = fs.readFileSync(path.join(__dirname, "assets/icon.png"));
function removeTestDirectory(root) { const resolved = path.resolve(root), parent = fs.realpathSync(os.tmpdir()); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("la-avatar-test-") || fs.lstatSync(resolved).isSymbolicLink() || path.dirname(fs.realpathSync(resolved)) !== parent) throw new Error("Unsafe test cleanup path"); fs.rmSync(resolved, { recursive: true, force: true }); }
function zip(entries) {
  const locals = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), content = Buffer.from(entry.content || ""), method = entry.method ?? 8, packed = method === 8 ? zlib.deflateRawSync(content) : content;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(entry.crc ?? crc32(content), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(entry.size ?? content.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(entry.crc ?? crc32(content), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(entry.size ?? content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(entry.attributes ?? 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); directory.push(central, name); offset += local.length + name.length + packed.length;
  }
  const data = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(data.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, data, end]);
}
const spineFiles = version => [{ name: "char/actor.json", content: JSON.stringify({ skeleton: { spine: version }, bones: [{ name: "root" }], animations: { idle: {}, talk: {} } }) }, { name: "char/actor.atlas", content: "actor.png\nsize: 1024,1024\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nregion\n  rotate: false\n" }, { name: "char/actor.png", content: png }];
test("ZIP stored and deflated payloads validate CRC and preserve UTF-8 paths", () => { const map = unzip(zip([{ name: "角色/a.txt", content: "hello", method: 0 }, { name: "角色/b.txt", content: "world" }])); assert.equal(map.get("角色/a.txt").toString(), "hello"); assert.equal(map.get("角色/b.txt").toString(), "world"); });
test("ZIP traversal, drive, UNC and unsafe Windows names are rejected", () => { for (const name of ["../a.png", "C:/a.png", "/a.png", "\\\\server\\a.png", "a/../b.png", "CON.txt", "a./b.png", "a%2f.png", "a?.png"]) assert.throws(() => unzip(zip([{ name, content: png }]))); });
test("ZIP duplicate and case folded aliases are rejected", () => { assert.throws(() => unzip(zip([{ name: "A.png", content: png }, { name: "a.png", content: png }]))); });
test("ZIP symbolic links and special files are rejected", () => { assert.throws(() => unzip(zip([{ name: "link.txt", content: "elsewhere", attributes: (0xa1ff << 16) >>> 0 }]))); });
test("ZIP executable and active content is rejected", () => { for (const name of ["a.js", "a.html", "a.svg", "a.exe", "a.dll", "a.zip"]) assert.throws(() => unzip(zip([{ name, content: "not run" }]))); });
test("ZIP corrupt checksums and declared bombs are rejected", () => { assert.throws(() => unzip(zip([{ name: "x.txt", content: "hi", crc: 0 }]))); assert.throws(() => unzip(zip([{ name: "x.txt", content: "hi", size: 99 * 1024 ** 2 }]))); });
test("ZIP local/central inconsistent paths fail", () => { const bytes = zip([{ name: "a.txt", content: "hi" }]); bytes[30] = 98; assert.throws(() => unzip(bytes)); });
test("ZIP incomplete archive and unknown compression fail", () => { assert.throws(() => unzip(zip([{ name: "x.txt", content: "hi" }]).subarray(0, -1))); assert.throws(() => unzip(zip([{ name: "x.txt", content: "hi", method: 99 }]))); });
test("Spine JSON, atlas and textures select matching runtime", () => { for (const version of ["3.8.99", "4.0.64", "4.1.24", "4.2.45"]) { const item = describe(unzip(zip(spineFiles(version)))); assert.equal(item.kind, "spine"); assert.equal(item.runtime, version.slice(0, 3)); assert.equal(item.stateMap.idle, "idle"); assert.deepEqual(item.animations, ["idle", "talk"]); } });
test("Spine mismatched or unsupported versions fail honestly", () => { for (const version of ["3.6.0", "3.8.75", "4.3.1", "unknown"]) assert.throws(() => describe(unzip(zip(spineFiles(version))))); });
test("Spine atlas external and traversal pages fail", () => { for (const page of ["https://remote/texture.png", "../texture.png", "/texture.png"]) { const entries = spineFiles("4.2.40"); entries[1].content = `${page}\nsize: 10,10\n`; assert.throws(() => describe(unzip(zip(entries)))); } });
test("Spine binary header version distinguishes 3.8 and 4.2", () => { const str = text => Buffer.concat([Buffer.from([text.length + 1]), Buffer.from(text)]); assert.equal(spineBinaryVersion(Buffer.concat([str("hash"), str("3.8.99"), Buffer.alloc(20)])), "3.8.99"); assert.equal(spineBinaryVersion(Buffer.concat([Buffer.alloc(8), str("4.2.45"), Buffer.alloc(20)])), "4.2.45"); assert.throws(() => spineBinaryVersion(Buffer.from("corrupt"))); });
test("Live2D references validate before activation", () => { const model = { Version: 3, FileReferences: { Moc: "model.moc3", Textures: ["texture.png"], Motions: { Idle: [{ File: "idle.motion3.json" }] } } }; const map = new Map([["char/model.model3.json", Buffer.from(JSON.stringify(model))], ["char/model.moc3", Buffer.concat([Buffer.from("MOC3"), Buffer.alloc(20)])], ["char/texture.png", png], ["char/idle.motion3.json", Buffer.from("{}")]]); const item = describe(map); assert.equal(item.kind, "live2d"); assert.equal(item.stateMap.idle, "Idle:0"); map.delete("char/model.moc3"); assert.throws(() => describe(map)); });
test("Live2D remote references and embedded sound fail", () => { for (const moc of ["https://remote/a.moc3", "../a.moc3"]) { const map = new Map([["model.model3.json", Buffer.from(JSON.stringify({ Version: 3, FileReferences: { Moc: moc, Textures: ["a.png"] } }))], ["a.png", png]]); assert.throws(() => describe(map)); } });
test("multiple character packages fail instead of guessing a model", () => { const entries = spineFiles("4.2.40"); entries.push({ name: "other.json", content: entries[0].content }); assert.throws(() => describe(unzip(zip(entries)))); });
test("library import, safe resolution, selection and reload preserve character", t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root)); const input = path.join(root, "avatar.png"); fs.writeFileSync(input, png); const library = new AvatarLibrary(root), item = library.importFile(input); assert.equal(library.list().active_id, item.id); assert.equal(library.resolveAsset(item.id, item.entry).mime, "image/png"); assert.equal(new AvatarLibrary(root).get().id, item.id); assert.throws(() => library.resolveAsset(item.id, "../library.json")); assert.throws(() => library.resolveAsset(item.id, "not-present.png")); library.select(null); assert.equal(library.get(), null); library.select(item.id); assert.equal(library.get().id, item.id); });
test("invalid import never activates or leaves a partially imported character", t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root)); const input = path.join(root, "broken.zip"); fs.writeFileSync(input, zip([{ name: "a.js", content: "no" }])); const library = new AvatarLibrary(root); assert.throws(() => library.importFile(input)); assert.equal(library.list().items.length, 0); assert.deepEqual(fs.readdirSync(path.join(root, "avatars")), []); });
test("animation configuration rejects arbitrary names and survives reload", t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root)); const input = path.join(root, "spine.zip"); fs.writeFileSync(input, zip(spineFiles("4.2.40"))); const library = new AvatarLibrary(root), item = library.importFile(input); library.configure({ id: item.id, speaking_animation: "talk" }); assert.equal(new AvatarLibrary(root).get().stateMap.speaking, "talk"); assert.throws(() => library.configure({ id: item.id, idle_animation: "https://no" })); });
test("per-character zoom persists independently and preserves exact imported assets", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "spine.zip"); fs.writeFileSync(input, zip(spineFiles("3.8.99")));
  const library = new AvatarLibrary(root), first = library.importFile(input), second = library.importFile(input);
  const changed = library.configure({ id: first.id, zoom: 1.736, speaking_animation: "talk" });
  assert.equal(changed.view.zoom, 1.74); assert.equal(changed.stateMap.speaking, "talk");
  assert.equal(new AvatarLibrary(root).get(first.id).view.zoom, 1.74); assert.equal(library.get(second.id).view.zoom, 1);
  assert.deepEqual(changed.files, first.files);
  assert.deepEqual(fs.readFileSync(library.resolveAsset(first.id, "char/actor.png").path), png);
  for (const value of [.49, 8.01, null, "2", NaN]) assert.throws(() => library.configure({ id: first.id, zoom: value }));
  assert.equal(library.get(first.id).view.zoom, 1.74);
  library.configure({ id: first.id, zoom: 8 }); assert.equal(new AvatarLibrary(root).get(first.id).view.zoom, 8);
  library.configure({ id: first.id, zoom: 1.74 });
  library.save = () => { throw new Error("simulated full disk"); };
  assert.throws(() => library.configure({ id: first.id, zoom: 2 }), /simulated full disk/);
  assert.equal(library.get(first.id).view.zoom, 1.74);
});
test("legacy manifests get a default zoom without rewriting saved resources", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "avatar.png"); fs.writeFileSync(input, png); const library = new AvatarLibrary(root), item = library.importFile(input);
  delete library.value.items[0].view; library.save(); const before = fs.readFileSync(library.index);
  const loaded = new AvatarLibrary(root); assert.equal(loaded.get(item.id).view.zoom, 1); assert.equal(loaded.list().items[0].view.zoom, 1);
  assert.deepEqual(fs.readFileSync(library.index), before);
});
test("media cannot disguise arbitrary data as PNG or WebM", () => { assert.throws(() => describe(new Map([["x.png", Buffer.from("not png")]]), "x.png")); assert.throws(() => describe(new Map([["x.webm", Buffer.from("not video")]]), "x.webm")); });

test("failed save restores active character and removes only the new import", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "avatar.png"); fs.writeFileSync(input, png); const library = new AvatarLibrary(root), original = library.importFile(input);
  library.save = () => { throw new Error("simulated full disk"); };
  assert.throws(() => library.importFile(input), /simulated full disk/);
  assert.equal(library.get().id, original.id); assert.equal(library.list().items.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, "avatars")).sort(), [original.id, "library.json"].sort());
  assert.equal(new AvatarLibrary(root).get().id, original.id);
});

test("asset resolution rejects a replaced avatar directory junction", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "avatar.png"); fs.writeFileSync(input, png); const library = new AvatarLibrary(root), original = library.importFile(input);
  const folder = path.join(root, "avatars", original.id), moved = path.join(root, "saved-character");
  fs.renameSync(folder, moved); fs.symlinkSync(moved, folder, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => library.resolveAsset(original.id, original.entry), /校验失败/);
  fs.unlinkSync(folder); fs.renameSync(moved, folder);
});

test("JPEG dimensions are recognized and oversized JPEG fails", () => {
  const jpeg = (w, h) => { const b = Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0,255,217]); b.writeUInt16BE(h,7); b.writeUInt16BE(w,9); return b; };
  assert.equal(describe(new Map([["x.jpg", jpeg(32,64)]]), "x.jpg").width, 32);
  assert.throws(() => describe(new Map([["x.jpg", jpeg(9000,64)]]), "x.jpg"));
});

test("Live2D rejects unsafe animation labels and embedded motion sound", () => {
  const base = { Version: 3, FileReferences: { Moc: "a.moc3", Textures: ["a.png"], Motions: { Idle: [{ File: "a.motion3.json" }] } } };
  const files = data => new Map([["a.model3.json", Buffer.from(JSON.stringify(data))], ["a.moc3", Buffer.concat([Buffer.from("MOC3"), Buffer.alloc(20)])], ["a.png", png], ["a.motion3.json", Buffer.from("{}")]]);
  const sound = structuredClone(base); sound.FileReferences.Motions.Idle[0].Sound = "voice.wav"; assert.throws(() => describe(files(sound)), /Sound/);
  const unsafe = structuredClone(base); unsafe.FileReferences.Motions = { "<unsafe>": [{ File: "a.motion3.json" }] }; assert.throws(() => describe(files(unsafe)), /动作列表/);
});

test("touch animation uses an exact existing motion and persists independently", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "spine.zip"); fs.writeFileSync(input, zip(spineFiles("3.8.99"))); const library = new AvatarLibrary(root), item = library.importFile(input);
  library.configure({ id: item.id, touch_animation: "talk", zoom: 8 });
  const saved = new AvatarLibrary(root).get(); assert.equal(saved.stateMap.touch, "talk"); assert.equal(saved.stateMap.idle, "idle"); assert.equal(saved.view.zoom, 8);
  assert.throws(() => library.configure({ id: item.id, touch_animation: "missing" }));
  library.configure({ id: item.id, touch_animation: "" }); assert.equal(library.get().stateMap.touch, "");
});
test('legacy manifests get Interact suggestions without writes or changing explicit choices',t=>{
  const f=deletionFixture(t),item=f.library.value.items[0];item.animations=['Idle','Interact','Special'];item.stateMap={idle:'Idle'};delete item.touch_animation_explicit;f.library.save();
  const before=fs.readFileSync(f.library.index),loaded=new AvatarLibrary(f.root);
  assert.equal(loaded.get(item.id).stateMap.touch,'Interact');assert.equal(loaded.get(item.id).touch_animation_explicit,false);assert.deepEqual(fs.readFileSync(f.library.index),before);
  loaded.configure({id:item.id,touch_animation:'Special'});assert.equal(new AvatarLibrary(f.root).get(item.id).stateMap.touch,'Special');
  loaded.configure({id:item.id,touch_animation:''});assert.equal(new AvatarLibrary(f.root).get(item.id).stateMap.touch,'');
});
test('binary animation discovery preserves configured state mappings and fills only automatic touch defaults',t=>{
  const f=deletionFixture(t),item=f.library.value.items[0];item.binary=true;item.animations=[];item.stateMap={idle:'',speaking:'Special'};item.touch_animation_explicit=false;
  const configured=f.library.configure({id:item.id,animations:['Idle','Interact','Special']});
  assert.equal(configured.stateMap.touch,'Interact');assert.equal(configured.stateMap.speaking,'Special');
  f.library.configure({id:item.id,touch_animation:''});
  assert.equal(f.library.configure({id:item.id,animations:['Idle','Interact','Special']}).stateMap.touch,'');
});

function deletionFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-avatar-test-")); t.after(() => removeTestDirectory(root));
  const input = path.join(root, "original.zip"); fs.writeFileSync(input, zip(spineFiles("3.8.99"))); const inputBytes = fs.readFileSync(input);
  const library = new AvatarLibrary(root), first = library.importFile(input), second = library.importFile(input);
  return { root, input, inputBytes, library, first, second };
}
test("deleting the active character soft-deletes only its imported resources and clears selection", t => {
  const f = deletionFixture(t), result = f.library.delete(f.second.id);
  assert.deepEqual(result, { id: f.second.id, active_id: null, active_deleted: true, trashed: true });
  assert.equal(f.library.get(), null); assert.equal(f.library.get(f.second.id), null); assert.equal(new AvatarLibrary(f.root).get(f.first.id).id, f.first.id);
  assert.throws(() => f.library.resolveAsset(f.second.id, f.second.entry));
  assert.deepEqual(fs.readFileSync(f.input), f.inputBytes);
  const trash = path.join(f.library.root, ".trash"), transactions = fs.readdirSync(trash); assert.equal(transactions.length, 1);
  const transaction = path.join(trash, transactions[0]), record = JSON.parse(fs.readFileSync(path.join(transaction, "record.json"), "utf8"));
  assert.equal(record.id, f.second.id); assert.equal(record.state, "deleted");
  assert.deepEqual(fs.readFileSync(path.join(transaction, "resources", "char", "actor.png")), png);
  assert.deepEqual(fs.readFileSync(f.library.resolveAsset(f.first.id, "char/actor.png").path), png);
});
test("deleting an inactive character preserves the active one and rejects invalid IDs", t => {
  const f = deletionFixture(t); assert.equal(f.library.delete(f.first.id).active_id, f.second.id); assert.equal(f.library.get().id, f.second.id);
  for (const id of [null, "", "../avatars", "00000000-0000-4000-8000-000000000000", f.first.id]) assert.throws(() => f.library.delete(id));
  assert.equal(new AvatarLibrary(f.root).get().id, f.second.id);
});
test("failed inventory commit restores the exact folder, selection and saved inventory", t => {
  const f = deletionFixture(t), before = fs.readFileSync(f.library.index);
  f.library.save = () => { throw new Error("simulated full disk"); };
  assert.throws(() => f.library.delete(f.second.id), /simulated full disk/);
  assert.equal(f.library.get().id, f.second.id); assert.equal(new AvatarLibrary(f.root).get().id, f.second.id);
  assert.deepEqual(fs.readFileSync(f.library.index), before); assert.deepEqual(fs.readFileSync(f.library.resolveAsset(f.second.id, "char/actor.png").path), png);
  assert.deepEqual(fs.readdirSync(path.join(f.library.root, ".trash")), []);
});
test("a locked resource folder never changes inventory or another character", t => {
  const f = deletionFixture(t), originalRename = fs.renameSync, source = path.join(f.library.root, f.second.id), before = fs.readFileSync(f.library.index);
  fs.renameSync = (from, to) => { if (from === source) throw new Error("simulated sharing violation"); return originalRename(from, to); };
  try { assert.throws(() => f.library.delete(f.second.id), /sharing violation/); } finally { fs.renameSync = originalRename; }
  assert.deepEqual(fs.readFileSync(f.library.index), before); assert.equal(f.library.get().id, f.second.id); assert.equal(f.library.get(f.first.id).id, f.first.id);
});
test("delete refuses source, trash and nested junctions without touching their target", t => {
  const f = deletionFixture(t), outside = path.join(f.root, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "keep.txt"), "untouched");
  const folder = path.join(f.library.root, f.second.id), saved = path.join(f.root, "saved-resources"), type = process.platform === "win32" ? "junction" : "dir";
  fs.renameSync(folder, saved); fs.symlinkSync(outside, folder, type);
  assert.throws(() => f.library.delete(f.second.id), /路径校验失败/); fs.unlinkSync(folder); fs.renameSync(saved, folder);
  const trash = path.join(f.library.root, ".trash"); fs.symlinkSync(outside, trash, type);
  assert.throws(() => f.library.delete(f.second.id), /路径校验失败/); fs.unlinkSync(trash);
  const nested = path.join(folder, "nested"); fs.symlinkSync(outside, nested, type);
  assert.throws(() => f.library.delete(f.second.id), /路径校验失败/); fs.unlinkSync(nested);
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "untouched"); assert.deepEqual(fs.readdirSync(outside), ["keep.txt"]); assert.equal(f.library.get().id, f.second.id);
});
test("startup restores a moved folder only when the deletion inventory was not committed", t => {
  const f = deletionFixture(t), trash = path.join(f.library.root, ".trash"), transaction = path.join(trash, require("node:crypto").randomUUID());
  fs.mkdirSync(transaction, { recursive: true }); fs.writeFileSync(path.join(transaction, "record.json"), JSON.stringify({ version: 1, state: "pending", id: f.second.id }));
  fs.renameSync(path.join(f.library.root, f.second.id), path.join(transaction, "resources"));
  const restarted = new AvatarLibrary(f.root); assert.equal(restarted.get().id, f.second.id); assert.deepEqual(fs.readFileSync(restarted.resolveAsset(f.second.id, "char/actor.png").path), png);
  assert.equal(JSON.parse(fs.readFileSync(path.join(transaction, "record.json"), "utf8")).state, "restored");
  restarted.delete(f.second.id);
  const deleted = fs.readdirSync(trash).map(name => path.join(trash, name)).find(dir => fs.existsSync(path.join(dir, "resources")));
  const recordPath = path.join(deleted, "record.json"), record = JSON.parse(fs.readFileSync(recordPath, "utf8")); record.state = "pending"; fs.writeFileSync(recordPath, JSON.stringify(record));
  assert.equal(new AvatarLibrary(f.root).get(f.second.id), null); assert.ok(fs.existsSync(path.join(deleted, "resources")));
});
