'use strict';
// Exercise actual navigation and section controls with synthetic user content.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, 'ui/index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'ui/styles.css'), 'utf8');

function documentTree() {
  const stack = [], ids = new Map(), elements = [];
  const voids = new Set(['input', 'img', 'meta', 'link', 'br', 'hr', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)(\s[^<>]*?)?\s*\/?>/gi)) {
    const [raw, tag, rest = ''] = match;
    if (raw.startsWith('</')) { assert.equal(stack.pop()?.tag, tag, `unbalanced ${tag}`); continue; }
    const attrs = Object.fromEntries([...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const node = { tag, attrs, parent: stack.at(-1) };
    elements.push(node);
    if (attrs.id) { assert.equal(ids.has(attrs.id), false, `duplicate #${attrs.id}`); ids.set(attrs.id, node); }
    if (!voids.has(tag) && !raw.endsWith('/>')) stack.push(node);
  }
  assert.equal(stack.length, 0);
  return { ids, elements, within(id, ancestor) { for (let node = ids.get(id); node; node = node.parent) if (node.attrs.id === ancestor) return true; return false; } };
}

function scene() {
  const tree = documentTree(), nodes = new Map(), calls = [];
  class Node {
    constructor(attrs = {}) { this.attrs = { ...attrs }; this.dataset = { view: attrs['data-view'] }; this.hidden = false; this.value = ''; this.listeners = {}; this.children = []; this.focused = false;
      const classes = new Set((attrs.class || '').split(/\s+/)); this.classList = { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) }; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    focus() { this.focused = true; }
    async emit(name, data = {}) { for (const fn of this.listeners[name] || []) await fn({ preventDefault() {}, ...data }); }
  }
  for (const [id, node] of tree.ids) nodes.set(id, new Node(node.attrs));
  const nav = tree.elements.filter(n => n.attrs['data-view']).map(n => new Node(n.attrs));
  const $ = id => { assert.ok(nodes.has(id), `missing #${id}`); return nodes.get(id); };
  const state = { view: 'chat', memoryScope: 'private', mode: 'daily', active: null,
    drafts: new Map([['private-draft', '私人草稿：角色形象与声音']]), profile: [{ content: '关于你', scope: 'private' }],
    messages: [{ content: '共享记忆', privacy: 'private' }], character: { persona: '角色形象与声音' } };
  const helpers = ['stopVoiceConversation', 'renderConversations', 'refreshHealth', 'refreshVoice', 'refreshVoiceProfiles', 'refreshResources',
    'loadWorkRuns', 'refreshWork', 'loadProviders', 'loadCompanion', 'loadAvatarLibrary', 'loadTouchLibrary', 'loadSkills'];
  const context = vm.createContext({ state, $, document: { querySelectorAll: () => nav },
    loadMemories: async () => calls.push(['memory', state.memoryScope]), loadProfile: async () => calls.push(['profile']),
    ...Object.fromEntries(helpers.map(name => [name, () => calls.push([name])])) });
  vm.runInContext(source.slice(source.indexOf('function updateHeader('), source.indexOf('function updateComposer(')), context);
  return { context, state, $, calls, nav };
}

test('voice controls belong to character while memory/profile remain one navigable module', () => {
  const tree = documentTree();
  for (const id of ['voice-form', 'voice-profile-form', 'voice-reference-file', 'refresh-voice', 'refresh-voice-profiles']) {
    assert.equal(tree.within(id, 'character-view'), true); assert.equal(tree.within(id, 'settings-view'), false);
  }
  for (const id of ['model-form', 'resources-form', 'open-data']) assert.equal(tree.within(id, 'settings-view'), true);
  assert.equal(tree.within('profile-results', 'memory-view'), true);
  assert.equal(tree.within('memory-results', 'memory-view'), true);
  const nav = tree.elements.filter(n => n.attrs['data-view']).map(n => n.attrs['data-view']);
  assert.equal(nav.filter(name => name === 'memory').length, 1); assert.equal(nav.includes('profile'), false);
  assert.equal(tree.ids.get('companion-scale').attrs.max, '8');
});
test('character entry refreshes its moved voice panels and settings refreshes only its own services', async () => {
  const s = scene(); await s.context.showView('character');
  assert.equal(s.$('character-view').hidden, false); assert.equal(s.$('settings-view').hidden, true);
  assert.equal(s.$('view-title').textContent, '角色形象与声音');
  for (const name of ['refreshVoice', 'refreshVoiceProfiles']) assert.equal(s.calls.filter(call => call[0] === name).length, 1);
  s.calls.length = 0; await s.context.showView('settings');
  assert.deepEqual(s.calls.filter(call => /refresh/.test(call[0])).map(call => call[0]), ['refreshHealth', 'refreshResources']);
});
test('shared private and personal tabs route existing readers without rewriting any user content', async () => {
  const s = scene(), before = JSON.stringify({ drafts: [...s.state.drafts], profile: s.state.profile, messages: s.state.messages, character: s.state.character });
  await s.context.showView('memory'); assert.equal(s.state.memoryScope, 'private'); assert.equal(s.$('memory-private').attrs['aria-selected'], 'true');
  assert.equal(s.$('profile-view').hidden, true); assert.equal(s.$('memory-data-panel').hidden, false);
  await s.context.selectMemorySection('profile');
  assert.equal(s.state.memoryScope, 'private'); assert.equal(s.$('profile-view').hidden, false); assert.equal(s.$('memory-data-panel').hidden, true);
  assert.equal(s.$('remember-new').hidden, true); assert.equal(s.$('memory-profile').tabIndex, 0);
  await s.context.selectMemorySection('shared');
  assert.equal(s.state.memoryScope, 'shared'); assert.equal(s.$('memory-data-panel').hidden, false); assert.equal(s.$('remember-new').hidden, false);
  assert.deepEqual(s.calls.filter(call => ['memory', 'profile'].includes(call[0])), [['memory', 'private'], ['profile'], ['memory', 'shared']]);
  assert.equal(JSON.stringify({ drafts: [...s.state.drafts], profile: s.state.profile, messages: s.state.messages, character: s.state.character }), before);
});
test('old profile navigation selects the memory module and tab keyboard navigation wraps', async () => {
  const s = scene(); await s.context.showView('profile');
  assert.equal(s.state.view, 'memory'); assert.equal(s.$('memory-view').hidden, false); assert.equal(s.$('profile-view').hidden, false);
  assert.equal(s.nav.find(n => n.dataset.view === 'memory').classList.contains('active'), true);
  s.context.bindMemoryNavigation(); await s.$('memory-profile').emit('keydown', { key: 'ArrowRight' });
  assert.equal(s.state.memorySection, 'shared'); assert.equal(s.$('memory-shared').focused, true);
  await s.$('memory-shared').emit('keydown', { key: 'End' });
  assert.equal(s.state.memorySection, 'profile'); assert.equal(s.$('memory-profile').focused, true);
  await s.$('memory-private').emit('click'); assert.equal(s.state.memoryScope, 'private');
});

function tokens(theme) {
  const base = {}, specific = {};
  for (const match of css.matchAll(/:root(\[data-theme=light\])?\{([^}]+)\}/g)) {
    const target = match[1] ? specific : base;
    for (const prop of match[2].matchAll(/(--[\w-]+):([^;]+)/g)) target[prop[1]] = prop[2];
  }
  return theme === 'light' ? { ...base, ...specific } : base;
}
function luminance(hex) {
  let text = hex.slice(1); if (text.length === 3) text = [...text].map(c => c + c).join('');
  const channels = [0, 2, 4].map(i => parseInt(text.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
test('both ocean blue themes retain readable action and selected tab colors', () => {
  for (const theme of ['dark', 'light']) {
    const color = tokens(theme);
    for (const [a, b] of [['--accent', '--inverse'], ['--accent-strong', '--inverse'], ['--accent-ink', '--accent-soft']]) {
      const x = luminance(color[a]), y = luminance(color[b]);
      assert.ok((Math.max(x, y) + .05) / (Math.min(x, y) + .05) >= 4.5, `${theme} ${a}/${b} contrast`);
    }
    const rgb = color['--accent'].slice(1).match(/../g).map(c => parseInt(c, 16));
    assert.ok(rgb[2] > rgb[1] && rgb[1] > rgb[0], `${theme} blue accent`);
  }
});

test('new bilingual labels change while matching memory profile persona and voice names remain user text', () => {
  const nodes = [];
  function node(tagName, value, protectedClass = '', attrs = {}) {
    const element = { nodeType: 1, tagName, attrs, closest(selector) { return protectedClass && selector.includes(protectedClass) ? this : null; },
      getAttribute(name) { return this.attrs[name] || null; }, setAttribute(name, value) { this.attrs[name] = value; } };
    const text = { nodeType: 3, nodeValue: value, parentElement: element };
    nodes.push(element, text); return text;
  }
  const title = node('SPAN', '角色形象与声音'), category = node('BUTTON', '记忆分类');
  const memory = node('P', '角色形象与声音', '.memory-content'), profile = node('P', '记忆分类', '.profile-content');
  const persona = node('TEXTAREA', '角色形象与声音'), voiceName = node('STRONG', '角色形象与声音', '[data-user-content="true"]');
  const body = { nodeType: 1, tagName: 'BODY', closest: () => null, getAttribute: () => null, setAttribute() {} };
  const document = { body, documentElement: {}, createTreeWalker() { let at = -1; return { nextNode() { this.currentNode = nodes[++at]; return Boolean(this.currentNode); } }; } };
  const context = vm.createContext({ window: {}, document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'ui/i18n.js'), 'utf8'), context);
  const api = context.window.I18n; api.setLanguage('en');
  assert.equal(title.nodeValue, 'Character & voice'); assert.equal(category.nodeValue, 'Memory sections');
  assert.equal(memory.nodeValue, '角色形象与声音'); assert.equal(profile.nodeValue, '记忆分类');
  assert.equal(persona.nodeValue, '角色形象与声音'); assert.equal(voiceName.nodeValue, '角色形象与声音');
  assert.equal(api.translate('桌宠大小可设置为 50% 到 800%。'), 'Desktop companion size must be between 50% and 800%.');
  api.setLanguage('zh'); assert.equal(title.nodeValue, '角色形象与声音'); assert.equal(category.nodeValue, '记忆分类');
  assert.equal(memory.nodeValue, '角色形象与声音'); assert.equal(profile.nodeValue, '记忆分类');
});
