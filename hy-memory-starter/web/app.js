const $ = (id) => document.getElementById(id);
let token = '', current = {}, configured = false, busy = false, dirty = false, stopped = false;
const presets = {
  local: {llm_url:'http://127.0.0.1:11434/v1', llm_model:'qwen3.5:9b', llm_key:'ollama', embed_url:'http://127.0.0.1:11434/v1', embed_model:'qwen3-embedding:0.6b', embed_key:'ollama', dimensions:1024},
  deepseek: {llm_url:'https://api.deepseek.com', llm_model:'deepseek-chat', embed_url:'https://dashscope.aliyuncs.com/compatible-mode/v1', embed_model:'text-embedding-v3', dimensions:1024},
  openai: {llm_url:'https://api.openai.com/v1', llm_model:'gpt-4.1-nano', embed_url:'https://api.openai.com/v1', embed_model:'text-embedding-3-small', dimensions:1536}
};

function notice(text, type = '') { $('notice').textContent = text; $('notice').className = 'notice ' + type; }
function updateControls() {
  if (stopped) {
    document.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = true);
    return;
  }
  document.querySelectorAll('button').forEach(b => b.disabled = busy);
  document.querySelectorAll('#config-form input, #config-form select').forEach(el => el.disabled = busy);
  document.querySelectorAll('.requires-config, #check').forEach(b => b.disabled = busy || !configured || dirty);
  $('llm-fields').hidden = $('mode').value === 'lite';
  $('same-key-row').hidden = $('preset').value !== 'openai' || $('mode').value === 'lite';
  $('mode-note').textContent = $('mode').value === 'lite' ? '基础记忆只需嵌入模型，不调用聊天模型。' : '事实记忆需要聊天模型与嵌入模型。';
  $('write-state').textContent = dirty ? '先保存刚修改的配置' : configured ? '记忆会保存在当前模型的本地记忆库' : '配置完成后即可使用';
}

async function post(path, payload) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json','X-HyMemory-Token':token}, body:JSON.stringify(payload)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作没有完成，请重试。');
  return result;
}

async function operation(message, action) {
  if (busy) return;
  busy = true; updateControls(); notice(message, 'busy');
  try { await action(); } catch(error) { notice(error.message || '无法连接本地服务，请重新启动。', 'error'); }
  finally { busy = false; updateControls(); }
}

function fillConfig(config) {
  current = config;
  for (const name of ['preset','mode','llm_url','llm_model','embed_url','embed_model','dimensions']) $(name).value = config[name];
  for (const prefix of ['llm','embed']) {
    $(prefix+'_key').value = '';
    $(prefix+'-key-state').textContent = config[prefix+'_key_saved'] ? '已加密保存' : '';
    $(prefix+'_key').placeholder = config[prefix+'_key_saved'] ? '留空保留原密钥' : '只在本机填写';
  }
  configured = Boolean(config.embed_url && config.embed_model && config.embed_key_saved &&
    (config.mode === 'lite' || (config.llm_url && config.llm_model && config.llm_key_saved)));
  dirty = false;
  updateControls();
}

$('preset').addEventListener('change', () => {
  const preset = presets[$('preset').value];
  if (preset) for (const [key, value] of Object.entries(preset)) $(key).value = value;
  for (const prefix of ['llm','embed']) { $(prefix+'_key').value = $('preset').value === 'local' ? 'ollama' : ''; $(prefix+'-key-state').textContent = $('preset').value === 'local' ? '本地接口占位值，无需购买密钥' : ''; }
  dirty = true; updateControls();
});
$('config-form').addEventListener('input', () => {dirty = true; updateControls();});
$('mode').addEventListener('change', () => {dirty = true; updateControls();});

$('config-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData($('config-form')));
  if ($('preset').value === 'openai' && $('same-key').checked) {
    const key = values.llm_key || values.embed_key;
    if (key) values.llm_key = values.embed_key = key;
  }
  operation('正在加密保存本地配置…', async () => {
    const result = await post('/api/config', values);
    fillConfig(result.config);
    notice(configured ? '配置已保存。可以测试连接，然后写入第一条记忆。' : '配置已保存在本机。决定服务后，补齐地址、模型和密钥即可。');
  });
});

$('check').addEventListener('click', () => operation('正在测试模型连接…', async () => {
  const result = await post('/api/check', {}); notice(result.message);
}));

$('add').addEventListener('click', () => {
  const text = $('memory-text').value.trim();
  if (!text) return notice('先写下一条希望助手记住的内容。', 'error');
  operation('正在保存记忆，事实整理可能需要一些时间…', async () => {
    const result = await post('/api/add', {text});
    const partial = result.result.agent_status && !['success','ok','completed'].includes(result.result.agent_status);
    notice(partial ? '原文已写入，但事实整理可能未完整完成，请检查服务配置后检索。' : '记忆已保存。现在换一种说法，试着把它找回来。', partial ? 'error' : '');
    $('memory-text').value = '';
  });
});

$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('query').value.trim();
  if (!text) return;
  operation('正在查找相关记忆…', async () => {
    const result = await post('/api/search', {text});
    $('results').replaceChildren();
    if (!result.memories.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      const title = document.createElement('strong'); title.textContent = '没有找到相关记忆';
      const note = document.createElement('p'); note.textContent = '试试更接近原意的提问，或确认当前使用的是写入时的模型配置。';
      empty.append(title, note); $('results').append(empty);
    }
    for (const memory of result.memories) {
      const card = document.createElement('article'); card.className = 'memory-result';
      const content = document.createElement('p'); content.textContent = memory.content;
      const meta = document.createElement('small');
      meta.textContent = `相关度 ${typeof memory.score === 'number' ? memory.score.toFixed(3) : '—'} · ${memory.layer || memory.channel}`;
      card.append(content, meta); $('results').append(card);
    }
    notice(`检索完成，找到 ${result.memories.length} 条相关记忆。`);
  });
});

$('stop').addEventListener('click', () => operation('正在停止本地服务…', async () => {
  await post('/api/shutdown', {});
  configured = false;
  stopped = true;
  notice('本地服务已停止。下次双击 Start.cmd 即可重新打开，记忆仍会保留。');
  token = '';
  document.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = true);
}));

(async () => {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('无法连接本地服务。');
    const status = await response.json(); token = status.token;
    $('version').textContent = status.version ? 'v' + status.version : '未安装';
    $('engine-status').textContent = status.version ? (status.hermes_connected ? '已配置 Hermes 连接' : '环境已就绪') : '请先运行 setup.ps1';
    fillConfig(status.config);
    notice(status.configured ? '已读取本地配置。可以测试连接，或继续检索已有记忆。' : '环境已准备好。选好服务后再填写密钥；现在不会调用任何模型 API。');
  } catch(error) {notice(error.message, 'error');}
})();
