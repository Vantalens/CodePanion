marked.setOptions({ breaks: true, gfm: true });

const state = {
    connected: false,
    messages: [],
    conversations: new Map(),
    sources: new Map(),
    activeConversation: '',
    activeView: 'active',
    codeBlocks: [],
    activeCodeId: '',
    workflowItemIds: new Set(),
    workflowItemsByThread: new Map(),
    workflowThreads: new Map()
};

const ACTIVE_CONVERSATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
const ARCHIVE_CONVERSATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 14;

function updateConnectionStatus(connected) {
    state.connected = Boolean(connected);
    const statusDots = document.querySelectorAll('.status-dot');
    const statusText = document.querySelector('.status-text');
    statusDots.forEach(dot => {
        dot.dataset.state = state.connected ? 'online' : 'offline';
    });
    if (statusText) statusText.textContent = state.connected ? '已连接' : '未连接';
}

function normalizeMessage(message) {
    const now = Date.now();
    const content = String(message.content || message.Content || message.message || message.Message || '');
    const normalized = {
        id: message.id || message.Id || generateId(),
        type: message.type || message.Type || 'activity',
        source: message.source || message.Source || 'daemon',
        sourceId: message.sourceId || message.SourceId || '',
        sessionId: message.sessionId || message.SessionId || '',
        eventId: message.eventId || message.EventId || '',
        threadId: message.threadId || message.ThreadId || '',
        windowTitle: message.windowTitle || message.WindowTitle || '',
        workspace: message.workspace || message.Workspace || '',
        url: message.url || message.Url || '',
        timestamp: Number(message.timestamp || message.Timestamp || now),
        content,
        options: Array.isArray(message.options) ? message.options : Array.isArray(message.Options) ? message.Options : undefined,
        level: message.level || message.Level || '',
        workflowSummary: message.workflowSummary || message.WorkflowSummary,
        rawItems: Array.isArray(message.rawItems) ? message.rawItems : Array.isArray(message.RawItems) ? message.RawItems : undefined
    };
    normalized.role = message.role || message.Role || '';
    normalized.conversationId = getConversationId(normalized);
    normalized.conversationTitle = getConversationTitle(normalized);
    return normalized;
}

function getConversationId(message) {
    if (message.threadId) return `workflow:${message.threadId}`;
    if (message.sessionId) return `session:${message.sessionId}`;
    if (message.sourceId) return `source:${message.sourceId}`;
    return `source:${message.source || 'daemon'}`;
}

function getConversationTitle(message) {
    if (message.windowTitle) return message.windowTitle;
    if (message.workspace) return shortPath(message.workspace);
    if (message.threadId) return `${message.source || 'workflow'} 线程`;
    if (message.sessionId) return `${message.source || 'cli'} 会话`;
    return message.source || 'daemon';
}

function shortPath(path) {
    return String(path).split(/[\\/]/).filter(Boolean).pop() || path;
}

function sourceLabel(message) {
    if (message.source === 'user') return '你';
    if (message.source === 'codex-desktop' || message.source === 'codex') return 'Codex';
    if (message.source === 'cli') return '终端';
    if (message.source === 'vscode') return 'VS Code';
    if (message.source === 'trae') return 'Trae';
    if (message.source === 'codebuddy') return 'CodeBuddy';
    if (message.source === 'lingma') return '通义灵码';
    if (message.source === 'marscode') return '豆包 / MarsCode';
    if (message.source === 'codegeex') return 'CodeGeeX';
    if (message.source === 'comate') return '百度 Comate';
    if (message.source === 'qwen-code') return 'Qwen Code';
    if (message.source === 'ai-ide') return 'AI IDE';
    return message.source || 'CodePanion';
}

function upsertConversation(message) {
    const id = message.conversationId;
    const current = state.conversations.get(id) || {
        id,
        title: message.conversationTitle,
        source: message.source,
        lastContent: '',
        lastAt: 0,
        count: 0,
        status: 'activity'
    };
    current.title = current.title || message.conversationTitle;
    current.source = message.source || current.source;
    current.lastContent = compactText(message.content);
    current.lastAt = message.timestamp;
    current.count += 1;
    current.status = message.type;
    state.conversations.set(id, current);
}

function compactText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function addMessage(message, render = true) {
    const normalized = normalizeMessage(message);
    const wasEmpty = state.messages.length === 0;
    state.messages.push(normalized);
    upsertConversation(normalized);
    extractCodeBlocks(normalized);
    if (!render) return;
    renderConversationList();
    appendMessageIfVisible(normalized, wasEmpty);
    renderCodeBrowser();
    renderContextDrawer();
}

function appendMessageIfVisible(message, wasEmpty) {
    const container = document.getElementById('chat-container');
    const visible = message.conversationId === state.activeConversation;
    if (!visible) return;

    if (wasEmpty || container.querySelector('.empty-state')) {
        container.innerHTML = '';
    }
    container.appendChild(renderMessage(message));
    requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
}

function clearMessages() {
    state.messages = [];
    state.conversations.clear();
    state.codeBlocks = [];
    state.activeCodeId = '';
    state.workflowItemIds.clear();
    state.workflowItemsByThread.clear();
    state.workflowThreads.clear();
    renderAll();
}

function renderAll() {
    renderConversationList();
    renderChat();
    renderCodeBrowser();
    renderContextDrawer();
}

