"use strict";

// Resource packages contain data only. They never supply executable renderer code.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { imageInfo, dimensions } = require("./companion.cjs");
const LIMITS = Object.freeze({ archive: 128 * 1024 ** 2, expanded: 256 * 1024 ** 2, file: 64 * 1024 ** 2, media: 25 * 1024 ** 2, count: 2000, characters: 100 });
const MIMES = Object.freeze({ ".json": "application/json", ".moc3": "application/octet-stream", ".skel": "application/octet-stream", ".atlas": "text/plain", ".png": "image/png", ".apng": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".webm": "video/webm", ".txt": "text/plain", ".md": "text/plain" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSIONS = ["3.8", "4.0", "4.1", "4.2"];
const fail = message => { throw new Error(message); };
function modelZoom(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < .5 || value > 8) fail("人物缩放可设置为 50% 到 800%。");
  return Math.round(value * 100) / 100;
}
function savedView(item) { try { return { zoom: modelZoom(item.view?.zoom ?? 1) }; } catch { return { zoom: 1 }; } }
function publicItem(item) {
  const result = { ...structuredClone(item), view: savedView(item) };
  const explicit = item.touch_animation_explicit ?? Object.hasOwn(item.stateMap || {}, "touch");
  result.touch_animation_explicit = explicit;
  if (!explicit) result.stateMap = { ...result.stateMap, touch: stateDefaults(result.animations || []).touch };
  return result;
}

function checkedDirectory(parent, target) {
  const absoluteParent = path.resolve(parent), absoluteTarget = path.resolve(target);
  if (path.dirname(absoluteTarget) !== absoluteParent) fail("角色删除路径校验失败。");
  const stat = fs.lstatSync(absoluteTarget), realParent = fs.realpathSync(absoluteParent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(absoluteTarget)) !== realParent) fail("角色删除路径校验失败。");
  return absoluteTarget;
}
function checkedTree(directory) {
  const pending = [directory]; let count = 0;
  while (pending.length) {
    const parent = pending.pop();
    for (const name of fs.readdirSync(parent)) {
      if (++count > LIMITS.count * 2 + 1) fail("角色删除路径校验失败。");
      const target = path.join(parent, name), stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail("角色删除路径校验失败。");
      if (stat.isDirectory()) pending.push(checkedDirectory(parent, target));
    }
  }
}

