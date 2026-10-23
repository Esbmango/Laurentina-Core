'use strict';

const $ = (id) => document.getElementById(id);
const iconPaths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  chat: '<path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-7a8 8 0 1 1 18-3Z"/><path d="M7 10h8M7 14h5"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/>',
  settings: '<path d="m9.5 3-.6 2.3-2 .9-2.2-.7L2.2 10l1.6 1.7v2.1L2.2 15.5l2.5 4.4 2.2-.7 2 .9.6 2.1h5l.6-2.1 2-.9 2.2.7 2.5-4.4-1.6-1.7v-2.1l1.6-1.7-2.5-4.5-2.2.7-2-.9-.6-2.3h-5Z"/><circle cx="12" cy="12.5" r="3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
  arrowUp: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v3M6 12H3v8h4v-8ZM18 12h3v8h-4v-8ZM10 13v5M14 11v9"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  volumeOff: '<path d="m11 4-6 5H2v6h3l6 5V4ZM16 9l6 6M22 9l-6 6"/>',
  orb: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 4 13 4 18 0M10 13v3h4v-3"/>',
  pin: '<path d="m16 3 5 5-4 2-3 5-2-2-7 8-1-1 8-7-2-2 5-3 1-5Z"/>',
  connect: '<path d="m8 4 12 12M4 8l12 12M6 10l4-4M14 18l4-4M2 14l5 5M14 2l5 5"/>',
};

const state = {
  ready: false,
  view: 'chat',
  conversations: [],
  active: null,
  messages: [],
  modeEvents: new Map(),
  mode: 'daily',
  modeEpoch: 0,
  switchingMode: false,
  voicePreferenceSaving: false,
  voiceSettingsVersion: 0,
  settings: {},
  character: { name: '劳纶缇娜', persona: '', avatar: null },
  avatarDraft: null,
  health: {},
  profile: [],
  jobs: new Map(),
  creating: false,
  sending: false,
  loadVersion: 0,
  memoryScope: 'shared',
  memoryVersion: 0,
  profileVersion: 0,
  voice: { settings: { auto_speak: true, voice_input_mode: 'direct' } },
  resourcePreset: 'balanced',
  workRuns: [],
  workActive: null,
  workTargets: [],
  workPolls: new Set(),
  workMutating: new Set(),
  workRefreshVersion: 0,
  workStarting: false,
  workSelection: null,
  drafts: new Map(),
  pendingSecrets: new Map(),
  secretBusy: new Set(),
  secretMinimized: new Map(),
  resolvedSecrets: new Set(),
  tasksByConversation: new Map(),
  taskPolls: new Set(),
  taskMutating: new Set(),
  taskTargetRefreshes: new Set(),
  intent: 'chat',
  providers: [],
  activeProvider: 'local',
  editingProvider: null,
  providerLoading: false,
  providerPreset: null,
  companion: { mode: 'orb', visible: false, scale: 1, artwork: null },
  companionDirty: false,
};