function renderConversationList() {
    const list = document.getElementById('conversation-list');
    list.innerHTML = '';

    const allConversations = Array.from(state.conversations.values())
        .filter(item => item.id !== 'all')
        .sort((a, b) => b.lastAt - a.lastAt);

    updateQueueMetrics(allConversations);

    const activeView = normalizeView(state.activeView);
    let conversations = allConversations.filter(item => matchesActiveView(item, activeView));
    if (activeView === 'active') {
        conversations = allConversations.filter(isCurrentConversation);
        if (conversations.length === 0) conversations = allConversations.filter(isRecentConversation).slice(0, 12);
    }
    conversations = conversations.slice(0, activeView === 'active' ? 24 : 60);

    if (!state.activeConversation || !conversations.some(item => item.id === state.activeConversation)) {
        state.activeConversation = conversations[0]?.id || '';
    }

    if (conversations.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'conversation-preview';
        empty.style.padding = '12px';
        empty.textContent = activeView === 'waiting' ? '当前没有等待处理的任务' : '当前没有可显示的任务';
        list.appendChild(empty);
        return;
    }

    conversations.forEach(item => list.appendChild(makeConversationButton(item)));
}

function normalizeView(view) {
    if (view === 'overview' || view === 'inbox') return 'active';
    return view || 'active';
}

function matchesActiveView(item, activeView) {
    if (activeView === 'waiting') return item.status === 'prompt';
    if (activeView === 'running') return item.status !== 'prompt' && item.status !== 'done' && item.status !== 'error';
    if (activeView === 'error') return item.status === 'error';
    if (activeView === 'code') return state.codeBlocks.some(block => block.conversationId === item.id);
    return true;
}

function updateQueueMetrics(conversations) {
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    setText('queue-total', conversations.length);
    setText('queue-waiting', conversations.filter(item => item.status === 'prompt').length);
    setText('queue-running', conversations.filter(item => item.status !== 'prompt' && item.status !== 'done' && item.status !== 'error').length);
    setText('queue-error', conversations.filter(item => item.status === 'error').length);
}

function isCurrentConversation(item) {
    if (item.status === 'done') return false;
    if (!isRecentConversation(item)) return false;
    if (isArchivedConversation(item)) return false;
    return true;
}

function isRecentConversation(item) {
    const lastAt = Number(item.lastAt || 0);
    return lastAt > 0 && Date.now() - lastAt <= ACTIVE_CONVERSATION_WINDOW_MS;
}

function isArchivedConversation(item) {
    const lastAt = Number(item.lastAt || 0);
    if (lastAt > 0 && Date.now() - lastAt > ARCHIVE_CONVERSATION_WINDOW_MS) return true;
    const title = `${item.title || ''}\n${item.lastContent || ''}`.trim();
    return /<turn_aborted>|<environment_context>|Context from my IDE setup/i.test(title);
}

function makeConversationButton(item) {
    const button = document.createElement('button');
    button.className = `conversation-item ${state.activeConversation === item.id ? 'active' : ''}`;
    button.type = 'button';
    button.addEventListener('click', () => {
        state.activeConversation = item.id;
        renderAll();
    });

    const dotClass = item.status === 'prompt' ? 'waiting' : item.status === 'error' ? 'error' : item.status === 'done' ? 'done' : 'running';
    button.innerHTML = `
        <div class="conversation-name">
            <span class="conversation-dot ${dotClass}"></span>
            <span></span>
        </div>
        <div class="conversation-meta">
            <span class="conversation-chip source-chip"></span>
            <span class="conversation-chip capability-chip"></span>
        </div>
        <div class="conversation-preview"></div>
    `;
    button.querySelector('.conversation-name span:last-child').textContent = item.title;
    button.querySelector('.source-chip').textContent = sourceLabel({ source: item.source });
    button.querySelector('.capability-chip').textContent = capabilityForSource(item.source).level;
    button.querySelector('.conversation-preview').textContent = item.lastContent || item.source || '';
    return button;
}

function renderChat() {
    const container = document.getElementById('chat-container');
    const title = document.getElementById('conversation-title');
    const messages = getVisibleMessages();
    const conversation = state.conversations.get(state.activeConversation);

    title.textContent = state.activeConversation
        ? conversation?.title || '任务'
        : '当前任务';
    updateStageMeta(conversation, messages);

    if (messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div>
                    <strong>暂无任务</strong><br>
                    有新的工作流事件时会显示在这里。
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    messages.forEach(message => container.appendChild(renderMessage(message)));
    requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }));
}

function updateStageMeta(conversation, messages) {
    const latest = messages[messages.length - 1];
    const source = latest?.source || conversation?.source || '';
    const capability = capabilityForSource(source);
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('stage-source', source ? sourceLabel({ source }) : '来源未选择');
    setText('stage-capability', capability.level);
    setText('stage-status', statusLabel(conversation?.status || latest?.type || 'idle'));
}

function getVisibleMessages() {
    if (state.activeConversation.startsWith('workflow:')) {
        return buildIntegratedWorkflowMessages(state.activeConversation.slice('workflow:'.length));
    }
    if (!state.activeConversation) return [];
    return state.messages.filter(message => message.conversationId === state.activeConversation);
}

function statusLabel(status) {
    if (status === 'prompt') return '等待输入';
    if (status === 'error') return '失败';
    if (status === 'done') return '已完成';
    if (status === 'idle') return '等待事件';
    return '运行中';
}

