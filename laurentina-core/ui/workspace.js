'use strict';

// Workspace metadata is kept separately from chat content. This module only
// changes presentation and passes explicit project/skill choices to Core.
function workspaceMeta(id) { return state.workspace?.conversation_meta?.[id] || {}; }
function workspaceProjects() { return state.workspace?.projects || []; }
function applyWorkspacePreferences(preferences = {}) {
  state.workspace.preferences = { theme: 'dark', language: 'zh', ...state.workspace.preferences, ...preferences };
  const { theme, language } = state.workspace.preferences;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]').content = theme === 'light' ? 'light' : 'dark';
  I18n.setLanguage(language);
  $('theme-toggle').textContent = tr(theme === 'light' ? '深色模式' : '浅色模式');
  $('language-toggle').textContent = language === 'zh' ? 'English' : '中文';
}
async function loadWorkspace() {
  try {
    const result = await rpc('workspace.get');
    state.workspace = { projects: [], conversation_meta: {}, preferences: {}, ...result };
    if (state.projectSelection && !workspaceProjects().some((p) => p.id === state.projectSelection)) state.projectSelection = null;
    applyWorkspacePreferences();
    renderConversations();
  } catch (error) { toast(errorText(error), true); }
}
async function saveWorkspacePreferences(patch) {
  try {
    const result = await rpc('workspace.preferences.save', patch);
    applyWorkspacePreferences(result.preferences || result);
    renderConversations(); updateHeader(); updateComposer();
  } catch (error) { toast(errorText(error), true); }
}
function workspaceConversationRow(conversation) {
  const row = el('div', `conversation-row${state.active?.id === conversation.id && state.view === 'chat' ? ' active' : ''}`);
  const includesPrivate = conversation.has_private || conversation.mode === 'private';
  const select = button('', 'conversation-select', () => openConversation(conversation.id), includesPrivate ? 'lock' : 'chat');
  const title = el('span', 'conversation-user-title', conversation.title || tr('新对话'));
  title.dataset.userContent = 'true';
  select.append(title);
  if (conversation.has_private) { const marker = el('span', 'conversation-private-marker', tr('含私聊')); marker.title = tr('此对话含私聊内容，私聊原文仅存本地'); select.append(marker); }
  select.title = `${conversation.title || tr('新对话')} · ${modeName(conversation.mode)}`;
  if (state.active?.id === conversation.id) select.setAttribute('aria-current', 'page');
  const menu = button('', 'conversation-menu', () => conversationMenu(conversation), 'more');
  menu.setAttribute('aria-label', tr('管理对话'));
  row.append(select, menu);
  return row;
}
function renderWorkspaceConversations() {
  const projects = $('project-list');
  projects.replaceChildren();
  const all = button('所有对话', `project-select${!state.projectSelection ? ' selected' : ''}`, () => {
    state.projectSelection = null; renderConversations(); updateHeader();
  }, 'layers');
  projects.append(all);
  const sortedProjects = [...workspaceProjects()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(a.name).localeCompare(String(b.name)));
  for (const project of sortedProjects) {
    const row = el('div', `project-row${state.projectSelection === project.id ? ' selected' : ''}`);
    const select = button('', 'project-select', () => { state.projectSelection = project.id; renderConversations(); updateHeader(); }, project.pinned ? 'pin' : 'folder');
    const label = el('span', 'project-user-title', project.name); label.dataset.userContent = 'true';
    const count = state.conversations.filter((c) => workspaceMeta(c.id).project_id === project.id).length;
    select.append(label, el('small', '', String(count)));
    const menu = button('', 'conversation-menu', () => projectMenu(project), 'more');
    menu.setAttribute('aria-label', tr('管理项目'));
    row.append(select, menu); projects.append(row);
  }
  const container = $('conversation-list'); container.replaceChildren();
  const selectedProject = workspaceProjects().find((p) => p.id === state.projectSelection);
  $('conversation-section-label').textContent = selectedProject ? selectedProject.name : tr('最近对话');
  $('conversation-section-label').dataset.userContent = selectedProject ? 'true' : 'false';
  const visible = state.conversations.filter((c) => !state.projectSelection || workspaceMeta(c.id).project_id === state.projectSelection);
  const pinned = visible.filter((c) => workspaceMeta(c.id).pinned);
  const recent = visible.filter((c) => !workspaceMeta(c.id).pinned);
  if (pinned.length) {
    container.append(el('div', 'conversation-group-label', tr('已置顶')));
    for (const c of pinned) container.append(workspaceConversationRow(c));
  }
  if (!visible.length) container.append(el('p', 'sidebar-empty', tr(selectedProject ? '项目中还没有对话' : '还没有对话')));
  if (pinned.length && recent.length) container.append(el('div', 'conversation-group-label', tr('最近')));
  for (const c of recent) container.append(workspaceConversationRow(c));
}
function createProject() {
  openModal({ title: tr('新建项目'), submit: tr('创建项目'), fields: [{ name: 'name', label: tr('项目名称'), maxLength: 80 }], onSubmit: async (values) => {
    const project = await rpc('project.create', { name: values.name.trim() });
    const id = project.id || project.project?.id;
    await loadWorkspace();
    if (id) state.projectSelection = id;
    renderConversations(); updateHeader();
  } });
}
function projectMenu(project) {
  const actions = el('div', 'modal-conversation-actions');
  actions.append(button(project.pinned ? '取消置顶项目' : '置顶项目', 'button secondary', async () => {
    try { await rpc('project.pin', { id: project.id, pinned: !project.pinned }); await loadWorkspace(); $('modal').close(); }
    catch (error) { toast(errorText(error), true); }
  }, 'pin'));
  actions.append(button('重命名项目', 'button secondary', () => {
    openModal({ title: tr('重命名项目'), submit: tr('保存'), fields: [{ name: 'name', label: tr('项目名称'), value: project.name, maxLength: 80 }], onSubmit: async (values) => {
      await rpc('project.rename', { id: project.id, name: values.name.trim() }); await loadWorkspace();
    } });
  }, 'folder'));
  actions.append(button('在项目中新建对话', 'button secondary', () => {
    state.projectSelection = project.id; $('modal').close(); createConversation(state.mode, { preserveDraft: false });
  }, 'plus'));
  openModal({ title: project.name, fields: [{ node: actions }] });
}
async function pinConversation(conversation) {
  try {
    await rpc('conversation.organize', { id: conversation.id, pinned: !workspaceMeta(conversation.id).pinned });
    await loadWorkspace(); $('modal').close();
  } catch (error) { toast(errorText(error), true); }
}
function moveConversation(conversation) {
  const wrapper = el('div');
  const label = el('label', '', tr('项目')); label.htmlFor = 'move-conversation-project';
  const select = el('select'); select.id = 'move-conversation-project'; select.name = 'project_id';
  const none = el('option', '', tr('不属于项目')); none.value = ''; select.append(none);
  for (const project of workspaceProjects()) { const option = el('option', '', project.name); option.value = project.id; option.dataset.userContent = 'true'; select.append(option); }
  select.value = workspaceMeta(conversation.id).project_id || '';
  wrapper.append(label, select);
  openModal({ title: tr('移动到项目'), submit: tr('保存'), fields: [{ node: wrapper }], onSubmit: async (values) => {
    await rpc('conversation.organize', { id: conversation.id, project_id: values.project_id || null }); await loadWorkspace();
  } });
}
function renderSkillPickers() {
  for (const id of ['chat-skill', 'work-skill']) {
    const picker = $(id), previous = picker.value; picker.replaceChildren();
    const empty = el('option', '', tr('不使用技能')); empty.value = ''; picker.append(empty);
    for (const item of state.skills || []) {
      if (item.available === false) continue;
      const option = el('option', '', item.name); option.value = item.id; option.dataset.userContent = 'true'; picker.append(option);
    }
    if ([...picker.options].some((o) => o.value === previous)) picker.value = previous;
  }
}
async function loadSkills() {
  try {
    const result = await rpc('skills.list'); state.skills = result.items || [];
    const container = $('skills-list'); container.replaceChildren();
    if (!state.skills.length) resultState(container, tr('还没有导入技能'), { icon: 'spark', description: tr('粘贴 GitHub 仓库或技能目录链接即可添加。') });
    for (const item of state.skills) {
      const card = el('section', 'settings-card skill-card');
      const heading = el('div', 'card-heading'); const copy = el('div');
      const title = el('h2', '', item.name); title.dataset.userContent = 'true';
      const description = el('p', '', item.description || ''); description.dataset.userContent = 'true';
      copy.append(title, description); heading.append(copy, button('查看文档', 'button secondary small', () => previewSkill(item), 'layers'));
      card.append(heading);
      if (item.source_url) { const source = el('p', 'field-hint skill-source', item.source_url); source.dataset.userContent = 'true'; card.append(source); }
      if (item.limitations) card.append(el('p', 'field-hint', Array.isArray(item.limitations) ? item.limitations.join('\n') : item.limitations));
      container.append(card);
    }
    renderSkillPickers();
  } catch (error) { feedback('skills-feedback', errorText(error), true); }
}
async function previewSkill(item) {
  try {
    const result = await rpc('skills.read', { id: item.id });
    $('skill-preview-title').textContent = result.name || item.name;
    $('skill-preview-content').textContent = result.content || '';
    $('skill-preview-card').hidden = false;
    $('skill-preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { feedback('skills-feedback', errorText(error), true); }
}
async function importSkill(event) {
  event.preventDefault(); $('import-skill').disabled = true; feedback('skills-feedback', tr('正在导入技能…'));
  try {
    const result = await rpc('skills.import', { url: $('skill-repo-url').value.trim() });
    await loadSkills(); feedback('skills-feedback', tr('已导入 {count} 个技能', { count: (result.items || []).length }));
  } catch (error) { feedback('skills-feedback', errorText(error), true); }
  finally { $('import-skill').disabled = false; }
}
function avatarAnimationNames(manifest) {
  const entries = Array.isArray(manifest?.animations) ? manifest.animations : Object.keys(manifest?.animations || {});
  return entries.map((entry) => typeof entry === 'string' ? entry : entry.name || entry.id).filter(Boolean);
}
const avatarAnimationFields = [
  ['idle', 'idle_animation', 'avatar-idle-animation', '自动选择待机'],
  ['speaking', 'speaking_animation', 'avatar-speaking-animation', '跟随待机动画'],
  ['thinking', 'thinking_animation', 'avatar-thinking-animation', '跟随待机动画'],
  ['touch', 'touch_animation', 'avatar-touch-animation', '不播放触摸动画'],
];
const avatarAnimationDrafts = new Map(), avatarAnimationSaves = new Map(), avatarDeleting = new Set();
function captureAvatarAnimationDraft() {
  for (const [, field, control] of avatarAnimationFields) {
    const picker = $(control), id = picker.dataset.avatarId;
    if (!id) continue;
    const draft = avatarAnimationDrafts.get(id) || {};
    if (picker.value !== picker.dataset.savedValue) draft[field] = picker.value;
    else delete draft[field];
    if (Object.keys(draft).length) avatarAnimationDrafts.set(id, draft); else avatarAnimationDrafts.delete(id);
  }
}
function renderAvatarAnimationPickers(current) {
  captureAvatarAnimationDraft();
  const names = avatarAnimationNames(current);
  const canAnimate = ['live2d', 'spine'].includes(current.kind) && names.length > 0 && !avatarDeleting.has(current.id);
  const draft = avatarAnimationDrafts.get(current.id) || {};
  for (const [stateName, field, id, defaultLabel] of avatarAnimationFields) {
    const picker = $(id); picker.replaceChildren();
    const automatic = el('option', '', tr(defaultLabel)); automatic.value = ''; picker.append(automatic);
    for (const name of names) { const option = el('option', '', name); option.value = name; option.dataset.userContent = 'true'; picker.append(option); }
    const saved = current[field] ?? current.stateMap?.[stateName] ?? '';
    picker.dataset.avatarId = current.id; picker.dataset.savedValue = names.includes(saved) ? saved : '';
    const selected = draft[field] ?? saved;
    picker.value = names.includes(selected) ? selected : '';
    picker.disabled = !canAnimate;
  }
  $('save-avatar-animation').disabled = !canAnimate;
}
let avatarLibraryLoadVersion = 0;
const avatarZoomWrites = new Map();
function renderAvatarLibrary() {
  captureAvatarAnimationDraft();
  const container = $('avatar-library'); container.replaceChildren();
  if (!state.avatarLibrary.items.length) container.append(el('p', 'field-hint', tr('还没有角色资源，先导入一个角色包或动态图片。')));
  for (const item of state.avatarLibrary.items) {
    const card = el('div', `avatar-library-item${state.avatarLibrary.active_id === item.id ? ' selected' : ''}`);
    const copy = el('div'); const name = el('strong', '', item.name); name.dataset.userContent = 'true';
    const kind = ({ image: 'Image', video: 'WebM', live2d: 'Live2D Cubism', spine: 'Spine' })[item.kind] || item.kind;
    copy.append(name, el('small', '', `${kind}${item.version ? ` · ${item.version}` : ''}`));
    const select = button(state.avatarLibrary.active_id === item.id ? '当前角色' : '使用角色', 'button secondary small', () => selectAvatar(item));
    select.disabled = state.avatarLibrary.active_id === item.id || avatarDeleting.has(item.id);
    const remove = button('删除角色', 'button danger small', () => deleteAvatar(item), 'trash');
    remove.disabled = avatarDeleting.has(item.id);
    card.append(copy, select, remove); container.append(card);
  }
  const current = state.avatarLibrary.items.find((a) => a.id === state.avatarLibrary.active_id);
  $('avatar-options').hidden = !current;
  const slider = $('avatar-character-zoom');
  const editing = current && slider.dataset.avatarId === current.id && slider.dataset.editing === 'true';
  if (!editing) delete slider.dataset.editing;
  slider.dataset.avatarId = current?.id || '';
  slider.disabled = !current || avatarDeleting.has(current.id);
  $('reset-avatar-character-zoom').disabled = slider.disabled;
  if (!current) { for (const [, , control] of avatarAnimationFields) $(control).dataset.avatarId = ''; return; }
  renderAvatarAnimationPickers(current);
  const zoom = editing ? Number(slider.value) : avatarZoomWrites.get(current.id)?.zoom ?? Math.max(0.5, Math.min(8, Number(current.view?.zoom) || 1));
  slider.value = zoom;
  $('avatar-character-zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  $('avatar-runtime-status').textContent = current.runtime_error || current.error || current.warning || tr('在桌面打开陪伴，即可播放当前角色。');
}
async function loadAvatarLibrary() {
  const version = ++avatarLibraryLoadVersion;
  try {
    const saved = await rpc('avatar.list');
    if (version !== avatarLibraryLoadVersion) return;
    state.avatarLibrary = { items: [], active_id: null, ...saved }; renderAvatarLibrary();
  }
  catch (error) { feedback('avatar-library-feedback', errorText(error), true); }
}
async function selectAvatar(item) {
  if (avatarDeleting.has(item.id)) return;
  try {
    await rpc('avatar.select', { id: item.id });
    state.avatarLibrary.active_id = item.id; $('companion-mode').value = 'avatar'; state.companionDirty = true;
    renderCompanionArtwork(); renderAvatarLibrary(); feedback('avatar-library-feedback', tr('角色已选择，可在桌面打开陪伴查看。'));
  } catch (error) { feedback('avatar-library-feedback', errorText(error), true); }
}
async function importAvatarPackage() {
  $('import-avatar-package').disabled = true;
  try {
    const result = await rpc('avatar.import'); if (result.cancelled) return;
    await loadAvatarLibrary();
    if (result.id) await selectAvatar(result);
    feedback('avatar-library-feedback', tr('角色资源已导入。'));
  } catch (error) { feedback('avatar-library-feedback', errorText(error), true); }
  finally { $('import-avatar-package').disabled = false; }
}
async function saveAvatarAnimations() {
  const id = state.avatarLibrary.active_id;
  if (!id || $('save-avatar-animation').disabled || $('avatar-idle-animation').dataset.avatarId !== id || avatarDeleting.has(id)) return;
  captureAvatarAnimationDraft();
  const payload = { id };
  for (const [, field, control] of avatarAnimationFields) payload[field] = $(control).value;
  $('save-avatar-animation').disabled = true;
  const request = rpc('avatar.configure', payload); avatarAnimationSaves.set(id, request);
  try {
    await request;
    const item = state.avatarLibrary.items.find(item => item.id === id), draft = avatarAnimationDrafts.get(id) || {};
    for (const [stateName, field, control] of avatarAnimationFields) {
      if (item) item.stateMap = { ...item.stateMap, [stateName]: payload[field] };
      if (draft[field] === payload[field]) delete draft[field];
      const picker = $(control); if (picker.dataset.avatarId === id) picker.dataset.savedValue = payload[field];
    }
    if (Object.keys(draft).length) avatarAnimationDrafts.set(id, draft); else avatarAnimationDrafts.delete(id);
    await loadAvatarLibrary();
    feedback('avatar-library-feedback', tr('动画设置已保存'));
  } catch (error) { feedback('avatar-library-feedback', errorText(error), true); }
  finally {
    if (avatarAnimationSaves.get(id) === request) avatarAnimationSaves.delete(id);
    const current = state.avatarLibrary.items.find((item) => item.id === state.avatarLibrary.active_id);
    $('save-avatar-animation').disabled = !current || !['live2d', 'spine'].includes(current.kind) || !avatarAnimationNames(current).length || avatarDeleting.has(current.id);
  }
}
function deleteAvatar(item) {
  openModal({ title: '删除这个角色？', description: '角色将从资源库移除，并保留在本机回收区。原始 ZIP 不会删除。',
    submit: '删除角色', danger: true, onSubmit: () => removeAvatarResource(item.id) });
}
async function removeAvatarResource(id) {
  if (avatarDeleting.has(id)) return;
  captureAvatarAnimationDraft(); avatarDeleting.add(id); renderAvatarLibrary();
  try {
    await avatarZoomWrites.get(id)?.tail;
    await avatarAnimationSaves.get(id)?.catch(() => {});
    const result = await rpc('avatar.delete', { id });
    avatarZoomWrites.delete(id);
    if (result.active_deleted && $('companion-mode').value === 'avatar' && (!state.avatarLibrary.active_id || state.avatarLibrary.active_id === id)) {
      $('companion-mode').value = 'orb'; renderCompanionArtwork();
    }
    await loadAvatarLibrary(); avatarAnimationDrafts.delete(id); feedback('avatar-library-feedback', tr('角色已移至本机回收区。'));
    return result;
  } finally { avatarDeleting.delete(id); renderAvatarLibrary(); }
}
function previewAvatarZoom() {
  const slider = $('avatar-character-zoom');
  if (slider.dataset.avatarId !== state.avatarLibrary.active_id) return;
  slider.dataset.editing = 'true';
  $('avatar-character-zoom-label').textContent = `${Math.round(Number(slider.value) * 100)}%`;
}
async function saveAvatarZoom(reset = false) {
  const id = state.avatarLibrary.active_id;
  const slider = $('avatar-character-zoom');
  // A selection broadcast can arrive before the new character's form is drawn.
  if (!id || slider.dataset.avatarId !== id || avatarDeleting.has(id)) return;
  const zoom = reset ? 1 : Number($('avatar-character-zoom').value);
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 8) return;
  delete slider.dataset.editing;
  slider.value = zoom;
  $('avatar-character-zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  let write = avatarZoomWrites.get(id);
  if (!write) { write = { tail: Promise.resolve(), revision: 0, zoom }; avatarZoomWrites.set(id, write); }
  const revision = ++write.revision; write.zoom = zoom;
  const request = write.tail.then(() => rpc('avatar.configure', { id, zoom }));
  // Serialize saves per character, so a slower old request cannot win last.
  write.tail = request.catch(() => {});
  try {
    await request;
    const item = state.avatarLibrary.items.find(item => item.id === id);
    if (item) item.view = { ...item.view, zoom };
    if (write.revision === revision && state.avatarLibrary.active_id === id) await loadAvatarLibrary();
  } catch (error) { if (write.revision === revision) feedback('avatar-library-feedback', errorText(error), true); }
  finally {
    if (write.revision === revision) { avatarZoomWrites.delete(id); if (state.avatarLibrary.active_id === id) renderAvatarLibrary(); }
  }
}
function initializeWorkspaceUI() {
  state.workspace = { projects: [], conversation_meta: {}, preferences: { theme: 'dark', language: 'zh' } };
  state.projectSelection = null; state.skills = []; state.avatarLibrary = { items: [], active_id: null };
  I18n.start(document.body);
  $('theme-toggle').addEventListener('click', () => saveWorkspacePreferences({ theme: state.workspace.preferences.theme === 'light' ? 'dark' : 'light' }));
  $('language-toggle').addEventListener('click', () => saveWorkspacePreferences({ language: state.workspace.preferences.language === 'zh' ? 'en' : 'zh' }));
  $('new-project').addEventListener('click', createProject);
  $('skill-import-form').addEventListener('submit', importSkill);
  $('close-skill-preview').addEventListener('click', () => { $('skill-preview-card').hidden = true; });
  $('import-avatar-package').addEventListener('click', importAvatarPackage);
  $('save-avatar-animation').addEventListener('click', saveAvatarAnimations);
  for (const [, , control] of avatarAnimationFields) $(control).addEventListener('change', captureAvatarAnimationDraft);
  $('avatar-character-zoom').addEventListener('input', previewAvatarZoom);
  $('avatar-character-zoom').addEventListener('change', () => saveAvatarZoom());
  $('reset-avatar-character-zoom').addEventListener('click', () => saveAvatarZoom(true));
  if (window.laurentina?.onAvatarState) window.laurentina.onAvatarState((value) => { state.avatarLibrary.active_id = value?.id || null; loadAvatarLibrary(); });
}