function svg(name) {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = `<svg viewBox="0 0 24 24">${iconPaths[name] || iconPaths.spark}</svg>`;
  return wrapper;
}
function installIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => el.replaceChildren(...svg(el.dataset.icon).childNodes));
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, callback, icon) {
  const node = el('button', className);
  node.type = 'button';
  if (icon) node.append(svg(icon));
  if (label) node.append(document.createTextNode(tr(label)));
  node.addEventListener('click', callback);
  return node;
}
async function rpc(action, payload = {}) {
  if (!window.laurentina?.request) throw new Error('桌面连接尚未就绪，请重新打开劳纶缇娜。');
  return window.laurentina.request(action, payload);
}
function errorText(error) { return error?.message || String(error || '操作没有完成，请重试。'); }
let toastTimer;
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = tr(text);
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3500);
}
function showGlobalError(text) {
  const box = $('global-error');
  box.replaceChildren(svg('alert'), el('span', 'error-text', text));
  const close = button('', 'icon-button', () => { box.hidden = true; }, 'x');
  close.setAttribute('aria-label', '关闭提示');
  box.append(close);
  box.hidden = false;
}
function feedback(id, text, isError = false) {
  $(id).textContent = tr(text);
  $(id).classList.toggle('error', isError);
}
function timeText(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString(I18n.language === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' });
}
function modeName(mode) { return tr(mode === 'private' ? '私聊' : '日常'); }
function draftKey(conversation = state.active, mode = state.mode) {
  const selectedMode = conversation?.mode || mode;
  return conversation?.id ? (selectedMode === 'private' ? `${conversation.id}:private` : conversation.id) : `new:${selectedMode}`;
}
function currentModeRevision() { return state.active ? (state.active.mode_revision || 0) : state.modeEpoch; }
function stashDraft() { state.drafts.set(draftKey(), $('chat-input').value); }
function restoreDraft() { $('chat-input').value = state.drafts.get(draftKey()) || ''; resizeInput(); }
function sourceName(source) {
  return ({ core: '本地对话', codex: 'Codex', chatgpt: 'ChatGPT', hermes: 'Hermes', manual: '你添加的', user: '你添加的', core_character: '角色设置', core_manual: '你添加的', 'core-character': '角色设置', 'core-manual': '你添加的', 'core-user': '本地对话', 'user-chat': '你分享的' })[source] || (source || '记忆');
}
function absorbConversationExtras(result) {
  const id = result.conversation?.id;
  if (!id) return;
  if (Array.isArray(result.mode_events)) state.modeEvents.set(id, result.mode_events);
  if (Object.hasOwn(result, 'pending_secret')) {
    if (result.pending_secret && !state.resolvedSecrets.has(result.pending_secret.id)) state.pendingSecrets.set(id, result.pending_secret);
    else state.pendingSecrets.delete(id);
  }
  if (Array.isArray(result.tasks)) {
    state.tasksByConversation.set(id, result.tasks);
    for (const task of result.tasks) if (shouldPollTask(task)) pollChatTask(task);
  }
}
function renderSecretConfirmation() {
  const container = $('secret-confirmation');
  const pending = state.pendingSecrets.get(state.active?.id);
  container.hidden = !pending;
  if (!pending) { container.replaceChildren(); container.displayKey = null; return; }
  const minimized = state.secretMinimized.get(pending.id) === JSON.stringify([pending.preview, pending.error, pending.can_confirm]);
  const key = JSON.stringify([pending.id, pending.preview, pending.error, pending.state, pending.can_confirm, pending.reason, minimized, state.secretBusy.has(pending.id)]);
  if (container.displayKey === key) return;
  container.displayKey = key;
  container.replaceChildren();
  const summary = button(pending.can_confirm === false ? '这段先留在本地 · 记忆待确认' : '发现一件秘密 · 要记住吗？', 'secret-summary', () => { state.secretMinimized.delete(pending.id); renderSecretConfirmation(); }, 'lock');
  summary.setAttribute('aria-expanded', String(!minimized));
  summary.setAttribute('aria-controls', 'secret-popup');
  container.append(summary);
  if (minimized) return;
  const popup = el('section', 'secret-popup');
  popup.id = 'secret-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'false');
  popup.setAttribute('aria-labelledby', 'secret-popup-title');
  const heading = el('div', 'secret-heading');
  const title = el('strong', '', pending.can_confirm === false ? '这件事先留在本地' : '要替你记住这个秘密吗？');
  title.id = 'secret-popup-title';
  const minimize = button('', 'icon-button', () => minimizeSecret(), 'x');
  minimize.setAttribute('aria-label', '收起秘密提醒，继续聊天');
  heading.append(svg('lock'), title, minimize);
  popup.append(heading);
  if (pending.preview) popup.append(el('p', 'secret-preview', pending.preview));
  const guidance = pending.can_confirm === false
    ? ({ credentials: '这段含有密码或密钥，不会写入记忆。可以去掉这些内容后再告诉我。', too_long: '内容有点长。可以用短一点的话告诉我想记住的事。', needs_content: '你可以继续说，等有具体内容时再决定要不要记住。' })[pending.reason] || '你可以继续说，等有具体内容时再决定要不要记住。'
    : '保存上面的原文到私密记忆，仅在这台电脑留存。';
  popup.append(el('p', 'field-hint', guidance));
  if (pending.error) popup.append(el('p', 'form-feedback error', pending.error));
  const actions = el('div', 'inline-actions');
  const confirm = button(pending.error ? '重试保存' : '存为私密记忆', 'button primary small', () => decideSecret('confirm'), 'lock');
  const cancel = button('这次不保存', 'button secondary small', () => decideSecret('cancel'));
  confirm.disabled = cancel.disabled = state.secretBusy.has(pending.id);
  confirm.hidden = pending.can_confirm === false;
  actions.append(confirm, cancel);
  if (pending.can_confirm === false) actions.append(button('继续聊', 'button primary small', () => minimizeSecret()));
  popup.append(actions);
  container.append(popup);
}
function minimizeSecret() {
  const pending = state.pendingSecrets.get(state.active?.id);
  if (!pending || state.secretBusy.has(pending.id)) return;
  state.secretMinimized.set(pending.id, JSON.stringify([pending.preview, pending.error, pending.can_confirm]));
  renderSecretConfirmation();
  $('chat-input').focus();
}
async function decideSecret(decision, quiet = false) {
  const id = state.active?.id;
  const pending = state.pendingSecrets.get(id);
  if (!pending) return true;
  if (state.secretBusy.has(pending.id)) return false;
  state.secretBusy.add(pending.id);
  renderSecretConfirmation();
  try {
    const result = await rpc('memory.confirm', { conversation_id: id, pending_id: pending.id, decision });
    if (result.ok !== true) throw new Error(result.error || '这次操作尚未确认，请重试。');
    state.resolvedSecrets.add(pending.id);
    state.secretMinimized.delete(pending.id);
    state.pendingSecrets.delete(id);
    if (!quiet) toast(decision === 'confirm' ? '这条已只存本地私密记忆；继续聊秘密请切到私聊。' : '这次不记住');
    if (!quiet && state.active?.id === id) {
      try {
        const saved = await rpc('conversation.get', { id });
        absorbConversationExtras(saved);
        state.messages = saved.messages || state.messages;
        renderMessages();
      } catch (_) { toast(decision === 'confirm' ? '记忆已保存，聊天记录暂时无法刷新。' : '已取消，聊天记录暂时无法刷新。', true); }
    }
    return true;
  } catch (error) {
    if (state.pendingSecrets.has(id)) state.pendingSecrets.set(id, { ...pending, error: errorText(error), state: 'error' });
    toast(errorText(error), true);
    return false;
  } finally {
    state.secretBusy.delete(pending.id);
    updateComposer();
  }
}
async function cancelPendingBeforeSwitch() {
  return !state.pendingSecrets.has(state.active?.id) || await decideSecret('cancel', true);
}
function categoryName(category) {
  return ({ identity: '个人资料', name: '称呼', language: '交流语言', preference: '偏好', preferences: '偏好', habit: '习惯', habits: '习惯', goal: '目标', goals: '目标', persona: '助手人设', fact: '其他信息' })[category] || '其他信息';
}
function avatarInto(container, avatar = state.character.avatar) {
  container.replaceChildren();
  if (typeof avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(avatar)) {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = state.character.name || '助手形象';
    container.append(img);
  } else {
    const mark = el('span', 'brand-symbol');
    mark.setAttribute('aria-hidden', 'true');
    container.append(mark);
  }
}
function applyCharacter() {
  const name = state.character.name || '劳纶缇娜';
  $('welcome-title').textContent = tr('新对话');
  $('chat-input').placeholder = tr('和{name}说些什么…', { name });
  $('chat-input').setAttribute('aria-label', tr('给{name}发消息', { name }));
  avatarInto($('welcome-avatar'));
  state.avatarDraft = state.character.avatar || null;
  avatarInto($('character-avatar'), state.avatarDraft);
  $('character-name').value = name;
  $('character-persona').value = state.character.persona || '';
  $('remove-avatar').disabled = !state.avatarDraft;
}
function updateHealth(health) {
  state.health = health || {};
  const ollama = state.health.ollama || {};
  const memory = state.health.memory || {};
  $('connection-dot').className = `status-dot ${ollama.ok ? 'online' : 'offline'}`;
  $('connection-label').textContent = ollama.ok ? (memory.ok ? '本地运行 · 记忆已连接' : '本地运行 · 记忆待连接') : '本地模型未连接';
  $('ollama-status').textContent = ollama.ok ? '已连接' : '未连接';
  $('ollama-status').classList.toggle('error', !ollama.ok);
  $('memory-status').textContent = memory.ok ? '已连接' : '未连接';
  $('memory-status').classList.toggle('error', !memory.ok);
  $('health-detail').textContent = [!ollama.ok && ollama.error, !memory.ok && memory.error].filter(Boolean).join('\n');
  $('app-version').textContent = state.health.version ? `v${String(state.health.version).replace(/^v/, '')}` : '';
  const previous = $('model-select').value || state.settings.model;
  $('model-select').replaceChildren();
  const models = Array.isArray(ollama.models) ? ollama.models : [];
  for (const model of models) {
    const name = typeof model === 'string' ? model : model.name;
    if (!name) continue;
    const option = el('option', '', name);
    option.value = name;
    $('model-select').append(option);
  }
  if (!models.length) {
    const option = el('option', '', ollama.ok ? '未找到已安装的模型' : '请先连接本地模型服务');
    option.value = '';
    $('model-select').append(option);
  }
  if ([...$('model-select').options].some((o) => o.value === previous)) $('model-select').value = previous;
  $('save-model').disabled = !models.length;
  $('composer-model').textContent = state.settings.model || ollama.model || '本地模型';
  $('composer-model').title = `本地模型：${state.settings.model || ollama.model || '未选择'}`;
  updateConnectionSummary();
}
function localResponseInFlight() {
  const job = state.jobs.get(state.active?.id);
  return Boolean(job && !job.replyDone && job.userMessage?.privacy === 'private');
}
function updateConnectionSummary() {
  const localOnly = (state.active?.mode || state.mode) === 'private' || state.pendingSecrets.has(state.active?.id) || localResponseInFlight();
  const provider = state.providers.find((item) => item.id === state.activeProvider);
  if (!localOnly && provider?.kind && provider.kind !== 'local') {
    $('connection-dot').className = `status-dot ${provider.connected ? 'online' : 'offline'}`;
    $('connection-label').textContent = provider.connected ? `云端聊天 · 记忆${state.health.memory?.ok ? '已连接' : '待连接'}` : '云端已选 · 尚未验证';
  } else {
    $('connection-dot').className = `status-dot ${state.health.ollama?.ok ? 'online' : 'offline'}`;
    $('connection-label').textContent = state.health.ollama?.ok ? `本地聊天 · 记忆${state.health.memory?.ok ? '已连接' : '待连接'}` : '本地模型未连接';
  }
}
function sortConversations() {
  state.conversations.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}
function upsertConversation(conversation) {
  if (!conversation?.id) return;
  const index = state.conversations.findIndex((c) => c.id === conversation.id);
  if (index < 0) state.conversations.unshift(conversation);
  else state.conversations[index] = { ...state.conversations[index], ...conversation };
  if (state.active?.id === conversation.id) state.active = { ...state.active, ...conversation };
  sortConversations();
  renderConversations();
}
function renderConversations() { renderWorkspaceConversations(); }

function updateHeader() {
  const titles = { character: '角色形象与声音', memory: '记忆', profile: '记忆', settings: '设置', work: '工作', connections: 'AI 连接', skills: '技能' };
  $('view-title').textContent = state.view === 'chat' ? (state.active?.title || '新对话') : titles[state.view];
  const badge = $('mode-badge');
  badge.replaceChildren();
  if (state.view === 'chat') {
    const mode = state.active?.mode || state.mode;
    badge.classList.toggle('private', mode === 'private');
    badge.append(svg(mode === 'private' ? 'lock' : 'chat'), document.createTextNode(modeName(mode)));
    badge.title = mode === 'private' ? '私聊原文仅存本地；明确的个人资料与长期偏好可按共享规则同步。' : '在本地聊天，相关长期信息可加入共享记忆。';
  }
  $('header-actions').replaceChildren();
  if (state.view === 'chat' && state.active) {
    const menu = button('', 'icon-button', () => conversationMenu(state.active), 'more');
    menu.setAttribute('aria-label', '管理当前对话');
    menu.title = '管理对话';
    $('header-actions').append(menu);
  }
  for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.dataset.view === state.view);
}
async function showView(view) {
  if (view === 'profile') { view = 'memory'; state.memorySection = 'profile'; }
  if (view !== 'chat') stopVoiceConversation();
  if (state.view === 'connections' && view !== 'connections') $('provider-api-key').value = '';
  state.view = view;
  for (const name of ['chat', 'character', 'memory', 'settings', 'work', 'connections', 'skills']) $(`${name}-view`).hidden = name !== view;
  updateHeader();
  renderConversations();
  if (view === 'memory') await selectMemorySection(state.memorySection || state.memoryScope || 'shared');
  if (view === 'settings') { refreshHealth(); refreshResources(); }
  if (view === 'work') { loadWorkRuns(); refreshWork(); }
  if (view === 'connections') await loadProviders();
  if (view === 'character') { loadCompanion(); loadAvatarLibrary(); loadTouchLibrary(); refreshVoice(); refreshVoiceProfiles(); }
  if (view === 'skills') loadSkills();
  if (view === 'chat') $('chat-input').focus();
}
async function selectMemorySection(section) {
  if (!['shared', 'private', 'profile'].includes(section)) return;
  state.memorySection = section;
  if (section !== 'profile') state.memoryScope = section;
  $('memory-data-panel').hidden = section === 'profile';
  $('profile-view').hidden = section !== 'profile';
  $('remember-new').hidden = section === 'profile';
  for (const name of ['shared', 'private', 'profile']) {
    const tab = $(`memory-${name}`), selected = name === section;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  $('memory-data-panel').setAttribute('aria-labelledby', section === 'private' ? 'memory-private' : 'memory-shared');
  if (section === 'profile') await loadProfile(); else await loadMemories();
}
function bindMemoryNavigation() {
  const sections = ['shared', 'private', 'profile'];
  for (const section of sections) {
    const tab = $(`memory-${section}`);
    tab.addEventListener('click', () => selectMemorySection(section));
    tab.addEventListener('keydown', event => {
      const index = sections.indexOf(section);
      const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3
        : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
      if (next < 0) return;
      event.preventDefault(); $(`memory-${sections[next]}`).focus(); selectMemorySection(sections[next]);
    });
  }
}
function updateComposer() {
  const mode = state.active?.mode || state.mode;
  const job = state.active ? state.jobs.get(state.active.id) : null;
  const active = Boolean(job && !job.replyDone);
  $('mode-daily').classList.toggle('selected', mode === 'daily');
  $('mode-private').classList.toggle('private-selected', mode === 'private');
  $('mode-private').classList.toggle('selected', mode === 'private');
  $('mode-daily').setAttribute('aria-pressed', String(mode === 'daily'));
  $('mode-private').setAttribute('aria-pressed', String(mode === 'private'));
  $('mode-daily').title = tr(mode === 'daily' ? '当前为日常对话' : '在当前对话中切换到日常');
  $('mode-private').title = tr(mode === 'private' ? '当前为私聊' : '在当前对话中切换到私聊');
  const switchingBlocked = !state.ready || state.switchingMode || state.sending || active || state.creating || state.secretBusy.size > 0;
  $('mode-daily').disabled = switchingBlocked;
  $('mode-private').disabled = switchingBlocked;
  const send = $('send-message');
  send.classList.toggle('stop', active);
  send.replaceChildren(svg(active ? 'stop' : 'arrowUp'));
  send.setAttribute('aria-label', active ? '停止回答' : '发送消息');
  send.title = active ? '停止回答' : '发送 (Enter)';
  send.disabled = !state.ready || state.switchingMode || state.sending || state.providerLoading || state.secretBusy.has(state.pendingSecrets.get(state.active?.id)?.id) || (!active && !$('chat-input').value.trim());
  $('composer').classList.toggle('private', mode === 'private');
  $('composer-hint').textContent = mode === 'private' ? '私聊原文仅存本地 · 个人资料与长期偏好按共享规则同步' : '本地对话 · Enter 发送，Shift + Enter 换行';
  const privateMode = mode === 'private';
  $('intent-task').disabled = privateMode || Boolean(state.pendingSecrets.get(state.active?.id));
  if (privateMode || state.pendingSecrets.get(state.active?.id)) state.intent = 'chat';
  $('intent-chat').classList.toggle('selected', state.intent === 'chat');
  $('intent-task').classList.toggle('selected', state.intent === 'task');
  $('chat-work-target').hidden = state.intent !== 'task';
  $('chat-skill').hidden = state.intent !== 'task';
  $('chat-task-hint').hidden = state.intent !== 'task';
  if (!privateMode && state.intent !== 'task') {
    const provider = state.providers.find((item) => item.id === state.activeProvider);
    $('composer-hint').textContent = `${provider?.kind && provider.kind !== 'local' ? '日常使用云端模型' : '本地对话'} · Enter 发送，Shift + Enter 换行`;
  }
  if (state.pendingSecrets.has(state.active?.id)) $('composer-hint').textContent = '当前秘密与确认仅在本地处理；继续私密交流可切到私聊';
  else if (localResponseInFlight()) $('composer-hint').textContent = '正在本地回复这条私密消息';
  updateProviderPicker();
  updateConnectionSummary();
  renderSecretConfirmation();
  publishAssistantState();
  renderMemoryActivity();
}
function renderMemoryActivity() {
  const node = $('memory-activity');
  const job = state.active ? state.jobs.get(state.active.id) : null;
  node.replaceChildren();
  node.classList.toggle('error', Boolean(job?.memoryError));
  if (job?.memoryText) node.append(svg(job.memoryError ? 'alert' : 'layers'), document.createTextNode(job.memoryText));
}
async function createConversation(mode = state.mode, { preserveDraft = true } = {}) {
  if (state.creating) return null;
  if (!await cancelPendingBeforeSwitch()) return null;
  if (voiceConversation && !voiceConversation.processing) stopVoiceConversation();
  stopSpeaking(false);
  const version = ++state.loadVersion;
  const draft = preserveDraft ? $('chat-input').value : '';
  const sourceDraftKey = draftKey();
  stashDraft();
  state.creating = true;
  try {
    const conversation = await rpc('conversation.create', { mode, project_id: state.projectSelection || null });
    if (state.projectSelection) state.workspace.conversation_meta[conversation.id] = { project_id: state.projectSelection, pinned: false };
    upsertConversation(conversation);
    if (version !== state.loadVersion) return conversation;
    state.active = conversation;
    state.messages = [];
    state.modeEvents.set(conversation.id, []);
    state.mode = conversation.mode || mode;
    $('chat-input').value = draft;
    state.drafts.set(draftKey(), draft);
    if (preserveDraft && sourceDraftKey.startsWith('new:') && state.drafts.get(sourceDraftKey) === draft) state.drafts.delete(sourceDraftKey);
    resizeInput();
    await showView('chat');
    renderMessages();
    updateComposer();
    return conversation;
  } catch (error) {
    toast(errorText(error), true);
    return null;
  } finally { state.creating = false; }
}
async function selectMode(mode) {
  if (!['daily', 'private'].includes(mode) || mode === (state.active?.mode || state.mode) || state.switchingMode || state.creating || state.sending || !state.ready) return;
  if (activeJob() && !activeJob().replyDone) { toast('请等当前回答结束，再切换模式。'); return; }
  stashDraft();
  stopSpeaking(false);
  stopVoiceConversation();
  if (!state.active) {
    state.mode = mode; state.modeEpoch++;
    restoreDraft(); updateHeader(); updateComposer();
    toast(mode === 'private' ? '已切换到私聊模式' : '已切换到日常模式');
    return;
  }
  const id = state.active.id, version = state.loadVersion;
  state.switchingMode = true; updateComposer();
  try {
    const result = await rpc('conversation.set_mode', { id, mode, expected_revision: currentModeRevision() });
    upsertConversation(result.conversation);
    absorbConversationExtras(result);
    if (state.active?.id !== id || version !== state.loadVersion) return;
    state.mode = result.conversation.mode;
    restoreDraft(); updateHeader(); renderMessages(); scrollToEnd(true);
    toast(mode === 'private' ? '已切换到私聊模式' : '已切换到日常模式');
  } catch (error) { toast(errorText(error), true); }
  finally { state.switchingMode = false; updateComposer(); }
}
async function openConversation(id) {
  if (state.active?.id !== id && !await cancelPendingBeforeSwitch()) return;
  if (state.active?.id !== id) { stopVoiceConversation(); stopSpeaking(false); }
  stashDraft();
  const version = ++state.loadVersion;
  try {
    const result = await rpc('conversation.get', { id });
    if (version !== state.loadVersion) return;
    state.active = result.conversation;
    state.mode = result.conversation.mode;
    state.messages = Array.isArray(result.messages) ? result.messages : [];
    absorbConversationExtras(result);
    const job = state.jobs.get(id);
    if (job && !job.replyDone && !state.messages.some((m) => m.id === job.userMessage.id)) state.messages.push(job.userMessage);
    if (job?.replyDone && job.finalMessage && !state.messages.some((m) => m.id === job.finalMessage.id)) state.messages.push(job.finalMessage);
    restoreDraft();
    await showView('chat');
    renderMessages();
    updateComposer();
    scrollToEnd(true);
  } catch (error) { if (version === state.loadVersion) toast(errorText(error), true); }
}
function appendInline(parent, text) {
  // All model and user content becomes text nodes; HTML is never interpreted.
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    const value = match[0];
    if (value.startsWith('`')) parent.append(el('code', '', value.slice(1, -1)));
    else if (value.startsWith('**')) parent.append(el('strong', '', value.slice(2, -2)));
    else parent.append(el('em', '', value.slice(1, -1)));
    last = match.index + value.length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
function renderMarkdown(container, raw) {
  container.replaceChildren();
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [];
  let list = null;
  let code = null;
  const flush = () => {
    if (paragraph.length) { const p = el('p'); appendInline(p, paragraph.join('\n')); container.append(p); paragraph = []; }
    list = null;
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code !== null) { const pre = el('pre'); pre.append(el('code', '', code.join('\n'))); container.append(pre); code = null; }
      else { flush(); code = []; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { flush(); const h = el(`h${heading[1].length}`); appendInline(h, heading[2]); container.append(h); continue; }
    const listItem = /^\s*(?:([-*])\s+|\d+[.)]\s+)(.*)$/.exec(line);
    if (listItem) {
      if (paragraph.length) { const p = el('p'); appendInline(p, paragraph.join('\n')); container.append(p); paragraph = []; }
      const tag = listItem[1] ? 'UL' : 'OL';
      if (!list || list.tagName !== tag) { list = el(tag.toLowerCase()); container.append(list); }
      const li = el('li'); appendInline(li, listItem[2]); list.append(li); continue;
    }
    if (/^>\s?/.test(line)) { flush(); const quote = el('blockquote'); appendInline(quote, line.replace(/^>\s?/, '')); container.append(quote); continue; }
    if (list) list = null;
    paragraph.push(line);
  }
  if (code !== null) { const pre = el('pre'); pre.append(el('code', '', code.join('\n'))); container.append(pre); }
  flush();
}
function activeJob() { return state.active ? state.jobs.get(state.active.id) : null; }
function isNearBottom() { const box = $('chat-scroll'); return box.scrollHeight - box.scrollTop - box.clientHeight < 110; }
function scrollToEnd(force = false) {
  const box = $('chat-scroll');
  if (force || isNearBottom()) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}
function assistantNode(message, streaming = false) {
  const row = el('article', 'message assistant');
  row.dataset.messageId = message.id || 'stream';
  const avatar = el('div', 'message-avatar');
  avatarInto(avatar);
  const content = el('div');
  const body = el('div', 'message-body');
  if (message.content) renderMarkdown(body, message.content);
  else if (streaming) {
    const typing = el('div', 'typing-indicator');
    typing.setAttribute('aria-label', '正在回答');
    for (let i = 0; i < 3; i++) typing.append(el('i'));
    body.append(typing);
  }
  content.append(body);
  if (!streaming) {
    const meta = el('div', 'message-meta');
    meta.append(el('span', '', state.character.name || '劳纶缇娜'));
    if (message.status === 'cancelled') meta.append(el('span', '', '已停止'));
    if (message.status === 'failed') meta.append(el('span', 'message-state error', '回答未完成'));
    if (message.privacy === 'private') meta.append(el('span', 'private-message-label', '仅本地'));
    if (message.content) {
      const copy = button('', 'message-copy', async () => {
        try { await navigator.clipboard.writeText(message.content); toast('已复制回答'); }
        catch (_) { toast('暂时无法复制，请选择文字后复制。', true); }
      }, 'copy');
      copy.setAttribute('aria-label', '复制回答');
      copy.title = '复制回答';
      meta.append(copy);
      const speak = button('', 'message-copy', () => speakText(message.content), 'volume');
      speak.setAttribute('aria-label', '朗读这条回答');
      speak.title = '朗读回答';
      meta.append(speak);
    }
    content.append(meta);
  }
  row.append(avatar, content);
  return row;
}
function renderMessages() {
  const nearBottom = isNearBottom();
  const container = $('messages');
  container.replaceChildren();
  const job = activeJob();
  const modeEvents = state.modeEvents.get(state.active?.id) || [];
  $('welcome').hidden = state.messages.length > 0 || modeEvents.length > 0 || Boolean(job && !job.replyDone);
  const appendSwitches = (after) => {
    for (const event of modeEvents.filter((item) => (item.after_message_id || null) === after)) {
      const marker = el('div', `mode-switch-notice${event.mode === 'private' ? ' private' : ''}`);
      marker.setAttribute('role', 'note');
      marker.append(svg(event.mode === 'private' ? 'lock' : 'chat'), el('span', '', tr(event.mode === 'private' ? '已切换到私聊模式' : '已切换到日常模式')));
      container.append(marker);
    }
  };
  appendSwitches(null);
  for (const message of state.messages) {
    if (message.role === 'user') {
      const article = el('article', 'message user');
      article.append(el('div', 'user-bubble', message.content || ''));
      if (message.privacy === 'private') article.append(el('span', 'private-message-label', '仅本地'));
      container.append(article);
    } else if (message.role === 'assistant') container.append(assistantNode(message));
    const tasks = state.tasksByConversation.get(state.active?.id) || [];
    for (const task of tasks.filter((item) => item.message_id === message.id)) container.append(buildTaskCard(task));
    appendSwitches(message.id);
  }
  if (job && !job.replyDone) container.append(assistantNode({ content: job.text }, true));
  if (job?.error) {
    const error = el('div', 'message-state error');
    error.append(svg('alert'), document.createTextNode(job.error));
    container.append(error);
  }
  if (nearBottom) scrollToEnd(true);
}
function resizeInput() {
  const input = $('chat-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 170)}px`;
  updateComposer();
}
async function sendMessage() {
  const job = activeJob();
  if (job && !job.replyDone) { await cancelJob(job); return; }
  const content = $('chat-input').value.trim();
  if (!content || state.switchingMode || state.sending || state.providerLoading || state.secretBusy.has(state.pendingSecrets.get(state.active?.id)?.id) || !state.ready) return;
  stopSpeaking(false);
  state.sending = true;
  updateComposer();
  try {
    let conversationId = state.active?.id;
    if (!conversationId) { const conversation = await createConversation(state.mode); if (!conversation) return; conversationId = conversation.id; }
    const destination = state.conversations.find((item) => item.id === conversationId) || state.active;
    const messageDraftKey = draftKey(destination);
    let taskTarget;
    if (state.intent === 'task') {
      taskTarget = selectedChatTaskTarget();
      if (!taskTarget) throw new Error('请先选择当前可用的任务执行目标。');
    }
    const result = await rpc('chat.send', { conversation_id: conversationId, content, expected_mode_revision: destination?.mode_revision || 0, ...(taskTarget ? { task_target: taskTarget, ...($('chat-skill').value ? { skill_id: $('chat-skill').value } : {}) } : {}) });
    if (result.conversation) upsertConversation(result.conversation);
    if (Object.hasOwn(result, 'pending_secret')) {
      if (result.pending_secret && !state.resolvedSecrets.has(result.pending_secret.id)) {
        state.pendingSecrets.set(conversationId, result.pending_secret);
        if (state.active?.id !== conversationId) {
          try {
            const cancelled = await rpc('memory.confirm', { conversation_id: conversationId, pending_id: result.pending_secret.id, decision: 'cancel' });
            if (cancelled.ok === true) { state.resolvedSecrets.add(result.pending_secret.id); state.pendingSecrets.delete(conversationId); }
          } catch (_) { toast('原对话的秘密确认未能取消，请返回原对话检查；内容仍留在本地。', true); }
        }
      }
      else state.pendingSecrets.delete(conversationId);
    }
    const newJob = { id: result.job_id, conversationId, userMessage: result.message, text: '', after: 0, replyDone: false, memoryPending: false, memoryText: '', memoryError: false, error: '', pollFailures: 0,
      speechLocal: result.speech_local ?? (result.message?.privacy === 'private' || destination?.mode === 'private' || state.activeProvider === 'local'),
      speechModeRevision: result.conversation?.mode_revision ?? destination?.mode_revision,
      resourcePreset: state.resourcePreset || 'balanced' };
    state.jobs.set(conversationId, newJob);
    if (state.drafts.get(messageDraftKey)?.trim() === content) state.drafts.delete(messageDraftKey);
    if (state.active?.id === conversationId) {
      state.messages.push(result.message);
      if ($('chat-input').value.trim() === content) $('chat-input').value = '';
      stashDraft();
      resizeInput();
      renderMessages();
      scrollToEnd(true);
    }
    const existing = state.conversations.find((c) => c.id === conversationId);
    if (existing) upsertConversation({ ...existing, has_private: existing.has_private || result.message?.privacy === 'private', title: ['新对话', '新的对话', '新的私聊'].includes(existing.title) || !existing.title ? (result.message?.privacy === 'private' ? '私密内容' : content.slice(0, 28)) : existing.title, updated_at: new Date().toISOString() });
    pollJob(newJob);
  } catch (error) { toast(errorText(error), true); }
  finally { state.sending = false; updateHeader(); updateComposer(); }
}
async function cancelJob(job) {
  if (job.cancelling) return;
  job.speechStopped = true;
  if (job.speechSession?.generation === speechGeneration) stopSpeaking();
  job.cancelling = true;
  try {
    await rpc('chat.cancel', { job_id: job.id });
    const result = await rpc('chat.tasks', { conversation_id: job.conversationId });
    for (const task of result.items || []) upsertTask(task);
    if (state.active?.id === job.conversationId) renderMessages();
  }
  catch (error) { toast(errorText(error), true); }
  finally { job.cancelling = false; }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function pollJob(job) {
  while (!job.replyDone || job.memoryPending) {
    if (job.memoryPending && job.memoryDeadline && Date.now() > job.memoryDeadline) {
      job.memoryPending = false;
      job.memoryText = '记忆仍在后台整理，可稍后到「关于你」查看。';
      if (state.active?.id === job.conversationId) renderMemoryActivity();
      break;
    }
    try {
      const result = await rpc('chat.poll', { job_id: job.id, after: job.after });
      job.pollFailures = 0;
      const recovered = Boolean(job.error && !job.replyDone);
      if (!job.replyDone) job.error = '';
      let changed = recovered;
      let completed = false;
      for (const event of result.events || []) {
        if (event.seq && event.seq <= job.after) continue;
        job.after = Math.max(job.after, event.seq || 0);
        if (event.type === 'delta') { job.text += event.text || ''; feedJobSpeech(job, event.text || ''); changed = true; }
        if (event.type === 'task' && event.task) { upsertTask(event.task); changed = true; }
        if (event.type === 'secret') {
          if (event.pending_secret) {
            if (!state.resolvedSecrets.has(event.pending_secret.id)) state.pendingSecrets.set(job.conversationId, event.pending_secret);
          } else state.pendingSecrets.delete(job.conversationId);
        }
        if (event.type === 'done') {
          if (event.conversation) upsertConversation(event.conversation);
          job.replyDone = true;
          job.memoryPending = Boolean(event.memory_pending);
          job.memoryDeadline = Date.now() + 60000;
          job.memoryText = job.memoryPending ? '正在整理值得记住的信息…' : '';
          const message = event.message || { id: `reply-${job.id}`, role: 'assistant', content: job.text, status: 'completed' };
          job.finalMessage = message;
          if (state.active?.id === job.conversationId && !state.messages.some((m) => m.id === message.id)) state.messages.push(message);
          changed = true;
          completed = true;
          if (message.status === 'cancelled') { if (job.speechSession?.generation === speechGeneration) stopSpeaking(); }
          else if (message.content) feedJobSpeech(job, '', true, message.content);
        }
        if (event.type === 'error') {
          if (job.speechSession?.generation === speechGeneration) stopSpeaking();
          job.replyDone = true;
          job.memoryPending = false;
          job.error = event.text || event.error || '回答没有完成，请检查本地模型后重试。';
          if (event.message && state.active?.id === job.conversationId && !state.messages.some((m) => m.id === event.message.id)) state.messages.push(event.message);
          else if (job.text && state.active?.id === job.conversationId) state.messages.push({ id: `partial-${job.id}`, role: 'assistant', content: job.text, status: 'failed' });
          changed = true;
          completed = true;
        }
        if (event.type === 'memory') {
          job.memoryPending = event.memory_pending === true;
          const failedMemories = Array.isArray(event.memories) ? event.memories.filter((memory) => memory.status === 'error' || memory.status === 'failed') : [];
          job.memoryError = Boolean(event.error || event.ok === false || event.status === 'error' || failedMemories.length);
          const count = Array.isArray(event.memories) ? event.memories.length : 0;
          job.memoryText = event.text || (job.memoryError ? (event.error || '部分记忆暂未同步，可到「关于你」查看。') : (count ? `已整理 ${count} 条记忆` : ''));
          if (state.view === 'memory' && state.memorySection === 'profile') loadProfile();
          if (state.view === 'memory') loadMemories();
        }
      }
      if (result.done && !job.replyDone) {
        // Older backend versions may persist a cancelled result without a done event.
        job.replyDone = true;
        job.memoryPending = false;
        try {
          const saved = await rpc('conversation.get', { id: job.conversationId });
          if (state.active?.id === job.conversationId && state.jobs.get(job.conversationId) === job) state.messages = saved.messages || [];
          upsertConversation(saved.conversation);
          absorbConversationExtras(saved);
        } catch (error) { job.error = errorText(error); }
        changed = true;
      }
      if (state.active?.id === job.conversationId) {
        if (changed) renderMessages();
        updateComposer();
      }
      if (completed) {
        try {
          const saved = await rpc('conversation.get', { id: job.conversationId });
          upsertConversation(saved.conversation);
          absorbConversationExtras(saved);
          if (state.active?.id === job.conversationId && state.jobs.get(job.conversationId) === job) { state.messages = saved.messages || state.messages; updateHeader(); renderMessages(); }
        } catch (_) { /* The persisted reply remains available in the active chat. */ }
      }
    } catch (error) {
      job.pollFailures++;
      if (job.pollFailures === 3) {
        job.error = '连接暂时中断，正在尝试恢复。你可以停止本次回答。';
        if (state.active?.id === job.conversationId) renderMessages();
      }
      if (job.pollFailures >= 8) {
        if (job.speechSession?.generation === speechGeneration) stopSpeaking();
        job.replyDone = true;
        job.memoryPending = false;
        job.error = errorText(error);
        if (state.active?.id === job.conversationId) { renderMessages(); updateComposer(); }
        break;
      }
    }
    if (!job.replyDone || job.memoryPending) await delay(job.pollFailures ? Math.min(5000, job.pollFailures * 750) : job.replyDone ? 1000 : 220);
  }
}

let modalHandler = null;
function openModal({ title, description = '', submit = '确定', danger = false, fields = [], onSubmit }) {
  const dialog = $('modal');
  if (dialog.open) dialog.close();
  $('modal-title').textContent = tr(title);
  $('modal-description').textContent = tr(description);
  $('modal-description').hidden = !description;
  $('modal-submit').textContent = tr(submit);
  $('modal-submit').className = `button ${danger ? 'danger' : 'primary'}`;
  $('modal-submit').hidden = !onSubmit;
  $('modal-cancel').hidden = !onSubmit;
  $('modal-error').textContent = '';
  $('modal-fields').replaceChildren();
  for (const field of fields) {
    if (field.node) { $('modal-fields').append(field.node); continue; }
    const label = el('label', '', field.label || '');
    label.htmlFor = `modal-${field.name}`;
    const control = el(field.multiline ? 'textarea' : 'input');
    control.id = `modal-${field.name}`;
    control.name = field.name;
    control.value = field.value || '';
    control.required = field.required !== false;
    control.maxLength = field.maxLength || 12000;
    control.placeholder = field.placeholder || '';
    $('modal-fields').append(label, control);
  }
  modalHandler = onSubmit;
  dialog.showModal();
  requestAnimationFrame(() => { dialog.querySelector('input, textarea')?.focus(); });
}
function conversationMenu(conversation) {
  const actions = el('div', 'modal-conversation-actions');
  actions.append(button(workspaceMeta(conversation.id).pinned ? '取消置顶' : '置顶对话', 'button secondary', () => pinConversation(conversation), 'pin'));
  actions.append(button('移动到项目', 'button secondary', () => moveConversation(conversation), 'folder'));
  actions.append(button('重命名对话', 'button secondary', () => renameConversation(conversation), 'chat'));
  actions.append(button('删除对话', 'button secondary', () => deleteConversation(conversation), 'trash'));
  openModal({ title: conversation.title || '新对话', description: `${modeName(conversation.mode)} · ${timeText(conversation.created_at)}`, fields: [{ node: actions }] });
}
function renameConversation(conversation) {
  openModal({ title: '重命名对话', submit: '保存', fields: [{ name: 'title', label: '对话名称', value: conversation.title, maxLength: 100 }], onSubmit: async (values) => {
    const updated = await rpc('conversation.rename', { id: conversation.id, title: values.title.trim() });
    upsertConversation(updated);
    updateHeader();
  } });
}
function deleteConversation(conversation) {
  if (state.jobs.get(conversation.id) && !state.jobs.get(conversation.id).replyDone) { toast('请先停止这段对话的回答，再删除。', true); return; }
  openModal({ title: '删除这段对话？', description: '这段聊天记录将从本机移除。已整理的长期记忆可以在记忆页单独管理。', submit: '删除对话', danger: true, onSubmit: async () => {
    await rpc('conversation.delete', { id: conversation.id });
    state.conversations = state.conversations.filter((c) => c.id !== conversation.id);
    state.drafts.delete(conversation.id);
    state.drafts.delete(`${conversation.id}:private`);
    state.modeEvents.delete(conversation.id);
    state.jobs.delete(conversation.id);
    if (state.active?.id === conversation.id) {
      state.loadVersion++;
      state.active = null;
      state.messages = [];
      renderMessages();
      updateHeader();
      updateComposer();
    }
    renderConversations();
    toast('对话已删除');
  } });
}
function resultState(container, text, { description = '', error = false, icon = 'layers', retry } = {}) {
  container.replaceChildren();
  const box = el('div', `result-state${error ? ' error' : ''}`);
  box.append(svg(icon), el('div', '', text));
  if (description) box.append(el('p', '', description));
  if (retry) box.append(button('重新读取', 'button secondary small', retry, 'refresh'));
  container.append(box);
}
async function loadMemories() {
  const version = ++state.memoryVersion;
  const scope = state.memoryScope;
  const query = $('memory-query').value.trim();
  const container = $('memory-results');
  resultState(container, '正在读取记忆…');
  $('clear-search').hidden = !query;
  $('memory-scope-hint').textContent = scope === 'private' ? '私密记忆仅供本地 Core 和私聊使用，其他助手无法读取。' : '已连接的助手可以读取共享记忆，包括你允许共享的个人资料与助手人设。';
  try {
    const result = await rpc(query ? 'memory.search' : 'memory.list', { scope, ...(query ? { query } : {}) });
    if (version !== state.memoryVersion) return;
    const items = Array.isArray(result.items) ? result.items : [];
    container.replaceChildren();
    if (result.error) {
      resultState(container, result.error, { error: true, retry: loadMemories });
      if (!items.length) return;
    }
    if (!items.length) { resultState(container, query ? '没有找到相关记忆' : '这里还没有记忆', { description: query ? '换一个关键词试试。' : '你可以手动添加，也可以在聊天中告诉她。' }); return; }
    container.append(el('div', 'results-label', query ? `找到 ${items.length} 条相关记忆` : `${items.length} 条记忆`));
    for (const memory of items) {
      const card = el('article', 'memory-card');
      card.append(el('p', 'memory-content', memory.content || memory.memory || ''));
      const meta = el('div', 'item-meta');
      meta.append(el('span', '', sourceName(memory.source)), el('span', '', scope === 'private' ? '仅本地' : '共享'));
      if (timeText(memory.created_at)) meta.append(el('span', '', timeText(memory.created_at)));
      card.append(meta);
      if (memory.id) {
        const remove = button('', 'icon-button delete-item', () => deleteMemory(memory, scope), 'trash');
        remove.setAttribute('aria-label', '删除这条记忆');
        card.append(remove);
      }
      container.append(card);
    }
  } catch (error) { if (version === state.memoryVersion) resultState(container, errorText(error), { error: true, retry: loadMemories }); }
}
function rememberNew() {
  const scope = state.memoryScope;
  openModal({ title: '添加一条记忆', description: scope === 'shared' ? '这条信息会加入共享库，供已连接的助手读取。' : '这条信息仅保存在本地私密库。', submit: '保存记忆', fields: [{ name: 'content', label: scope === 'shared' ? '共享记忆' : '私密记忆', multiline: true, maxLength: 4000, placeholder: '写下一条希望她记住的事实或偏好…' }], onSubmit: async (values) => {
    const result = await rpc('memory.remember', { scope, content: values.content.trim() });
    if (result?.error || result?.ok === false) throw new Error(result.error || '记忆尚未保存，请重试。');
    toast('记忆已保存');
    loadMemories();
  } });
}
function deleteMemory(memory, scope) {
  openModal({ title: '删除这条记忆？', description: scope === 'shared' ? '这会从共享记忆库移除该信息。' : '这会从本地私密库移除该信息。', submit: '删除记忆', danger: true, onSubmit: async () => {
    await rpc('memory.delete', { scope, id: memory.id });
    await loadMemories();
    toast('记忆已删除');
  } });
}
async function loadProfile() {
  const version = ++state.profileVersion;
  const container = $('profile-results');
  resultState(container, '正在读取关于你的信息…', { icon: 'user' });
  try {
    const result = await rpc('profile.list');
    if (version !== state.profileVersion) return;
    const items = Array.isArray(result.items) ? result.items : [];
    state.profile = items;
    if (!items.length) { resultState(container, '我们还在慢慢认识彼此', { description: '聊聊你的称呼、习惯和愿望，明确的信息会逐渐整理在这里。', icon: 'user' }); return; }
    container.replaceChildren();
    const groups = new Map();
    for (const item of items) { const group = categoryName(item.category); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(item); }
    for (const [group, entries] of groups) {
      container.append(el('h2', 'profile-group-heading', group));
      for (const item of entries) {
        const card = el('article', 'profile-card');
        card.append(el('p', 'profile-content', item.content || ''));
        const meta = el('div', 'item-meta');
        meta.append(el('span', '', item.scope === 'private' ? '仅本地' : '共享'));
        const labels = { synced: '已同步', saved: '已记录', pending: '待同步', failed: '同步未完成', error: '同步未完成', deleted: '已移除', active: '已记录', confirmed: '你已确认', inferred: '待确认', uncertain: '待确认' };
        if (item.status) meta.append(el('span', `profile-state${['pending', 'failed', 'error', 'inferred', 'uncertain'].includes(item.status) ? ' warning' : ''}`, labels[item.status] || '已记录'));
        if (item.error) meta.title = item.error;
        if (timeText(item.updated_at)) meta.append(el('span', '', `更新于 ${timeText(item.updated_at)}`));
        card.append(meta);
        if (item.id) {
          const remove = button('', 'icon-button delete-item', () => removeProfile(item), 'trash');
          remove.setAttribute('aria-label', '移除这条个人信息');
          card.append(remove);
        }
        container.append(card);
      }
    }
  } catch (error) { if (version === state.profileVersion) resultState(container, errorText(error), { error: true, icon: 'user', retry: loadProfile }); }
}
function removeProfile(item) {
  openModal({ title: '移除这条个人信息？', description: '她会停止使用这条画像信息，并尝试移除对应的长期记忆。', submit: '移除', danger: true, onSubmit: async () => {
    const result = await rpc('profile.delete', { id: item.id });
    if (result?.error || result?.ok === false) throw new Error(result.error || '移除未完成，请重试。');
    await loadProfile();
    toast('个人信息已移除');
  } });
}
async function refreshHealth() {
  $('refresh-health').disabled = true;
  try { updateHealth(await rpc('health.get')); }
  catch (error) { feedback('model-feedback', errorText(error), true); }
  finally { $('refresh-health').disabled = false; }
}
async function bootstrap() {
  state.ready = false;
  $('startup-overlay').hidden = false;
  $('startup-overlay').classList.remove('error');
  $('startup-message').textContent = '准备本地对话与记忆…';
  $('retry-bootstrap').hidden = true;
  updateComposer();
  try {
    const data = await rpc('bootstrap');
    state.settings = data.settings || {};
      state.resourcePreset = data.resources?.preset || 'balanced';
    state.character = { name: '劳纶缇娜', persona: '', avatar: null, ...data.character };
    state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
    state.profile = data.profile?.items || data.profile || [];
    state.ready = true;
    await loadWorkspace();
    sortConversations();
    applyCharacter();
    updateHealth(data.health);
    renderConversations();
    updateHeader();
    renderMessages();
    updateComposer();
    $('startup-overlay').hidden = true;
    $('chat-input').focus();
    refreshHealth();
    refreshVoice();
    loadProviders(false);
    loadCompanion();
    loadSkills();
  } catch (error) {
    $('startup-overlay').classList.add('error');
    $('startup-message').textContent = errorText(error);
    $('retry-bootstrap').hidden = false;
    $('connection-label').textContent = '本地服务尚未连接';
    $('connection-dot').className = 'status-dot offline';
  }
}

const providerPresets = {
  local: { name: '本地 Qwen', kind: 'local', description: '使用本机已安装的模型，无 API 调用费用。', modelHint: '填写本机已安装的 Ollama 模型名称。' },
  openai: { name: 'OpenAI', kind: 'openai', description: '当前通过 API 接入，按 API 账户计费。ChatGPT 账号登录正在后续规划中。', modelHint: '从官方控制台填写你有权限使用的模型 ID。' },
  deepseek: { name: 'DeepSeek', kind: 'deepseek', description: '通过 DeepSeek API 接入，费用和余额以官方账户为准。', modelHint: '填写官方控制台提供的模型 ID。' },
  gemini: { name: 'Google Gemini', kind: 'custom', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', description: '部分模型和地区有免费额度，并有用量限制；免费层内容可能用于改进产品。', modelHint: '在 Google AI Studio 选择可用模型，再填写其模型 ID。' },
  doubao: { name: '豆包 / 火山方舟', kind: 'custom', base_url: 'https://ark.cn-beijing.volces.com/api/v3', description: '使用火山方舟 API；免费试用和后续费用以你的账户为准。', modelHint: '填写火山方舟控制台中可调用的模型 ID 或推理接入点 ID。' },
  custom: { name: '其他兼容服务', kind: 'custom', description: '连接提供 OpenAI 兼容接口的本地或云端服务。', modelHint: '按服务商说明填写模型 ID。' },
};
function providerPresetFor(provider) {
  if (!provider) return 'custom';
  if (provider.kind !== 'custom') return provider.kind;
  return ['gemini', 'doubao'].find((key) => provider.base_url?.replace(/\/$/, '') === providerPresets[key].base_url) || 'custom';
}
function openProviderChooser() {
  $('provider-chooser').showModal();
}
async function chooseProviderPreset(key) {
  const preset = providerPresets[key];
  if (!preset) return;
  $('provider-chooser').close();
  await showView('connections');
  const existing = key === 'custom' ? null : state.providers.find((item) => providerPresetFor(item) === key);
  editProvider(existing || { kind: preset.kind, name: key === 'custom' ? '' : preset.name, base_url: preset.base_url || '', model: key === 'local' ? state.settings.model || '' : '' }, key);
  $('provider-model').focus();
}
function providerLabel(provider) { return `${provider.name || ({ local: '本地 Qwen', openai: 'OpenAI', deepseek: 'DeepSeek', custom: '自定义' })[provider.kind] || '模型'} · ${provider.model || '未配置模型'}`; }
function updateProviderPicker() {
  const picker = $('daily-provider');
  const privateMode = (state.active?.mode || state.mode) === 'private';
  const pending = state.pendingSecrets.has(state.active?.id);
  const protectedReply = localResponseInFlight();
  const localOnly = privateMode || pending || protectedReply;
  const selected = localOnly ? 'local' : state.activeProvider;
  const list = state.providers.length ? state.providers : [{ id: 'local', kind: 'local', name: '本地', model: state.settings.model || 'Qwen' }];
  const key = JSON.stringify([list.map((provider) => [provider.id, provider.name, provider.model, provider.available]), selected, privateMode, pending, protectedReply]);
  if (picker.displayKey !== key) {
    picker.replaceChildren();
    for (const provider of list) {
      if (!localOnly && provider.available === false) continue;
      const option = el('option', '', localOnly && provider.id === 'local' ? `${pending ? '秘密确认' : privateMode ? '私聊' : '本地回答'} · ${provider.model || '本地 Qwen'}` : providerLabel(provider));
      option.value = provider.id;
      option.disabled = provider.available === false;
      picker.append(option);
    }
    if (!localOnly) { const add = el('option', '', '+ 添加模型…'); add.value = '__add__'; picker.append(add); }
    picker.value = selected;
    picker.displayKey = key;
  }
  picker.disabled = localOnly || state.providerLoading;
  picker.title = pending ? '待确认秘密及后续确认只在本地处理' : privateMode ? '私聊固定使用本地模型' : protectedReply ? '这条私密消息的回答正在本地生成' : '选择日常聊天模型；云端模型会收到日常聊天内容';
}
async function loadProviders(openEditor = true) {
  try {
    const result = await rpc('provider.list');
    state.providers = result.items || [];
    state.activeProvider = result.active_id || 'local';
    renderProviders();
    updateProviderPicker();
    if (openEditor && !state.editingProvider) editProvider(state.providers.find((provider) => provider.id === state.activeProvider) || state.providers[0]);
    updateComposer();
  } catch (error) {
    if (state.view === 'connections') resultState($('provider-list'), errorText(error), { error: true, retry: () => loadProviders() });
  }
}
function renderProviders() {
  const container = $('provider-list');
  container.replaceChildren();
  for (const provider of state.providers) {
    const row = button('', `provider-card${provider.id === state.editingProvider?.id ? ' selected' : ''}`, () => editProvider(provider));
    row.append(el('strong', '', provider.name || provider.kind), el('span', 'provider-card-model', provider.model || '尚未设置模型'));
    const status = provider.id === state.activeProvider ? '日常使用中' : provider.available ? (provider.connected ? '连接已验证' : '已配置 · 待验证') : '尚未配置完成';
    row.append(el('span', `provider-card-status${provider.id === state.activeProvider ? ' active' : ''}`, status));
    container.append(row);
  }
}
function editProvider(provider, presetKey = null) {
  state.editingProvider = provider ? { ...provider } : { kind: 'custom', name: '', model: '', base_url: '' };
  state.providerPreset = presetKey || providerPresetFor(state.editingProvider);
  const item = state.editingProvider;
  $('provider-kind').value = item.kind || 'custom';
  $('provider-kind').disabled = Boolean(item.id);
  $('provider-name').value = item.name || '';
  $('provider-model').value = item.model || '';
  $('provider-url').value = item.base_url || '';
  $('provider-api-key').value = '';
  $('provider-clear-key').checked = false;
  $('provider-key-status').textContent = item.has_key ? '已有密钥保存在本机。留空可继续使用。' : '尚未保存密钥。';
  $('delete-provider').hidden = !item.id || ['local', 'openai', 'deepseek'].includes(item.id);
  $('select-provider').disabled = !item.id || item.available === false;
  $('test-provider').disabled = !item.id;
  feedback('provider-feedback', '');
  updateProviderFields();
  renderProviders();
}
function updateProviderFields() {
  const kind = $('provider-kind').value;
  $('provider-key-fields').hidden = kind === 'local';
  $('provider-url-fields').hidden = kind !== 'custom';
  $('provider-name').readOnly = kind !== 'custom';
  const presetKey = kind === 'custom' ? state.providerPreset || 'custom' : kind;
  const preset = providerPresets[presetKey] || providerPresets.custom;
  $('provider-guide-title').textContent = `${preset.name} · 接入指引`;
  $('provider-guide-note').textContent = preset.description;
  $('provider-model-hint').textContent = preset.modelHint;
  $('provider-help-links').hidden = !['openai', 'deepseek', 'gemini', 'doubao'].includes(presetKey);
  $('provider-guide-local').hidden = kind !== 'local';
  $('provider-guide-cloud').hidden = kind === 'local';
  $('provider-connection-note').textContent = kind === 'local' ? '私聊始终使用本地服务。' : '密钥只保存在本机配置中。测试会发送简短请求，可能消耗服务商额度。';
  $('provider-return-chat').hidden = !state.editingProvider?.id || state.editingProvider.id !== state.activeProvider;
  $('provider-guide-progress').textContent = !state.editingProvider?.id || state.editingProvider.available === false ? '下一步：填好配置，保存连接。' : state.editingProvider.id === state.activeProvider ? '已设为日常模型，可返回聊天。' : state.editingProvider.connected ? '连接已验证，点击「用于日常聊天」。' : '配置已保存，下一步测试连接。';
}
function providerFormDirty() {
  const item = state.editingProvider;
  return !item?.id || $('provider-model').value.trim() !== (item.model || '') || ($('provider-kind').value === 'custom' && ($('provider-name').value.trim() !== (item.name || '') || $('provider-url').value.trim() !== (item.base_url || ''))) || Boolean($('provider-api-key').value) || $('provider-clear-key').checked;
}
async function saveProvider(event) {
  event.preventDefault();
  $('save-provider').disabled = true;
  const payload = { ...(state.editingProvider?.id ? { id: state.editingProvider.id } : {}), kind: $('provider-kind').value, name: $('provider-name').value.trim(), model: $('provider-model').value.trim(), base_url: $('provider-url').value.trim(), api_key: $('provider-api-key').value, clear_key: $('provider-clear-key').checked };
  $('provider-api-key').value = '';
  try {
    const saved = await rpc('provider.save', payload);
    payload.api_key = '';
    await loadProviders(false);
    editProvider(saved);
    feedback('provider-feedback', '配置已保存。请测试连接，再用于日常聊天。');
  } catch (error) { feedback('provider-feedback', `${errorText(error)}${payload.api_key ? '\n密钥输入已清空，需要时请重新填写。' : ''}`, true); }
  finally { payload.api_key = ''; $('provider-api-key').value = ''; $('save-provider').disabled = false; }
}
async function testProvider() {
  if (providerFormDirty()) { feedback('provider-feedback', '请先保存修改，再测试这个连接。'); return; }
  const id = state.editingProvider?.id;
  if (!id) return;
  $('test-provider').disabled = true;
  feedback('provider-feedback', '正在发送一条简短请求验证连接…');
  try {
    const result = await rpc('provider.test', { id });
    if (result.ok !== true) throw new Error(result.error || '连接尚未验证通过。');
    feedback('provider-feedback', '连接验证通过');
    await loadProviders(false);
    const item = state.providers.find((provider) => provider.id === id);
    if (item) state.editingProvider = item;
    updateProviderFields();
  } catch (error) { feedback('provider-feedback', errorText(error), true); }
  finally { $('test-provider').disabled = false; }
}
async function selectProvider(id) {
  const previous = state.activeProvider;
  state.providerLoading = true;
  updateComposer();
  try {
    const result = await rpc('provider.select', { id });
    state.activeProvider = result.id || id;
    if (state.view === 'connections') feedback('provider-feedback', '已用于接下来的日常聊天；私聊仍使用本地模型。');
    updateComposer();
  } catch (error) { state.activeProvider = previous; toast(errorText(error), true); }
  finally { state.providerLoading = false; updateComposer(); renderProviders(); if (state.editingProvider) updateProviderFields(); }
}
function deleteProvider() {
  const item = state.editingProvider;
  if (!item?.id) return;
  openModal({ title: '删除这个连接？', description: '这个连接及其本机保存的密钥将被移除。', submit: '删除', danger: true, onSubmit: async () => {
    await rpc('provider.delete', { id: item.id });
    state.editingProvider = null;
    await loadProviders();
  } });
}

let cropImage = null;
let cropOffset = { x: 0, y: 0 };
let cropDrag = null;
function drawAvatarCrop() {
  if (!cropImage) return;
  const canvas = $('avatar-crop-canvas');
  const context = canvas.getContext('2d');
  const size = canvas.width;
  const scale = Math.max(size / cropImage.naturalWidth, size / cropImage.naturalHeight) * Number($('avatar-crop-zoom').value);
  const width = cropImage.naturalWidth * scale;
  const height = cropImage.naturalHeight * scale;
  cropOffset.x = Math.max(-(width - size) / 2, Math.min((width - size) / 2, cropOffset.x));
  cropOffset.y = Math.max(-(height - size) / 2, Math.min((height - size) / 2, cropOffset.y));
  context.clearRect(0, 0, size, size);
  context.drawImage(cropImage, (size - width) / 2 + cropOffset.x, (size - height) / 2 + cropOffset.y, width, height);
}
async function cropImportedAvatar(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片无法打开，请换一张图片。')); image.src = dataUrl; });
  cropImage = image;
  cropOffset = { x: 0, y: 0 };
  $('avatar-crop-zoom').value = '1';
  drawAvatarCrop();
  $('avatar-crop-modal').showModal();
  $('avatar-crop-canvas').focus();
}
function companionForm() { return { mode: $('companion-mode').value, visible: $('companion-visible').checked, scale: Number($('companion-scale').value), artwork: state.companion.artwork || null }; }
function renderCompanionArtwork() {
  $('companion-artwork-fields').hidden = $('companion-mode').value !== 'illustration';
  $('avatar-library-fields').hidden = $('companion-mode').value !== 'avatar';
  $('companion-artwork-preview').replaceChildren();
  if (state.companion.artwork) { const image = document.createElement('img'); image.src = state.companion.artwork; image.alt = '桌面立绘预览'; $('companion-artwork-preview').append(image); }
  else $('companion-artwork-preview').append(el('span', '', '导入一张独立的桌面立绘'));
  $('clear-companion').disabled = !state.companion.artwork;
  $('companion-scale-label').textContent = `${Math.round(Number($('companion-scale').value) * 100)}%`;
}
async function loadCompanion() {
  if (state.companionDirty) return;
  try {
    state.companion = await rpc('companion.get');
    $('companion-mode').value = state.companion.mode || 'orb';
    $('companion-visible').checked = Boolean(state.companion.visible);
    $('companion-scale').value = state.companion.scale || 1;
    renderCompanionArtwork();
  } catch (error) { feedback('companion-feedback', errorText(error), true); }
}
async function saveCompanion(event) {
  event.preventDefault();
  const value = companionForm();
  if (value.mode === 'illustration' && !value.artwork) { feedback('companion-feedback', '请先导入桌面立绘。', true); return; }
  if (value.mode === 'avatar' && !state.avatarLibrary.active_id) { feedback('companion-feedback', '请先导入并选择角色。', true); return; }
  $('save-companion').disabled = true;
  try { state.companion = await rpc('companion.save', value); state.companionDirty = false; feedback('companion-feedback', '桌面陪伴设置已保存'); }
  catch (error) { feedback('companion-feedback', errorText(error), true); }
  finally { $('save-companion').disabled = false; }
}

let voiceRecorder = null;
let voiceStream = null;
let recordingTimer = null;
let voiceTranscribing = false;
let foreignRecording = false;
let playback = null;
let speechGeneration = 0;
let speechResolve = null;
let recordingStarted = 0;
let microphoneStarting = false;
let speechActive = false;
let voiceAudioContext = null;
let voiceMeter = null;
let voiceLevel = 0;
let speechQueue = null;
let speechOutput = null;
let speechCursor = 0;
let speechStopBarrier = Promise.resolve();
let speechStartBarrier = Promise.resolve();
const speechSources = new Set();
let voiceConversation = null;
let touchPlayback = null;
const touchAudioCache = new Map();
function finishTouch(id, busy = false) { if(touchPlayback?.id===id)touchPlayback=null;rpc('companion.touch.end',{id,busy}).catch(()=>{}); }

function stopVoiceMeter() {
  if (voiceMeter) {
    cancelAnimationFrame(voiceMeter.frame);
    voiceMeter.source.disconnect();
    voiceMeter.analyser.disconnect();
    voiceMeter = null;
  }
  voiceLevel = 0;
}
async function startVoiceMeter(input, kind) {
  stopVoiceMeter();
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    voiceAudioContext ||= new Context();
    await voiceAudioContext.resume();
    // A canceled preparation must not reconnect an old source to the speaker.
    if (kind === 'speaker' && input !== playback) return;
    if (kind === 'buffer' && input !== speechOutput) return;
    if (kind === 'microphone' && input !== voiceStream) return;
    const analyser = voiceAudioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const source = kind === 'buffer' ? input : kind === 'speaker' ? voiceAudioContext.createMediaElementSource(input) : voiceAudioContext.createMediaStreamSource(input);
    source.connect(analyser);
    if (kind !== 'microphone') analyser.connect(voiceAudioContext.destination);
    const meter = { source, analyser, frame: 0, lastPublish: 0 };
    voiceMeter = meter;
    const samples = new Uint8Array(analyser.fftSize);
    const measure = (now) => {
      if (voiceMeter !== meter) return;
      analyser.getByteTimeDomainData(samples);
      let squares = 0;
      for (const value of samples) squares += ((value - 128) / 128) ** 2;
      const rms = Math.sqrt(squares / samples.length);
      // This is the decoded audio signal, not an invented waveform.
      voiceLevel = Math.min(1, rms * 5.5);
      if (now - meter.lastPublish >= 80) { meter.lastPublish = now; publishAssistantState(); }
      meter.frame = requestAnimationFrame(measure);
    };
    meter.frame = requestAnimationFrame(measure);
  } catch (_) { stopVoiceMeter(); /* Playback and transcription stay usable without visualization. */ }
}

function updateSpeechControls(text = '', active = false) {
  speechActive = active;
  $('voice-playback-status').textContent = active ? text : '';
  $('test-voice').replaceChildren(svg(active ? 'stop' : 'volume'), document.createTextNode(active ? '停止试听' : '试听声音'));
  $('test-voice').setAttribute('aria-label', active ? '停止声音播放或准备' : '试听已保存的声音');
  $('stop-audio').hidden = !active;
  if(!active && touchPlayback)finishTouch(touchPlayback.id);
}

function voiceState(text = '', speaking = false) {
  if (!text && voiceConversation && !speaking) text = '正在聆听…';
  $('voice-activity').textContent = text;
  $('record-audio').classList.toggle('recording', Boolean(voiceRecorder && voiceRecorder.state === 'recording'));
  $('record-audio').setAttribute('aria-label', voiceRecorder?.state === 'recording' ? '停止录音并识别' : '录音输入');
  $('record-audio').title = voiceRecorder?.state === 'recording' ? tr('停止录音并识别') : tr((state.voice.settings?.voice_input_mode || 'direct') === 'direct' ? '录音输入，识别后直接发送' : '录音输入，识别后可编辑');
  $('record-audio').disabled = voiceTranscribing || foreignRecording || microphoneStarting;
  updateSpeechControls(text, speaking);
  publishAssistantState();
}
function publishAssistantState() {
  rpc('ui.voice_state', { source:touchPlayback ? 'touch' : null, touch_id:touchPlayback?.id || null, recording: Boolean(voiceRecorder?.state === 'recording' || voiceConversation?.capturing), speaking: speechActive, thinking: [...state.jobs.values()].some((job) => !job.replyDone), level: voiceLevel, conversation_id: state.active?.id || null, mode: state.active?.mode || state.mode, mode_revision: currentModeRevision(), text: $('voice-activity').textContent || '' }).catch(() => {});
}
function stopSpeaking(announce = true) {
  if(touchPlayback)finishTouch(touchPlayback.id);
  speechGeneration++;
  for (const job of state.jobs.values()) if (!job.replyDone) job.speechStopped = true;
  speechQueue?.cancel(); speechQueue = null;
  for (const source of speechSources) { try { source.stop(); } catch (_) {} }
  speechSources.clear();
  speechOutput = null;
  speechCursor = 0;
  const pendingStart = speechStartBarrier;
  speechStopBarrier = speechStopBarrier.then(() => pendingStart).then(() => rpc('voice.stop')).catch(() => {});
  stopVoiceMeter();
  if (playback) { playback.pause(); playback.removeAttribute('src'); playback.load(); playback = null; }
  if (speechResolve) { speechResolve(); speechResolve = null; }
  updateSpeechControls();
  $('voice-activity').textContent = '';
  if (announce) voiceState('');
}
function speechChunks(raw) { return new SpeechPipeline.SentenceBuffer().push(String(raw || ''), true); }
async function* streamSpeechAudio(text, generation) {
  const starting = rpc('voice.start', { text });
  speechStartBarrier = starting.then(() => {}, () => {});
  const session = await starting;
  let after = 0;
  const deadline = Date.now() + 180000;
  while (generation === speechGeneration) {
    if (Date.now() > deadline) throw new Error('声音准备超时，请缩短文本后重试。');
    const result = await rpc('voice.poll', { session_id: session.id, after });
    if(result.diagnostics)state.voice.synthesis_metrics=result.diagnostics;
    for (const audio of result.chunks || []) {
      if (generation !== speechGeneration) return;
      if (audio.seq <= after) continue;
      if (audio.seq !== after + 1 || !audio.audio_base64 || audio.mime_type !== 'audio/wav') throw new Error('语音服务没有返回连续可播放的声音。');
      after = audio.seq;
      const bytes = Uint8Array.from(atob(audio.audio_base64), character => character.charCodeAt(0));
      const decoded = await voiceAudioContext.decodeAudioData(bytes.buffer);
      if (generation !== speechGeneration) return;
      yield decoded;
    }
    if (result.done) {
      if (result.error) throw new Error(result.error);
      // The final batch also needs an acknowledgement, otherwise its base64
      // payload stays resident until the next utterance replaces the session.
      if (after > 0) await rpc('voice.poll', { session_id: session.id, after }).catch(() => {});
      return;
    }
    await delay(60);
  }
}
function beginSpeech() {
  stopSpeaking(false);
  const generation = speechGeneration;
  const Context = window.AudioContext || window.webkitAudioContext;
  let initialized;
  const initialize = async () => {
    await speechStopBarrier;
    if (generation !== speechGeneration) throw new Error('朗读已停止。');
    if (!Context) throw new Error('当前设备不支持连续音频播放。');
    voiceAudioContext ||= new Context();
    await voiceAudioContext.resume();
    if (generation !== speechGeneration) throw new Error('朗读已停止。');
    speechOutput = voiceAudioContext.createGain();
    await startVoiceMeter(speechOutput, 'buffer');
  };
  const queue = new SpeechPipeline.SpeechQueue({
    clock: () => voiceAudioContext?.currentTime || 0,
    onMetrics: metrics => { state.voice.playback_metrics = metrics; },
    prepare: async text => {
      initialized ||= initialize(); await initialized;
      if (generation !== speechGeneration) throw new Error('朗读已停止。');
      voiceState('准备朗读…', true);
      return streamSpeechAudio(text, generation);
    },
    play: buffer => {
      if (generation !== speechGeneration) return;
      const source = voiceAudioContext.createBufferSource(); source.buffer = buffer;
      source.connect(speechOutput); speechSources.add(source);
      const start = Math.max(voiceAudioContext.currentTime + 0.025, speechCursor);
      speechCursor = start + buffer.duration;
      voiceState('正在朗读', true);
      const ended = new Promise(resolve => { source.onended = () => { speechSources.delete(source); source.disconnect(); source.onended = null; try { source.buffer = null; } catch {} resolve(); }; });
      source.start(start); return ended;
    },
    onError: error => { if (generation === speechGeneration) { toast(errorText(error), true); stopSpeaking(); } },
    onDone: () => { if (generation === speechGeneration) { speechQueue = null; speechOutput = null; stopVoiceMeter(); voiceState(voiceConversation ? '正在聆听…' : ''); } },
  });
  speechQueue = queue;
  return { queue, generation };
}
async function speakText(text) {
  if (voiceRecorder?.state === 'recording' || foreignRecording || microphoneStarting || voiceConversation?.capturing) { toast('请先结束录音，再朗读回答。'); return; }
  const chunks = speechChunks(text); if (!chunks.length) return;
  const session = beginSpeech();
  for (const chunk of chunks) session.queue.enqueue(chunk);
  await session.queue.finish();
}
function feedJobSpeech(job, delta = '', final = false, finalText = '') {
  if (job.speechStopped || job.speechFinalized || state.voice.settings?.auto_speak === false || state.active?.id !== job.conversationId
      || (job.speechModeRevision !== undefined && job.speechModeRevision !== currentModeRevision())
      || voiceRecorder?.state === 'recording' || voiceConversation?.capturing || foreignRecording || microphoneStarting) return;
  // In the selected low-memory mode, avoid concurrent local text and speech
  // inference. Reuse the answer already held by the chat rather than keeping
  // another copy of every deferred token. Cloud and balanced remain streaming.
  const local = job.speechLocal === true || job.userMessage?.privacy === 'private';
  const defer = job.speechDeferred || ((job.resourcePreset || state.resourcePreset) === 'low_memory' && local);
  if (defer && !final) { job.speechDeferred = true; return; }
  job.speechBuffer ||= new SpeechPipeline.SentenceBuffer();
  const chunks = job.speechBuffer.push(defer ? (finalText || job.text) : (final && !job.text ? finalText : delta), final);
  if (chunks.length && !job.speechSession) {
    job.speechSession = beginSpeech();
    // beginSpeech cancels older output; this job now owns the new generation.
    job.speechStopped = false;
  }
  if (job.speechSession?.generation !== speechGeneration) return;
  for (const chunk of chunks) job.speechSession.queue.enqueue(chunk);
  if (final) { job.speechFinalized = true; job.speechSession?.queue.finish(); }
}
async function toggleRecording() {
  if (voiceConversation) { stopVoiceConversation(); return; }
  if (voiceRecorder?.state === 'recording') { voiceRecorder.stop(); return; }
  if (voiceTranscribing || microphoneStarting || foreignRecording) return;
  const context = { id: state.active?.id || null, mode: state.active?.mode || state.mode, mode_revision: currentModeRevision(), draft: $('chat-input').value };
  microphoneStarting = true;
  $('record-audio').disabled = true;
  stopSpeaking(false);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { microphoneStarting = false; voiceState(''); toast('当前窗口无法使用麦克风，请重新打开桌面应用。', true); return; }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!mimeType) throw new Error('当前录音格式不受支持。');
    const chunks = [];
    voiceRecorder = new MediaRecorder(voiceStream, { mimeType, audioBitsPerSecond: 64000 });
    let bytes = 0;
    voiceRecorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunks.push(event.data);
      bytes += event.data.size;
      if (bytes > 8 * 1024 * 1024 && voiceRecorder?.state === 'recording') voiceRecorder.stop();
    };
    voiceRecorder.onerror = () => { toast('录音中断，请检查麦克风后重试。', true); if (voiceRecorder?.state === 'recording') voiceRecorder.stop(); };
    voiceRecorder.onstop = async () => {
      clearInterval(recordingTimer);
      stopVoiceMeter();
      voiceStream?.getTracks().forEach((track) => track.stop());
      voiceStream = null;
      voiceRecorder = null;
      voiceTranscribing = true;
      voiceState('正在识别录音…');
      try {
        if (bytes > 8 * 1024 * 1024) throw new Error('这段录音过大，请分段录音。');
        const blob = new Blob(chunks, { type: mimeType });
        const buffer = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < buffer.length; i += 16384) binary += String.fromCharCode(...buffer.subarray(i, i + 16384));
        const result = await rpc('voice.transcribe', { audio_base64: btoa(binary), mime_type: mimeType });
        if (!result.text?.trim()) { toast('没有听清楚，请再说一次。'); return; }
        await receiveTranscript(result.text.trim(), context, (state.voice.settings?.voice_input_mode || 'direct') === 'direct');
      } catch (error) { toast(errorText(error), true); }
      finally { voiceTranscribing = false; voiceState(''); }
    };
    voiceRecorder.start(250);
    startVoiceMeter(voiceStream, 'microphone');
    microphoneStarting = false;
    recordingStarted = Date.now();
    voiceState('正在录音 0:00');
    recordingTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingStarted) / 1000);
      voiceState(`正在录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (seconds >= 59 && voiceRecorder?.state === 'recording') voiceRecorder.stop();
    }, 500);
  } catch (error) {
    stopVoiceMeter();
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    microphoneStarting = false;
    voiceState('');
    toast(error.name === 'NotAllowedError' ? '麦克风权限未开启，请在系统设置中允许录音。' : errorText(error), true);
  }
}
function updateConversationVoiceControl() {
  const button = $('voice-conversation');
  if (!button) return;
  button.classList.toggle('enabled', Boolean(voiceConversation));
  button.setAttribute('aria-pressed', String(Boolean(voiceConversation)));
  button.title = tr(voiceConversation ? '结束连续语音' : '开始连续语音');
  button.setAttribute('aria-label', button.title);
}
function stopVoiceConversation() {
  const session = voiceConversation;
  if (!session) return;
  voiceConversation = null; session.closed = true;
  rpc('resources.continuous', { enabled: false, session_id: session.resourceId }).catch(() => {});
  session.node?.disconnect(); session.source?.disconnect(); session.mute?.disconnect();
  session.stream?.getTracks().forEach(track => track.stop());
  if (session.context) session.context.close().catch(() => {});
  session.parts = []; session.preRoll = [];
  updateConversationVoiceControl();
  if (!speechActive) voiceState('');
  else publishAssistantState();
}
async function toggleVoiceConversation() {
  if (voiceConversation) { stopVoiceConversation(); return; }
  if (!state.ready || voiceRecorder || microphoneStarting || voiceTranscribing || foreignRecording) return;
  if (state.intent !== 'chat') { toast('请先切回聊天，再开始连续语音。'); return; }
  stopSpeaking(false);
  const session = { resourceId: `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`, closed: false, capturing: false, processing: false, parts: [], preRoll: [], preFrames: 0, interruption: Promise.resolve() };
  voiceConversation = session; updateConversationVoiceControl();
  try {
    await showView('chat');
    voiceState('正在准备语音…');
    await speechStopBarrier;
    if (session.closed) return;
    await rpc('resources.continuous', { enabled: true, session_id: session.resourceId });
    if (session.closed) { await rpc('resources.continuous', { enabled: false, session_id: session.resourceId }); return; }
    await rpc('voice.prepare');
    if (session.closed) return;
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (session.closed) { session.stream.getTracks().forEach(track => track.stop()); return; }
    for (const track of session.stream.getAudioTracks()) track.addEventListener('ended', () => { if (voiceConversation === session) stopVoiceConversation(); });
    const Context = window.AudioContext || window.webkitAudioContext;
    session.context = new Context(); await session.context.resume();
    if (session.closed) return;
    session.detector = new SpeechPipeline.VoiceActivityDetector(session.context.sampleRate);
    session.source = session.context.createMediaStreamSource(session.stream);
    const capture = samples => captureVoiceFrame(session, samples);
    if (session.context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      await session.context.audioWorklet.addModule('voice_capture_worklet.js');
      session.node = new AudioWorkletNode(session.context, 'laurentina-capture');
      session.node.port.onmessage = event => capture(new Float32Array(event.data));
    } else {
      session.node = session.context.createScriptProcessor(2048, 1, 1);
      session.node.onaudioprocess = event => capture(event.inputBuffer.getChannelData(0).slice());
    }
    if (session.closed) { session.node.disconnect(); await session.context.close().catch(() => {}); return; }
    session.mute = session.context.createGain(); session.mute.gain.value = 0;
    session.source.connect(session.node); session.node.connect(session.mute); session.mute.connect(session.context.destination);
    voiceState('正在聆听…');
  } catch (error) {
    if (voiceConversation === session) {
      stopVoiceConversation();
      toast(error.name === 'NotAllowedError' ? '麦克风权限未开启，请在系统设置中允许录音。' : errorText(error), true);
    }
  }
}
function captureVoiceFrame(session, samples) {
  if (session.closed || session !== voiceConversation || session.processing) return;
  const event = session.detector.process(samples, speechActive);
  if (!session.capturing) {
    session.preRoll.push(samples); session.preFrames += samples.length;
    while (session.preFrames > session.context.sampleRate * 0.6 && session.preRoll.length > 1) session.preFrames -= session.preRoll.shift().length;
  } else session.parts.push(samples);
  if (event.type === 'start') {
    session.capturing = true; session.parts = session.preRoll; session.preRoll = []; session.preFrames = 0;
    session.destination = { id: state.active?.id || null, mode: state.active?.mode || state.mode, mode_revision: currentModeRevision() };
    stopSpeaking(false);
    const job = activeJob();
    session.interruptedJob = job && !job.replyDone ? job : null;
    session.interruption = job && !job.replyDone ? cancelJob(job) : Promise.resolve();
    voiceState('正在听你说…');
  }
  if (session.capturing) {
    voiceLevel = Math.min(1, event.level * 5.5);
    if (!session.lastPublish || Date.now() - session.lastPublish >= 90) { session.lastPublish = Date.now(); publishAssistantState(); }
  }
  if (event.type === 'end' && session.capturing) {
    session.capturing = false;
    const parts = session.parts; session.parts = [];
    processVoiceTurn(session, parts);
  }
}
async function processVoiceTurn(session, parts) {
  session.processing = true; voiceTranscribing = true; voiceState('正在识别录音…');
  try {
    const bytes = new Uint8Array(SpeechPipeline.wavFromPCM(parts, session.context.sampleRate));
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    const result = await rpc('voice.transcribe', { audio_base64: btoa(binary), mime_type: 'audio/wav' });
    await session.interruption;
    const deadline = Date.now() + 2000;
    while (session.interruptedJob && !session.interruptedJob.replyDone && !session.closed && Date.now() < deadline) await delay(80);
    if (session.closed || session !== voiceConversation) return;
    if (result.text?.trim()) await receiveTranscript(result.text.trim(), session.destination, (state.voice.settings?.voice_input_mode || 'direct') === 'direct');
  } catch (error) { if (!session.closed) toast(errorText(error), true); }
  finally {
    voiceTranscribing = false; session.processing = false; session.detector.reset();
    if (session === voiceConversation) { if (speechActive) publishAssistantState(); else voiceState('正在聆听…'); }
  }
}
async function receiveVoiceTranscript(payload) {
  const text = (typeof payload === 'string' ? payload : payload?.text)?.trim();
  if (!text) return;
  const captured = payload && typeof payload === 'object' && payload.context_captured === true;
  const context = captured ? { id: payload.conversation_id || null, mode: payload.mode || 'daily', mode_revision: payload.mode_revision }
    : { id: state.active?.id || null, mode: state.active?.mode || state.mode, mode_revision: currentModeRevision() };
  const direct = (state.voice.settings?.voice_input_mode || 'direct') === 'direct';
  context.background = payload?.open_panel === false;
  // Old senders without captured context remain editable; do not route delayed
  // speech into an unrelated chat merely because it is now in the foreground.
  await receiveTranscript(text, context, captured && payload.submit === true && direct);
}
async function receiveTranscript(text, context = { id: state.active?.id || null, mode: state.active?.mode || state.mode, mode_revision: currentModeRevision() }, submit = false) {
  const sameConversation = (context.id ? state.active?.id === context.id : !state.active) && (state.active?.mode || state.mode) === context.mode;
  if (sameConversation) {
    if(!context.background) await showView('chat');
    // Navigating views may await a refresh. Recheck the original destination.
    const stillSame = (context.id ? state.active?.id === context.id : !state.active) && (state.active?.mode || state.mode) === context.mode;
    if (!stillSame) return receiveTranscript(text, context, false);
    const previousDraft = $('chat-input').value.trim();
    $('chat-input').value = [previousDraft, text].filter(Boolean).join('\n');
    stashDraft();
    resizeInput();
    if(!context.background) $('chat-input').focus();
    const busy = state.switchingMode || state.sending || state.providerLoading || !state.ready || (activeJob() && !activeJob().replyDone)
      || state.secretBusy.has(state.pendingSecrets.get(state.active?.id)?.id);
    if (submit && Number.isSafeInteger(context.mode_revision) && context.mode_revision === currentModeRevision() && !busy && !previousDraft && state.intent === 'chat') {
      await sendMessage();
    } else toast(tr(submit ? '录音已保留在输入框，请确认后发送。' : '录音已转为文字，可编辑后发送。'));
    return;
  }
  let destinationId = context.id;
  let created = false;
  if (!destinationId || !state.conversations.some((item) => item.id === destinationId)) {
    const conversation = await rpc('conversation.create', { mode: context.mode || 'daily' });
    destinationId = conversation.id;
    created = true;
    upsertConversation(conversation);
  }
  const destinationKey = draftKey({ id: destinationId, mode: context.mode });
  const previous = state.drafts.get(destinationKey) ?? (context.id ? '' : state.drafts.get(`new:${context.mode}`) ?? context.draft ?? '');
  state.drafts.set(destinationKey, [previous.trim(), text].filter(Boolean).join('\n'));
  toast(created ? `录音已转为文字，已放入新的${modeName(context.mode)}草稿。` : '录音已转为文字，已放回原来的对话草稿。');
}
function updateVoiceFields() {
  const custom = $('tts-provider').value === 'custom';
  $('piper-voice-fields').hidden = custom;
  $('custom-voice-fields').hidden = !custom;
  if ($('voice-clone-fields')) $('voice-clone-fields').hidden = !custom;
}
function updateAutoSpeakControl() {
  const enabled = state.voice.settings?.auto_speak !== false;
  $('toggle-auto-speak').setAttribute('aria-pressed', String(enabled));
  $('toggle-auto-speak').setAttribute('aria-label', tr(enabled ? '关闭自动朗读' : '开启自动朗读'));
  $('toggle-auto-speak').title = tr(enabled ? '自动朗读已开启，点击关闭' : '自动朗读已关闭，点击开启');
  $('toggle-auto-speak').classList.toggle('enabled', enabled);
  $('toggle-auto-speak').replaceChildren(svg(enabled ? 'volume' : 'volumeOff'));
  $('toggle-auto-speak').disabled = state.voicePreferenceSaving;
  $('save-voice').disabled = state.voicePreferenceSaving;
  $('auto-speak').checked = enabled;
}
async function toggleAutoSpeak() {
  if (state.voicePreferenceSaving) return;
  const enabled = state.voice.settings?.auto_speak === false;
  const previous = state.voice.settings || {};
  state.voicePreferenceSaving = true;
  state.voiceSettingsVersion++;
  state.voice.settings = { ...previous, auto_speak: enabled };
  if (!enabled) stopSpeaking();
  updateAutoSpeakControl();
  try {
    const result = await rpc('voice.settings.save', { auto_speak: enabled });
    state.voice.settings = result.settings || result;
    toast(enabled ? '自动朗读已开启' : '自动朗读已关闭');
  } catch (error) { state.voice.settings = previous; toast(errorText(error), true); }
  finally { state.voicePreferenceSaving = false; updateAutoSpeakControl(); }
}
async function refreshVoice() {
  $('refresh-voice').disabled = true;
  const settingsVersion = state.voiceSettingsVersion;
  try {
    const result = await rpc('voice.status');
    if (settingsVersion !== state.voiceSettingsVersion || state.voicePreferenceSaving) return;
    state.voice = result;
    const settings = result.settings || {};
    $('tts-provider').value = settings.tts_provider || 'piper';
    $('tts-custom-url').value = settings.custom_url || '';
    $('tts-custom-model').value = settings.custom_model || '';
    $('tts-custom-voice').value = settings.custom_voice || '';
    $('speech-rate').value = settings.speech_rate || 1;
    $('speech-language').value = settings.speech_language || 'Auto';
    if ($('voice-clone-mode')) $('voice-clone-mode').value = settings.voice_clone_mode || 'icl';
    $('voice-orb-open-panel').checked = settings.voice_orb_open_panel === true;
    $('speech-rate-value').textContent = `${Number(settings.speech_rate || 1).toFixed(2)}×`;
    $('auto-speak').checked = Boolean(settings.auto_speak);
    updateAutoSpeakControl();
    if ($('voice-input-mode')) $('voice-input-mode').value = settings.voice_input_mode || 'direct';
    if (!voiceRecorder && !microphoneStarting && !voiceTranscribing) $('record-audio').title = tr((settings.voice_input_mode || 'direct') === 'direct' ? '录音输入，识别后直接发送' : '录音输入，识别后可编辑');
    $('tts-voice').replaceChildren();
    const voices = Array.isArray(result.voices) ? result.voices : [];
    for (const voice of voices) { const option = el('option', '', voice.name || voice.id); option.value = voice.id; $('tts-voice').append(option); }
    if (!voices.length) { const option = el('option', '', '本地声音尚未就绪'); option.value = ''; $('tts-voice').append(option); }
    if (settings.voice) $('tts-voice').value = settings.voice;
    $('asr-status').textContent = result.asr_ready ? '已就绪 · 中文 / English' : '未就绪';
    $('asr-status').classList.toggle('error', !result.asr_ready);
    const customUnverified = settings.tts_provider === 'custom' && result.tts_ready && result.provider_verified === false;
    $('tts-status').textContent = customUnverified ? '已配置 · 待试听' : result.tts_ready ? '已就绪' : '未就绪';
    $('tts-status').classList.toggle('error', !result.tts_ready || customUnverified);
    $('voice-detail').textContent = result.error || (customUnverified ? '自定义服务已配置，请试听确认连接与声音。' : '');
    updateVoiceFields();
  } catch (error) { $('voice-detail').textContent = errorText(error); }
  finally { $('refresh-voice').disabled = false; }
}
async function saveVoiceSettings(event) {
  event.preventDefault();
  if (state.voicePreferenceSaving) return;
  const previous = state.voice.settings || {};
  state.voicePreferenceSaving = true;
  state.voiceSettingsVersion++;
  state.voice.settings = { ...previous, auto_speak: $('auto-speak').checked };
  stopSpeaking(false);
  updateAutoSpeakControl();
  try {
    const settings = await rpc('voice.settings.save', { tts_provider: $('tts-provider').value, voice: $('tts-voice').value || 'auto', custom_url: $('tts-custom-url').value.trim(), custom_model: $('tts-custom-model').value.trim(), custom_voice: $('tts-custom-voice').value.trim(), auto_speak: $('auto-speak').checked, voice_input_mode: $('voice-input-mode')?.value || 'direct', speech_rate: Number($('speech-rate').value), speech_language: $('speech-language').value, voice_clone_mode: $('voice-clone-mode')?.value || 'icl', voice_orb_open_panel:$('voice-orb-open-panel').checked });
    state.voice.settings = settings.settings || settings;
    updateAutoSpeakControl();
    feedback('voice-feedback', '声音设置已保存');
    refreshVoice();
  } catch (error) { state.voice.settings = previous; feedback('voice-feedback', errorText(error), true); }
  finally { state.voicePreferenceSaving = false; updateAutoSpeakControl(); }
}
function previewVoice() {
  if (speechActive) { stopSpeaking(); return; }
  const settings = state.voice.settings || {};
  const provider = settings.tts_provider || 'piper';
  const voice = settings.voice || 'auto';
  const dirty = (provider === 'custom' && ($('speech-language').value !== (settings.speech_language || 'Auto') || ($('voice-clone-mode')?.value || 'icl') !== (settings.voice_clone_mode || 'icl'))) || $('tts-provider').value !== provider || (provider === 'piper' && $('tts-voice').value !== voice) || (provider === 'custom' && ($('tts-custom-url').value.trim() !== (settings.custom_url || '') || $('tts-custom-model').value.trim() !== (settings.custom_model || '') || $('tts-custom-voice').value.trim() !== (settings.custom_voice || '')));
  if (dirty) { feedback('voice-feedback', '请先保存声音设置，再试听所选声音。'); return; }
  const chinese = `你好，我是${state.character.name || '劳纶缇娜'}。很高兴听见你的声音。`;
  const english = "Hello, I'm Laurentina. It's good to hear your voice.";
  speakText(voice.startsWith('en_') ? english : voice.startsWith('zh_') ? chinese : `${chinese}\n\n${english}`);
}

async function refreshVoiceProfiles() {
  try {
    const result = await rpc('voice.profiles.list');
    const status = result.status || {};
    $('voice-profile-status').textContent = !status.models_ready ? status.error || '本地自定义声音尚未准备好。'
      : status.service_running ? (status.model_loaded ? '本地声线服务已就绪' : '服务已启动，首次试听会准备声音模型') : '模型已准备好，使用时启动本地服务';
    $('start-custom-voice').disabled = !status.models_ready || status.service_running;
    $('stop-custom-voice').disabled = !status.service_running;
    const container = $('voice-profile-list'); container.replaceChildren();
    for (const profile of result.profiles || []) {
      const card = el('div', 'voice-profile-item');
      const details = el('div'); const name = el('strong', '', profile.name); name.dataset.userContent = 'true'; details.append(name, el('p', 'field-hint', `${Number(profile.duration_seconds).toFixed(1)} s`));
      const actions = el('div', 'voice-profile-actions');
      const selected = state.voice.settings?.tts_provider === 'custom' && state.voice.settings.custom_voice === profile.id;
      actions.append(button(selected ? '正在使用' : '使用这条声线', 'button secondary small', () => voiceProfileAction(async () => {
        const result = await rpc('voice.profiles.use', { id: profile.id });
        state.voice.settings = result.settings; feedback('voice-profile-feedback', '声音已切换，可点击试听。');
      })), button('删除', 'text-button', () => openModal({ title: '删除声音档案', description: '删除后无法继续使用这条声线；若正在使用，将恢复内置声音。', submit: '删除', danger: true,
        onSubmit: () => voiceProfileAction(async () => { await rpc('voice.profiles.delete', { id: profile.id }); }) })));
      card.append(details, actions); container.append(card);
    }
    if (!result.profiles?.length) container.append(el('p', 'field-hint', '还没有声音档案，导入一段参考录音即可添加。'));
  } catch (error) { $('voice-profile-status').textContent = errorText(error); }
}
async function voiceProfileAction(action) {
  if (state.voicePreferenceSaving) return;
  state.voicePreferenceSaving = true; state.voiceSettingsVersion++; updateAutoSpeakControl();
  stopSpeaking(false);
  $('import-voice-profile').disabled = true;
  try { await action(); }
  catch (error) { feedback('voice-profile-feedback', errorText(error), true); }
  finally {
    state.voicePreferenceSaving = false; $('import-voice-profile').disabled = false;
    updateAutoSpeakControl(); await refreshVoice(); await refreshVoiceProfiles();
  }
}
async function importVoiceProfile(event) {
  event.preventDefault();
  const file = $('voice-reference-file').files?.[0];
  if (!file || file.size > 8 * 1024 * 1024) { feedback('voice-profile-feedback', '请选择 8 MB 以内的参考录音。', true); return; }
  await voiceProfileAction(async () => {
    feedback('voice-profile-feedback', '正在准备本地声音档案…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    await rpc('voice.profiles.import', { name: $('voice-profile-name').value.trim(), filename: file.name, audio_base64: btoa(binary), transcript: $('voice-reference-text').value.trim() });
    $('voice-profile-form').reset(); feedback('voice-profile-feedback', '声音档案已保存，选择使用后可试听。');
  });
}

const terminalWorkStates = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'failed', 'error', 'cancelled', 'canceled', 'stopped', 'interrupted', 'unknown']);
function workStatus(status) {
  return tr(({ queued: '等待开始', pending: '等待开始', starting: '正在启动', submitting: '正在提交', stopping: '正在停止', unknown: '提交状态待核对', running: '正在工作', waiting: '等待处理', waiting_approval: '等待你的决定', waiting_for_approval: '等待你的决定', awaiting_approval: '等待你的决定', approval_required: '等待你的决定', completed: '执行结束', complete: '执行结束', succeeded: '执行结束', success: '执行结束', done: '执行结束', failed: '执行失败', error: '执行失败', cancelled: '已停止', canceled: '已停止', stopped: '已停止', interrupted: '已中断' })[status] || status || '等待状态');
}
function workTargetName(target) {
  if (!target) return 'Hermes';
  return target.label || target.title || ({ hermes: 'Hermes', codex: 'Codex', chatgpt: 'ChatGPT' })[target.kind] || '助手';
}
function selectedChatTaskTarget() {
  const key = $('chat-work-target').value;
  const target = state.workTargets.find((item) => `${item.kind}:${item.id || 'default'}` === key);
  return target ? { kind: target.kind, ...(target.id ? { id: target.id } : {}) } : null;
}
function shouldPollTask(task) { return (!terminalWorkStates.has(task.run?.status || task.status) || task.run?.validation?.status === 'pending') && !['draft', 'awaiting_target'].includes(task.status); }
function updateChatTaskTargets() {
  const picker = $('chat-work-target');
  const previous = picker.value;
  picker.replaceChildren();
  const placeholder = el('option', '', '选择执行目标'); placeholder.value = ''; picker.append(placeholder);
  for (const target of state.workTargets) {
    const option = el('option', '', workTargetName(target));
    option.value = `${target.kind}:${target.id || 'default'}`;
    picker.append(option);
  }
  if (previous && [...picker.options].some((option) => option.value === previous)) picker.value = previous;
  else if (previous) {
    const unavailable = el('option', '', '原任务目标暂时不可用，请重新选择');
    unavailable.value = previous; unavailable.disabled = true; unavailable.selected = true; picker.append(unavailable);
  }
  // A newly enabled task composer may offer Hermes, but external IDs are never guessed.
  else if (state.workTargets.some((target) => target.kind === 'hermes')) picker.value = `hermes:${state.workTargets.find((target) => target.kind === 'hermes').id || 'default'}`;
}
function upsertTask(task) {
  if (!task?.task_id || !task.conversation_id) return;
  const list = state.tasksByConversation.get(task.conversation_id) || [];
  const index = list.findIndex((item) => item.task_id === task.task_id);
  if (index >= 0) list[index] = { ...list[index], ...task }; else list.push(task);
  state.tasksByConversation.set(task.conversation_id, list);
  if (['draft', 'awaiting_target'].includes(task.status) && !state.taskTargetRefreshes.has(task.task_id)) {
    state.taskTargetRefreshes.add(task.task_id);
    refreshWork();
  }
  if (state.active?.id === task.conversation_id) {
    const existing = [...$('messages').querySelectorAll('.inline-task-card')].find((node) => node.dataset.taskId === task.task_id);
    if (existing) renderTaskCard(existing, task);
  }
  if (shouldPollTask(task)) pollChatTask(task);
}
function buildTaskCard(task) {
  const card = el('article', 'inline-task-card');
  card.dataset.taskId = task.task_id;
  renderTaskCard(card, task);
  return card;
}
function renderTaskCard(card, task) {
  const run = task.run || {};
  const status = run.status || task.status;
  const signature = JSON.stringify([task.task_id, status, task.error, run.text, run.error, run.approval, run.validation, run.supports_stop, state.taskMutating.has(task.task_id), state.workTargets.map((target) => [target.kind, target.id])]);
  if (card.displayKey === signature) return;
  card.displayKey = signature;
  const previousTarget = card.querySelector('select')?.value;
  card.replaceChildren();
  const header = el('div', 'inline-task-heading');
  const title = el('strong', '', `${({ hermes: 'Hermes', codex: 'Codex', chatgpt: 'ChatGPT' })[task.requested_kind] || '工作'} · ${status === 'awaiting_target' ? tr('请选择目标对话') : status === 'draft' ? tr('等待提交') : workStatus(status)}`);
  header.append(svg('work'), title);
  if (!terminalWorkStates.has(status)) {
    if (['draft', 'awaiting_target'].includes(status) || (task.run_id && run.supports_stop !== false)) header.append(button('停止', 'text-button', () => mutateChatTask(task, 'stop')));
    else if (!task.run_id) header.append(el('span', 'field-hint', '正在取得执行回执'));
    else header.append(el('span', 'field-hint', '在原应用停止'));
  }
  card.append(header);
  if (task.run_id && terminalWorkStates.has(status)) card.append(el('p', 'field-hint', validationLabel(run)));
  if (['awaiting_target', 'draft'].includes(status)) {
    card.append(el('p', 'field-hint', '请选择真实的执行目标；只交接这条任务和共享信息。'));
    const controls = el('div', 'inline-task-controls');
    const select = document.createElement('select');
    select.setAttribute('aria-label', '选择这项任务的目标对话');
    const placeholder = el('option', '', '选择目标对话'); placeholder.value = ''; select.append(placeholder);
    const targets = state.workTargets.filter((target) => target.kind === task.requested_kind && (target.kind === 'hermes' || target.id));
    for (const target of targets) { const option = el('option', '', workTargetName(target)); option.value = `${target.kind}:${target.id || 'default'}`; select.append(option); }
    if (previousTarget && [...select.options].some((option) => option.value === previousTarget)) select.value = previousTarget;
    const start = button('提交任务', 'button primary small', () => {
      const target = targets.find((item) => `${item.kind}:${item.id || 'default'}` === select.value);
      if (!target) { toast('请先选择目标对话。', true); return; }
      mutateChatTask(task, 'start', { target: { kind: target.kind, ...(target.id ? { id: target.id } : {}) } });
    });
    start.disabled = state.taskMutating.has(task.task_id) || !select.value;
    select.addEventListener('change', () => { start.disabled = !select.value; });
    controls.append(select, start, button('', 'icon-button', refreshWork, 'refresh'));
    controls.lastChild.setAttribute('aria-label', '刷新可用任务目标');
    card.append(controls);
  }
  if (run.text) { const content = el('div', 'message-body inline-task-result'); renderMarkdown(content, run.text); card.append(content); }
  if (task.error || run.error) card.append(el('p', 'form-feedback error', task.error || run.error));
  if (status === 'unknown') card.append(el('p', 'field-hint', '请在工作记录或原应用核对，应用不会自动重发这项任务。'));
  if (run.approval && run.supports_approvals !== false && !terminalWorkStates.has(status)) {
    const approval = run.approval;
    const box = el('div', 'work-approval');
    box.append(el('h3', '', '这一步需要你的决定'), el('p', '', approval.reason || '请核对即将执行的操作。'));
    if (approval.command) box.append(el('pre', '', typeof approval.command === 'string' ? approval.command : JSON.stringify(approval.command)));
    const actions = el('div', 'approval-actions');
    const labels = { once: '仅这一次', session: '本次会话允许', always: '始终允许', deny: '拒绝' };
    for (const choice of approval.request_id && Array.isArray(approval.choices) ? approval.choices : []) {
      const value = typeof choice === 'string' ? choice : choice.id || choice.value;
      const control = button(labels[value] || choice.label || value, 'button secondary small', () => mutateChatTask(task, 'approve', { decision: { choice: value, request_id: approval.request_id } }));
      control.disabled = state.taskMutating.has(task.task_id);
      actions.append(control);
    }
    box.append(actions); card.append(box);
  }
  if (task.run_id) card.append(button('在工作页查看', 'text-button', async () => { await showView('work'); await loadWorkRuns(); const selected = state.workRuns.find((item) => item.run_id === task.run_id); if (selected) selectWork(selected); }));
}
async function mutateChatTask(task, action, payload = {}) {
  if (state.taskMutating.has(task.task_id)) return;
  state.taskMutating.add(task.task_id);
  upsertTask(task);
  try {
    const result = await rpc(`chat.task.${action}`, { conversation_id: task.conversation_id, task_id: task.task_id, ...payload });
    upsertTask(result.task || result);
  } catch (error) { toast(errorText(error), true); }
  finally {
    state.taskMutating.delete(task.task_id);
    const latest = (state.tasksByConversation.get(task.conversation_id) || []).find((item) => item.task_id === task.task_id);
    if (latest) upsertTask(latest);
  }
}
async function pollChatTask(task) {
  if (state.taskPolls.has(task.task_id)) return;
  state.taskPolls.add(task.task_id);
  let failures = 0;
  try {
    while (true) {
      await delay(1300);
      if (state.taskMutating.has(task.task_id)) continue;
      try {
        const result = await rpc('chat.task.poll', { conversation_id: task.conversation_id, task_id: task.task_id });
        const current = result.task || result;
        if (state.taskMutating.has(task.task_id)) continue;
        upsertTask(current);
        failures = 0;
        if (!shouldPollTask(current)) break;
      } catch (error) { if (++failures >= 4) { toast('任务状态暂时无法刷新，可到工作页核对；任务不会重新提交。', true); break; } }
    }
  } finally { state.taskPolls.delete(task.task_id); }
}
function upsertRun(run) {
  if (!run?.run_id) return;
  const index = state.workRuns.findIndex((item) => item.run_id === run.run_id);
  if (index >= 0) state.workRuns[index] = { ...state.workRuns[index], ...run };
  else state.workRuns.unshift(run);
  if (state.workActive?.run_id === run.run_id) state.workActive = { ...state.workActive, ...run };
  for (const tasks of state.tasksByConversation.values()) {
    for (const task of [...tasks]) if (task.run_id === run.run_id) upsertTask({ ...task, status: run.status || task.status, run: { ...task.run, ...run } });
  }
  renderWorkList();
}
function renderWorkList() {
  $('work-list').replaceChildren();
  if (!state.workRuns.length) { $('work-list').append(el('p', 'sidebar-empty', '还没有任务。\n把第一件事交给她。')); return; }
  for (const run of state.workRuns) {
    const item = button('', `work-list-item${state.workActive?.run_id === run.run_id ? ' active' : ''}`, () => selectWork(run));
    item.append(el('span', 'work-list-title', (run.content || '任务').slice(0, 40)), el('span', 'work-list-status', workStatus(run.status)));
    $('work-list').append(item);
  }
}
async function loadWorkRuns() {
  try {
    const result = await rpc('work.list');
    state.workRuns = Array.isArray(result.items) ? result.items : Array.isArray(result) ? result : [];
    renderWorkList();
    if (state.workActive) {
      const saved = state.workRuns.find((run) => run.run_id === state.workActive.run_id);
      if (saved) { state.workActive = saved; renderWorkRun(); }
    }
  } catch (error) { $('work-list').replaceChildren(el('p', 'sidebar-empty', errorText(error))); }
}
async function refreshWork() {
  const version = ++state.workRefreshVersion;
  const previousValue = $('work-target').value;
  const previousTarget = state.workSelection || (/^\d+$/.test(previousValue) ? state.workTargets[Number(previousValue)] : null);
  $('refresh-work-targets').disabled = true;
  $('start-work').disabled = true;
  const refreshingBridge = $('work-health').querySelector('.work-bridge-status');
  if (refreshingBridge) { refreshingBridge.textContent = '正在刷新可用助手…'; refreshingBridge.classList.remove('warning'); }
  const [targetResult] = await Promise.allSettled([rpc('work.targets', { query: '' })]);
  // targets refreshes the bridge connection cache; health reads that fresh snapshot.
  const [healthResult] = await Promise.allSettled([rpc('work.health')]);
  if (version !== state.workRefreshVersion) return;
  const box = $('work-health');
  const connectionCopy = el('div', 'work-connection-copy');
  box.replaceChildren(svg('work'), connectionCopy);
  if (healthResult.status === 'fulfilled') {
    const health = healthResult.value;
    const details = [health.model, health.provider].filter(Boolean).join(' · ');
    connectionCopy.append(el('p', '', health.ok ? `Hermes 已连接${details ? ` · ${details}` : ''}。当前执行环境以实际配置为准。` : (health.error || 'Hermes 尚未连接。开始任务时会尝试连接本地执行服务。')));
  } else connectionCopy.append(el('p', '', errorText(healthResult.reason)));
  $('work-target').replaceChildren();
  state.workTargets = [{ kind: 'hermes', title: 'Hermes · 工作执行' }];
  if (targetResult.status === 'fulfilled') {
    const items = targetResult.value.items || targetResult.value;
    if (Array.isArray(items)) {
      for (const target of items) {
        if (!target || !['hermes', 'codex', 'chatgpt'].includes(target.kind)) continue;
        if (target.kind !== 'hermes' && !target.id) continue;
        if (target.kind === 'hermes') { state.workTargets[0] = { ...state.workTargets[0], ...target }; continue; }
        state.workTargets.push(target);
      }
    }
  }
  const bridge = healthResult.status === 'fulfilled' ? healthResult.value.desktop_bridge : null;
  const hermesReady = healthResult.status === 'fulfilled' && healthResult.value.ok;
  const localNote = hermesReady ? ' 本地 Hermes 仍可使用。' : '';
  let bridgeText = '';
  let bridgeWarning = false;
  if (targetResult.status === 'rejected') {
    bridgeText = `暂时无法读取外部对话，请刷新重试。${localNote}`;
    bridgeWarning = true;
  } else if (bridge?.state === 'disconnected') {
    bridgeText = `Codex / ChatGPT 暂时断开。请回到 Codex 重新连接，再刷新这里。${localNote}`;
    bridgeWarning = true;
  } else if (bridge?.state === 'unconfigured') {
    bridgeText = `尚未连接 Codex / ChatGPT。${localNote}`;
  } else if (bridge?.state === 'unverified') {
    bridgeText = `Codex / ChatGPT 的连接尚未确认，请刷新可用助手。${localNote}`;
    bridgeWarning = true;
  } else if (bridge?.state === 'connected') {
    bridgeText = state.workTargets.some((target) => target.kind !== 'hermes') ? '外部对话已连接，可选择具体对话交接任务。' : '当前没有可接续的外部对话。可先在 Codex 打开对话，再刷新这里。';
  } else {
    bridgeText = '外部对话连接尚未确认，可刷新可用助手。';
  }
  connectionCopy.append(el('p', `work-bridge-status${bridgeWarning ? ' warning' : ''}`, bridgeText));
  for (let i = 0; i < state.workTargets.length; i++) {
    const target = state.workTargets[i];
    const option = el('option', '', workTargetName(target));
    option.value = String(i);
    $('work-target').append(option);
  }
  if (previousTarget) {
    const selectedIndex = state.workTargets.findIndex((target) => target.kind === previousTarget.kind && (target.kind === 'hermes' || target.id === previousTarget.id));
    if (selectedIndex >= 0) {
      $('work-target').value = String(selectedIndex);
      if ($('work-feedback').textContent === '原来的助手暂时不可用，请重新选择执行目标。') feedback('work-feedback', '');
    }
    else {
      const unavailable = el('option', '', `${workTargetName(previousTarget)}（暂时不可用）`);
      unavailable.value = '';
      unavailable.disabled = true;
      unavailable.selected = true;
      $('work-target').prepend(unavailable);
      feedback('work-feedback', '原来的助手暂时不可用，请重新选择执行目标。');
    }
  }
  state.workSelection = previousTarget || state.workTargets[Number($('work-target').value)] || null;
  updateChatTaskTargets();
  for (const task of state.tasksByConversation.get(state.active?.id) || []) upsertTask(task);
  $('start-work').disabled = state.workStarting || !/^\d+$/.test($('work-target').value);
  $('refresh-work-targets').disabled = false;
}
async function refreshResources() {
  try {
    const result = await rpc('resources.status');
    state.resourcePreset = result.settings?.preset || 'balanced';
    $('resource-preset').value = result.settings?.preset || 'balanced';
    const ram = result.hardware?.ram || {};
    const gb = value => `${(Number(value) / 1024 ** 3).toFixed(1)} GB`;
    const parts = [];
    if (ram.available) parts.push(`${tr('可用内存')} ${gb(ram.available_bytes)} / ${gb(ram.total_bytes)}`);
    for (const gpu of result.hardware?.gpus || []) parts.push(`${tr('可用显存')} ${gb(gpu.free_bytes)} / ${gb(gpu.total_bytes)}`);
    const pressure = result.pressure?.level;
    if (pressure === 'critical' || pressure === 'warning') parts.push(tr('资源紧张，建议减少同时运行的本地模型。'));
    if (result.continuous || result.continuous_voice) parts.push(tr('连续语音保持就绪'));
    $('resource-status').textContent = parts.join(' · ') || tr('暂未取得硬件状态');
  } catch (error) { $('resource-status').textContent = errorText(error); }
}
async function saveResourceSettings(event) {
  event.preventDefault();
  try {
    await rpc('resources.settings.save', { preset: $('resource-preset').value });
    feedback('resource-feedback', tr('运行偏好已保存')); await refreshResources();
  } catch (error) { feedback('resource-feedback', errorText(error), true); }
}
function readWorkValidation() {
  const root = $('work-validation-root').value.trim();
  const paths = $('work-validation-files').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const totals = $('work-validation-totals').checked;
  if (!root && !paths.length && !totals) return null;
  if (!root || (!paths.length && !totals)) throw new Error(tr('请选择成果目录，并填写预期文件或勾选金额核验。'));
  const checks = [...new Set(paths)].map(path => ({ kind: 'file', path, min_bytes: 1, max_bytes: 10485760 }));
  if (totals) checks.push({ kind: 'csv_json_totals', csv: 'expenses.csv', json: 'summary.json', category_column: 'category', amount_column: 'amount_cents', row_count_pointer: '/row_count', total_pointer: '/grand_total_cents', by_category_pointer: '/by_category_cents' });
  return { root, checks };
}
function restoreWorkValidation(run) {
  const spec = run.validation_spec || run.validation?.spec;
  $('work-validation-root').value = spec?.root || '';
  $('work-validation-files').value = (spec?.checks || []).filter(c => c.kind === 'file').map(c => c.path).join('\n');
  $('work-validation-totals').checked = Boolean(spec?.checks?.some(c => c.kind === 'csv_json_totals'));
}
function validationLabel(run) {
  const status = run?.validation?.status;
  return tr(({ passed: '成果检查通过', failed: '成果检查未通过', pending: '正在核验成果' })[status] || '成果未验证');
}
function renderWorkValidation(run) {
  $('validate-work').hidden = !run || !['completed', 'complete', 'succeeded', 'success', 'done'].includes(run.status);
  $('validate-work').disabled = run?.validation?.status === 'pending';
  $('work-validation-status').textContent = run ? validationLabel(run) : '';
  $('work-validation-status').classList.toggle('error', run?.validation?.status === 'failed');
  const list = $('work-validation-results'); list.replaceChildren();
  for (const check of run?.validation?.checks || []) {
    const detail = check.summary || check.message || check.error || check.path || check.kind || '';
    list.append(el('li', '', `${check.status === 'passed' || check.passed === true || check.ok === true ? '✓' : '·'} ${detail}`));
  }
  if (run?.validation?.status === 'passed') list.append(el('li', '', tr('仅确认列出的检查项；内容质量仍需按任务目标验收。')));
}
async function validateCurrentWork() {
  const run = state.workActive;
  if (!run) return;
  $('validate-work').disabled = true;
  try {
    const validation = readWorkValidation();
    if (!validation) throw new Error(tr('请选择成果目录，并填写预期文件或勾选金额核验。'));
    const result = await rpc('work.validate', { run_id: run.run_id, validation });
    upsertRun({ ...result, run_id: run.run_id }); renderWorkRun(); pollWork(run.run_id);
  } catch (error) { $('work-validation-status').textContent = errorText(error); $('validate-work').disabled = false; }
}
function newWork() {
  state.workActive = null;
  $('work-form').hidden = false;
  $('work-run').hidden = true;
  $('work-content').value = '';
  $('work-validation-root').value = ''; $('work-validation-files').value = ''; $('work-validation-totals').checked = false;
  renderWorkValidation(null);
  feedback('work-feedback', '');
  renderWorkList();
  $('work-content').focus();
}
function selectWork(run) {
  state.workActive = run;
  renderWorkRun();
  renderWorkList();
  restoreWorkValidation(run);
  if (!terminalWorkStates.has(run.status) || run.validation?.status === 'pending') pollWork(run.run_id);
}
function renderWorkRun() {
  const run = state.workActive;
  $('work-form').hidden = Boolean(run);
  $('work-run').hidden = !run;
  if (!run) return;
  $('work-run-title').textContent = run.content || '工作任务';
  $('work-run-status').textContent = `${workTargetName(run.target)} · ${workStatus(run.status)} · ${validationLabel(run)}`;
  $('work-run-status').classList.toggle('error', ['failed', 'error'].includes(run.status));
  renderWorkValidation(run);
  $('stop-work').hidden = terminalWorkStates.has(run.status) || run.supports_stop === false || run.target?.supports_stop === false;
  const resultKey = JSON.stringify([run.run_id, run.text, run.status, run.supports_stop, run.target?.supports_stop]);
  if ($('work-result').displayKey !== resultKey) {
    if (run.text) renderMarkdown($('work-result'), run.text);
    else $('work-result').replaceChildren(el('p', 'work-waiting', run.status === 'unknown' ? '提交状态无法确认，请在原应用核对；请勿重复提交相同任务。' : terminalWorkStates.has(run.status) ? '这次任务没有返回文字结果。' : '任务已提交，正在等待实际执行结果…'));
    if ((run.supports_stop === false || run.target?.supports_stop === false) && !terminalWorkStates.has(run.status)) $('work-result').append(el('p', 'field-hint', '如需停止，请在原应用停止。'));
    $('work-result').displayKey = resultKey;
  }
  $('work-run-error').textContent = run.error || '';
  const approval = run.supports_approvals === false || run.target?.supports_approvals === false ? null : run.approval;
  const approvalKey = JSON.stringify([run.run_id, approval?.request_id, approval?.command, approval?.reason, approval?.description, approval?.choices]);
  const approvalVisible = Boolean(approval && !terminalWorkStates.has(run.status));
  $('work-approval').hidden = !approvalVisible;
  if (!approvalVisible) { $('work-approval').replaceChildren(); $('work-approval').displayKey = null; }
  if (approvalVisible && $('work-approval').displayKey !== approvalKey) {
    const box = $('work-approval');
    box.replaceChildren();
    box.displayKey = approvalKey;
    box.append(el('h3', '', '这一步需要你的决定'), el('p', '', approval.reason || approval.description || '请检查即将执行的操作。'));
    if (approval.command) box.append(el('pre', '', typeof approval.command === 'string' ? approval.command : JSON.stringify(approval.command, null, 2)));
    const actions = el('div', 'approval-actions');
    const labels = { once: '仅允许这一次', session: '本次会话允许', always: '始终允许', deny: '拒绝' };
    if (!approval.request_id) box.append(el('p', '', '未收到有效审批编号，请在原应用检查这一步。'));
    for (const choice of approval.request_id && Array.isArray(approval.choices) ? approval.choices : []) {
      const value = typeof choice === 'string' ? choice : choice.id || choice.value;
      if (!value) continue;
      const label = typeof choice === 'object' ? choice.label || labels[value] || value : labels[value] || value;
      const action = button(label, `button small ${value === 'deny' ? 'secondary' : 'primary'}`, async () => {
        state.workMutating.add(run.run_id);
        for (const child of actions.querySelectorAll('button')) child.disabled = true;
        try {
          const result = await rpc('work.approve', { run_id: run.run_id, decision: { choice: value, request_id: approval.request_id } });
          upsertRun({ ...run, ...result, approval: result.approval || null });
          renderWorkRun();
          pollWork(run.run_id);
        } catch (error) { toast(errorText(error), true); for (const child of actions.querySelectorAll('button')) child.disabled = false; }
        finally { state.workMutating.delete(run.run_id); }
      });
      actions.append(action);
    }
    box.append(actions);
  }
}
async function startWork(event) {
  event.preventDefault();
  const content = $('work-content').value.trim();
  if (!content) return;
  const target = /^\d+$/.test($('work-target').value) ? state.workTargets[Number($('work-target').value)] : null;
  if (!target) { feedback('work-feedback', '请先选择一个当前可用的执行目标。', true); return; }
  state.workStarting = true;
  $('start-work').disabled = true;
  feedback('work-feedback', '正在提交任务…');
  try {
    const validation = readWorkValidation();
    const result = await rpc('work.start', { content, target: { kind: target.kind, ...(target.id ? { id: target.id } : {}) }, ...(validation ? { validation } : {}), ...($('work-skill').value ? { skill_id: $('work-skill').value } : {}) });
    const run = { content, target, created_at: new Date().toISOString(), ...result };
    if (!run.run_id) throw new Error('执行服务没有返回任务编号，请先检查连接状态。');
    upsertRun(run);
    state.workActive = run;
    renderWorkRun();
    renderWorkList();
    pollWork(run.run_id);
  } catch (error) { feedback('work-feedback', errorText(error), true); }
  finally { state.workStarting = false; $('start-work').disabled = !/^\d+$/.test($('work-target').value); }
}
async function stopWork() {
  if (!state.workActive) return;
  if (state.workActive.supports_stop === false || state.workActive.target?.supports_stop === false) { toast('请在原应用停止这项任务。'); return; }
  const runId = state.workActive.run_id;
  state.workMutating.add(runId);
  $('stop-work').disabled = true;
  try {
    const result = await rpc('work.stop', { run_id: runId });
    const run = state.workRuns.find((item) => item.run_id === runId);
    upsertRun({ ...run, ...result, run_id: runId });
    renderWorkRun();
  } catch (error) { toast(errorText(error), true); }
  finally { state.workMutating.delete(runId); $('stop-work').disabled = false; }
}
async function pollWork(runId) {
  if (state.workPolls.has(runId)) return;
  state.workPolls.add(runId);
  let failures = 0;
  try {
    for (;;) {
      try {
        const result = await rpc('work.poll', { run_id: runId });
        failures = 0;
        if (state.workMutating.has(runId)) { await delay(1000); continue; }
        upsertRun({ ...result, run_id: runId });
        if (state.workActive?.run_id === runId) renderWorkRun();
        if (terminalWorkStates.has(result.status) && result.validation?.status !== 'pending') break;
      } catch (error) {
        failures++;
        if (failures >= 4) { if (state.workActive?.run_id === runId) $('work-run-error').textContent = `${errorText(error)} 点击工作记录可重新读取状态。`; break; }
      }
      await delay(failures ? 3000 : 1200);
    }
  } finally { state.workPolls.delete(runId); }
}

async function loadTouchLibrary() {
  try {
    const result=await rpc('touch.list');$('touch-enabled').checked=result.enabled;
    const list=$('touch-list');list.replaceChildren();
    if(!result.items.length)list.append(el('p','field-hint',tr('尚未添加回应，触碰时会朗读“我在”。')));
    for(const item of result.items) {
      const row=el('div','voice-profile-item');const copy=el('div');copy.dataset.userContent='true';
      copy.append(el('strong','',item.name),el('p','field-hint',item.text || tr('仅播放录音')));
      const actions=el('div','inline-actions');actions.append(button('试听声音','button secondary small',()=>rpc('companion.touch',{clip_id:item.id}).catch(e=>toast(errorText(e),true))),button('删除','text-button',async()=>{try{await rpc('touch.delete',{id:item.id});touchAudioCache.delete(item.audio_url);await loadTouchLibrary();}catch(e){toast(errorText(e),true);}}));
      row.append(copy,actions);list.append(row);
    }
  } catch(e){feedback('touch-feedback',errorText(e),true);}
}
async function addTouchAudio(audio) {
  $('touch-import').disabled=$('touch-add-text').disabled=true;
  try {const result=await rpc(audio?'touch.import':'touch.add_text',{text:$('touch-text').value.trim()});if(result.cancelled)return;$('touch-text').value='';await loadTouchLibrary();feedback('touch-feedback',tr('触碰回应已添加。'));}
  catch(e){feedback('touch-feedback',errorText(e),true);}
  finally{$('touch-import').disabled=$('touch-add-text').disabled=false;}
}
function cancelTouchResponse(value) {
  if(value?.phase==='cancel' && touchPlayback && (!value.id || value.id===touchPlayback.id))stopSpeaking(false);
}
async function playTouchResponse(item) {
  if((speechActive && !touchPlayback) || voiceRecorder || foreignRecording || voiceConversation || microphoneStarting || [...state.jobs.values()].some(j=>!j.replyDone)) {finishTouch(item.id,true);return;}
  if(touchPlayback)stopSpeaking(false);
  if(!item.audio_url) {
    const promise=speakText(item.text || '我在。');touchPlayback={id:item.id};publishAssistantState();
    try{await promise;}finally{finishTouch(item.id);}return;
  }
  stopSpeaking(false);const generation=speechGeneration;touchPlayback={id:item.id};voiceState(item.text || tr('正在播放触碰回应'),true);
  try {
    await speechStopBarrier;
    const Context=window.AudioContext||window.webkitAudioContext;voiceAudioContext ||= new Context();await voiceAudioContext.resume();
    let audio=touchAudioCache.get(item.audio_url);
    if(!audio) {const response=await fetch(item.audio_url);if(!response.ok)throw new Error(tr('回应录音无法播放。'));audio=await voiceAudioContext.decodeAudioData(await response.arrayBuffer());if(audio.duration>61)throw new Error(tr('回应录音无法播放。'));touchAudioCache.set(item.audio_url,audio);while(touchAudioCache.size>2)touchAudioCache.delete(touchAudioCache.keys().next().value);}
    if(generation!==speechGeneration)return;
    speechOutput=voiceAudioContext.createGain();await startVoiceMeter(speechOutput,'buffer');if(generation!==speechGeneration)return;
    const source=voiceAudioContext.createBufferSource();source.buffer=audio;source.connect(speechOutput);speechSources.add(source);
    source.onended=()=>{speechSources.delete(source);source.disconnect();source.onended=null;try{source.buffer=null;}catch{}if(generation===speechGeneration){speechOutput=null;stopVoiceMeter();voiceState('');}};
    source.start();publishAssistantState();
  } catch(e){if(generation===speechGeneration){stopSpeaking();toast(errorText(e),true);}}
}
function bindEvents() {
  $('touch-enabled').addEventListener('change',async()=>{try{await rpc('touch.configure',{enabled:$('touch-enabled').checked});}catch(e){toast(errorText(e),true);loadTouchLibrary();}});
  $('touch-import').addEventListener('click',()=>addTouchAudio(true));
  $('touch-add-text').addEventListener('click',()=>addTouchAudio(false));
  $('companion-hide-panel').addEventListener('click',()=>rpc('window.main.hide').catch(e=>toast(errorText(e),true)));
  window.laurentina?.onTouchRequest?.(playTouchResponse);
  window.laurentina?.onTouchResponse?.(cancelTouchResponse);
  for (const [id, action, name] of [['minimize', 'window.minimize', 'minimize'], ['maximize', 'window.maximize', 'maximize'], ['close-window', 'window.close', 'x']]) {
    $(id).append(svg(name));
    $(id).addEventListener('click', () => rpc(action).catch((error) => toast(errorText(error), true)));
  }
  $('brand-home').addEventListener('click', () => showView('chat'));
  $('new-chat').addEventListener('click', () => createConversation(state.mode, { preserveDraft: false }));
  for (const link of document.querySelectorAll('.nav-link')) link.addEventListener('click', () => showView(link.dataset.view));
  $('mode-daily').addEventListener('click', () => selectMode('daily'));
  $('mode-private').addEventListener('click', () => selectMode('private'));
  $('chat-input').addEventListener('input', resizeInput);
  $('chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!activeJob() || activeJob().replyDone) sendMessage(); }
  });
  $('send-message').addEventListener('click', sendMessage);
  $('record-audio').addEventListener('click', toggleRecording);
  $('voice-conversation').addEventListener('click', toggleVoiceConversation);
  $('speech-rate').addEventListener('input', () => { $('speech-rate-value').textContent = `${Number($('speech-rate').value).toFixed(2)}×`; });
  $('refresh-voice-profiles').addEventListener('click', refreshVoiceProfiles);
  $('voice-profile-form').addEventListener('submit', importVoiceProfile);
  $('start-custom-voice').addEventListener('click', () => voiceProfileAction(async () => { await rpc('voice.profiles.start'); feedback('voice-profile-feedback', '本地声线服务已启动。'); }));
  $('stop-custom-voice').addEventListener('click', () => voiceProfileAction(async () => { await rpc('voice.profiles.stop'); feedback('voice-profile-feedback', '本地声线服务已停止。'); }));
  $('stop-audio').addEventListener('click', () => stopSpeaking());
  $('show-orb').addEventListener('click', () => {
    if (voiceRecorder || microphoneStarting) { toast('请先结束当前录音，再打开悬浮球。'); return; }
    rpc('window.orb').catch((error) => toast(errorText(error), true));
  });
  $('refresh-voice').addEventListener('click', refreshVoice);
  $('refresh-resources').addEventListener('click', refreshResources);
  $('resources-form').addEventListener('submit', saveResourceSettings);
  $('tts-provider').addEventListener('change', updateVoiceFields);
  $('voice-form').addEventListener('submit', saveVoiceSettings);
  $('toggle-auto-speak').addEventListener('click', toggleAutoSpeak);
  $('test-voice').addEventListener('click', previewVoice);
  $('work-form').addEventListener('submit', startWork);
  $('choose-work-validation-root').addEventListener('click', async () => { try { const result = await rpc('file.work_root'); if (!result.cancelled) $('work-validation-root').value = result.path; } catch (error) { toast(errorText(error), true); } });
  $('validate-work').addEventListener('click', validateCurrentWork);
  $('intent-chat').addEventListener('click', () => { state.intent = 'chat'; updateComposer(); });
  $('intent-task').addEventListener('click', () => { state.intent = 'task'; updateComposer(); refreshWork(); });
  $('new-work').addEventListener('click', newWork);
  $('refresh-work-targets').addEventListener('click', refreshWork);
  $('work-target').addEventListener('change', () => {
    state.workSelection = /^\d+$/.test($('work-target').value) ? state.workTargets[Number($('work-target').value)] : null;
    $('start-work').disabled = state.workStarting || !state.workSelection;
    feedback('work-feedback', '');
  });
  $('stop-work').addEventListener('click', stopWork);
  if (window.laurentina?.onTranscript) window.laurentina.onTranscript(async (text) => {
    const value = typeof text === 'string' ? text : text?.text;
    if (!value) return;
    try { await receiveVoiceTranscript(text); } catch (error) { toast(errorText(error), true); }
  });
  if (window.laurentina?.onVoiceState) window.laurentina.onVoiceState((value) => {
    foreignRecording = Boolean(value?.recording && !voiceRecorder);
    $('record-audio').disabled = voiceTranscribing || foreignRecording || microphoneStarting;
    if (foreignRecording) { stopVoiceConversation(); stopSpeaking(false); }
  });
  document.querySelectorAll('[data-starter]').forEach((node) => node.addEventListener('click', () => { $('chat-input').value = node.dataset.starter; resizeInput(); $('chat-input').focus(); }));
  $('retry-bootstrap').addEventListener('click', bootstrap);
  $('character-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('save-character');
    submit.disabled = true;
    feedback('character-feedback', '正在保存角色与人设…');
    try {
      const result = await rpc('character.save', { name: $('character-name').value.trim(), persona: $('character-persona').value, avatar: state.avatarDraft });
      state.character = result.character || result;
      applyCharacter();
      const syncError = result.memory_sync?.status === 'error' ? result.memory_sync.error : null;
      feedback('character-feedback', result.warning || result.memory_error || syncError || '角色已保存，人设摘要已共享');
      if (result.warning || result.memory_error || syncError) $('character-feedback').classList.add('error');
      renderMessages();
    } catch (error) { feedback('character-feedback', errorText(error), true); }
    finally { submit.disabled = false; }
  });
  $('import-avatar').addEventListener('click', async () => {
    try {
      const result = await rpc('file.avatar');
      if (result.cancelled) return;
      await cropImportedAvatar(result.data_url);
    } catch (error) { feedback('character-feedback', errorText(error), true); }
  });
  $('remove-avatar').addEventListener('click', () => { state.avatarDraft = null; avatarInto($('character-avatar'), null); $('remove-avatar').disabled = true; feedback('character-feedback', '已恢复默认形象，保存后生效。'); });
  $('import-persona').addEventListener('click', async () => {
    try {
      const result = await rpc('file.persona');
      if (result.cancelled) return;
      $('character-persona').value = result.content;
      feedback('character-feedback', `已导入 ${result.filename}，保存后生效。`);
    } catch (error) { feedback('character-feedback', errorText(error), true); }
  });
  bindMemoryNavigation();
  $('memory-search-form').addEventListener('submit', (event) => { event.preventDefault(); loadMemories(); });
  $('clear-search').addEventListener('click', () => { $('memory-query').value = ''; loadMemories(); });
  $('memory-query').addEventListener('input', () => { $('clear-search').hidden = !$('memory-query').value; });
  $('remember-new').addEventListener('click', rememberNew);
  $('refresh-health').addEventListener('click', refreshHealth);
  $('provider-form').addEventListener('submit', saveProvider);
  $('new-provider').addEventListener('click', openProviderChooser);
  $('provider-chooser-close').addEventListener('click', () => $('provider-chooser').close());
  for (const choice of document.querySelectorAll('[data-provider-preset]')) choice.addEventListener('click', () => chooseProviderPreset(choice.dataset.providerPreset));
  for (const page of ['keys', 'docs', 'pricing']) $(`provider-help-${page}`).addEventListener('click', async () => {
    try { await rpc('provider.open_help', { provider: state.providerPreset, page }); }
    catch (error) { feedback('provider-feedback', errorText(error), true); }
  });
  $('provider-return-chat').addEventListener('click', () => showView('chat'));
  $('provider-kind').addEventListener('change', () => {
    const kind = $('provider-kind').value;
    const existing = state.providers.find((item) => item.kind === kind && item.kind !== 'custom');
    editProvider(existing || { kind, name: kind === 'custom' ? '' : providerPresets[kind].name, model: '', base_url: '' }, kind);
  });
  $('provider-url').addEventListener('input', () => { state.providerPreset = providerPresetFor({ kind: 'custom', base_url: $('provider-url').value.trim() }); updateProviderFields(); });
  $('test-provider').addEventListener('click', testProvider);
  $('select-provider').addEventListener('click', () => {
    if (providerFormDirty()) { feedback('provider-feedback', '请先保存修改，再选择这个连接。'); return; }
    selectProvider(state.editingProvider.id);
  });
  $('delete-provider').addEventListener('click', deleteProvider);
  $('daily-provider').addEventListener('change', () => {
    if ($('daily-provider').value === '__add__') { $('daily-provider').value = state.activeProvider; openProviderChooser(); }
    else selectProvider($('daily-provider').value);
  });
  $('companion-form').addEventListener('submit', saveCompanion);
  $('companion-mode').addEventListener('change', () => { state.companionDirty = true; renderCompanionArtwork(); });
  $('companion-scale').addEventListener('input', () => { state.companionDirty = true; renderCompanionArtwork(); });
  $('companion-visible').addEventListener('change', () => { state.companionDirty = true; });
  $('import-companion').addEventListener('click', async () => {
    try {
      const result = await rpc('file.companion');
      if (result.cancelled) return;
      const decoded = new Image();
      decoded.src = result.data_url;
      await decoded.decode();
      if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth * decoded.naturalHeight > 40000000) throw new Error('图片尺寸过大或无法打开，请换一张图片。');
      state.companion.artwork = result.data_url;
      state.companionDirty = true;
      renderCompanionArtwork();
      feedback('companion-feedback', '图片已导入，动画会按原图播放；保存后生效。');
    } catch (error) { feedback('companion-feedback', errorText(error), true); }
  });
  $('clear-companion').addEventListener('click', () => { state.companion.artwork = null; state.companionDirty = true; renderCompanionArtwork(); });
  if (window.laurentina?.onCompanionState) window.laurentina.onCompanionState((value) => {
    if (state.companionDirty) return;
    state.companion = value;
    $('companion-mode').value = value.mode || 'orb';
    $('companion-visible').checked = Boolean(value.visible);
    $('companion-scale').value = value.scale || 1;
    renderCompanionArtwork();
  });
  for (const id of ['crop-close', 'crop-cancel']) $(id).addEventListener('click', () => $('avatar-crop-modal').close());
  $('avatar-crop-zoom').addEventListener('input', drawAvatarCrop);
  $('crop-confirm').addEventListener('click', () => {
    state.avatarDraft = $('avatar-crop-canvas').toDataURL('image/png');
    avatarInto($('character-avatar'), state.avatarDraft);
    $('remove-avatar').disabled = false;
    $('avatar-crop-modal').close();
    feedback('character-feedback', '头像已裁剪，保存角色后生效。');
  });
  $('avatar-crop-modal').addEventListener('close', () => { cropImage = null; cropDrag = null; });
  $('avatar-crop-canvas').addEventListener('pointerdown', (event) => { cropDrag = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); });
  $('avatar-crop-canvas').addEventListener('pointermove', (event) => {
    if (!cropDrag) return;
    const factor = event.currentTarget.width / event.currentTarget.clientWidth;
    cropOffset.x += (event.clientX - cropDrag.x) * factor;
    cropOffset.y += (event.clientY - cropDrag.y) * factor;
    cropDrag = { x: event.clientX, y: event.clientY };
    drawAvatarCrop();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('avatar-crop-canvas').addEventListener(type, () => { cropDrag = null; });
  $('avatar-crop-canvas').addEventListener('keydown', (event) => {
    const offsets = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    if (!offsets[event.key]) return;
    event.preventDefault(); cropOffset.x += offsets[event.key][0]; cropOffset.y += offsets[event.key][1]; drawAvatarCrop();
  });
  $('model-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('save-model').disabled = true;
    try {
      state.settings = await rpc('settings.save', { model: $('model-select').value });
      $('composer-model').textContent = state.settings.model;
      feedback('model-feedback', '模型已保存，将用于接下来的回答。');
      loadProviders(false);
    } catch (error) { feedback('model-feedback', errorText(error), true); }
    finally { $('save-model').disabled = false; }
  });
  $('open-data').addEventListener('click', () => rpc('app.open_data').catch((error) => toast(errorText(error), true)));
  for (const id of ['modal-close', 'modal-cancel']) $(id).addEventListener('click', () => $('modal').close());
  $('modal').addEventListener('click', (event) => { if (event.target === $('modal')) { const rect = $('modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('modal').close(); } });
  $('modal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!modalHandler) return;
    $('modal-submit').disabled = true;
    $('modal-error').textContent = '';
    try {
      const data = Object.fromEntries(new FormData($('modal-form')).entries());
      await modalHandler(data);
      $('modal').close();
    } catch (error) { $('modal-error').textContent = errorText(error); }
    finally { $('modal-submit').disabled = false; }
  });
  document.addEventListener('keydown', (event) => {
    const modalOpen = $('modal').open || $('avatar-crop-modal').open || $('provider-chooser').open;
    if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!modalOpen && state.ready) createConversation(state.mode, { preserveDraft: false }); }
    if (event.key === 'Escape' && !modalOpen && $('secret-popup') && state.view === 'chat') { event.preventDefault(); minimizeSecret(); return; }
    if (event.key === 'Escape' && !modalOpen && activeJob() && !activeJob().replyDone && state.view === 'chat') cancelJob(activeJob());
  });
  window.addEventListener('beforeunload', () => {
    stopVoiceConversation();
    clearInterval(recordingTimer);
    voiceStream?.getTracks().forEach((track) => track.stop());
    stopSpeaking(false);
  });
}

initializeWorkspaceUI();
installIcons();
bindEvents();
bootstrap();