function capabilityForSource(source) {
    const normalized = String(source || '').toLowerCase();
    if (normalized === 'cli' || normalized === 'codex' || normalized === 'claude-code') {
        return {
            level: 'L3 回复/继续',
            detail: '可从终端/PTTY 会话识别等待输入并回写回复。'
        };
    }
    if (normalized === 'codex-desktop') {
        return {
            level: 'L2 状态事件',
            detail: '可同步本地线程与工作流状态；回复能力取决于事件目标。'
        };
    }
    if (normalized === 'vscode') {
        return {
            level: 'L2 状态事件',
            detail: '通过显式来源注册接收轻量事件，不读取编辑器私有状态。'
        };
    }
    if (['qwen-code', 'codebuddy', 'lingma', 'trae', 'comate', 'codegeex', 'marscode', 'ai-ide'].includes(normalized)) {
        return {
            level: 'L1/L2 接入',
            detail: '当前以存在识别和轻量状态为主，不把弱接入展示为可接管。'
        };
    }
    if (normalized === 'user') {
        return {
            level: '本地输入',
            detail: '用户在 CodePanion 中发出的回复或记录。'
        };
    }
    return {
        level: 'L1 来源识别',
        detail: '已进入统一任务模型，深度能力以来源适配器为准。'
    };
}

function privacyBoundaryText(source) {
    const normalized = String(source || '').toLowerCase();
    if (normalized === 'cli' || normalized === 'codex' || normalized === 'claude-code') {
        return '显式会话';
    }
    if (normalized === 'vscode' || normalized === 'codex-desktop') {
        return '显式接入';
    }
    return '最小采集';
}

function latestActionablePrompt(messages) {
    return messages.slice().reverse().find(message => message.type === 'prompt' && (message.sessionId || message.eventId));
}

function focusActiveReply() {
    const input = document.querySelector('.message-prompt .custom-input:not(:disabled)');
    if (!input) return false;
    input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
}

function copyText(text) {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => undefined);
    }
}

function renderMessage(message) {
    const item = document.createElement('article');
    item.className = `message message-${message.type} ${message.role ? `message-role-${message.role}` : ''}`;
    item.dataset.messageId = message.id;
    if (message.sessionId) item.dataset.sessionId = message.sessionId;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = avatarText(message);

    const card = document.createElement('div');
    card.className = 'message-card';

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

    if (message.type !== 'activity' && message.role !== 'assistant' && message.role !== 'user') meta.appendChild(badge);
    meta.appendChild(source);
    meta.appendChild(time);
    if (message.type !== 'activity' || message.rawItems?.length || message.role) card.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'message-content';
    body.innerHTML = DOMPurify.sanitize(marked.parse(formatMessageContent(message)));
    body.querySelectorAll('a').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });
    card.appendChild(body);

    if (message.workflowSummary) {
        card.appendChild(renderWorkflowSummary(message.workflowSummary));
    }

    if (Array.isArray(message.rawItems) && message.rawItems.length > 0) {
        card.appendChild(renderWorkflowDetails(message.rawItems));
    }

    if (message.type === 'prompt') {
        card.appendChild(renderOptions(message.sessionId, message.eventId, message.options || [], message.id));
    }

    item.appendChild(avatar);
    item.appendChild(card);
    return item;
}

function formatMessageContent(message) {
    if (message.type !== 'output') return message.content;
    if (/```/.test(message.content)) return message.content;
    return message.content;
}

function avatarText(message) {
    if (message.role === 'user' || message.type === 'user-reply') return '我';
    const source = (message.source || 'AI').replace(/[^a-z0-9]/gi, '');
    return source.slice(0, 2).toUpperCase() || 'AI';
}

function typeLabel(type) {
    switch (type) {
        case 'prompt': return '等待输入';
        case 'notification': return '通知';
        case 'done': return '完成';
        case 'error': return '错误';
        case 'output': return '输出';
        case 'user-reply': return '回复';
        default: return '状态';
    }
}

function renderOptions(sessionId, eventId, options, messageId) {
    const container = document.createElement('div');
    container.className = 'prompt-options';
    container.dataset.promptId = sessionId || eventId || messageId || generateId();

    options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'option-button';
        button.type = 'button';
        button.innerHTML = `<span class="option-number">${index + 1}</span><span class="option-label"></span>`;
        button.querySelector('.option-label').textContent = String(option);
        button.addEventListener('click', () => selectOption(sessionId, eventId, option, container.dataset.promptId));
        container.appendChild(button);
    });

    const input = document.createElement('input');
    input.className = 'custom-input';
    input.type = 'text';
    input.placeholder = sessionId || eventId ? '输入自定义回复，按 Enter 发送' : '记录本次选择，按 Enter 确认';
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && input.value.trim()) {
            selectOption(sessionId, eventId, input.value.trim(), container.dataset.promptId);
        }
    });
    container.appendChild(input);
    setTimeout(() => input.focus(), 80);

    return container;
}

function selectOption(sessionId, eventId, value, promptId) {
    if (sessionId) {
        sendToHost({ type: 'reply', sessionId, value: String(value) });
    } else if (eventId) {
        sendToHost({ type: 'event-reply', eventId, value: String(value) });
    }

    addMessage({
        type: 'user-reply',
        sessionId,
        eventId,
        source: 'user',
        timestamp: Date.now(),
        content: sessionId || eventId ? `**您的回复**：${value}` : `**已记录选择**：${value}`
    });
    disableOptionsForPrompt(promptId);
}

function disableOptionsForPrompt(promptId) {
    if (!promptId) return;
    document.querySelectorAll(`[data-prompt-id="${CSS.escape(promptId)}"] .option-button, [data-prompt-id="${CSS.escape(promptId)}"] .custom-input`)
        .forEach(el => { el.disabled = true; });
}

function extractCodeBlocks(message) {
    const regex = /```([\w.+-]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(message.content)) !== null) {
        const code = match[2].trimEnd();
        if (!code.trim()) continue;
        const language = match[1] || 'text';
        if (!isUsefulCodeBlock(language, code)) continue;
        const block = {
            id: `${message.id}:code:${state.codeBlocks.length}`,
            messageId: message.id,
            conversationId: message.conversationId,
            title: message.conversationTitle,
            language,
            code,
            timestamp: message.timestamp
        };
        state.codeBlocks.push(block);
        if (!state.activeCodeId) state.activeCodeId = block.id;
    }
}

