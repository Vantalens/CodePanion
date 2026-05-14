const DEFAULTS = {
  port: 7777,
  token: '',
  allowlist: ['chat.openai.com', 'chatgpt.com', 'claude.ai']
};

let sourceByTab = new Map();

async function settings() {
  return await chrome.storage.sync.get(DEFAULTS);
}

async function request(route, payload) {
  const cfg = await settings();
  const res = await fetch(`http://127.0.0.1:${cfg.port}${route}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`${route} failed: ${res.status}`);
  return await res.json();
}

async function ensureSource(tabId, page) {
  if (sourceByTab.has(tabId)) return sourceByTab.get(tabId);
  const source = await request('/sources/register', {
    kind: 'browser-extension',
    name: page.host,
    windowTitle: page.title,
    url: page.url,
    capabilities: ['dom-state', 'allowlist']
  });
  sourceByTab.set(tabId, source.id);
  return source.id;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'check-allowlist') {
      const cfg = await settings();
      const host = new URL(message.url).hostname;
      sendResponse({ allowed: cfg.allowlist.some(item => host === item || host.endsWith(`.${item}`)) });
      return;
    }

    if (message.type === 'monitor-event' && sender.tab?.id != null) {
      const sourceId = await ensureSource(sender.tab.id, message.page);
      await request('/events', {
        ...message.event,
        source: 'browser-extension',
        sourceId,
        windowTitle: message.page.title,
        url: message.page.url,
        timestamp: Date.now()
      });
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
