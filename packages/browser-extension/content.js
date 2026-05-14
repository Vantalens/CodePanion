let lastState = '';
let allowed = false;

function pageInfo() {
  return {
    title: document.title,
    url: location.href,
    host: location.hostname
  };
}

function visibleText() {
  return document.body?.innerText?.slice(-4000) || '';
}

function detectState() {
  const text = visibleText();
  const busySelectors = [
    '[aria-label*="Stop"]',
    '[aria-label*="停止"]',
    '[data-testid*="stop"]',
    '.result-streaming'
  ];
  const isBusy = busySelectors.some(selector => document.querySelector(selector));
  if (isBusy) return { key: 'busy', type: 'activity', title: '浏览器对话生成中', content: document.title };

  if (/(regenerate|重新生成|继续生成|try again|重试|send message|发送)/i.test(text)) {
    return { key: `done:${document.title}`, type: 'done', title: '浏览器对话已结束', content: document.title };
  }

  if (/(error|出错|网络错误|rate limit|too many requests)/i.test(text)) {
    return { key: `error:${document.title}`, type: 'error', title: '浏览器对话出现错误', content: document.title };
  }

  return { key: 'idle', type: 'activity', title: '浏览器对话空闲', content: document.title };
}

function post(event) {
  chrome.runtime.sendMessage({
    type: 'monitor-event',
    page: pageInfo(),
    event
  });
}

function tick() {
  if (!allowed) return;
  const state = detectState();
  if (state.key === lastState) return;
  lastState = state.key;
  if (state.type === 'done' || state.type === 'error') post(state);
}

chrome.runtime.sendMessage({ type: 'check-allowlist', url: location.href }, response => {
  allowed = Boolean(response?.allowed);
  if (allowed) {
    setInterval(tick, 2500);
    tick();
  }
});