function isUsefulCodeBlock(language, code) {
    const normalized = code.trim();
    if (!normalized) return false;
    if (language && !/^text$/i.test(language)) return true;
    if (normalized.split(/\r?\n/).length >= 3) return true;
    return /^(diff --git|[+\-]{3}\s|@@\s|import\s|export\s|function\s|class\s|const\s|let\s|var\s|interface\s|type\s|namespace\s|using\s|public\s|private\s|protected\s|def\s|async\s|await\s|SELECT\s|CREATE\s|INSERT\s|UPDATE\s|DELETE\s)/m.test(normalized);
}

function renderCodeBrowser() {
    const shell = document.getElementById('app-shell');
    const list = document.getElementById('code-list');
    const preview = document.getElementById('code-preview');
    const count = document.getElementById('code-count');
    const blocks = state.activeConversation === 'all'
        ? state.codeBlocks
        : state.codeBlocks.filter(block => block.conversationId === state.activeConversation);

    shell.classList.toggle('has-code', state.activeView === 'code' && blocks.length > 0);
    count.textContent = `${blocks.length} 个片段`;
    list.innerHTML = '';

    if (blocks.length === 0) {
        preview.innerHTML = '<div class="empty-code"><strong>暂无可预览产物</strong><span>只展示真实代码块，不再显示普通 text 片段。</span></div>';
        return;
    }

    if (!blocks.some(block => block.id === state.activeCodeId)) {
        state.activeCodeId = blocks[0].id;
    }

    blocks.slice().reverse().forEach(block => {
        const button = document.createElement('button');
        button.className = `code-item ${state.activeCodeId === block.id ? 'active' : ''}`;
        button.type = 'button';
        button.innerHTML = `
            <div class="code-item-title"></div>
            <div class="code-item-meta"></div>
        `;
        button.querySelector('.code-item-title').textContent = block.title;
        button.querySelector('.code-item-meta').textContent = `${block.language} · ${new Date(block.timestamp).toLocaleTimeString('zh-CN')}`;
        button.addEventListener('click', () => {
            state.activeCodeId = block.id;
            renderCodeBrowser();
        });
        list.appendChild(button);
    });

    const active = blocks.find(block => block.id === state.activeCodeId) || blocks[0];
    preview.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'code-preview-header';
    header.innerHTML = '<div class="code-preview-title"></div><div class="code-preview-lang"></div>';
    header.querySelector('.code-preview-title').textContent = active.title;
    header.querySelector('.code-preview-lang').textContent = active.language;

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = active.code;
    pre.appendChild(code);
    preview.appendChild(header);
    preview.appendChild(pre);
}

function renderContextDrawer() {
    const conversation = state.conversations.get(state.activeConversation);
    const messages = getVisibleMessages();
    const latest = messages[messages.length - 1];
    const source = latest?.source || conversation?.source || '';
    const capability = capabilityForSource(source);
    const prompt = latestActionablePrompt(messages);
    const workspace = latest?.workspace || messages.find(message => message.workspace)?.workspace || '';
    updateStageMeta(conversation, messages);

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('drawer-source-name', source ? sourceLabel({ source }) : '未选择任务');
    setText('drawer-source-detail', conversation ? `${statusLabel(conversation.status)} · ${conversation.title || '未命名任务'}` : '选择一个任务后显示来源状态。');
    setText('drawer-capability', capability.level);
    setText('drawer-privacy', privacyBoundaryText(source));
    setText('drawer-action-note', capability.detail);

    const canReply = Boolean(prompt);
    const contextText = messages.map(message => `[${sourceLabel(message)}] ${compactText(message.content)}`).join('\n');
    wireActionButton('stage-focus-reply', canReply, () => focusActiveReply());
    wireActionButton('drawer-focus-reply', canReply, () => focusActiveReply());
    wireActionButton('stage-copy-context', messages.length > 0, () => copyText(contextText));
    wireActionButton('drawer-copy-workspace', Boolean(workspace), () => copyText(workspace));
    wireOmnibar(prompt);
}

function wireActionButton(id, enabled, handler) {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = !enabled;
    button.onclick = enabled ? handler : null;
}

