const DEFAULTS = {
  port: 7777,
  token: '',
  allowlist: ['chat.openai.com', 'chatgpt.com', 'claude.ai']
};

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById('port').value = cfg.port;
  document.getElementById('token').value = cfg.token;
  document.getElementById('allowlist').value = cfg.allowlist.join('\n');
}

async function save() {
  await chrome.storage.sync.set({
    port: Number(document.getElementById('port').value || 7777),
    token: document.getElementById('token').value,
    allowlist: document.getElementById('allowlist').value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  });
  document.getElementById('save').textContent = '已保存';
  setTimeout(() => document.getElementById('save').textContent = '保存', 1200);
}

document.getElementById('save').addEventListener('click', save);
load();
