'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// A minimal DOM verifies that a locale toggle changes UI labels while leaving
// private messages and imported content untouched. No real user data is read.
function fixture() {
  function text(value) { return { nodeType: 3, nodeValue: value, parentElement: null }; }
  function element(tag = 'DIV', { protectedContent = false, attrs = {}, children = [] } = {}) {
    const node = { nodeType: 1, tagName: tag, children, protectedContent, attrs: { ...attrs },
      closest(selector) {
        if (selector.startsWith('[data-user-content')) {
          for (let p = this; p; p = p.parentElement) if (p.protectedContent) return p;
        }
        return null;
      },
      getAttribute(name) { return this.attrs[name] || null; },
      setAttribute(name, value) { this.attrs[name] = value; },
    };
    for (const child of children) child.parentElement = node;
    return node;
  }
  const label = text('新对话');
  const userText = text('新对话');
  const privateText = text('找到 3 条相关记忆');
  const dynamic = text('找到 3 条相关记忆');
  const name = text('已导入 我的角色.zip，保存后生效。');
  const animationName = text('说话动画'), followIdle = text('跟随待机动画');
  const input = element('INPUT', { attrs: { placeholder: '和劳纶缇娜说些什么…' } });
  const body = element('BODY', { children: [element('BUTTON', { children: [label] }), element('DIV', { protectedContent: true, children: [userText, privateText] }), element('DIV', { children: [dynamic, name] }), input,
    element('SELECT', { children: [element('OPTION', { protectedContent: true, children: [animationName] }), element('OPTION', { children: [followIdle] })] })] });
  const document = { body, documentElement: {}, createTreeWalker(root) {
    const nodes = []; const visit = node => { for (const child of node.children || []) { nodes.push(child); visit(child); } }; visit(root);
    let index = -1; return { nextNode() { index++; this.currentNode = nodes[index]; return Boolean(this.currentNode); } };
  } };
  const context = vm.createContext({ window: {}, document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'ui/i18n.js'), 'utf8'), context);
  return { api: context.window.I18n, label, userText, privateText, dynamic, name, input, animationName, followIdle };
}
test('language switches UI and dynamic counts without altering private content', () => {
  const f = fixture(); f.api.start(); f.api.setLanguage('en');
  assert.equal(f.label.nodeValue, 'New chat');
  assert.equal(f.dynamic.nodeValue, 'Found 3 matching memories');
  assert.equal(f.userText.nodeValue, '新对话');
  assert.equal(f.privateText.nodeValue, '找到 3 条相关记忆');
  assert.equal(f.name.nodeValue, 'Imported 我的角色.zip. Save to apply.');
  assert.equal(f.input.attrs.placeholder, 'Message 劳纶缇娜…');
  assert.equal(f.animationName.nodeValue, '说话动画');
  assert.equal(f.followIdle.nodeValue, 'Follow idle animation');
  f.api.setLanguage('zh');
  assert.equal(f.label.nodeValue, '新对话');
  assert.equal(f.dynamic.nodeValue, '找到 3 条相关记忆');
  assert.equal(f.input.attrs.placeholder, '和劳纶缇娜说些什么…');
  assert.equal(f.animationName.nodeValue, '说话动画');
  assert.equal(f.followIdle.nodeValue, '跟随待机动画');
});
test('changing status text and repeated locale toggles preserve its original meaning', () => {
  const f = fixture(); f.api.setLanguage('en');
  f.label.nodeValue = '已完成'; f.api.apply();
  assert.equal(f.label.nodeValue, 'Completed');
  f.api.setLanguage('zh'); assert.equal(f.label.nodeValue, '已完成');
  f.api.setLanguage('en'); assert.equal(f.label.nodeValue, 'Completed');
  assert.equal(f.api.translate('已导入 {count} 个技能', { count: 4 }), 'Imported 4 skills');
});
test('HTML exposes locale/theme/project/avatar/skill controls without duplicate IDs or missing literal references', () => {
  const html = fs.readFileSync(path.join(__dirname, 'ui/index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const required of ['new-project', 'project-list', 'theme-toggle', 'language-toggle', 'voice-input-mode', 'avatar-library', 'import-avatar-package', 'avatar-speaking-animation', 'avatar-thinking-animation', 'skills-view', 'chat-skill', 'work-skill']) assert.ok(ids.includes(required));
  const js = ['app.js', 'workspace.js'].map(name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8')).join('\n');
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]) || match[1] === 'secret-popup', `missing #${match[1]}`);
  assert.ok(!html.includes('从一句话开始，慢慢了解彼此。'));
  assert.ok(!html.includes('陪伴，从了解开始。'));
});

function avatarFixture(current) {
  const nodes = new Map(), calls = [];
  function node() { return { options: [], value: '', dataset: {}, disabled: false,
    replaceChildren() { this.options = []; }, append(option) { this.options.push(option); } }; }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const source = fs.readFileSync(path.join(__dirname, 'ui/workspace.js'), 'utf8');
  const context = vm.createContext({ $, state: { avatarLibrary: { active_id: current.id, items: [current] } },
    el: (_tag, _className, text) => ({ ...node(), textContent: text }), tr: text => text,
    rpc: async (action, payload) => calls.push({ action, payload: structuredClone(payload) }),
    loadAvatarLibrary: async () => {}, feedback: () => {}, errorText: error => error.message });
  vm.runInContext(source.slice(source.indexOf('function avatarAnimationNames('), source.indexOf('function renderAvatarLibrary(')), context);
  vm.runInContext(source.slice(source.indexOf('async function saveAvatarAnimations('), source.indexOf('function initializeWorkspaceUI(')), context);
  context.renderAvatarAnimationPickers(current);
  return { $, calls, save: () => context.saveAvatarAnimations() };
}

test('avatar state animation choices keep exact names and save all mappings in one request', async () => {
  const f = avatarFixture({ id: 'selected-character', kind: 'live2d', animations: ['待机', '说话动画', 'think:0'], stateMap: { idle: '待机', speaking: '', thinking: 'think:0' } });
  assert.equal(f.$('avatar-speaking-animation').value, '');
  assert.equal(f.$('avatar-speaking-animation').options[0].textContent, '跟随待机动画');
  assert.equal(f.$('avatar-thinking-animation').value, 'think:0');
  const exactName = f.$('avatar-speaking-animation').options.find(option => option.value === '说话动画');
  assert.equal(exactName.dataset.userContent, 'true');
  f.$('avatar-speaking-animation').value = '说话动画';
  f.$('avatar-thinking-animation').value = '';
  await f.save();
  assert.deepEqual(f.calls, [{ action: 'avatar.configure', payload: { id: 'selected-character', idle_animation: '待机', speaking_animation: '说话动画', thinking_animation: '', touch_animation: '' } }]);
});

test('media and models without animations disable every animation setting', async () => {
  for (const current of [{ id: 'media', kind: 'image', animations: ['irrelevant'] }, { id: 'binary-pending', kind: 'spine', animations: [] }]) {
    const f = avatarFixture(current);
    for (const id of ['avatar-idle-animation', 'avatar-speaking-animation', 'avatar-thinking-animation', 'save-avatar-animation']) assert.equal(f.$(id).disabled, true);
    await f.save(); assert.deepEqual(f.calls, []);
  }
});