function wireOmnibar(prompt) {
    const input = document.getElementById('omnibar-input');
    const submit = document.getElementById('omnibar-submit');
    if (!input || !submit) return;

    const enabled = Boolean(prompt);
    input.disabled = !enabled;
    submit.disabled = !enabled;
    input.placeholder = enabled ? '输入回复，按 Enter 发送到当前等待任务' : '选择可回复的等待任务后启用';

    submit.onclick = enabled ? () => {
        const value = input.value.trim();
        if (!value) return;
        selectOption(prompt.sessionId, prompt.eventId, value, prompt.id);
        input.value = '';
    } : null;

    input.onkeydown = enabled ? (event) => {
        if (event.key === 'Enter' && input.value.trim()) {
            selectOption(prompt.sessionId, prompt.eventId, input.value.trim(), prompt.id);
            input.value = '';
        }
    } : null;
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
                eventId: message.data.id || message.data.Id,
                type: message.data.type || message.data.Type || 'activity',
                content: message.data.content || message.data.Content || message.data.title || message.data.Title || ''
            });
            break;
        case 'workflow-snapshot':
            if (message.snapshot) applyWorkflowSnapshot(message.snapshot);
            break;
        case 'workflow-event':
            if (message.data) applyWorkflowEvent(message.data);
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
        case 'source-disconnected': {
            const sourceId = message.sourceId || message.SourceId || '';
            const source = state.sources.get(sourceId);
            if (source) {
                source.status = 'offline';
                source.Status = 'offline';
                addMessage({
                    type: 'done',
                    source: source.kind || source.Kind,
                    sourceId,
                    windowTitle: source.windowTitle || source.WindowTitle,
                    workspace: source.workspace || source.Workspace,
                    timestamp: Date.now(),
                    content: `监控源已离线：**${source.name || source.Name || '未命名来源'}**`
                });
            }
            break;
        }
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

function applyWorkflowSnapshot(snapshot) {
    const threads = Array.isArray(snapshot.threads) ? snapshot.threads : Array.isArray(snapshot.Threads) ? snapshot.Threads : [];
    const items = Array.isArray(snapshot.items) ? snapshot.items : Array.isArray(snapshot.Items) ? snapshot.Items : [];

    threads.forEach(thread => storeWorkflowThread(thread));
    items
        .slice()
        .sort((a, b) => Number(a.timestamp || a.Timestamp || 0) - Number(b.timestamp || b.Timestamp || 0))
        .forEach(item => storeWorkflowItem(item));
    refreshAllWorkflowConversations();
    chooseInitialConversation();
    renderAll();
}

function applyWorkflowEvent(event) {
    const action = event.action || event.Action;
    const thread = event.thread || event.Thread;
    const item = event.item || event.Item;

    if (thread) {
        storeWorkflowThread(thread);
    }

    if (action === 'item-append' && item) {
        const stored = storeWorkflowItem(item);
        if (stored) refreshWorkflowConversation(getWorkflowThreadId(item));
        renderAll();
    } else {
        if (thread) refreshWorkflowConversation(thread.id || thread.Id);
        renderConversationList();
    }
}

function storeWorkflowThread(thread) {
    const id = thread.id || thread.Id;
    if (!id) return;
    const existing = state.workflowThreads.get(id) || {};
    state.workflowThreads.set(id, {
        ...existing,
        id,
        title: thread.title || thread.Title || existing.title || id,
        source: thread.source || thread.Source || existing.source || 'workflow',
        workspace: thread.workspace || thread.Workspace || existing.workspace || '',
        status: thread.status || thread.Status || existing.status || 'running',
        updatedAt: Number(thread.updatedAt || thread.UpdatedAt || existing.updatedAt || Date.now()),
        itemCount: Number(thread.itemCount || thread.ItemCount || existing.itemCount || 0)
    });
}

function storeWorkflowItem(item) {
    const id = item.id || item.Id || generateId();
    if (state.workflowItemIds.has(id)) return false;
    state.workflowItemIds.add(id);
    const threadId = getWorkflowThreadId(item);
    if (!threadId) return false;

    const normalizedItem = normalizeWorkflowItem(item, id);
    if (shouldIgnoreWorkflowItem(normalizedItem)) return false;
    if (isLowValueStatus(normalizedItem)) return false;

    if (!state.workflowItemsByThread.has(threadId)) {
        state.workflowItemsByThread.set(threadId, []);
    }
    state.workflowItemsByThread.get(threadId).push(normalizedItem);

    if (!state.workflowThreads.has(threadId)) {
        state.workflowThreads.set(threadId, {
            id: threadId,
            title: normalizedItem.title || `${normalizedItem.source} 线程`,
            source: normalizedItem.source || 'workflow',
            workspace: normalizedItem.filePath || '',
            status: normalizedItem.status || 'running',
            updatedAt: normalizedItem.timestamp,
            itemCount: 0
        });
    }

    const thread = state.workflowThreads.get(threadId);
    thread.updatedAt = Math.max(Number(thread.updatedAt || 0), normalizedItem.timestamp);
    thread.itemCount = Math.max(Number(thread.itemCount || 0), state.workflowItemsByThread.get(threadId).length);
    thread.title = deriveWorkflowTitle(threadId, thread.title);
    if (normalizedItem.status) thread.status = normalizedItem.status;
    if (shouldExtractWorkflowCode(normalizedItem)) {
        extractCodeBlocks(normalizeMessage(workflowItemToMessage(normalizedItem, id)));
    }
    return true;
}

function workflowItemToMessage(item, id) {
    const kind = item.kind || 'message';
    const status = item.status || '';
    const threadId = item.threadId || '';
    const title = item.title || '';
    const content = item.content || '';
    const messageType = workflowKindToMessageType(kind, status);
    return {
        id,
        type: messageType,
        source: item.source || 'workflow',
        threadId,
        windowTitle: '',
        workspace: item.filePath || '',
        timestamp: item.timestamp || Date.now(),
        content: workflowContent(kind, title, content, item.language),
        level: status,
        role: item.role || ''
    };
}

function normalizeWorkflowItem(item, id) {
    return {
        id,
        threadId: getWorkflowThreadId(item),
        kind: item.kind || item.Kind || 'message',
        source: item.source || item.Source || 'workflow',
        timestamp: Number(item.timestamp || item.Timestamp || Date.now()),
        title: item.title || item.Title || '',
        content: String(item.content || item.Content || ''),
        language: item.language || item.Language || '',
        status: item.status || item.Status || '',
        role: item.role || item.Role || '',
        filePath: item.filePath || item.FilePath || ''
    };
}