// Only remove this import's exact direct child; never recursively follow a replaced link.
function removeImportDirectory(root, target, id) {
  if (!UUID.test(id)) fail("角色导入清理路径无效。");
  const absoluteRoot = path.resolve(root), absoluteTarget = path.resolve(target);
  if (path.dirname(absoluteTarget) !== absoluteRoot || ![id, `.import-${id}`].includes(path.basename(absoluteTarget))) fail("角色导入清理路径无效。");
  let stat; try { stat = fs.lstatSync(absoluteTarget); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (stat.isSymbolicLink()) { fs.unlinkSync(absoluteTarget); return; }
  const realRoot = fs.realpathSync(absoluteRoot), realTarget = fs.realpathSync(absoluteTarget);
  if (path.dirname(realTarget) !== realRoot || !stat.isDirectory()) fail("角色导入清理路径校验失败。");
  fs.rmSync(realTarget, { recursive: true });
}

function safePath(value, directory = false) {
  if (typeof value !== "string" || !value || value.length > 500 || /[\\\x00-\x1f\x7f:%?#]/.test(value) || value.startsWith("/") || value.normalize("NFC") !== value) fail("角色包包含不安全的文件路径。");
  const parts = (directory && value.endsWith("/") ? value.slice(0, -1) : value).split("/");
  if (parts.some(p => !p || p === "." || p === ".." || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p) || /[<>"|*]/.test(p))) fail("角色包包含不安全的文件路径。");
  return parts.join("/");
}
const ext = name => path.posix.extname(name).toLowerCase();
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

function unzip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.archive || bytes.length < 22) fail("ZIP 文件无效或超过 128 MB。");
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail("不支持分卷、加密或不完整的 ZIP。");
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), length = bytes.readUInt32LE(end + 12);
  if (count !== bytes.readUInt16LE(end + 8) || count < 1 || count > LIMITS.count || start + length !== end || start === 0xffffffff) fail("ZIP 文件目录无效或文件数量过多。");
  const files = new Map(), names = new Set(), regions = []; let cursor = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail("ZIP 文件目录损坏。");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42), attributes = bytes.readUInt32LE(cursor + 38);
    if (cursor + 46 + nameLength + extra + comment > end || flags & 0x2041 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34)) fail("不支持此 ZIP 的加密或压缩方式。");
    const raw = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name; try { name = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { fail("ZIP 文件名必须使用 UTF-8 编码。"); }
    const directory = name.endsWith("/"), normalized = safePath(name, directory), folded = normalized.toLowerCase();
    if (names.has(folded)) fail("ZIP 中存在重复或大小写冲突的文件。");
    names.add(folded);
    const mode = (attributes >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) fail("角色包不能包含链接或特殊文件。");
    if (directory && size) fail("ZIP 目录内容无效。");
    if (size > LIMITS.file || (total += size) > LIMITS.expanded || (size > 1024 ** 2 && size > Math.max(1, compressed) * 1000)) fail("角色包解压后过大，请精简资源。");
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail("ZIP 文件头不一致。");
    const ln = bytes.readUInt16LE(local + 26), le = bytes.readUInt16LE(local + 28), dataStart = local + 30 + ln + le, dataEnd = dataStart + compressed;
    if (dataEnd > start || !bytes.subarray(local + 30, local + 30 + ln).equals(raw)) fail("ZIP 文件数据范围无效。");
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size)) fail("ZIP 文件大小不一致。");
    regions.push([local, dataEnd]);
    cursor += 46 + nameLength + extra + comment;
    if (directory) continue;
    if (!MIMES[ext(name)]) fail("角色包只允许模型、图片、视频和说明文件，不允许脚本或程序。");
    let content; try { content = method === 0 ? bytes.subarray(dataStart, dataEnd) : zlib.inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, size) }); } catch { fail("ZIP 数据解压失败或超出大小限制。"); }
    if (content.length !== size || crc32(content) !== crc) fail("ZIP 校验失败，资源可能已损坏。");
    files.set(normalized, Buffer.from(content));
  }
  if (cursor !== end) fail("ZIP 文件目录长度无效。");
  regions.sort((a, b) => a[0] - b[0]);
  if (regions.some((r, i) => i && r[0] < regions[i - 1][1])) fail("ZIP 文件数据存在重叠。");
  return files;
}

