marked.setOptions({ breaks: true, gfm: true });

const state = {
    connected: false,
    messages: [],
    sources: new Map()
};

function updateConnectionStatus(connected) {
    state.connected = Boolean(connected);
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    if (!statusDot || !statusText) return;
    statusDot.dataset.state = state.connected ? 'online' : 'offline';
    statusText.textContent = state.connected ? '已连接' : '未连接';
}

function sourceLabel(message) {
    const source = message.source || 'daemon';
    const title = message.windowTitle || message.workspace || message.url || '';
    return title ? `${source} · ${title}` : source;
}

function normalizeMessage(message) {
    const now = Date.now();
    return {
        id: message.id || message.Id || generateId(),
        type: message.type || message.Type || 'activity',
        source: message.source || message.Source || 'daemon',
        sourceId: message.sourceId || message.SourceId || '',
        sessionId: message.sessionId || message.SessionId || '',
        windowTitle: message.windowTitle || message.WindowTitle || '',
        workspace: message.workspace || message.Workspace || '',
        url: message.url || message.Url || '',
        timestamp: Number(message.timestamp || message.Timestamp || now),
        content: String(message.content || message.Content || message.message || message.Message || ''),
        options: Array.isArray(message.options) ? message.options : Array.isArray(message.Options) ? message.Options : undefined,
        level: message.level || message.Level || ''
    };
}

function showEmptyState() {
    const container = document.getElementById('chat-container');
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">AI</div>
            <div class="empty-state-title">等待监控事件</div>
            <div class="empty-state-description">
                CLI、VS Code、Codex、Claude Code 和浏览器扩展的提醒会显示在这里。
            </div>
        </div>
    `;
}

function renderMessage(input) {
    const message = normalizeMessage(input);
    const item = document.createElement('article');
    item.className = `message message-${message.type}`;
    item.dataset.messageId = message.id;
    if (message.sessionId) item.dataset.sessionId = message.sessionId;

    const timestamp = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const badge = document.createElement('span');
    badge.className = `message-badge badge-${message.type}`;
    badge.textContent = typeLabel(message.type);

    const source = document.createElement('span');
    source.className = 'message-source';
    source.textContent = sourceLabel(message);

    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = timestamp;

    meta.appendChild(badge);
    meta.appendChild(source);
    meta.appendChild(time);
    item.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'message-content';
    body.innerHTML = DOMPurify.sanitize(marked.parse(message.content));
    body.querySelectorAll('a').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });
    item.appendChild(body);

    if (message.type === 'prompt') {
        item.appendChild(renderOptions(message.sessionId, message.options || [], message.id));
    }

    return item;
}

function typeLabel(type) {
    switch (type) {
        case 'prompt': return '等待输入';
        case 'notification': return '通知';
        case 'done': return '完成';
        case 'error': return '错误';
        case 'user-reply': return '回复';
        default: return '动态';
    }
}

function renderOptions(sessionId, options, messageId) {
    const container = document.createElement('div');
    container.className = 'prompt-options';
    container.dataset.promptId = sessionId || messageId || generateId();

    options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'option-button';
        button.type = 'button';
        button.innerHTML = `<span class="option-number">${index + 1}</span><span class="option-label"></span>`;
        button.querySelector('.option-label').textContent = String(option);
        button.addEventListener('click', () => selectOption(sessionId, option, container.dataset.promptId));
        container.appendChild(button);
    });

    const input = document.createElement('input');
    input.className = 'custom-input';
    input.type = 'text';
    input.placeholder = sessionId ? '输入自定义回复，按 Enter 发送' : '记录本次选择，按 Enter 确认';
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && input.value.trim()) {
            selectOption(sessionId, input.value.trim(), container.dataset.promptId);
        }
    });
    container.appendChild(input);
    setTimeout(() => input.focus(), 80);

    return container;
}

function selectOption(sessionId, value, promptId) {
    if (sessionId) {
        sendToHost({ type: 'reply', sessionId, value: String(value) });
    } else if (promptId) {
        sendToHost({ type: 'event-reply', eventId: promptId, value: String(value) });
    }
    addMessage({
        type: 'user-reply',
        sessionId,
        source: 'user',
        timestamp: Date.now(),
        content: sessionId ? `**您的回复**：${value}` : `**已记录选择**：${value}`
    });
    disableOptionsForPrompt(promptId);
}

function disableOptionsForPrompt(promptId) {
    if (!promptId) return;
    document.querySelectorAll(`[data-prompt-id="${CSS.escape(promptId)}"] .option-button, [data-prompt-id="${CSS.escape(promptId)}"] .custom-input`)
        .forEach(el => { el.disabled = true; });
}

function addMessage(message) {
    const normalized = normalizeMessage(message);
    state.messages.push(normalized);
    const container = document.getElementById('chat-container');
    if (state.messages.length === 1) container.innerHTML = '';
    container.appendChild(renderMessage(normalized));
    requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
}

function clearMessages() {
    state.messages = [];
    showEmptyState();
}

function handleMessage(message) {
    switch (message.type) {
        case 'connection-status':
            updateConnectionStatus(message.connected);
            break;
        case 'add-message':
            if (message.data) addMessage(message.data);
            break;
        case 'monitor-event':
            if (message.data) addMessage({
                ...message.data,
                type: message.data.type || message.data.Type || 'activity',
                content: message.data.content || message.data.Content || message.data.title || message.data.Title || ''
            });
            break;
        case 'source-registered':
            if (message.source) {
                const sourceId = message.source.id || message.source.Id || generateId();
                state.sources.set(sourceId, message.source);
                addMessage({
                    type: 'activity',
                    source: message.source.kind || message.source.Kind,
                    sourceId,
                    windowTitle: message.source.windowTitle || message.source.WindowTitle,
                    workspace: message.source.workspace || message.source.Workspace,
                    timestamp: message.source.lastSeenAt || message.source.LastSeenAt || Date.now(),
                    content: `监控源已连接：**${message.source.name || message.source.Name || '未命名来源'}**`
                });
            }
            break;
        case 'session-registered':
            if (message.session) addMessage({
                type: 'activity',
                source: message.session.source || 'cli',
                sourceId: message.session.sourceId,
                sessionId: message.session.id,
                windowTitle: message.session.windowTitle,
                workspace: message.session.workspace,
                timestamp: message.session.startedAt || Date.now(),
                content: `会话已开始：\`${message.session.command}\``
            });
            break;
        case 'clear':
            clearMessages();
            break;
        default:
            console.log('Unknown message type:', message.type, message);
    }
}

function sendToHost(message) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
    }
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function initApp() {
    showEmptyState();
    updateConnectionStatus(false);
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener('message', event => handleMessage(event.data));
    }
    sendToHost({ type: 'ready' });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.RemindAI = { addMessage, clearMessages, updateConnectionStatus };