function shouldIgnoreWorkflowItem(item) {
    const role = String(item.role || item.title || '').toLowerCase();
    if (role === 'system' || role === 'developer') return true;

    const content = item.content.trim();
    if (!content) return item.kind === 'message';
    if (isInternalWorkflowContent(content)) return true;
    return false;
}

function isInternalWorkflowContent(content) {
    if (/^<permissions instructions>/i.test(content)) return true;
    if (/^<environment_context>/i.test(content)) return true;
    if (/^<turn_aborted>/i.test(content)) return true;
    if (/^# Context from my IDE setup:/i.test(content)) return true;
    if (/^#\s*Tools\s*$/im.test(content) && /namespace:?\s*(functions|web|image_gen)/i.test(content)) return true;
    if (/^You are Codex,/i.test(content)) return true;
    if (/^Knowledge cutoff:/i.test(content)) return true;
    return false;
}

function isLowValueStatus(item) {
    if (item.kind !== 'status') return false;
    const title = String(item.title || '').toLowerCase();
    return title === '任务开始' || title === '任务完成' || title === 'task_started' || title === 'task_complete';
}

function shouldExtractWorkflowCode(item) {
    if (shouldIgnoreWorkflowItem(item)) return false;
    if (!/```[\s\S]*?```/.test(item.content)) return false;
    if (item.kind === 'artifact') return true;
    if (item.kind === 'message') {
        const role = String(item.role || item.title || '').toLowerCase();
        return role === 'assistant' || role === 'user' || role === 'codex';
    }
    return false;
}

function getWorkflowThreadId(item) {
    return item.threadId || item.ThreadId || '';
}

function refreshAllWorkflowConversations() {
    Array.from(state.workflowThreads.keys()).forEach(refreshWorkflowConversation);
}

function refreshWorkflowConversation(threadId) {
    if (!threadId) return;
    const thread = state.workflowThreads.get(threadId);
    if (!thread) return;
    const summary = summarizeWorkflow(threadId);
    const status = workflowStatusToMessageType(thread.status || summary.status);
    state.conversations.set(`workflow:${threadId}`, {
        id: `workflow:${threadId}`,
        title: deriveWorkflowTitle(threadId, thread.title),
        source: thread.source || 'workflow',
        lastContent: workflowPreview(threadId, summary),
        lastAt: Number(thread.updatedAt || summary.lastAt || Date.now()),
        count: summary.totalCount,
        status: isArchivedConversation({ title: thread.title, lastContent: workflowPreview(threadId, summary), lastAt: Number(thread.updatedAt || summary.lastAt || Date.now()) })
            ? 'done'
            : status
    });
}

function chooseInitialConversation() {
    if (state.activeConversation) return;
    const best = Array.from(state.conversations.values())
        .filter(item => item.status !== 'done')
        .sort((a, b) => b.lastAt - a.lastAt)[0]
        || Array.from(state.conversations.values()).sort((a, b) => b.lastAt - a.lastAt)[0];
    state.activeConversation = best?.id || '';
}

function deriveWorkflowTitle(threadId, fallback) {
    const items = state.workflowItemsByThread.get(threadId) || [];
    const user = items.find(item => item.kind === 'message' && String(item.role || item.title).toLowerCase() === 'user' && item.content.trim());
    if (user) return compactTitle(user.content);

    const assistant = items.find(item => item.kind === 'message' && String(item.role || item.title).toLowerCase() === 'assistant' && item.content.trim());
    if (assistant) return compactTitle(assistant.content);

    const cleanFallback = String(fallback || '').replace(/^Codex\s+/i, '').trim();
    if (/^[0-9a-f-]{20,}$/i.test(cleanFallback)) return 'Codex 工作流';
    return cleanFallback || 'Codex 工作流';
}

function compactTitle(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, '代码片段')
        .replace(/[#*_`>[\]()-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 34) || 'Codex 工作流';
}

function workflowPreview(threadId, summary) {
    const items = state.workflowItemsByThread.get(threadId) || [];
    const latest = items.slice().reverse().find(item => item.kind === 'message' && item.content.trim());
    const prefix = [];
    if (summary.promptCount) prefix.push('等待回复');
    if (summary.errorCount) prefix.push('有错误');
    if (summary.codeCount) prefix.push('含代码');
    if (latest) prefix.push(compactText(latest.content));
    return prefix.length > 0 ? prefix.join(' · ') : '执行中';
}

function buildWorkflowOverviewMessages() {
    return Array.from(state.workflowThreads.values())
        .map(thread => {
            const summary = summarizeWorkflow(thread.id);
            return normalizeMessage({
                id: `workflow-overview:${thread.id}`,
                type: workflowStatusToMessageType(thread.status || summary.status),
                source: thread.source || 'workflow',
                threadId: thread.id,
                windowTitle: deriveWorkflowTitle(thread.id, thread.title),
                workspace: thread.workspace,
                timestamp: thread.updatedAt || summary.lastAt || Date.now(),
                content: `**${deriveWorkflowTitle(thread.id, thread.title)}**\n\n${workflowPreview(thread.id, summary)}`,
                workflowSummary: summary
            });
        });
}

function buildIntegratedWorkflowMessages(threadId) {
    const thread = state.workflowThreads.get(threadId);
    const items = (state.workflowItemsByThread.get(threadId) || [])
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);
    if (!thread && items.length === 0) return [];

    const messages = [];
    const summary = summarizeWorkflow(threadId);
    const meta = thread || {};
    const firstGoal = items.find(item => item.kind === 'message' && String(item.role || item.title).toLowerCase() === 'user' && item.content.trim());
    if (firstGoal) {
        messages.push(normalizeMessage({
            id: `workflow-goal:${threadId}`,
            type: 'activity',
            source: 'user',
            role: 'user',
            threadId,
            windowTitle: deriveWorkflowTitle(threadId, meta.title),
            workspace: meta.workspace || '',
            timestamp: firstGoal.timestamp,
            content: firstGoal.content
        }));
    }

    const seenText = new Set();
    const activityBuffer = [];
    const flushActivity = () => {
        if (activityBuffer.length === 0) return;
        const first = activityBuffer[0];
        const last = activityBuffer[activityBuffer.length - 1];
        const counts = countKinds(activityBuffer);
        const visibleBuffer = summarizeActivityItems(activityBuffer);
        if (visibleBuffer.length === 0) {
            activityBuffer.length = 0;
            return;
        }
        messages.push(normalizeMessage({
            id: `workflow-group:${threadId}:${first.id}:${last.id}`,
            type: hasError(activityBuffer) ? 'error' : 'activity',
            source: first.source || meta.source || 'workflow',
            threadId,
            windowTitle: meta.title || '',
            workspace: first.filePath || meta.workspace || '',
            timestamp: first.timestamp,
            content: buildActivitySummary(counts, activityBuffer.length, first.timestamp, last.timestamp),
            rawItems: visibleBuffer
        }));
        activityBuffer.length = 0;
    };

    for (const item of items) {
        if (firstGoal && item.id === firstGoal.id) continue;
        if (isPrimaryWorkflowMessage(item)) {
            flushActivity();
            const content = formatWorkflowPrimaryMessage(item);
            const key = `${item.kind}:${item.status}:${compactText(content)}`;
            if (seenText.has(key)) continue;
            seenText.add(key);
            messages.push(normalizeMessage({
                id: `workflow-message:${item.id}`,
                type: workflowKindToMessageType(item.kind, item.status),
                source: String(item.role || item.title).toLowerCase() === 'user' ? 'user' : item.source || meta.source || 'workflow',
                sessionId: inferWorkflowSessionId(threadId),
                eventId: inferWorkflowEventId(item.id),
                threadId,
                windowTitle: deriveWorkflowTitle(threadId, meta.title),
                workspace: item.filePath || meta.workspace || '',
                timestamp: item.timestamp,
                content,
                level: item.status,
                role: normalizeWorkflowRole(item)
            }));
        } else {
            activityBuffer.push(item);
            if (activityBuffer.length >= 24) flushActivity();
        }
    }
    flushActivity();

    return trimIntegratedMessages(messages);
}

function inferWorkflowSessionId(threadId) {
    return String(threadId || '').startsWith('session:') ? String(threadId).slice('session:'.length) : '';
}

function inferWorkflowEventId(itemId) {
    return String(itemId || '').startsWith('monitor:') ? String(itemId).slice('monitor:'.length) : '';
}

function trimIntegratedMessages(messages) {
    const maxMessages = 70;
    if (messages.length <= maxMessages) return messages;
    const head = messages.slice(0, 1);
    const tail = messages.slice(-(maxMessages - 2));
    const hidden = messages.length - head.length - tail.length;
    return [
        ...head,
        normalizeMessage({
            id: `workflow-trimmed:${messages[0].threadId}:${hidden}`,
            type: 'activity',
            source: messages[0].source,
            threadId: messages[0].threadId,
            windowTitle: messages[0].windowTitle,
            timestamp: tail[0]?.timestamp || messages[0].timestamp,
            content: `已隐藏较早的 ${hidden} 条记录。`
        }),
        ...tail
    ];
}

function isPrimaryWorkflowMessage(item) {
    if (shouldIgnoreWorkflowItem(item)) return false;
    if (isLowValueStatus(item)) return false;
    if (item.kind === 'prompt') return true;
    if (item.status === 'waiting' || item.status === 'error') return true;
    if (item.kind !== 'message' && item.kind !== 'artifact') return false;
    if (!item.content.trim()) return Boolean(item.title);
    if (item.kind === 'artifact') return /```|diff --git|^\s*(export|import|function|class|const|let|var)\b/m.test(item.content);
    return item.content.trim().length >= 2;
}

function formatWorkflowPrimaryMessage(item) {
    if (item.kind !== 'message') return workflowContent(item.kind, item.title, item.content, item.language);
    const role = normalizeWorkflowRole(item);
    if (role === 'user') return item.content;
    return item.content;
}

function normalizeWorkflowRole(item) {
    const role = String(item.role || item.title || '').toLowerCase();
    if (role === 'user') return 'user';
    if (role === 'assistant' || role === 'codex') return 'assistant';
    return '';
}

function summarizeWorkflow(threadId) {
    const items = state.workflowItemsByThread.get(threadId) || [];
    const summary = {
        totalCount: items.length,
        messageCount: 0,
        toolCount: 0,
        commandCount: 0,
        fileChangeCount: 0,
        codeCount: 0,
        promptCount: 0,
        errorCount: 0,
        lastAt: 0,
        status: state.workflowThreads.get(threadId)?.status || 'running'
    };
    for (const item of items) {
        if (item.kind === 'message') summary.messageCount += 1;
        if (item.kind === 'tool_call') summary.toolCount += 1;
        if (item.kind === 'command') summary.commandCount += 1;
        if (item.kind === 'file_change') summary.fileChangeCount += 1;
        if (item.kind === 'prompt') summary.promptCount += 1;
        if (item.status === 'error') summary.errorCount += 1;
        if (/```[\s\S]*?```/.test(item.content) || item.kind === 'artifact') summary.codeCount += 1;
        summary.lastAt = Math.max(summary.lastAt, item.timestamp || 0);
        if (item.status) summary.status = item.status;
    }
    return summary;
}

function countKinds(items) {
    return items.reduce((counts, item) => {
        counts[item.kind] = (counts[item.kind] || 0) + 1;
        return counts;
    }, {});
}

function hasError(items) {
    return items.some(item => item.status === 'error');
}

function buildActivitySummary(counts, total, startAt, endAt) {
    const seconds = Math.max(0, Math.round((Number(endAt || startAt) - Number(startAt || endAt)) / 1000));
    const duration = seconds > 0 ? ` ${formatDuration(seconds)}` : '';
    const parts = [];
    if (counts.file_change) parts.push(`${counts.file_change} 个文件`);
    if (counts.tool_call) parts.push(`${counts.tool_call} 次操作`);
    if (counts.command) parts.push(`${counts.command} 条输出`);
    if (counts.artifact) parts.push(`${counts.artifact} 段代码`);
    if (parts.length === 0) parts.push(`${total} 条记录`);
    return `已处理${duration}  ${parts.join('，')}`;
}

function summarizeActivityItems(items) {
    return items
        .filter(item => !isLowValueStatus(item))
        .filter(item => item.kind === 'tool_call' || item.kind === 'command' || item.kind === 'file_change' || item.status === 'error')
        .slice(-6);
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function renderWorkflowSummary(summary) {
    const wrapper = document.createElement('div');
    wrapper.className = 'workflow-summary';
    const stats = [
        ['消息', summary.messageCount],
        ['工具', summary.toolCount],
        ['命令', summary.commandCount],
        ['文件', summary.fileChangeCount],
        ['代码', summary.codeCount],
        ['等待', summary.promptCount],
        ['错误', summary.errorCount]
    ].filter(([, value]) => value > 0);

    stats.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'workflow-stat';
        item.innerHTML = '<span></span><strong></strong>';
        item.querySelector('span').textContent = label;
        item.querySelector('strong').textContent = String(value);
        wrapper.appendChild(item);
    });
    return wrapper;
}

function renderWorkflowDetails(items) {
    const details = document.createElement('details');
    details.className = 'workflow-details';
    const summary = document.createElement('summary');
    summary.textContent = `查看 ${items.length} 条原始事件`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'workflow-detail-list';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'workflow-detail-row';
        const title = document.createElement('div');
        title.className = 'workflow-detail-title';
        title.textContent = `${workflowKindLabel(item.kind)}${item.title ? ` · ${item.title}` : ''}`;
        const body = document.createElement('pre');
        body.textContent = compactRawWorkflowText(item.content || item.filePath || item.status || '');
        row.appendChild(title);
        if (body.textContent) row.appendChild(body);
        list.appendChild(row);
    });
    details.appendChild(list);
    return details;
}

function workflowKindLabel(kind) {
    switch (kind) {
        case 'tool_call': return '工具调用';
        case 'command': return '命令输出';
        case 'file_change': return '文件变更';
        case 'artifact': return 'Artifact';
        case 'prompt': return '等待输入';
        case 'status': return '状态';
        default: return '活动';
    }
}

function compactRawWorkflowText(text) {
    const normalized = String(text || '').trim();
    if (normalized.length <= 1200) return normalized;
    return `${normalized.slice(0, 1200)}\n... 已截断，完整内容仍保留在源线程中`;
}

function workflowKindToMessageType(kind, status) {
    if (kind === 'prompt' || status === 'waiting') return 'prompt';
    if (status === 'error') return 'error';
    if (status === 'done') return 'done';
    if (kind === 'command' || kind === 'tool_call' || kind === 'file_change') return 'output';
    return 'activity';
}

function workflowStatusToMessageType(status) {
    if (status === 'waiting') return 'prompt';
    if (status === 'error') return 'error';
    if (status === 'done') return 'done';
    return 'activity';
}

function workflowContent(kind, title, content, language) {
    if (!content) return title || kind;
    if (kind === 'artifact' && !/```/.test(content)) {
        return `**${title || 'Artifact'}**\n\n\`\`\`${language || 'text'}\n${content}\n\`\`\``;
    }
    if (kind === 'tool_call') return `**工具调用：${title || 'tool'}**\n\n${content}`;
    if (kind === 'command') return `**命令/输出：${title || 'output'}**\n\n${content}`;
    if (kind === 'file_change') return `**文件变更：${title || 'change'}**\n\n${content}`;
    return title ? `**${title}**\n\n${content}` : content;
}

function bindViewButtons() {
    document.querySelectorAll('.tool-button, .rail-button').forEach(button => {
        button.addEventListener('click', () => {
            const nextView = button.dataset.view || 'active';
            document.querySelectorAll('.tool-button, .rail-button').forEach(item => {
                item.classList.toggle('active', item.dataset.view === nextView);
            });
            state.activeView = nextView;
            if (state.activeView === 'code' && state.codeBlocks.length > 0) {
                state.activeConversation = state.codeBlocks[state.codeBlocks.length - 1].conversationId;
            }
            renderAll();
        });
    });
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
    bindViewButtons();
    renderAll();
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

window.CodePanion = { addMessage, clearMessages, updateConnectionStatus };