function jsonFile(files, name) {
  const bytes = files.get(name); if (!bytes || bytes.length > 16 * 1024 ** 2) fail("角色包缺少 JSON 文件或文件过大。");
  try { const value = JSON.parse(bytes.toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw 0; return value; } catch { fail("角色包包含无效的 JSON。"); }
}
function reference(files, entry, relative, expected = null) {
  const safe = safePath(relative), base = path.posix.dirname(entry), name = base === "." ? safe : `${base}/${safe}`;
  if (!files.has(name) || (expected && !expected.includes(ext(name)))) fail("角色包缺少引用资源，或资源路径、格式无效。");
  return name;
}
function validateMedia(name, bytes) {
  if (bytes.length > LIMITS.media || !bytes.length) fail("单个图片或视频请控制在 25 MB 以内。");
  const mime = MIMES[ext(name)];
  if (mime === "video/webm") { if (bytes.length < 16 || bytes.readUInt32BE(0) !== 0x1a45dfa3 || !bytes.subarray(0, Math.min(4096, bytes.length)).includes(Buffer.from("webm"))) fail("WebM 文件头无效。"); return { mime, animated: true }; }
  let info = imageInfo(bytes, mime);
  if (mime === "image/jpeg") {
    let cursor = 2, found = false;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor++] !== 255) fail("JPEG 文件结构无效。"); while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) break; const length = bytes.readUInt16BE(cursor);
      if (length < 2 || cursor + length > bytes.length) fail("JPEG 文件不完整。");
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { if (length < 8) fail("JPEG 尺寸无效。"); info = { ...info, ...dimensions(bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3)) }; found = true; break; }
      cursor += length;
    }
    if (!found) fail("JPEG 缺少有效的图像尺寸。");
  }
  if (info.width > 8192 || info.height > 8192) fail("角色纹理的宽和高请控制在 8192 像素以内。");
  return { mime, ...info };
}
function spineBinaryVersion(bytes) {
  // Spine <=3.8 stores hash + version strings; >=4.0 stores a 64-bit hash first.
  const read = start => { let cursor = start, length = 0, shift = 0; for (let i = 0; i < 5; i++) { if (cursor >= bytes.length) throw 0; const b = bytes[cursor++]; length |= (b & 127) << shift; if (!(b & 128)) { if (length < 1 || length > 100 || cursor + length - 1 > bytes.length) throw 0; return [bytes.toString("utf8", cursor, cursor + length - 1), cursor + length - 1]; } shift += 7; } throw 0; };
  for (const offset of [0, 8]) { try { let [text, next] = read(offset); if (offset === 0) [text] = read(next); if (/^\d+\.\d+\.\d+(?:[-\w.]*)?$/.test(text)) return text; } catch {} }
  fail("无法识别 Spine 骨骼版本，请使用完整的标准导出包。");
}
function atlasPages(text) {
  if (text.length > 4 * 1024 ** 2 || text.includes("\0")) fail("Spine atlas 文件过大或无效。");
  const lines = text.replace(/\r/g, "").split("\n"), pages = []; let expectPage = true;
  for (const line of lines) { const s = line.trim(); if (!s) { expectPage = true; continue; } if (expectPage) { if (s.includes(":")) fail("Spine atlas 页面路径无效。"); pages.push(s); expectPage = false; } }
  if (!pages.length || pages.length > 50) fail("Spine atlas 缺少纹理页面或页面过多。");
  return pages;
}
function stateDefaults(animations) {
  animations = Array.isArray(animations) ? animations.filter(name => typeof name === "string") : [];
  const find = words => animations.find(n => words.some(w => n.toLowerCase().includes(w))) || "";
  return { idle: find(["idle", "待机", "default", "normal"]) || animations[0] || "", speaking: find(["talk", "speak", "说话"]), thinking: find(["think", "思考"]),
    touch: animations.find(name => /^interact$/i.test(name)) || find(["touch", "interact", "点击", "触摸"]) };
}
function describe(files, preferred = null) {
  const names = [...files.keys()], live = names.filter(n => n.toLowerCase().endsWith(".model3.json"));
  const skeletons = names.filter(n => ext(n) === ".skel" || (ext(n) === ".json" && !n.endsWith(".model3.json") && jsonFile(files, n).skeleton?.spine));
  if (live.length + skeletons.length > 1) fail("一个 ZIP 请只放一个角色模型；可分别导入多个角色。");
  let result;
  if (live.length) {
    const entry = live[0], data = jsonFile(files, entry), refs = data.FileReferences;
    if (data.Version !== 3 || !refs || typeof refs !== "object" || !Array.isArray(refs.Textures) || !refs.Textures.length || refs.Textures.length > 32) fail("Live2D 必须包含完整的 Cubism model3.json、moc3 和纹理。");
    const moc = reference(files, entry, refs.Moc, [".moc3"]);
    if (files.get(moc).length < 16 || files.get(moc).toString("ascii", 0, 4) !== "MOC3") fail("Live2D moc3 文件头无效。");
    refs.Textures.forEach(n => validateMedia(reference(files, entry, n, [".png", ".webp"]), files.get(reference(files, entry, n))));
    for (const key of ["Physics", "Pose", "UserData", "DisplayInfo"]) if (refs[key]) jsonFile(files, reference(files, entry, refs[key], [".json"]));
    const animations = [], expressions = [];
    if (refs.Motions) for (const [group, motions] of Object.entries(refs.Motions)) { if (!Array.isArray(motions) || !group || group.length > 100 || /[<>"'&\x00-\x1f]/.test(group) || motions.length > 200) fail("Live2D 动作列表无效。"); motions.forEach((m, i) => { if (!m || m.Sound) fail("本版角色动作请移除内嵌 Sound 引用，再通过语音系统发声。"); jsonFile(files, reference(files, entry, m.File, [".json"])); animations.push(`${group}:${i}`); }); }
    if (refs.Expressions) { if (!Array.isArray(refs.Expressions) || refs.Expressions.length > 200) fail("Live2D 表情列表无效。"); for (const e of refs.Expressions) { if (typeof e?.Name !== "string" || !e.Name || e.Name.length > 100 || /[<>"'&\x00-\x1f]/.test(e.Name)) fail("Live2D 表情名称无效。"); jsonFile(files, reference(files, entry, e.File, [".json"])); expressions.push(e.Name); } }
    result = { kind: "live2d", entry, version: "Cubism 3–5.2", animations, expressions, stateMap: stateDefaults(animations) };
  } else if (skeletons.length) {
    const entry = skeletons[0], binary = ext(entry) === ".skel", data = binary ? null : jsonFile(files, entry), version = binary ? spineBinaryVersion(files.get(entry)) : data.skeleton.spine;
    const major = String(version).match(/^\d+\.\d+/)?.[0];
    if (!VERSIONS.includes(major) || version === "3.8.75") fail(`此角色使用 Spine ${version}；本版支持 3.8（不含 3.8.75）、4.0、4.1、4.2 标准导出。`);
    const candidates = names.filter(n => ext(n) === ".atlas"), stem = entry.slice(0, -ext(entry).length);
    const atlas = candidates.find(n => n === `${stem}.atlas`) || (candidates.length === 1 ? candidates[0] : null);
    if (!atlas) fail("Spine 包中需要匹配的 .atlas 文件。");
    for (const page of atlasPages(files.get(atlas).toString("utf8"))) { const p = reference(files, atlas, page, [".png", ".jpg", ".jpeg", ".webp"]); validateMedia(p, files.get(p)); }
    const animations = data ? Object.keys(data.animations || {}) : [];
    if (animations.some(n => n.length > 160 || /[<>"'&\x00-\x1f]/.test(n)) || animations.length > 500) fail("Spine 动作名称无效或列表过大。");
    result = { kind: "spine", entry, atlas, version, runtime: major, binary, animations, stateMap: stateDefaults(animations) };
  } else {
    const media = preferred ? [preferred] : names.filter(n => /^(image|video)\//.test(MIMES[ext(n)] || ""));
    if (media.length !== 1 || !files.has(media[0])) fail("请选择一个图片/视频，或包含一个 Live2D / Spine 角色的 ZIP。");
    const entry = media[0], info = validateMedia(entry, files.get(entry));
    result = { kind: info.mime.startsWith("video/") ? "video" : "image", entry, animations: [], stateMap: {}, ...info };
  }
  // Validate every resource before it becomes addressable, even unused textures.
  let pixels = 0;
  for (const [name, bytes] of files) { if (/^(image|video)\//.test(MIMES[ext(name)] || "")) { const image = validateMedia(name, bytes); pixels += (image.width || 0) * (image.height || 0); if (pixels > 100 * 1024 ** 2) fail("角色包纹理总像素过多，请缩小或精简纹理。"); } if (ext(name) === ".json") jsonFile(files, name); }
  return result;
}

class AvatarLibrary {
  constructor(dataDir) {
    this.root = path.resolve(dataDir, "avatars"); this.index = path.join(this.root, "library.json");
    fs.mkdirSync(this.root, { recursive: true }); this.value = { version: 1, items: [], active_id: null };
    try { if (fs.statSync(this.index).size < 32 * 1024 ** 2) { const saved = JSON.parse(fs.readFileSync(this.index, "utf8")); if (saved.version === 1 && Array.isArray(saved.items) && saved.items.length <= LIMITS.characters) { this.value.items = saved.items.filter(i => i && UUID.test(i.id) && typeof i.name === "string" && ["image", "video", "live2d", "spine"].includes(i.kind) && typeof i.entry === "string" && Array.isArray(i.files) && i.files.length <= LIMITS.count); this.value.active_id = this.value.items.some(i => i.id === saved.active_id) ? saved.active_id : null; } } } catch { /* Bad config cannot break chat startup. */ }
    this.recoverTrash();
  }
  save() { const tmp = this.index + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.index); }
  list() { return { ...structuredClone(this.value), items: this.value.items.map(publicItem) }; }
  get(id = this.value.active_id) { const item = this.value.items.find(i => i.id === id); return item ? publicItem(item) : null; }
  importFile(file, options = {}) {
    if (this.value.items.length >= LIMITS.characters) fail("角色库最多可保留 100 个角色。");
    if (typeof file !== "string" || !path.isAbsolute(file)) fail("请通过文件选择器选择角色资源。");
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.archive || !stat.size) fail("资源文件无效或大于 128 MB。");
    const bytes = fs.readFileSync(file), extension = ext(file), base = path.basename(file), files = extension === ".zip" ? unzip(bytes) : new Map([[safePath(base), bytes]]);
    if (this.value.items.reduce((n, item) => n + item.files.length, 0) + files.size > 20000) fail("角色库资源总数已达上限，请精简角色包。");
    const description = describe(files, extension === ".zip" ? null : base), id = crypto.randomUUID(), destination = path.join(this.root, id), temporary = path.join(this.root, `.import-${id}`), previousActive = this.value.active_id;
    const name = typeof options.name === "string" ? options.name.trim() : path.basename(base, extension);
    if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) fail("角色名称需为 1–100 个字符。");
    const item = { id, name, ...description, touch_animation_explicit: false, view: { zoom: 1 }, files: [...files.keys()].map(name => ({ path: name, mime: MIMES[ext(name)], size: files.get(name).length, sha256: crypto.createHash("sha256").update(files.get(name)).digest("hex") })), created_at: new Date().toISOString() };
    try { fs.mkdirSync(temporary); for (const [name, content] of files) { const output = path.join(temporary, ...name.split("/")); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content, { flag: "wx", mode: 0o600 }); } fs.renameSync(temporary, destination); this.value.items.push(item); this.value.active_id = id; this.save(); } catch (error) { this.value.items = this.value.items.filter(i => i.id !== id); this.value.active_id = previousActive; removeImportDirectory(this.root, temporary, id); removeImportDirectory(this.root, destination, id); throw error; }
    return structuredClone(item);
  }
  select(id) { if (id !== null && !this.value.items.some(i => i.id === id)) fail("角色不存在，请重新选择。"); const previous = this.value.active_id; this.value.active_id = id; try { this.save(); } catch (error) { this.value.active_id = previous; throw error; } return this.get(); }
  configure(payload) {
    if (!payload || typeof payload !== "object" || Object.keys(payload).some(k => !["id", "idle_animation", "speaking_animation", "thinking_animation", "touch_animation", "animations", "zoom"].includes(k))) fail("角色动作设置格式无效。");
    const index = this.value.items.findIndex(i => i.id === payload.id); if (index < 0) fail("角色不存在。"); const previous = this.value.items[index], item = structuredClone(previous);
    item.view = savedView(item);
    if (payload.zoom !== undefined) item.view.zoom = modelZoom(payload.zoom);
    // Binary skeleton animation names become known after the official runtime parses them.
    if (payload.animations !== undefined) {
      if (item.kind !== "spine" || !item.binary || !Array.isArray(payload.animations) || payload.animations.length > 500 || payload.animations.some(n => typeof n !== "string" || n.length > 160 || /[<>"'&\x00-\x1f]/.test(n))) fail("角色动作列表无效。");
      const explicit = item.touch_animation_explicit ?? Object.hasOwn(item.stateMap || {}, "touch");
      item.animations = [...new Set(payload.animations)]; const defaults = stateDefaults(item.animations);
      item.stateMap = { ...defaults, ...item.stateMap }; if (!explicit) item.stateMap.touch = defaults.touch;
      item.touch_animation_explicit = explicit;
    }
    for (const [field, state] of [["idle_animation", "idle"], ["speaking_animation", "speaking"], ["thinking_animation", "thinking"], ["touch_animation", "touch"]]) if (payload[field] !== undefined) { if (typeof payload[field] !== "string" || (payload[field] && !item.animations.includes(payload[field]))) fail("请选择角色已有的动作。"); item.stateMap ||= {}; item.stateMap[state] = payload[field]; if (state === "touch") item.touch_animation_explicit = true; }
    this.value.items[index] = item; try { this.save(); } catch (error) { this.value.items[index] = previous; throw error; } return structuredClone(item);
  }
  recoverTrash() {
    // A crash after the resource rename but before inventory commit is reversible.
    try {
      checkedDirectory(path.dirname(this.root), this.root);
      const trash = checkedDirectory(this.root, path.join(this.root, ".trash"));
      for (const token of fs.readdirSync(trash).slice(0, 1000)) {
        if (!UUID.test(token)) continue;
        try {
          const transaction = checkedDirectory(trash, path.join(trash, token)), journal = path.join(transaction, "record.json");
          const stat = fs.lstatSync(journal); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 ** 2) continue;
          const record = JSON.parse(fs.readFileSync(journal, "utf8"));
          if (record.state !== "pending" || !UUID.test(record.id) || !this.value.items.some(item => item.id === record.id)) continue;
          const source = path.join(this.root, record.id); if (fs.existsSync(source)) continue;
          const resources = checkedDirectory(transaction, path.join(transaction, "resources")); checkedTree(resources);
          fs.renameSync(resources, source); record.state = "restored";
          fs.writeFileSync(journal, JSON.stringify(record, null, 2), { mode: 0o600 });
        } catch { /* Keep recoverable resources in place when a path or disk is unavailable. */ }
      }
    } catch { /* Missing trash never blocks startup. */ }
  }
  delete(id) {
    if (typeof id !== "string" || !UUID.test(id)) fail("角色资源标识无效。");
    const item = this.get(id); if (!item) fail("角色不存在。");
    checkedDirectory(path.dirname(this.root), this.root);
    const source = checkedDirectory(this.root, path.join(this.root, id)); checkedTree(source);
    const trash = path.join(this.root, ".trash");
    if (!fs.existsSync(trash)) fs.mkdirSync(trash, { mode: 0o700 });
    checkedDirectory(this.root, trash);
    const transaction = path.join(trash, crypto.randomUUID()); fs.mkdirSync(transaction, { mode: 0o700 }); checkedDirectory(trash, transaction);
    const resources = path.join(transaction, "resources"), journal = path.join(transaction, "record.json");
    const previous = this.value, activeDeleted = previous.active_id === id;
    const record = { version: 1, state: "pending", id, item, deleted_at: new Date().toISOString(), was_active: activeDeleted };
    let moved = false;
    try {
      fs.writeFileSync(journal, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
      checkedDirectory(this.root, source); checkedDirectory(trash, transaction);
      fs.renameSync(source, resources); moved = true;
      this.value = { ...previous, items: previous.items.filter(entry => entry.id !== id), active_id: activeDeleted ? null : previous.active_id };
      this.save();
    } catch (error) {
      this.value = previous;
      try {
        if (moved) {
          if (fs.existsSync(source)) fail("角色删除恢复路径已被占用。");
          checkedDirectory(trash, transaction); checkedDirectory(transaction, resources);
          fs.renameSync(resources, source);
        }
        if (fs.existsSync(journal)) fs.unlinkSync(journal);
        fs.rmdirSync(transaction);
      } catch (rollbackError) { throw new Error(`${error.message}；角色资源保留在本机回收区，重新启动后会尝试恢复。`, { cause: rollbackError }); }
      throw error;
    }
    record.state = "deleted";
    try { fs.writeFileSync(journal, JSON.stringify(record, null, 2), { mode: 0o600 }); } catch { /* Inventory commit is authoritative; pending trash remains safely removed. */ }
    return { id, active_id: this.value.active_id, active_deleted: activeDeleted, trashed: true };
  }
  resolveAsset(id, relative) {
    if (typeof id !== "string" || !UUID.test(id)) fail("角色资源标识无效。");
    const name = safePath(relative), item = this.value.items.find(i => i.id === id), record = item?.files.find(f => f.path === name);
    if (!record) fail("角色资源不存在。");
    const directory = path.join(this.root, id), target = path.join(directory, ...name.split("/")), realRoot = fs.realpathSync(directory), actual = fs.realpathSync(target);
    if (!realRoot.startsWith(fs.realpathSync(this.root) + path.sep) || fs.lstatSync(directory).isSymbolicLink() || !actual.startsWith(realRoot + path.sep) || fs.lstatSync(target).isSymbolicLink() || !fs.statSync(actual).isFile() || fs.statSync(actual).size !== record.size) fail("角色资源校验失败。");
    return { path: actual, mime: record.mime, size: record.size };
  }
}

module.exports = { AvatarLibrary, LIMITS, MIMES, safePath, unzip, describe, spineBinaryVersion, atlasPages, crc32 };
