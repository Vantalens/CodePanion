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
    workflowThreads: new Map(),
    openSnoozeMenuId: '',
    groupMode: 'workspace',
    batchMode: false,
    selectedBatchConversationIds: new Set()
};

const MAX_MESSAGES = 5000;
const MAX_CODE_BLOCKS = 300;
const MAX_WORKFLOW_THREADS = 30;
const MAX_WORKFLOW_ITEMS_PER_THREAD = 120;
const MAX_WORKFLOW_ITEM_IDS = 4000;
const ACTIVE_CONVERSATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
const ARCHIVE_CONVERSATION_WINDOW_MS = 1000 * 60 * 60 * 24 * 14;
let renderScheduled = false;
let renderSmoothScroll = false;
const AUTO_SCROLL_THRESHOLD_PX = 96;

function updateConnectionStatus(connected) {
    state.connected = Boolean(connected);
    const statusDots = document.querySelectorAll('.status-dot');
    const statusText = document.querySelector('.status-text');
    statusDots.forEach(dot => {
        dot.dataset.state = state.connected ? 'online' : 'offline';
    });
    if (statusText) statusText.textContent = state.connected ? '已连接' : '未连接';
    renderSourceStatusPanel();
}

function renderSourceStatusPanel() {
    const vscodeText = document.getElementById('vscode-source-status');
    const vscodeDot = document.querySelector('[data-source-kind="vscode"] .source-status-dot');
    if (!vscodeText || !vscodeDot) return;
    const sources = Array.from(state.sources.values());
    const vscodeSources = sources.filter(source => String(source.kind || source.Kind || '').toLowerCase() === 'vscode');
    const online = vscodeSources.find(source => String(source.status || source.Status || '').toLowerCase() === 'online');
    vscodeDot.dataset.state = online ? 'online' : 'offline';
    if (online) {
        const workspace = online.workspace || online.Workspace || online.windowTitle || online.WindowTitle || '';
        vscodeText.textContent = workspace ? `在线：${shortPath(workspace)}` : '在线';
        return;
    }
    vscodeText.textContent = state.connected
        ? '未连接：VS Code 扩展未加载或未连到 daemon'
        : 'daemon 未连接';
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
        capabilityLevel: message.capabilityLevel || message.CapabilityLevel || '',
        integrationKind: message.integrationKind || message.IntegrationKind || '',
        privacyBoundary: message.privacyBoundary || message.PrivacyBoundary || '',
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
    if (message.source === 'claude-code') return 'Claude Code';
    if (message.source === 'opencode') return 'OpenCode';
    if (message.source === 'cli') return '终端';
    if (message.source === 'vscode') return 'VS Code';
    if (message.source === 'trae') return 'Trae';
    if (message.source === 'codebuddy') return 'CodeBuddy';
    if (message.source === 'lingma') return '通义灵码';
    if (message.source === 'marscode') return '豆包 / MarsCode';
    if (message.source === 'codegeex') return 'CodeGeeX';
    if (message.source === 'comate') return '百度 Comate';
    if (message.source === 'qwen-code') return 'Qwen Code';
    if (message.source === 'cc-switch') return 'CC Switch';
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
        status: 'activity',
        capabilityLevel: message.capabilityLevel,
        integrationKind: message.integrationKind,
        privacyBoundary: message.privacyBoundary
    };
    current.title = current.title || message.conversationTitle;
    current.source = message.source || current.source;
    current.capabilityLevel = message.capabilityLevel || current.capabilityLevel;
    current.integrationKind = message.integrationKind || current.integrationKind;
    current.privacyBoundary = message.privacyBoundary || current.privacyBoundary;
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
    pruneMessageState();
    if (!render) return;
    renderConversationList();
    appendMessageIfVisible(normalized, wasEmpty);
    renderCodeBrowser();
    renderContextDrawer();
}

function pruneMessageState() {
    let changed = false;

    if (state.messages.length > MAX_MESSAGES) {
        state.messages = state.messages.slice(-MAX_MESSAGES);
        changed = true;
    }

    if (state.codeBlocks.length > MAX_CODE_BLOCKS) {
        state.codeBlocks = state.codeBlocks.slice(-MAX_CODE_BLOCKS);
        if (state.activeCodeId && !state.codeBlocks.some(block => block.id === state.activeCodeId)) {
            state.activeCodeId = state.codeBlocks[0]?.id || '';
        }
    }

    if (changed) rebuildConversationState();
}

function rebuildConversationState() {
    const messages = state.messages;
    state.conversations.clear();
    state.codeBlocks = [];
    state.activeCodeId = '';
    messages.forEach(message => {
        upsertConversation(message);
        extractCodeBlocks(message);
    });
    if (state.codeBlocks.length > MAX_CODE_BLOCKS) {
        state.codeBlocks = state.codeBlocks.slice(-MAX_CODE_BLOCKS);
        state.activeCodeId = state.codeBlocks[0]?.id || '';
    }
    if (state.activeConversation && !state.conversations.has(state.activeConversation)) {
        state.activeConversation = '';
    }
}

function appendMessageIfVisible(message, wasEmpty) {
    const container = document.getElementById('chat-container');
    const visible = message.conversationId === state.activeConversation;
    if (!visible) return;
    const shouldStickToBottom = isNearScrollBottom(container);

    if (wasEmpty || container.querySelector('.empty-state')) {
        container.innerHTML = '';
    }
    container.appendChild(renderMessage(message));
    if (shouldStickToBottom) {
        requestAnimationFrame(() => scrollContainerToBottom(container, 'auto'));
    }
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
    renderSourceStatusPanel();
    renderConversationList();
    renderChat();
    renderCodeBrowser();
    renderContextDrawer();
}

function scheduleRenderAll({ smoothScroll = false } = {}) {
    renderSmoothScroll = renderSmoothScroll || smoothScroll;
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        renderAll();
        renderSmoothScroll = false;
    });
}

function renderConversationList() {
    const list = document.getElementById('conversation-list');
    list.innerHTML = '';

    const allConversations = Array.from(state.conversations.values())
        .filter(item => item.id !== 'all')
        .filter(isUserFacingConversation)
        .sort((a, b) => {
            return compareConversations(a, b);
        });

    updateQueueMetrics(allConversations);

    const activeView = normalizeView(state.activeView);
    updateBatchToolbar(activeView, allConversations);
    let conversations = allConversations.filter(item => matchesActiveView(item, activeView));
    if (activeView === 'active') {
        conversations = allConversations.filter(isCurrentConversation);
        if (conversations.length === 0) {
            conversations = allConversations
                .filter(item => isRecentConversation(item) && isUserFacingConversation(item) && !isArchivedTask(item) && !isSnoozedTask(item))
                .slice(0, 12);
        }
    }
    conversations = conversations.slice(0, activeView === 'active' ? 24 : 60);

    // P0.1: 只有当前 active 在全量 conversations 中已彻底消失时才回退；
    // 切换 view 导致 active 不在 filtered 结果中时保持不变，避免抢焦点。
    if (state.activeConversation && !allConversations.some(item => item.id === state.activeConversation)) {
        state.activeConversation = '';
    }
    if (!state.activeConversation) {
        state.activeConversation = conversations[0]?.id || '';
    }

    if (conversations.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'conversation-preview';
        empty.style.padding = '12px';
        empty.textContent = activeView === 'waiting'
            ? '当前没有等待处理的任务'
            : activeView === 'done'
                ? '当前没有已完成任务'
            : activeView === 'later'
                ? '当前没有稍后或已归档任务'
                : activeView === 'active'
                    ? '当前没有正在同步的任务'
                    : '当前没有可显示的任务';
        list.appendChild(empty);
        return;
    }

    const groups = buildConversationGroups(conversations, activeView);
    groups.forEach(group => {
        const section = document.createElement('section');
        section.className = 'conversation-group';
        const header = document.createElement('div');
        header.className = 'conversation-group-header';
        header.innerHTML = `
            <span class="conversation-group-title"></span>
            <span class="conversation-group-count"></span>
        `;
        header.querySelector('.conversation-group-title').textContent = group.label;
        header.querySelector('.conversation-group-count').textContent = `${group.items.length} 项`;
        section.appendChild(header);
        group.items.forEach(item => section.appendChild(makeConversationButton(item)));
        list.appendChild(section);
    });
}

function selectConversation(conversationId, options = {}) {
    state.activeConversation = String(conversationId || '');
    if (options.render === false) return;
    renderAll();
}

function compareConversations(a, b) {
    // 队列顺序仍以真实任务状态为主，手动优先级只在同一状态带内生效；
    // 这样不会让“低风险高优先级”覆盖掉“真正等待输入/失败”的任务。
    const priA = conversationPriority(a);
    const priB = conversationPriority(b);
    if (priA !== priB) return priA - priB;
    if (isPinnedTask(a) !== isPinnedTask(b)) return isPinnedTask(a) ? -1 : 1;
    const manualA = manualPriorityWeight(a);
    const manualB = manualPriorityWeight(b);
    if (manualA !== manualB) return manualA - manualB;
    const sortA = manualSortOrder(a);
    const sortB = manualSortOrder(b);
    if (sortA !== sortB) return sortA - sortB;
    return Number(b.lastAt || 0) - Number(a.lastAt || 0);
}

function manualSortOrder(item) {
    const value = Number(taskStateForConversation(item).sortOrder);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function buildConversationGroups(conversations, activeView) {
    const mode = normalizeGroupMode(state.groupMode);
    if (mode === 'none') {
        return [{ key: 'queue', label: activeView === 'later' ? '当前队列' : '任务队列', items: conversations }];
    }
    const groups = new Map();
    conversations.forEach(item => {
        const key = conversationGroupKey(item, mode);
        const label = conversationGroupLabel(item, mode);
        const existing = groups.get(key) || { key, label, items: [] };
        existing.items.push(item);
        groups.set(key, existing);
    });
    return Array.from(groups.values()).sort((a, b) => {
        const firstA = a.items[0];
        const firstB = b.items[0];
        if (!firstA || !firstB) return 0;
        return compareConversations(firstA, firstB);
    });
}

function normalizeGroupMode(value) {
    return ['workspace', 'source', 'none'].includes(String(value || '')) ? String(value) : 'workspace';
}

function conversationGroupKey(item, mode) {
    if (mode === 'source') return `source:${String(item?.source || 'unknown').toLowerCase()}`;
    if (mode === 'workspace') return `workspace:${groupWorkspaceLabel(item)}`;
    return 'queue';
}

function conversationGroupLabel(item, mode) {
    if (mode === 'source') return sourceLabel({ source: item?.source || 'daemon' });
    if (mode === 'workspace') return groupWorkspaceLabel(item);
    return '任务队列';
}

function groupWorkspaceLabel(item) {
    const workspace = String(item?.workspace || '').trim();
    if (workspace) return shortPath(workspace);
    const title = String(item?.title || '').trim();
    return title || '未绑定项目';
}

function updateBatchToolbar(activeView, allConversations) {
    const toolbar = document.getElementById('batch-toolbar');
    const selectionCount = document.getElementById('batch-selection-count');
    const toggle = document.getElementById('batch-toggle');
    if (!toolbar || !selectionCount || !toggle) return;

    const eligibleIds = new Set(
        allConversations
            .filter(item => matchesActiveView(item, activeView))
            .map(item => item.id)
            .filter(id => workflowThreadIdFromConversationId(id))
    );

    for (const id of Array.from(state.selectedBatchConversationIds)) {
        if (!eligibleIds.has(id)) state.selectedBatchConversationIds.delete(id);
    }

    const showToolbar = activeView !== 'code' && eligibleIds.size > 0;
    if (!showToolbar) {
        toolbar.hidden = true;
        state.batchMode = false;
        state.selectedBatchConversationIds.clear();
        return;
    }

    toolbar.hidden = false;
    toggle.textContent = state.batchMode ? '退出批量' : '批量选择';
    const selectedCount = state.selectedBatchConversationIds.size;
    selectionCount.textContent = state.batchMode
        ? (selectedCount > 0 ? `已选择 ${selectedCount} 项` : '选择需要批量处理的任务')
        : '批量处理当前视图中的任务';

    wireActionButton('batch-toggle', true, () => {
        state.batchMode = !state.batchMode;
        if (!state.batchMode) state.selectedBatchConversationIds.clear();
        renderAll();
    });
    wireActionButton('batch-clear', state.batchMode && selectedCount > 0, () => {
        state.selectedBatchConversationIds.clear();
        renderAll();
    });
    wireActionButton('batch-restore', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ archived: false, snoozedUntil: null });
    });
    wireActionButton('batch-archive', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ archived: true });
    });
    wireActionButton('batch-snooze', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ archived: false, snoozedUntil: Date.now() + (30 * 60 * 1000) });
    });
    wireActionButton('batch-pin', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ pinned: true });
    });
    wireActionButton('batch-priority-high', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ priority: 'high' });
    });
    wireActionButton('batch-priority-normal', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ priority: 'normal' });
    });
    wireActionButton('batch-priority-low', state.batchMode && selectedCount > 0, () => {
        applyBatchTaskAction({ priority: 'low' });
    });
}

function normalizeView(view) {
    if (view === 'overview' || view === 'inbox') return 'active';
    return view || 'active';
}

function matchesActiveView(item, activeView) {
    if (isArchivedTask(item)) return activeView === 'later';
    if (isSnoozedTask(item)) return activeView === 'later';
    if (!isUserFacingConversation(item)) return false;
    if (activeView === 'waiting') return item.status === 'prompt';
    if (activeView === 'running') return item.status !== 'prompt' && item.status !== 'done' && item.status !== 'error';
    if (activeView === 'error') return item.status === 'error';
    if (activeView === 'done') return item.status === 'done';
    if (activeView === 'later') return isArchivedTask(item) || isSnoozedTask(item);
    if (activeView === 'code') return state.codeBlocks.some(block => block.conversationId === item.id);
    return true;
}

function updateQueueMetrics(conversations) {
    const visible = conversations.filter(item => isUserFacingConversation(item) && !isArchivedTask(item) && !isSnoozedTask(item));
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };
    setText('queue-total', visible.length);
    setText('queue-waiting', visible.filter(item => item.status === 'prompt').length);
    setText('queue-running', visible.filter(item => item.status !== 'prompt' && item.status !== 'done' && item.status !== 'error').length);
    setText('queue-error', visible.filter(item => item.status === 'error').length);
}

function isCurrentConversation(item) {
    if (!isUserFacingConversation(item)) return false;
    if (isArchivedTask(item) || isSnoozedTask(item)) return false;
    if (item.sourceOnline === false && !isActionableStatus(item.status)) return false;
    if (!isRecentConversation(item)) return false;
    if (isArchivedConversation(item)) return false;
    return true;
}

function isUserFacingConversation(item) {
    if (!item) return false;
    if (isPassiveSourceKind(item.source) && !isActionableStatus(item.status)) return false;
    return true;
}

function taskStateForConversation(item) {
    const raw = normalizeTaskStatePayload(item?.taskState || item?.TaskState);
    const snoozedUntil = Number(raw.snoozedUntil || 0);
    const sortOrder = Number(raw.sortOrder);
    return {
        pinned: Boolean(raw.pinned),
        archived: Boolean(raw.archived),
        snoozedUntil: Number.isFinite(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : 0,
        priority: ['high', 'low'].includes(String(raw.priority || '')) ? String(raw.priority) : 'normal',
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
        handoffStatus: ['pending', 'active', 'returned'].includes(String(raw.handoffStatus || '')) ? String(raw.handoffStatus) : 'idle',
        handoffTarget: ['generic', 'codex', 'claude-code', 'opencode'].includes(String(raw.handoffTarget || '')) ? String(raw.handoffTarget) : null,
        handoffSessionId: typeof raw.handoffSessionId === 'string' && raw.handoffSessionId.trim() ? raw.handoffSessionId : null
    };
}

function normalizeTaskStatePayload(taskState) {
    if (!taskState || typeof taskState !== 'object') {
        return { pinned: false, archived: false, snoozedUntil: 0, priority: 'normal', handoffStatus: 'idle', handoffTarget: null, handoffSessionId: null };
    }
    const snoozedUntil = Number(taskState.snoozedUntil || taskState.SnoozedUntil || 0);
    return {
        pinned: Boolean(taskState.pinned ?? taskState.Pinned),
        archived: Boolean(taskState.archived ?? taskState.Archived),
        snoozedUntil: Number.isFinite(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : 0,
        priority: String(taskState.priority ?? taskState.Priority ?? 'normal'),
        sortOrder: Number(taskState.sortOrder ?? taskState.SortOrder),
        handoffStatus: String(taskState.handoffStatus ?? taskState.HandoffStatus ?? 'idle'),
        handoffTarget: taskState.handoffTarget ?? taskState.HandoffTarget ?? null,
        handoffSessionId: taskState.handoffSessionId ?? taskState.HandoffSessionId ?? null,
        updatedAt: Number(taskState.updatedAt || taskState.UpdatedAt || 0)
    };
}

function isArchivedTask(item) {
    return taskStateForConversation(item).archived;
}

function isSnoozedTask(item) {
    const snoozedUntil = taskStateForConversation(item).snoozedUntil;
    return snoozedUntil > Date.now();
}

function isPinnedTask(item) {
    return taskStateForConversation(item).pinned;
}

function manualPriorityWeight(item) {
    const priority = taskStateForConversation(item).priority;
    if (priority === 'high') return 0;
    if (priority === 'low') return 2;
    return 1;
}

function taskPriorityLabel(priority) {
    if (priority === 'high') return '高优先级';
    if (priority === 'low') return '低优先级';
    return '标准优先级';
}

function isActionableStatus(status) {
    return status === 'prompt' || status === 'error';
}

function isPassiveSourceKind(source) {
    // VS Code 现在承载 Claude Code / Codex 终端输出，必须进入主运行列表；
    // 其它 IDE/切换器来源仍只在 prompt / error 时抬升。
    return [
        'cc-switch',
        'qwen-code',
        'trae',
        'codebuddy',
        'lingma',
        'marscode',
        'codegeex',
        'comate',
        'ai-ide'
    ].includes(String(source || '').toLowerCase());
}

function shouldDisplayMonitorEvent(event) {
    const type = event.type || event.Type || 'activity';
    const source = event.source || event.Source || metadataFromSourceId(event.sourceId || event.SourceId, 'kind');
    if (!isPassiveSourceKind(source)) return true;
    return type === 'prompt' || type === 'error';
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
    if (state.batchMode) button.classList.add('batch-mode');
    if (state.selectedBatchConversationIds.has(item.id)) button.classList.add('selected');
    button.type = 'button';
    button.addEventListener('click', () => {
        if (state.batchMode) {
            toggleBatchSelection(item.id);
            return;
        }
        selectConversation(item.id);
    });

    // P0.3：摘要走 displayStatus（等待我/运行中/失败/需审阅/完成/来源在线），
    // preview 显示下一步动作而不是最近一条原始输出，避免命令片段刷屏。
    const display = deriveConversationDisplay(item);
    const taskState = taskStateForConversation(item);
    button.innerHTML = `
        <div class="conversation-select" ${state.batchMode ? '' : 'hidden'}>
            <input type="checkbox" ${state.selectedBatchConversationIds.has(item.id) ? 'checked' : ''}>
        </div>
        <div class="conversation-body">
            <div class="conversation-name">
                <span class="conversation-dot ${display.kind}"></span>
                <span class="conversation-title-text"></span>
            </div>
            <div class="conversation-meta">
                <span class="conversation-chip status-chip"></span>
                <span class="conversation-chip source-chip"></span>
                <span class="conversation-chip capability-chip"></span>
                <span class="conversation-chip priority-chip"></span>
                <span class="conversation-chip management-chip" hidden></span>
            </div>
            <div class="conversation-preview"></div>
        </div>
    `;
    const checkbox = button.querySelector('.conversation-select input');
    if (checkbox) {
        checkbox.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleBatchSelection(item.id);
        });
    }
    button.dataset.displayStatus = display.kind;
    if (item.source) button.dataset.source = item.source;
    button.querySelector('.conversation-title-text').textContent = item.title;
    button.querySelector('.status-chip').textContent = display.label;
    button.querySelector('.source-chip').textContent = sourceLabel({ source: item.source });
    // P1.3：能力 chip 同步显示文案与颜色，让用户一眼区分只读 / 弱接入 / 可回写。
    const capability = capabilityForMessage(item);
    const capChip = button.querySelector('.capability-chip');
    capChip.textContent = capability.level;
    const capClass = capabilityChipClass(capability.rawLevel);
    if (capClass) {
        capChip.classList.add(capClass);
        capChip.dataset.capabilityLevel = capability.rawLevel || '';
    }
    const priorityChip = button.querySelector('.priority-chip');
    priorityChip.textContent = taskPriorityLabel(taskState.priority);
    priorityChip.classList.add(`priority-${taskState.priority}`);
    const managementChip = button.querySelector('.management-chip');
    if (taskState.archived) {
        managementChip.hidden = false;
        managementChip.textContent = '已归档';
    } else if (taskState.snoozedUntil > Date.now()) {
        managementChip.hidden = false;
        managementChip.textContent = `稍后至 ${formatShortTime(taskState.snoozedUntil)}`;
    } else if (taskState.handoffStatus === 'active' && taskState.handoffTarget) {
        managementChip.hidden = false;
        managementChip.textContent = `已转交 ${handoffTargetLabel(taskState.handoffTarget)}`;
    } else if (taskState.handoffStatus === 'pending' && taskState.handoffTarget) {
        managementChip.hidden = false;
        managementChip.textContent = `待转交 ${handoffTargetLabel(taskState.handoffTarget)}`;
    } else if (taskState.handoffStatus === 'returned' && taskState.handoffTarget) {
        managementChip.hidden = false;
        managementChip.textContent = `已回流 ${handoffTargetLabel(taskState.handoffTarget)}`;
    } else if (taskState.pinned) {
        managementChip.hidden = false;
        managementChip.textContent = '已置顶';
    }
    button.querySelector('.conversation-preview').textContent = display.action;
    return button;
}

function toggleBatchSelection(conversationId) {
    if (state.selectedBatchConversationIds.has(conversationId)) {
        state.selectedBatchConversationIds.delete(conversationId);
    } else if (workflowThreadIdFromConversationId(conversationId)) {
        state.selectedBatchConversationIds.add(conversationId);
    }
    renderAll();
}

function workflowThreadIdFromConversationId(conversationId) {
    if (!String(conversationId || '').startsWith('workflow:')) return '';
    return String(conversationId).slice('workflow:'.length);
}

function handoffConversationIdForSession(sessionId) {
    const normalized = String(sessionId || '').trim();
    return normalized ? `workflow:session:${normalized}` : '';
}

function findLinkedHandoffConversation(conversation) {
    const taskState = taskStateForConversation(conversation);
    const conversationId = handoffConversationIdForSession(taskState.handoffSessionId);
    if (!conversationId) return null;
    return state.conversations.get(conversationId) || {
        id: conversationId,
        title: `接力会话 ${taskState.handoffSessionId}`,
        source: conversation?.source || 'workflow',
        status: 'running'
    };
}

function findParentConversationForThread(threadId) {
    const sessionId = String(threadId || '').startsWith('session:') ? String(threadId).slice('session:'.length) : '';
    if (!sessionId) return null;
    for (const conversation of state.conversations.values()) {
        if (!String(conversation?.id || '').startsWith('workflow:')) continue;
        if (taskStateForConversation(conversation).handoffSessionId === sessionId) return conversation;
    }
    return null;
}

function applyBatchTaskAction(patch) {
    const selectedIds = Array.from(state.selectedBatchConversationIds);
    selectedIds.forEach(conversationId => {
        const threadId = workflowThreadIdFromConversationId(conversationId);
        if (!threadId) return;
        sendTaskAction(threadId, patch, { preserveSelection: true, suppressRender: true });
    });
    state.selectedBatchConversationIds.clear();
    state.batchMode = false;
    renderAll();
}

// P0.3：把任务的 status + 计数派生为 6 档显示状态 + 下一步动作；
// 任意时刻 deriveConversationDisplay(conv).kind 必属下列之一：
//   waiting-me  → 等待我（prompt）
//   error       → 失败
//   review      → 需审阅（done 且有 artifact/file_change/code/tool 产物）
//   done        → 完成（done 且没有要审阅的产物）
//   source-online → 来源在线（被动源，未抬升到 prompt/error）
//   running     → 运行中（其余）
function deriveConversationDisplay(item) {
    if (!item) return { kind: 'running', label: '运行中', action: '执行中' };
    const taskState = taskStateForConversation(item);
    if (taskState.archived) {
        return { kind: 'archived', label: '已归档', action: '已从主队列移出' };
    }
    if (taskState.snoozedUntil > Date.now()) {
        return { kind: 'deferred', label: '稍后处理', action: `提醒已延后到 ${formatShortTime(taskState.snoozedUntil)}` };
    }
    const status = item.status || '';
    if (status === 'prompt' || status === 'waiting') {
        if (taskState.handoffStatus === 'returned') {
            return { kind: 'waiting-me', label: '等待我', action: '审阅接力结果并决定下一步' };
        }
        return { kind: 'waiting-me', label: '等待我', action: '选择选项或输入回复' };
    }
    if (status === 'error') {
        if (taskState.handoffStatus === 'returned') {
            return { kind: 'error', label: '失败', action: '查看接力失败摘要并决定是否重试' };
        }
        return { kind: 'error', label: '失败', action: '查看错误并复制诊断' };
    }
    if (status === 'done') {
        const reviewable = (item.fileChangeCount || 0) > 0
            || (item.codeCount || 0) > 0
            || (item.toolCount || 0) > 0;
        return reviewable
            ? { kind: 'review', label: '需审阅', action: '查看新产物' }
            : { kind: 'done', label: '完成', action: '执行已结束' };
    }
    // 来源离线时，把"运行中 / 来源在线"统一降级为"来源已离线"，避免 Codex/Claude Code
    // 已退出 GUI 仍显示绿点这种和现实脱节的状态。等待我 / 失败 / 需审阅 不在这里降级——
    // 那些是需要用户处理的高优先级状态，即使来源离线也应当继续突出。
    if (item.sourceOnline === false && !isActionableStatus(status)) {
        return { kind: 'source-offline', label: '来源已离线', action: '请确认对应工具是否仍在运行' };
    }
    if (isPassiveSourceKind(item.source) && !isActionableStatus(status)) {
        return { kind: 'source-online', label: '来源在线', action: '等待新事件' };
    }
    return { kind: 'running', label: '运行中', action: runningHint(item) };
}

function runningHint(item) {
    if ((item.errorCount || 0) > 0) return '有错误待复核';
    if ((item.promptCount || 0) > 0) return '即将需要回复';
    if ((item.toolCount || 0) > 0) return '工具调用中';
    if ((item.commandCount || 0) > 0) return '命令输出中';
    if ((item.messageCount || 0) > 0) return 'AI 处理中';
    return '执行中';
}

// P1.1：把任务在队列里排成"等待我 → 失败 → 需审阅 → 运行中 → 来源在线 → 完成"，
// 多任务并行时等待输入永远在最前，普通输出再吵也不会盖掉它。
function conversationPriority(item) {
    if (!item) return 99;
    const display = deriveConversationDisplay(item);
    switch (display.kind) {
        case 'waiting-me': return 0;
        case 'error': return 1;
        case 'review': return 2;
        case 'running': return 3;
        case 'source-online': return 4;
        case 'done': return 5;
        case 'deferred': return 6;
        case 'archived': return 7;
        default: return 6;
    }
}

function renderChat() {
    const container = document.getElementById('chat-container');
    const title = document.getElementById('conversation-title');
    const messages = getVisibleMessages();
    const conversation = state.conversations.get(state.activeConversation);
    const activeConversation = state.activeConversation || '';
    const shouldStickToBottom = isNearScrollBottom(container);

    title.textContent = activeConversation
        ? conversation?.title || '任务'
        : '当前任务';
    updateStageMeta(conversation, messages);
    renderTaskSpotlight(conversation, messages);

    if (messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div>
                    <strong>当前暂无任务内容</strong>
                    请从左侧任务列表中选择任务，或等待新的任务事件进入工作台。
                </div>
            </div>
        `;
        container.dataset.conversationId = activeConversation;
        return;
    }

    if (container.dataset.conversationId !== activeConversation || container.querySelector('.empty-state')) {
        container.innerHTML = '';
        container.dataset.conversationId = activeConversation;
    }
    syncChatMessages(container, messages);
    if (shouldStickToBottom) {
        const behavior = renderSmoothScroll ? 'smooth' : 'auto';
        requestAnimationFrame(() => scrollContainerToBottom(container, behavior));
    }
}

function syncChatMessages(container, messages) {
    const existingById = new Map();
    container.querySelectorAll('[data-message-id]').forEach(node => {
        existingById.set(node.dataset.messageId, node);
    });

    const nodes = messages.map(message => {
        const messageId = String(message.id);
        const renderKey = getMessageRenderKey(message);
        const existing = existingById.get(messageId);
        if (existing?.dataset.renderKey === renderKey) {
            return existing;
        }
        const next = renderMessage(message);
        next.dataset.renderKey = renderKey;
        return next;
    });

    if (hasSameChildren(container, nodes)) return;
    container.replaceChildren(...nodes);
}

function hasSameChildren(container, nodes) {
    if (container.children.length !== nodes.length) return false;
    return nodes.every((node, index) => container.children[index] === node);
}

function isNearScrollBottom(container) {
    if (!container) return true;
    if (container.scrollHeight <= container.clientHeight) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= AUTO_SCROLL_THRESHOLD_PX;
}

function scrollContainerToBottom(container, behavior = 'auto') {
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
    }
    container.scrollTop = container.scrollHeight;
}

function updateStageMeta(conversation, messages) {
    const latest = messages[messages.length - 1];
    const source = latest?.source || conversation?.source || '';
    const capability = capabilityForMessage(latest || { source });
    const display = deriveConversationDisplay(conversation || latest || {});
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('stage-source', source ? sourceLabel({ source }) : '来源未选择');
    setText('stage-capability', capability.level);
    // P1.3：stage 顶部 capability chip 颜色与列表 chip 对齐，
    // 用户在 stage / list / drawer 三个地方看到的能力色一致。
    applyCapabilityClass('stage-capability', capability.rawLevel);
    setText('stage-status', display.label || statusLabel(conversation?.status || latest?.type || 'idle'));
}

function renderTaskSpotlight(conversation, messages) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const latest = safeMessages[safeMessages.length - 1];
    const display = deriveConversationDisplay(conversation || latest || {});
    const taskState = taskStateForConversation(conversation);
    const workspace = latest?.workspace || safeMessages.find(message => message.workspace)?.workspace || '';
    const breakdown = buildSpotlightBreakdown(conversation);
    const handoffSummary = findLatestHandoffSummary(safeMessages);
    const management = taskState.archived
        ? '已归档'
        : taskState.snoozedUntil > Date.now()
            ? `稍后至 ${formatShortTime(taskState.snoozedUntil)}`
            : taskState.pinned
                ? '已置顶'
                : conversation
                    ? '主队列中'
                    : '等待任务';
    const priority = taskPriorityLabel(taskState.priority);
    const updatedAt = Number(conversation?.lastAt || latest?.timestamp || 0);
    const summaryCount = Number(conversation?.count || safeMessages.length || 0);
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('spotlight-next-action', conversation ? display.label : '请选择需要处理的任务');
    setText('spotlight-subaction', conversation
        ? (handoffSummary?.handlingAdvice || handoffSummary?.nextAction || display.action)
        : '可从左侧任务列表中切换，或等待新的任务进入队列。');
    setText('spotlight-project', workspace ? shortPath(workspace) : (conversation?.title || '未绑定项目'));
    setText('spotlight-workspace', workspace || '当前任务未提供可展示的工作区路径。');
    setText('spotlight-management', conversation ? `${management} · ${priority}` : management);
    setText('spotlight-updated', updatedAt ? `最近更新于 ${formatShortTime(updatedAt)}` : '等待新的任务状态更新。');
    setText('spotlight-summary', handoffSummary
        ? `${handoffSummary.conclusion || `接力回流 · ${handoffSummary.result || '已更新'}`}`
        : `${summaryCount} 条记录`);
    setText('spotlight-breakdown', handoffSummary
        ? buildHandoffSpotlightText(handoffSummary, breakdown)
        : breakdown);
}

function buildSpotlightBreakdown(conversation) {
    if (!conversation) return '当前尚无可展示的任务记录。';
    const parts = [];
    if (conversation.promptCount) parts.push(`${conversation.promptCount} 个等待`);
    if (conversation.errorCount) parts.push(`${conversation.errorCount} 个错误`);
    if (conversation.fileChangeCount) parts.push(`${conversation.fileChangeCount} 个文件变更`);
    if (conversation.codeCount) parts.push(`${conversation.codeCount} 段代码`);
    if (parts.length === 0 && conversation.messageCount) parts.push(`${conversation.messageCount} 条主消息`);
    return parts.length > 0 ? parts.join('，') : '当前没有需要特别关注的等待、错误或代码产物。';
}

function applyCapabilityClass(elementId, rawLevel) {
    const el = document.getElementById(elementId);
    if (!el) return;
    Array.from(el.classList)
        .filter(name => name.startsWith('capability-'))
        .forEach(name => el.classList.remove(name));
    const klass = capabilityChipClass(rawLevel);
    if (klass) {
        el.classList.add(klass);
        el.dataset.capabilityLevel = rawLevel || '';
    } else {
        delete el.dataset.capabilityLevel;
    }
}

function getVisibleMessages() {
    if (state.activeConversation.startsWith('workflow:')) {
        return buildIntegratedWorkflowMessages(state.activeConversation.slice('workflow:'.length));
    }
    if (!state.activeConversation) return [];
    return state.messages.filter(message => message.conversationId === state.activeConversation);
}

function statusLabel(status) {
    // P0.3：右上角 / 抽屉态文案与左侧任务列表 6 档对齐；
    // 进入 conversation 后只能看到这五种，"需审阅"由 displayStatus 派生，
    // 这里走的是基础字符串映射，保持简洁。
    if (status === 'prompt' || status === 'waiting') return '等待我';
    if (status === 'error') return '失败';
    if (status === 'done') return '完成';
    if (status === 'deferred') return '稍后处理';
    if (status === 'archived') return '已归档';
    if (status === 'idle') return '等待事件';
    return '运行中';
}

function capabilityForMessage(messageOrSource) {
    if (messageOrSource && typeof messageOrSource === 'object') {
        const level = messageOrSource.capabilityLevel || metadataFromSourceId(messageOrSource.sourceId, 'capabilityLevel');
        const detail = integrationDetail(
            messageOrSource.integrationKind || metadataFromSourceId(messageOrSource.sourceId, 'integrationKind'),
            messageOrSource.privacyBoundary || metadataFromSourceId(messageOrSource.sourceId, 'privacyBoundary')
        );
        // P1.3：rawLevel 保留原始 L1/L1-L2/L2/L2-L3/L3/L4，UI 拿去派生 chip 颜色与可写回提示；
        // level 给出人话标签，detail 给出"只读同步 / 进程识别 / 可回复"具体说明。
        if (level) return { rawLevel: level, level: capabilityLevelLabel(level), detail };
        return capabilityForSource(messageOrSource.source);
    }
    return capabilityForSource(messageOrSource);
}

function metadataFromSourceId(sourceId, key) {
    if (!sourceId) return '';
    const source = state.sources.get(sourceId);
    if (!source) return '';
    return source[key] || source[key[0].toUpperCase() + key.slice(1)] || '';
}

function capabilityLevelLabel(level) {
    // P1.3：人话化能力层级；让"只读 / 弱接入 / 可回写 / 可编排"在一眼就能区分，
    // 避免用户把 L1 进程识别误解为 L3 深度接管。
    if (level === 'L1') return 'L1 进程识别';
    if (level === 'L1-L2') return 'L1/L2 弱接入';
    if (level === 'L2') return 'L2 只读事件';
    if (level === 'L2-L3') return 'L2/L3 事件可回';
    if (level === 'L3') return 'L3 可回写会话';
    if (level === 'L4') return 'L4 工作流编排';
    return level;
}

// P1.3：把 capabilityLevel 派生成 CSS class，给 chip / stage / drawer 同步上色，
// 形成"只读灰 → 弱蓝 → 可写主蓝 → 编排紫"的视觉梯度。
function capabilityChipClass(rawLevel) {
    if (!rawLevel) return '';
    const id = String(rawLevel).toLowerCase().replace(/[^a-z0-9]/g, '');
    return `capability-${id}`;
}

function integrationDetail(integrationKind, privacyBoundary) {
    const integration = {
        'cli-pty': '终端/PTTY 会话',
        'local-file-sync': '本地文件同步',
        extension: '公开扩展 API',
        'process-scan': '进程级识别',
        'config-switcher': '配置切换器',
        adapter: '显式适配器',
        manual: '手动来源'
    }[integrationKind] || '来源适配器';
    const privacy = privacyBoundaryText(privacyBoundary);
    return `${integration}；隐私边界：${privacy}。`;
}

function capabilityForSource(source) {
    const normalized = String(source || '').toLowerCase();
    // P1.3：所有内置来源都返回 rawLevel + 人话 label + detail，
    // chip 颜色与文案统一从 rawLevel 派生，避免 stage / list / drawer 三处对不上。
    const make = (rawLevel, detail) => ({ rawLevel, level: capabilityLevelLabel(rawLevel), detail });
    if (normalized === 'cli' || normalized === 'codex' || normalized === 'claude-code') {
        return make('L3', '可从终端/PTTY 会话识别等待输入并回写回复。');
    }
    if (normalized === 'codex-desktop') {
        return make('L2', '可同步本地线程与工作流状态；回复能力取决于事件目标。');
    }
    if (normalized === 'vscode') {
        return make('L2', '通过显式来源注册接收轻量事件，不读取编辑器私有状态。');
    }
    if (normalized === 'cc-switch') {
        return make('L1-L2', '可识别账号或 provider 切换器状态；真实切换仍由 CC Switch 执行，CodePanion 不读取账号凭据。');
    }
    if (['qwen-code', 'codebuddy', 'lingma', 'trae', 'comate', 'codegeex', 'marscode', 'ai-ide'].includes(normalized)) {
        return make('L1-L2', '当前以存在识别和轻量状态为主，不把弱接入展示为可接管。');
    }
    if (normalized === 'user') {
        return { rawLevel: '', level: '本地输入', detail: '用户在 CodePanion 中发出的回复或记录。' };
    }
    return make('L1', '已进入统一任务模型，深度能力以来源适配器为准。');
}

function privacyBoundaryText(source) {
    const normalized = String(source || '').toLowerCase();
    if (normalized === 'explicit-session') return '显式会话';
    if (normalized === 'local-history') return '本地历史';
    if (normalized === 'explicit-extension') return '显式扩展';
    if (normalized === 'minimal-process') return '最小进程识别';
    if (normalized === 'config-switcher') return '配置切换器';
    if (normalized === 'explicit-adapter') return '显式适配器';
    if (normalized === 'cli' || normalized === 'codex' || normalized === 'claude-code') {
        return '显式会话';
    }
    if (normalized === 'vscode' || normalized === 'codex-desktop') {
        return '显式接入';
    }
    if (normalized === 'cc-switch') {
        return '配置切换器';
    }
    return '最小采集';
}

function latestActionablePrompt(messages) {
    return messages.slice().reverse().find(message => {
        if (message.type !== 'prompt') return false;
        if (message.sessionId) return true;
        return Boolean(message.eventId);
    });
}

function focusActiveReply() {
    const target = document.querySelector('.message-prompt .custom-input:not(:disabled), .message-prompt .option-button:not(:disabled)');
    if (!target) return false;
    target.focus();
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    item.dataset.renderKey = getMessageRenderKey(message);
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

    // P1.2：失败态先把"具体报了什么"放在主视图，让用户不必展开 details 就能判断来源；
    // 大段日志依旧通过下面的 workflow-details 折叠。
    if (message.type === 'error') {
        const errorSummary = renderErrorSummary(message);
        if (errorSummary) card.appendChild(errorSummary);
    }

    if (Array.isArray(message.rawItems) && message.rawItems.length > 0) {
        card.appendChild(renderWorkflowDetails(message.rawItems));
    }

    if (message.type === 'prompt') {
        card.appendChild(renderOptions(message.sessionId, message.eventId, message.options || [], message.id));
    }

    // P1.2：失败专属动作 — 复制本次失败诊断（来源/标题/能力/报错原文/相关命令），
    // 用户可直接粘给 Codex / Claude 继续排查。
    if (message.type === 'error') {
        card.appendChild(renderDiagnosticsAction(message));
    }

    item.appendChild(avatar);
    item.appendChild(card);
    return item;
}

function getMessageRenderKey(message) {
    return JSON.stringify({
        id: message.id,
        type: message.type,
        role: message.role,
        source: message.source,
        sessionId: message.sessionId,
        eventId: message.eventId,
        threadId: message.threadId,
        timestamp: message.timestamp,
        content: message.content,
        level: message.level,
        capabilityLevel: message.capabilityLevel,
        workflowSummary: message.workflowSummary || null,
        rawItems: message.rawItems || null,
        options: message.options || null
    });
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

    // P1.1：没有 sessionId 也没有 eventId 时根本无处回写，
    // 不再渲染按钮/输入框，避免"记录本次选择"这种假回复误导用户。
    if (!sessionId && !eventId) {
        const hint = document.createElement('div');
        hint.className = 'prompt-hint';
        hint.textContent = '该提示无可回写的目标会话，请回到来源工具中继续。';
        container.appendChild(hint);
        return container;
    }

    // P1.1：在选项上方明确告知回复将写到哪个目标，避免用户搞不清楚回复的去处。
    const targetText = describeReplyTarget(sessionId, eventId);
    if (targetText) {
        const target = document.createElement('div');
        target.className = 'prompt-target';
        target.textContent = targetText;
        container.appendChild(target);
    }

    options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'option-button';
        button.type = 'button';
        button.innerHTML = `<span class="option-number">${index + 1}</span><span class="option-label"></span>`;
        button.querySelector('.option-label').textContent = String(option);
        button.addEventListener('click', () => selectOption(sessionId, eventId, option, container.dataset.promptId));
        container.appendChild(button);
    });

    if (!sessionId) {
        // event 回写到来源适配器：选项 + 自定义输入都允许。
        const input = document.createElement('input');
        input.className = 'custom-input';
        input.type = 'text';
        input.placeholder = '输入自定义回复，按 Enter 发送';
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && input.value.trim()) {
                selectOption(sessionId, eventId, input.value.trim(), container.dataset.promptId);
            }
        });
        container.appendChild(input);
        setTimeout(() => input.focus(), 80);
    } else if (options.length === 0) {
        // session prompt 无解析到的选项（自由文本输入：密码、文件名等）：
        // 出于安全与正确性，daemon 不接受自由文本注入，引导用户回到 CLI 终端。
        const hint = document.createElement('div');
        hint.className = 'prompt-hint';
        hint.textContent = '该提示需要自由文本回复，请在 CLI 终端中直接输入。';
        container.appendChild(hint);
    }

    return container;
}

function describeReplyTarget(sessionId, eventId) {
    if (sessionId) return '回复将写回 CLI/PTTY 会话';
    if (eventId) return '回复将通过事件发送到来源适配器';
    return '';
}

function selectOption(sessionId, eventId, value, promptId) {
    if (sessionId) {
        sendToHost({ type: 'reply', sessionId, value: String(value) });
        disableOptionsForPrompt(promptId);
        return;
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
    const escapedPromptId = CSS.escape(promptId);
    document.querySelectorAll(`[data-prompt-id="${escapedPromptId}"] .option-button, [data-prompt-id="${escapedPromptId}"] .custom-input`)
        .forEach(el => { el.disabled = true; });
}

function extractCodeBlocks(message) {
    // P2-E：先批量识别再一次性裁剪上限，避免每次 push 都 splice 一次；
    // pruneMessageState 与 MAX_CODE_BLOCKS 上限仍兜底，所以裁剪只需一次。
    const regex = /```([\w.+-]*)\n([\s\S]*?)```/g;
    const matched = [];
    let match;
    while ((match = regex.exec(message.content)) !== null) {
        const code = match[2].trimEnd();
        if (!code.trim()) continue;
        const language = match[1] || 'text';
        if (!isUsefulCodeBlock(language, code)) continue;
        matched.push({ language, code });
    }
    if (matched.length === 0) return;
    const baseIndex = state.codeBlocks.length;
    matched.forEach((entry, offset) => {
        const block = {
            id: `${message.id}:code:${baseIndex + offset}`,
            messageId: message.id,
            conversationId: message.conversationId,
            title: message.conversationTitle,
            language: entry.language,
            code: entry.code,
            timestamp: message.timestamp
        };
        state.codeBlocks.push(block);
        if (!state.activeCodeId) state.activeCodeId = block.id;
    });
    if (state.codeBlocks.length > MAX_CODE_BLOCKS) {
        state.codeBlocks.splice(0, state.codeBlocks.length - MAX_CODE_BLOCKS);
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
    const capability = capabilityForMessage(latest || { source });
    const prompt = latestActionablePrompt(messages);
    const workspace = latest?.workspace || messages.find(message => message.workspace)?.workspace || '';
    const threadId = activeWorkflowThreadId();
    const taskState = taskStateForConversation(conversation);
    updateStageMeta(conversation, messages);

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('drawer-source-name', source ? sourceLabel({ source }) : '未选择任务');
    setText('drawer-source-detail', conversation ? `${statusLabel(conversation.status)} · ${conversation.title || '未命名任务'}` : '选择一个任务后显示来源状态。');
    setText('drawer-capability', capability.level);
    applyCapabilityClass('drawer-capability', capability.rawLevel);
    setText('drawer-privacy', privacyBoundaryText(latest?.privacyBoundary || metadataFromSourceId(latest?.sourceId, 'privacyBoundary') || source));
    setText('drawer-action-note', buildTaskActionNote(capability.detail, taskState));

    const canReply = Boolean(prompt);
    // P1.2：复制上下文从"一行一条 compactText"升级为结构化诊断文本，
    // 任务标题/来源/能力/隐私边界/最近完整消息都在里面，能直接喂给 Codex / Claude 继续排查。
    const stageContext = buildStageContext(conversation, messages);
    wireActionButton('stage-focus-reply', canReply, () => focusActiveReply(), { hideWhenDisabled: true });
    wireActionButton('drawer-focus-reply', canReply, () => focusActiveReply(), { hideWhenDisabled: true });
    wireActionButton('stage-copy-context', messages.length > 0, () => copyText(stageContext));
    wireActionButton('drawer-copy-workspace', Boolean(workspace), () => copyText(workspace));
    wireSuggestedHandoffActions(conversation, messages, taskState, stageContext);
    wireTaskActionButtons(threadId, taskState);
    renderHandoffNavigation(conversation, taskState, threadId);
    renderHandoffPanel(conversation, messages);
    wireOmnibar(prompt);
}

function renderHandoffNavigation(conversation, taskState, threadId) {
    const linkedPanel = document.getElementById('drawer-linked-session-panel');
    const linkedTitle = document.getElementById('drawer-linked-session-title');
    const linkedNote = document.getElementById('drawer-linked-session-note');
    const parentPanel = document.getElementById('drawer-parent-task-panel');
    const parentTitle = document.getElementById('drawer-parent-task-title');
    const parentNote = document.getElementById('drawer-parent-task-note');
    const linkedConversation = findLinkedHandoffConversation(conversation);
    const parentConversation = findParentConversationForThread(threadId);

    if (linkedPanel && linkedTitle && linkedNote) {
        const hasLinkedSession = Boolean(taskState.handoffSessionId);
        linkedPanel.hidden = !hasLinkedSession;
        if (hasLinkedSession) {
            const targetLabel = taskState.handoffTarget ? handoffTargetLabel(taskState.handoffTarget) : '目标工具';
            linkedTitle.textContent = linkedConversation?.title || `接力会话 ${taskState.handoffSessionId}`;
            linkedNote.textContent = linkedConversation && state.conversations.has(linkedConversation.id)
                ? `当前责任已交给 ${targetLabel}。可直接打开接力会话 ${taskState.handoffSessionId} 查看执行进度。`
                : `当前责任已交给 ${targetLabel}。接力会话 ${taskState.handoffSessionId} 尚未出现在主界面中。`;
        } else {
            linkedTitle.textContent = '未建立接力会话';
            linkedNote.textContent = '转交建立后，可直接跳转到接力会话继续跟进。';
        }
        wireActionButton(
            'drawer-jump-linked-session',
            Boolean(linkedConversation && state.conversations.has(linkedConversation.id)),
            () => selectConversation(linkedConversation.id)
        );
    }

    if (parentPanel && parentTitle && parentNote) {
        parentPanel.hidden = !parentConversation;
        if (parentConversation) {
            const parentTaskState = taskStateForConversation(parentConversation);
            parentTitle.textContent = parentConversation.title || '来源任务';
            parentNote.textContent = parentTaskState.handoffTarget
                ? `当前会话来自上游任务，责任目标为 ${handoffTargetLabel(parentTaskState.handoffTarget)}。可返回来源任务继续处理或回收责任。`
                : '当前会话来自一个上游任务，可返回原任务查看整体状态。';
        } else {
            parentTitle.textContent = '未关联来源任务';
            parentNote.textContent = '当前会话来自某个上游任务时，可直接返回原任务。';
        }
        wireActionButton(
            'drawer-jump-parent-task',
            Boolean(parentConversation),
            () => selectConversation(parentConversation.id)
        );
    }
}

function buildTaskActionNote(capabilityDetail, taskState) {
    if (taskState.archived) return `${capabilityDetail} 当前任务已归档，可恢复后重新进入主队列。`;
    if (taskState.snoozedUntil > Date.now()) return `${capabilityDetail} 当前任务已稍后提醒，恢复时间：${formatFullTime(taskState.snoozedUntil)}。`;
    if (taskState.handoffStatus === 'active' && taskState.handoffTarget) return `${capabilityDetail} 当前任务已转交给 ${handoffTargetLabel(taskState.handoffTarget)}，${taskState.handoffSessionId ? `接力会话 ${taskState.handoffSessionId} 已建立，` : ''}CodePanion 现在跟踪责任状态与回流入口。`;
    if (taskState.handoffStatus === 'pending' && taskState.handoffTarget) return `${capabilityDetail} 当前任务已准备转交给 ${handoffTargetLabel(taskState.handoffTarget)}，等待目标工具确认接手。`;
    if (taskState.handoffStatus === 'returned' && taskState.handoffTarget) return `${capabilityDetail} 当前任务已从 ${handoffTargetLabel(taskState.handoffTarget)} 回收到当前队列，可继续处理。`;
    if (taskState.pinned) return `${capabilityDetail} 当前任务已置顶，会在同优先级任务中优先显示。`;
    if (typeof taskState.sortOrder === 'number') return `${capabilityDetail} 当前任务已进入手动排序队列，可继续上移或下移。`;
    if (taskState.priority === 'high') return `${capabilityDetail} 当前任务已标记为高优先级，会在同状态任务中靠前展示。`;
    if (taskState.priority === 'low') return `${capabilityDetail} 当前任务已标记为低优先级，会在同状态任务中靠后展示。`;
    return capabilityDetail;
}

function wireSuggestedHandoffActions(conversation, messages, taskState, stageContext) {
    const recommendations = getSuggestedHandoffActions(conversation, messages, taskState, stageContext);
    const primary = recommendations[0] || null;
    const secondary = recommendations[1] || null;
    setButtonText('stage-suggested-action', primary?.label || '建议动作');
    setButtonText('drawer-suggested-action', primary?.label || '建议动作');
    setButtonText('stage-suggested-secondary', secondary?.label || '后续动作');
    setButtonText('drawer-suggested-secondary', secondary?.label || '后续动作');
    wireActionButton('stage-suggested-action', Boolean(primary), () => primary.run(), { hideWhenDisabled: true });
    wireActionButton('drawer-suggested-action', Boolean(primary), () => primary.run(), { hideWhenDisabled: true });
    wireActionButton('stage-suggested-secondary', Boolean(secondary), () => secondary.run(), { hideWhenDisabled: true });
    wireActionButton('drawer-suggested-secondary', Boolean(secondary), () => secondary.run(), { hideWhenDisabled: true });
}

function getSuggestedHandoffActions(conversation, messages, taskState, stageContext) {
    const handoffSummary = findLatestHandoffSummary(Array.isArray(messages) ? messages : []);
    if (!handoffSummary) return [];

    const linkedConversation = findLinkedHandoffConversation(conversation);
    const recommendations = [];
    const appendPackageAction = () => {
        if (!conversation) return;
        const target = taskState.handoffTarget || 'generic';
        const pkg = buildHandoffPackage(conversation, messages, target);
        recommendations.push({
            label: '复制交接包',
            run: () => copyText(pkg.preview),
        });
    };

    if (taskState.handoffStatus === 'returned' && !handoffSummary.issueType && linkedConversation && state.conversations.has(linkedConversation.id)) {
        recommendations.push({
            label: '打开接力会话',
            run: () => selectConversation(linkedConversation.id),
        });
        appendPackageAction();
        return recommendations;
    }

    if (handoffSummary.manualHandling === '需要' || handoffSummary.issueType) {
        recommendations.push({
            label: '复制诊断',
            run: () => copyText(stageContext),
        });
        appendPackageAction();
        return recommendations;
    }

    appendPackageAction();
    return recommendations;
}

function wireTaskActionButtons(threadId, taskState) {
    const canManage = Boolean(threadId);
    const pinLabel = taskState.pinned ? '取消置顶' : '置顶任务';
    const snoozeLabel = taskState.snoozedUntil > Date.now() ? '恢复到当前' : '稍后处理';
    const archiveLabel = taskState.archived ? '恢复任务' : '归档任务';

    setButtonText('stage-pin-task', pinLabel);
    setButtonText('drawer-pin-task', pinLabel);
    setButtonText('stage-snooze-task', snoozeLabel);
    setButtonText('drawer-snooze-task', snoozeLabel);
    setButtonText('stage-archive-task', archiveLabel);
    setButtonText('drawer-archive-task', archiveLabel);
    renderSnoozeMenu('stage-snooze-menu', threadId, taskState);
    renderSnoozeMenu('drawer-snooze-menu', threadId, taskState);

    wireActionButton('stage-pin-task', canManage, () => togglePinnedTask(threadId, taskState));
    wireActionButton('drawer-pin-task', canManage, () => togglePinnedTask(threadId, taskState));
    wireActionButton('stage-snooze-task', canManage, () => toggleSnoozeTask(threadId, taskState, 'stage-snooze-menu'));
    wireActionButton('drawer-snooze-task', canManage, () => toggleSnoozeTask(threadId, taskState, 'drawer-snooze-menu'));
    wireActionButton('stage-archive-task', canManage, () => toggleArchivedTask(threadId, taskState));
    wireActionButton('drawer-archive-task', canManage, () => toggleArchivedTask(threadId, taskState));
    wirePriorityButtonSet('stage', threadId, taskState, canManage);
    wirePriorityButtonSet('drawer', threadId, taskState, canManage);
    wireOrderButtons('stage', threadId, canManage);
    wireOrderButtons('drawer', threadId, canManage);
}

function setButtonText(id, text) {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
}

function wirePriorityButtonSet(prefix, threadId, taskState, canManage) {
    ['high', 'normal', 'low'].forEach(priority => {
        const button = document.getElementById(`${prefix}-priority-${priority}`);
        if (!button) return;
        button.disabled = !canManage;
        button.classList.remove('active', 'priority-high', 'priority-normal', 'priority-low');
        button.classList.add(`priority-${priority}`);
        button.classList.toggle('active', taskState.priority === priority);
        button.onclick = canManage ? () => setTaskPriority(threadId, priority) : null;
    });
}

function wireOrderButtons(prefix, threadId, canManage) {
    wireActionButton(`${prefix}-move-up`, canManage && canMoveTask(threadId, -1), () => moveTaskRelative(threadId, -1));
    wireActionButton(`${prefix}-move-down`, canManage && canMoveTask(threadId, 1), () => moveTaskRelative(threadId, 1));
}

// P1.2：复制上下文走结构化诊断格式，保留来源、能力、隐私边界与最近若干条完整消息，
// 方便用户把上下文一次性丢给 Codex / Claude 继续排查。
function buildStageContext(conversation, messages) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const latest = safeMessages[safeMessages.length - 1] || {};
    const source = conversation?.source || latest.source || '';
    const capability = capabilityForMessage(latest.source ? latest : { source });
    const taskState = taskStateForConversation(conversation);
    const handoffSummary = findLatestHandoffSummary(safeMessages);
    const lines = [];
    lines.push('# CodePanion 任务上下文');
    lines.push(`任务：${conversation?.title || latest.conversationTitle || '当前任务'}`);
    if (source) lines.push(`来源：${sourceLabel({ source })}`);
    if (conversation?.status) lines.push(`状态：${statusLabel(conversation.status)}`);
    lines.push(`能力：${capability.level}`);
    if (taskState.pinned) lines.push('任务管理：已置顶');
    if (taskState.archived) lines.push('任务管理：已归档');
    if (taskState.snoozedUntil > Date.now()) lines.push(`任务管理：稍后至 ${formatFullTime(taskState.snoozedUntil)}`);
    if (taskState.handoffStatus !== 'idle') lines.push(`转交状态：${handoffStatusLabel(taskState.handoffStatus)}${taskState.handoffTarget ? ` · ${handoffTargetLabel(taskState.handoffTarget)}` : ''}`);
    if (taskState.handoffSessionId) lines.push(`接力会话：${taskState.handoffSessionId}`);
    lines.push(`优先级：${taskPriorityLabel(taskState.priority)}`);
    if (typeof taskState.sortOrder === 'number') lines.push(`手动排序：${taskState.sortOrder}`);
    const privacy = privacyBoundaryText(latest.privacyBoundary || metadataFromSourceId(latest.sourceId, 'privacyBoundary') || source);
    if (privacy) lines.push(`隐私边界：${privacy}`);
    if (handoffSummary) {
        lines.push('');
        lines.push('## 最近接力回流');
        if (handoffSummary.tool) lines.push(`工具：${handoffSummary.tool}`);
        if (handoffSummary.session) lines.push(`会话：${handoffSummary.session}`);
        if (handoffSummary.conclusion) lines.push(`回流结论：${handoffSummary.conclusion}`);
        if (handoffSummary.result) lines.push(`结果：${handoffSummary.result}`);
        if (handoffSummary.manualHandling) lines.push(`人工处理：${handoffSummary.manualHandling}`);
        if (handoffSummary.issueType) lines.push(`问题类型：${handoffSummary.issueType}`);
        if (handoffSummary.exitCode) lines.push(`退出码：${handoffSummary.exitCode}`);
        if (handoffSummary.retrySuggested) lines.push(`建议重试：${handoffSummary.retrySuggested}`);
        if (handoffSummary.handlingAdvice) lines.push(`处理建议：${handoffSummary.handlingAdvice}`);
        if (handoffSummary.nextAction) lines.push(`后续动作：${handoffSummary.nextAction}`);
        if (Array.isArray(handoffSummary.touchedFiles) && handoffSummary.touchedFiles.length > 0) {
            lines.push('涉及文件：');
            handoffSummary.touchedFiles.forEach((file) => lines.push(`- ${file}`));
        }
        if (handoffSummary.progress) lines.push(`最近进展：${handoffSummary.progress}`);
    }

    const recent = safeMessages.slice(-12);
    if (recent.length > 0) {
        lines.push('');
        lines.push('## 最近消息');
        recent.forEach(message => {
            const time = new Date(message.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
            lines.push(`### [${time}] ${sourceLabel(message)} · ${typeLabel(message.type || 'activity')}`);
            const content = String(message.content || '').trim();
            lines.push(content ? truncateForDiagnostics(content) : '（无文本内容）');
            lines.push('');
        });
    }

    lines.push('（由 CodePanion 任务上下文导出）');
    return lines.join('\n');
}

function buildHandoffPackage(conversation, messages, target = 'generic') {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const latest = safeMessages[safeMessages.length - 1] || {};
    const source = conversation?.source || latest.source || '';
    const workspace = latest.workspace || safeMessages.find(message => message.workspace)?.workspace || conversation?.workspace || '';
    const capability = capabilityForMessage(latest.source ? latest : { source });
    const taskState = taskStateForConversation(conversation);
    const handoffSummary = findLatestHandoffSummary(safeMessages);
    const targetLabel = handoffTargetLabel(target);
    const taskName = conversation?.title || latest.conversationTitle || '当前任务';
    const promptMessage = latestActionablePrompt(safeMessages);
    const lines = [];
    lines.push('# CodePanion 任务转交包');
    lines.push(`目标工具：${targetLabel}`);
    lines.push(`任务：${taskName}`);
    if (source) lines.push(`来源：${sourceLabel({ source })}`);
    if (conversation?.status) lines.push(`状态：${statusLabel(conversation.status)}`);
    if (workspace) lines.push(`工作区：${workspace}`);
    lines.push(`能力：${capability.level}`);
    lines.push(`优先级：${taskPriorityLabel(taskState.priority)}`);
    if (taskState.pinned) lines.push('任务管理：已置顶');
    if (taskState.archived) lines.push('任务管理：已归档');
    if (taskState.snoozedUntil > Date.now()) lines.push(`任务管理：稍后至 ${formatFullTime(taskState.snoozedUntil)}`);
    if (taskState.handoffStatus !== 'idle') lines.push(`转交状态：${handoffStatusLabel(taskState.handoffStatus)}${taskState.handoffTarget ? ` · ${handoffTargetLabel(taskState.handoffTarget)}` : ''}`);
    if (taskState.handoffSessionId) lines.push(`接力会话：${taskState.handoffSessionId}`);
    if (typeof taskState.sortOrder === 'number') lines.push(`手动排序：${taskState.sortOrder}`);

    const goal = safeMessages.find(message => String(message.role || '').toLowerCase() === 'user' && String(message.content || '').trim());
    if (goal?.content) {
        lines.push('');
        lines.push('## 原始目标');
        lines.push(String(goal.content).trim());
    }

    if (promptMessage?.content) {
        lines.push('');
        lines.push('## 当前阻塞点');
        lines.push(String(promptMessage.content).trim());
        if (Array.isArray(promptMessage.options) && promptMessage.options.length > 0) {
            lines.push(`可选项：${promptMessage.options.join(' / ')}`);
        }
    }

    if (handoffSummary) {
        lines.push('');
        lines.push('## 最近接力回流');
        if (handoffSummary.tool) lines.push(`工具：${handoffSummary.tool}`);
        if (handoffSummary.session) lines.push(`会话：${handoffSummary.session}`);
        if (handoffSummary.conclusion) lines.push(`回流结论：${handoffSummary.conclusion}`);
        if (handoffSummary.result) lines.push(`结果：${handoffSummary.result}`);
        if (handoffSummary.manualHandling) lines.push(`人工处理：${handoffSummary.manualHandling}`);
        if (handoffSummary.issueType) lines.push(`问题类型：${handoffSummary.issueType}`);
        if (handoffSummary.exitCode) lines.push(`退出码：${handoffSummary.exitCode}`);
        if (handoffSummary.retrySuggested) lines.push(`建议重试：${handoffSummary.retrySuggested}`);
        if (handoffSummary.handlingAdvice) lines.push(`处理建议：${handoffSummary.handlingAdvice}`);
        if (handoffSummary.nextAction) lines.push(`后续动作：${handoffSummary.nextAction}`);
        if (Array.isArray(handoffSummary.touchedFiles) && handoffSummary.touchedFiles.length > 0) {
            lines.push('涉及文件：');
            handoffSummary.touchedFiles.forEach((file) => lines.push(`- ${file}`));
        }
        if (handoffSummary.progress) lines.push(`最近进展：${handoffSummary.progress}`);
    }

    lines.push('');
    lines.push('## 最近上下文');
    safeMessages.slice(-8).forEach(message => {
        const role = String(message.role || '').toLowerCase();
        const actor = role === 'user' ? '用户' : sourceLabel(message);
        const content = String(message.content || '').trim();
        lines.push(`- ${actor} / ${typeLabel(message.type || 'activity')}：${content ? compactText(content) : '（无文本内容）'}`);
    });

    const preview = lines.join('\n');
    const prompt = [
        handoffPromptIntro(targetLabel),
        '',
        '请继续处理以下任务，并在继续前先理解当前阻塞点、已有上下文和优先级：',
        '',
        preview
    ].join('\n');

    return {
        target,
        targetLabel,
        preview,
        prompt
    };
}

function findLatestHandoffSummary(messages) {
    const match = messages.slice().reverse().find((message) => {
        return String(message?.source || '').toLowerCase() === 'codepanion'
            && /接力结果摘要/.test(String(message?.content || ''));
    });
    if (!match) return null;
    return parseHandoffSummary(match.content);
}

function parseHandoffSummary(content) {
    const text = String(content || '');
    if (!/接力结果摘要/.test(text)) return null;
    const readField = (label) => {
        const pattern = new RegExp(`(?:^|\\n)-\\s*${label}：(.+?)(?=\\n|$)`);
        return text.match(pattern)?.[1]?.trim() || '';
    };
    const touchedFilesMatch = text.match(/(?:^|\n)##\s*涉及文件\s*\n([\s\S]*?)(?=\n##\s|$)/);
    const touchedFiles = (touchedFilesMatch?.[1] || '')
        .split(/\r?\n/)
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(Boolean);
    const progressMatch = text.match(/(?:^|\n)##\s*最近进展\s*\n([\s\S]+)$/);
    const progress = progressMatch?.[1]?.trim() || '';
    return {
        tool: readField('工具'),
        session: readField('会话'),
        conclusion: readField('回流结论'),
        result: readField('结果'),
        manualHandling: readField('人工处理'),
        issueType: readField('问题类型'),
        exitCode: readField('退出码'),
        retrySuggested: readField('建议重试'),
        handlingAdvice: readField('处理建议'),
        nextAction: readField('后续动作'),
        touchedFiles,
        progress,
    };
}

function buildHandoffSpotlightText(summary, fallback) {
    const parts = [];
    if (summary.tool) parts.push(summary.tool);
    if (summary.session) parts.push(summary.session);
    if (summary.manualHandling) parts.push(`人工处理：${summary.manualHandling}`);
    if (summary.issueType) parts.push(`问题类型：${summary.issueType}`);
    if (summary.handlingAdvice) parts.push(`处理建议：${summary.handlingAdvice}`);
    if (Array.isArray(summary.touchedFiles) && summary.touchedFiles[0]) parts.push(summary.touchedFiles[0]);
    if (summary.progress) parts.push(summary.progress);
    if (parts.length === 0) return fallback;
    return parts.join(' · ');
}

function handoffTargetLabel(target) {
    switch (String(target || '').toLowerCase()) {
        case 'codex': return 'Codex';
        case 'claude-code': return 'Claude Code';
        case 'opencode': return 'OpenCode';
        default: return '通用';
    }
}

function handoffPromptIntro(targetLabel) {
    if (targetLabel === 'Codex') return '你现在在 Codex 中接手一个来自 CodePanion 的任务。';
    if (targetLabel === 'Claude Code') return '你现在在 Claude Code 中接手一个来自 CodePanion 的任务。';
    if (targetLabel === 'OpenCode') return '你现在在 OpenCode 中接手一个来自 CodePanion 的任务。';
    return '你现在接手一个来自 CodePanion 的任务。';
}

function handoffStatusLabel(status) {
    if (status === 'pending') return '待转交';
    if (status === 'active') return '已转交';
    if (status === 'returned') return '已回流';
    return '未转交';
}

function renderHandoffPanel(conversation, messages) {
    const targetSelect = document.getElementById('drawer-handoff-target');
    const preview = document.getElementById('drawer-handoff-preview');
    const taskState = taskStateForConversation(conversation);
    const hasTask = Boolean(conversation) && Array.isArray(messages) && messages.length > 0;
    if (!targetSelect || !preview) return;
    if (taskState.handoffTarget) {
        targetSelect.value = taskState.handoffTarget;
    } else if (!targetSelect.value) {
        targetSelect.value = 'generic';
    }

    const sync = () => {
        if (!hasTask) {
            preview.textContent = '选择任务后显示标准化交接内容。';
            wireActionButton('drawer-copy-handoff', false, () => undefined);
            wireActionButton('drawer-copy-handoff-prompt', false, () => undefined);
            wireActionButton('drawer-start-handoff', false, () => undefined);
            wireActionButton('drawer-mark-handoff-active', false, () => undefined);
            wireActionButton('drawer-return-handoff', false, () => undefined);
            wireActionButton('drawer-clear-handoff', false, () => undefined);
            return;
        }
        const pkg = buildHandoffPackage(conversation, messages, targetSelect.value || 'generic');
        preview.textContent = pkg.preview;
        wireActionButton('drawer-copy-handoff', true, () => copyText(pkg.preview));
        wireActionButton('drawer-copy-handoff-prompt', true, () => copyText(pkg.prompt));
        const threadId = workflowThreadIdFromConversationId(conversation.id);
        wireActionButton('drawer-start-handoff', Boolean(threadId), () => {
            sendToHost({
                type: 'handoff-launch',
                threadId,
                target: targetSelect.value || 'generic',
                prompt: pkg.prompt,
                preview: pkg.preview
            });
        });
        wireActionButton('drawer-mark-handoff-active', Boolean(threadId), () => {
            sendTaskAction(threadId, { handoffStatus: 'active', handoffTarget: targetSelect.value || 'generic' });
        });
        wireActionButton('drawer-return-handoff', Boolean(threadId), () => {
            sendTaskAction(threadId, { handoffStatus: 'returned', handoffTarget: targetSelect.value || 'generic' });
        });
        wireActionButton('drawer-clear-handoff', Boolean(threadId), () => {
            sendTaskAction(threadId, { handoffStatus: 'idle', handoffTarget: null, handoffSessionId: null });
        });
    };

    targetSelect.onchange = sync;
    sync();
}

function wireActionButton(id, enabled, handler, options = {}) {
    const button = document.getElementById(id);
    if (!button) return;
    if (options.hideWhenDisabled) button.hidden = !enabled;
    button.disabled = !enabled;
    button.onclick = enabled ? handler : null;
}

function activeWorkflowThreadId() {
    if (!String(state.activeConversation || '').startsWith('workflow:')) return '';
    return String(state.activeConversation).slice('workflow:'.length);
}

function togglePinnedTask(threadId, taskState) {
    hideAllSnoozeMenus();
    sendTaskAction(threadId, { pinned: !taskState.pinned });
}

function toggleSnoozeTask(threadId, taskState, menuId) {
    const isSnoozed = taskState.snoozedUntil > Date.now();
    if (isSnoozed) {
        hideAllSnoozeMenus();
        sendTaskAction(threadId, { snoozedUntil: null });
        return;
    }
    toggleSnoozeMenu(menuId);
}

function toggleArchivedTask(threadId, taskState) {
    hideAllSnoozeMenus();
    sendTaskAction(threadId, { archived: !taskState.archived });
}

function setTaskPriority(threadId, priority) {
    hideAllSnoozeMenus();
    sendTaskAction(threadId, { priority });
}

function canMoveTask(threadId, direction) {
    const visible = visibleWorkflowQueue();
    const index = visible.findIndex(item => workflowThreadIdFromConversationId(item.id) === threadId);
    if (index < 0) return false;
    const targetIndex = index + direction;
    return targetIndex >= 0 && targetIndex < visible.length;
}

function moveTaskRelative(threadId, direction) {
    hideAllSnoozeMenus();
    const visible = visibleWorkflowQueue();
    const index = visible.findIndex(item => workflowThreadIdFromConversationId(item.id) === threadId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= visible.length) return;

    const reordered = visible.slice();
    const [current] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, current);

    reordered.forEach((item, idx) => {
        const nextOrder = (idx + 1) * 100;
        const itemThreadId = workflowThreadIdFromConversationId(item.id);
        if (!itemThreadId) return;
        if (taskStateForConversation(item).sortOrder === nextOrder) return;
        sendTaskAction(itemThreadId, { sortOrder: nextOrder }, { preserveSelection: true, suppressRender: true });
    });
    renderAll();
}

function visibleWorkflowQueue() {
    const activeView = normalizeView(state.activeView);
    const allConversations = Array.from(state.conversations.values())
        .filter(item => item.id !== 'all')
        .filter(isUserFacingConversation)
        .sort(compareConversations);
    let conversations = allConversations.filter(item => matchesActiveView(item, activeView));
    if (activeView === 'active') {
        conversations = allConversations.filter(isCurrentConversation);
        if (conversations.length === 0) {
            conversations = allConversations
                .filter(item => isRecentConversation(item) && isUserFacingConversation(item) && !isArchivedTask(item) && !isSnoozedTask(item))
                .slice(0, 12);
        }
    }
    return conversations
        .slice(0, activeView === 'active' ? 24 : 60)
        .filter(item => Boolean(workflowThreadIdFromConversationId(item.id)));
}

function sendTaskAction(threadId, patch, options = {}) {
    if (!threadId) return;
    hideAllSnoozeMenus();
    if (!options.preserveSelection) {
        state.selectedBatchConversationIds.clear();
        state.batchMode = false;
    }
    applyTaskStatePatchLocal(threadId, patch);
    sendToHost({
        type: 'task-action',
        threadId,
        ...patch
    });
    if (!options.suppressRender) renderAll();
}

function applyTaskStatePatchLocal(threadId, patch) {
    const touchesHandoff = Object.prototype.hasOwnProperty.call(patch, 'handoffStatus')
        || Object.prototype.hasOwnProperty.call(patch, 'handoffTarget')
        || Object.prototype.hasOwnProperty.call(patch, 'handoffSessionId');
    if (!touchesHandoff) return;
    const thread = state.workflowThreads.get(threadId);
    if (thread) {
        thread.taskState = normalizeTaskStatePayload({
            ...(thread.taskState || {}),
            ...patch,
            updatedAt: Date.now()
        });
    }
    const conversationId = `workflow:${threadId}`;
    const conversation = state.conversations.get(conversationId);
    if (conversation) {
        conversation.taskState = normalizeTaskStatePayload({
            ...(conversation.taskState || {}),
            ...patch,
            updatedAt: Date.now()
        });
    }
}

function renderSnoozeMenu(containerId, threadId, taskState) {
    const menu = document.getElementById(containerId);
    if (!menu) return;
    const canManage = Boolean(threadId) && !(taskState.snoozedUntil > Date.now());
    menu.hidden = state.openSnoozeMenuId !== containerId || !canManage;
    if (!canManage) {
        menu.innerHTML = '';
        return;
    }

    const tomorrowMorning = nextMorningNine();
    menu.innerHTML = `
        <div class="task-action-menu-title">选择提醒时间</div>
        <div class="task-action-menu-grid">
            <button class="action-button" type="button" data-snooze-preset="30m">30 分钟</button>
            <button class="action-button" type="button" data-snooze-preset="2h">2 小时</button>
            <button class="action-button" type="button" data-snooze-preset="tomorrow-9">明早 09:00</button>
            <button class="action-button" type="button" data-snooze-action="cancel-menu">取消</button>
        </div>
        <div class="task-action-menu-custom">
            <input type="datetime-local" value="${formatDateTimeLocalValue(tomorrowMorning)}">
            <button class="action-button primary" type="button" data-snooze-action="apply-custom">确定</button>
        </div>
    `;

    menu.querySelectorAll('[data-snooze-preset]').forEach(button => {
        button.addEventListener('click', () => {
            const preset = button.getAttribute('data-snooze-preset');
            const dueAt = presetSnoozeTime(preset);
            if (dueAt > Date.now()) sendTaskAction(threadId, { snoozedUntil: dueAt });
        });
    });

    menu.querySelector('[data-snooze-action="cancel-menu"]')?.addEventListener('click', hideAllSnoozeMenus);
    menu.querySelector('[data-snooze-action="apply-custom"]')?.addEventListener('click', () => {
        const input = menu.querySelector('input[type="datetime-local"]');
        const dueAt = parseDateTimeLocalValue(input?.value || '');
        if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
            input?.focus();
            return;
        }
        sendTaskAction(threadId, { snoozedUntil: dueAt });
    });
}

function toggleSnoozeMenu(menuId) {
    state.openSnoozeMenuId = state.openSnoozeMenuId === menuId ? '' : menuId;
    renderAll();
}

function hideAllSnoozeMenus() {
    if (!state.openSnoozeMenuId) return;
    state.openSnoozeMenuId = '';
    renderAll();
}

function presetSnoozeTime(preset) {
    if (preset === '30m') return Date.now() + (30 * 60 * 1000);
    if (preset === '2h') return Date.now() + (2 * 60 * 60 * 1000);
    if (preset === 'tomorrow-9') return nextMorningNine();
    return 0;
}

function nextMorningNine() {
    const due = new Date();
    due.setSeconds(0, 0);
    due.setHours(9, 0, 0, 0);
    if (due.getTime() <= Date.now()) {
        due.setDate(due.getDate() + 1);
    }
    return due.getTime();
}

function formatDateTimeLocalValue(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value) {
    if (!value) return NaN;
    return new Date(value).getTime();
}

function formatShortTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function wireOmnibar(prompt) {
    const omnibar = document.getElementById('omnibar');
    const input = document.getElementById('omnibar-input');
    const submit = document.getElementById('omnibar-submit');
    if (!input || !submit) return;

    const allowTextReply = Boolean(prompt && (prompt.sessionId || prompt.eventId));
    if (omnibar) {
        omnibar.hidden = false;
        document.getElementById('app-shell')?.classList.remove('omnibar-hidden');
    }
    input.disabled = !allowTextReply;
    submit.disabled = !allowTextReply;
    input.placeholder = allowTextReply ? '输入回复，按 Enter 发送到当前等待任务' : '当前任务没有可写回的回复目标';

    submit.onclick = allowTextReply ? () => {
        const value = input.value.trim();
        if (!value) return;
        selectOption(prompt.sessionId, prompt.eventId, value, prompt.id);
        input.value = '';
    } : null;

    input.onkeydown = allowTextReply ? (event) => {
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
            if (message.data && shouldDisplayMonitorEvent(message.data)) {
                addMessage({
                    ...message.data,
                    eventId: message.data.id || message.data.Id,
                    type: message.data.type || message.data.Type || 'activity',
                    content: message.data.content || message.data.Content || message.data.title || message.data.Title || ''
                });
            }
            break;
        case 'workflow-snapshot':
            if (message.snapshot) applyWorkflowSnapshot(message.snapshot);
            break;
        case 'workflow-event':
            applyWorkflowEvent(message.data || message);
            break;
        case 'source-registered':
            if (message.source) {
                const sourceId = message.source.id || message.source.Id || generateId();
                state.sources.set(sourceId, message.source);
                renderSourceStatusPanel();
                renderContextDrawer();
            }
            break;
        case 'sources-snapshot': {
            // observer 重连重建：snapshot 是权威列表，清掉已不存在的旧来源。
            const sources = Array.isArray(message.sources) ? message.sources : [];
            const nextIds = new Set();
            sources.forEach(source => {
                if (!source) return;
                const sourceId = source.id || source.Id;
                if (!sourceId) return;
                nextIds.add(sourceId);
                state.sources.set(sourceId, source);
            });
            for (const id of Array.from(state.sources.keys())) {
                if (!nextIds.has(id)) state.sources.delete(id);
            }
            renderSourceStatusPanel();
            renderContextDrawer();
            break;
        }
        case 'source-disconnected': {
            const sourceId = message.sourceId || message.SourceId || '';
            const source = state.sources.get(sourceId);
            if (source) {
                source.status = 'offline';
                source.Status = 'offline';
                renderSourceStatusPanel();
                renderContextDrawer();
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

    resetWorkflowState();
    threads.forEach(thread => storeWorkflowThread(thread));
    items
        .slice()
        .sort((a, b) => Number(a.timestamp || a.Timestamp || 0) - Number(b.timestamp || b.Timestamp || 0))
        .forEach(item => storeWorkflowItem(item));
    refreshAllWorkflowConversations();
    chooseInitialConversation();
    scheduleRenderAll();
}

function resetWorkflowState() {
    state.workflowItemIds.clear();
    state.workflowItemsByThread.clear();
    state.workflowThreads.clear();
    state.codeBlocks = state.codeBlocks.filter(block => !String(block.conversationId || '').startsWith('workflow:'));
    for (const id of Array.from(state.conversations.keys())) {
        if (String(id).startsWith('workflow:')) state.conversations.delete(id);
    }
    if (String(state.activeConversation || '').startsWith('workflow:')) {
        state.activeConversation = '';
    }
}

function applyWorkflowEvent(event) {
    const action = event.action || event.Action;
    const thread = event.thread || event.Thread;
    const item = event.item || event.Item;

    if (thread) {
        storeWorkflowThread(thread);
    }

    if ((!action || action === 'item-append') && item) {
        const stored = storeWorkflowItem(item);
        if (stored) refreshWorkflowConversation(getWorkflowThreadId(item));
        scheduleRenderAll();
    } else {
        if (thread) refreshWorkflowConversation(thread.id || thread.Id);
        scheduleRenderAll();
    }
}

function storeWorkflowThread(thread) {
    const id = thread.id || thread.Id;
    if (!id) return;
    const existing = state.workflowThreads.get(id) || {};
    const taskState = normalizeTaskStatePayload(thread.taskState || thread.TaskState || existing.taskState || existing.TaskState);
    // sourceOnline 是 daemon 加的新字段，旧 snapshot 没有；缺省 undefined ≠ false，
    // 不能用 || existing.sourceOnline，否则一旦 daemon 推 false 会被旧 undefined 顶回去。
    const rawSourceOnline = thread.sourceOnline ?? thread.SourceOnline;
    state.workflowThreads.set(id, {
        ...existing,
        id,
        title: thread.title || thread.Title || existing.title || id,
        source: thread.source || thread.Source || existing.source || 'workflow',
        workspace: thread.workspace || thread.Workspace || existing.workspace || '',
        status: thread.status || thread.Status || existing.status || 'running',
        updatedAt: Number(thread.updatedAt || thread.UpdatedAt || existing.updatedAt || Date.now()),
        itemCount: Number(thread.itemCount || thread.ItemCount || existing.itemCount || 0),
        sourceOnline: typeof rawSourceOnline === 'boolean' ? rawSourceOnline : existing.sourceOnline,
        taskState
    });
    pruneWorkflowThreads();
}

function storeWorkflowItem(item) {
    const id = item.id || item.Id || generateId();
    const threadId = getWorkflowThreadId(item);
    if (!threadId) return false;

    const normalizedItem = normalizeWorkflowItem(item, id);
    if (shouldIgnoreWorkflowItem(normalizedItem)) return false;
    if (isLowValueStatus(normalizedItem)) return false;
    if (state.workflowItemIds.has(id)) return false;
    state.workflowItemIds.add(id);

    if (!state.workflowItemsByThread.has(threadId)) {
        state.workflowItemsByThread.set(threadId, []);
    }
    const items = state.workflowItemsByThread.get(threadId);
    items.push(normalizedItem);
    pruneWorkflowItems(threadId);

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
    thread.itemCount = state.workflowItemsByThread.get(threadId).length;
    thread.title = deriveWorkflowTitle(threadId, thread.title);
    if (normalizedItem.status) thread.status = normalizedItem.status;
    pruneWorkflowThreads();
    if (shouldExtractWorkflowCode(normalizedItem)) {
        extractCodeBlocks(normalizeMessage(workflowItemToMessage(normalizedItem, id)));
    }
    return true;
}

function pruneWorkflowItems(threadId) {
    const items = state.workflowItemsByThread.get(threadId);
    if (!items) return;

    if (items.length > MAX_WORKFLOW_ITEMS_PER_THREAD) {
        const removed = items.splice(0, items.length - MAX_WORKFLOW_ITEMS_PER_THREAD);
        removed.forEach(item => state.workflowItemIds.delete(item.id));
    }

    if (state.workflowItemIds.size > MAX_WORKFLOW_ITEM_IDS) {
        pruneWorkflowItemIdsGlobal();
    }
}

function pruneWorkflowThreads() {
    if (state.workflowThreads.size <= MAX_WORKFLOW_THREADS) return;
    const ordered = Array.from(state.workflowThreads.values())
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    const remove = ordered.slice(MAX_WORKFLOW_THREADS);
    remove.forEach(thread => removeWorkflowThread(thread.id));
}

function removeWorkflowThread(threadId) {
    const conversationId = `workflow:${threadId}`;
    const items = state.workflowItemsByThread.get(threadId) || [];
    items.forEach(item => state.workflowItemIds.delete(item.id));
    state.workflowItemsByThread.delete(threadId);
    state.workflowThreads.delete(threadId);
    state.conversations.delete(conversationId);
    state.codeBlocks = state.codeBlocks.filter(block => block.conversationId !== conversationId);
    if (state.activeConversation === conversationId) {
        state.activeConversation = '';
    }
}

function pruneWorkflowItemIdsGlobal() {
    const all = [];
    state.workflowItemsByThread.forEach((items, threadId) => {
        items.forEach(item => all.push({ threadId, item }));
    });
    all.sort((a, b) => Number(a.item.timestamp || 0) - Number(b.item.timestamp || 0));
    const removeCount = Math.max(0, all.length - MAX_WORKFLOW_ITEM_IDS);
    if (removeCount === 0) return;
    for (const entry of all.slice(0, removeCount)) {
        const items = state.workflowItemsByThread.get(entry.threadId);
        if (!items) continue;
        const index = items.findIndex(item => item.id === entry.item.id);
        if (index >= 0) items.splice(index, 1);
        state.workflowItemIds.delete(entry.item.id);
        const thread = state.workflowThreads.get(entry.threadId);
        if (thread) thread.itemCount = items.length;
    }
    // P2-B：item 被剪掉后，与之关联的 workflow codeBlocks 失去消息锚，必须同步清理，
    // 否则代码视图保留对已删除消息 id 的引用，点击后跳回找不到的对话。
    state.codeBlocks = state.codeBlocks.filter(block => {
        if (!String(block.conversationId || '').startsWith('workflow:')) return true;
        return state.workflowItemIds.has(block.messageId);
    });
    if (state.activeCodeId && !state.codeBlocks.some(block => block.id === state.activeCodeId)) {
        state.activeCodeId = state.codeBlocks[0]?.id || '';
    }
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
        sessionId: threadId.startsWith('session:') ? threadId.slice('session:'.length) : '',
        windowTitle: '',
        workspace: item.filePath || '',
        timestamp: item.timestamp || Date.now(),
        content: workflowContent(kind, title, content, item.language),
        options: item.options,
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
        options: Array.isArray(item.options) ? item.options : Array.isArray(item.Options) ? item.Options : undefined,
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
    if (isApprovalTranscriptContent(content)) return true;
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

function isApprovalTranscriptContent(content) {
    const normalized = String(content || '').trim();
    if (/^The following is the Codex agent history added since your last approval assessment\./i.test(normalized)) return true;
    if (/^The following is the Codex agent history whose request action you are assessing\./i.test(normalized)) return true;
    if (/^\{\s*"outcome"\s*:\s*"allow"\s*\}$/i.test(normalized)) return true;
    if (/^\{\s*"outcome"\s*:\s*"deny"\s*\}/i.test(normalized)) return true;
    if (/^\{\s*"risk_level"\s*:/i.test(normalized) && /"outcome"\s*:\s*"(allow|deny)"/i.test(normalized)) return true;
    return false;
}

function isLowValueStatus(item) {
    if (item.kind !== 'status') return false;
    const title = String(item.title || '').toLowerCase();
    if (title === '任务开始' || title === '任务完成' || title === 'task_started' || title === 'task_complete') return true;
    if (title === '会话开始' || title === '会话结束' || title === 'token_count' || title === 'reasoning') return true;
    const content = String(item.content || '').trim();
    if (/^\{\s*"type"\s*:\s*"(token_count|reasoning)"\s*\}$/i.test(content)) return true;
    if (/^cmd\.exe\s+\/c\s+exit\s+0$/i.test(content)) return true;
    if (/^退出码：?0$/i.test(content)) return true;
    return false;
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
    if (!hasUserVisibleWorkflowContent(threadId, summary)) {
        state.conversations.delete(`workflow:${threadId}`);
        if (state.activeConversation === `workflow:${threadId}`) {
            state.activeConversation = '';
        }
        return;
    }
    const status = workflowStatusToMessageType(thread.status || summary.status);
    const preview = workflowPreview(threadId, summary);
    const lastAt = Number(thread.updatedAt || summary.lastAt || Date.now());
    const finalStatus = isArchivedConversation({ title: thread.title, lastContent: preview, lastAt })
        ? 'done'
        : status;
    // P0.3：把 summary 上的计数带到 conversation 上，
    // 任务列表的状态/动作派生不再依赖最近一条原始消息内容。
    state.conversations.set(`workflow:${threadId}`, {
        id: `workflow:${threadId}`,
        title: deriveWorkflowTitle(threadId, thread.title),
        source: thread.source || 'workflow',
        workspace: thread.workspace || '',
        lastContent: preview,
        lastAt,
        count: summary.totalCount,
        status: finalStatus,
        promptCount: summary.promptCount,
        errorCount: summary.errorCount,
        codeCount: summary.codeCount,
        fileChangeCount: summary.fileChangeCount,
        messageCount: summary.messageCount,
        toolCount: summary.toolCount,
        commandCount: summary.commandCount,
        // sourceOnline 透传到 conversation item，给 deriveConversationDisplay 用：
        // false 时把"运行中/来源在线"显示降级为"来源已离线"，避免 Codex 关了仍显示绿点。
        sourceOnline: thread.sourceOnline,
        taskState: normalizeTaskStatePayload(thread.taskState)
    });
}

function chooseInitialConversation() {
    if (state.activeConversation) return;
    // P1.1：首次进入或重连后没有选中任务时，优先落到等待我 / 失败 / 需审阅；
    // 单纯 lastAt 倒序会把刚结束的 done 任务排到等待输入之前。
    const candidates = Array.from(state.conversations.values())
        .filter(isUserFacingConversation)
        .sort(compareConversations);
    state.activeConversation = candidates[0]?.id || '';
}

function deriveWorkflowTitle(threadId, fallback) {
    const items = state.workflowItemsByThread.get(threadId) || [];
    const user = items.find(item => item.kind === 'message' && String(item.role || item.title).toLowerCase() === 'user' && item.content.trim());
    if (user) return compactTitle(user.content);

    const assistant = items.find(item => item.kind === 'message' && String(item.role || item.title).toLowerCase() === 'assistant' && item.content.trim());
    if (assistant) return compactTitle(assistant.content);

    const execution = items.find(item => item.kind === 'message' && isAssistantExecutionSource(item.source) && item.content.trim());
    if (execution) return compactTitle(execution.title || execution.content);

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
        if (!shouldShowActivitySummary(activityBuffer, counts)) {
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
            rawItems: activityBuffer.slice()
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
                options: item.options,
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
    if (item.kind === 'command' || item.kind === 'tool_call') return false;
    if (item.kind === 'prompt') return true;
    if (item.status === 'waiting' || item.status === 'error') return true;
    if (item.status === 'done' && item.kind !== 'message' && item.kind !== 'artifact') return false;
    if (item.kind !== 'message' && item.kind !== 'artifact') return false;
    if (!item.content.trim()) return Boolean(item.title);
    if (item.kind === 'artifact') return /```|diff --git|^\s*(export|import|function|class|const|let|var)\b/m.test(item.content);
    const role = normalizeWorkflowRole(item);
    return (role === 'assistant' || role === 'user') && item.content.trim().length >= 2;
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
    if (isAssistantExecutionSource(item.source)) return 'assistant';
    return '';
}

function isAssistantExecutionSource(source) {
    return ['claude-code', 'codex', 'opencode', 'vscode'].includes(String(source || '').toLowerCase());
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

function hasUserVisibleWorkflowContent(threadId, summary) {
    const items = state.workflowItemsByThread.get(threadId) || [];
    if (items.length === 0) return false;
    if (summary.promptCount > 0 || summary.errorCount > 0 || summary.fileChangeCount > 0) return true;
    if (items.some(item => item.kind === 'artifact')) return true;
    return items.some(isPrimaryWorkflowMessage);
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
    if (counts.command) parts.push(`${counts.command} 条命令输出`);
    if (counts.artifact) parts.push(`${counts.artifact} 段代码`);
    if (parts.length === 0) parts.push(`${total} 条记录`);
    return `**执行记录**\n\n已处理${duration} ${parts.join('，')}`;
}

function shouldShowActivitySummary(items, counts) {
    if (hasError(items)) return true;
    if (counts.file_change || counts.artifact) return true;
    return false;
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

function renderErrorSummary(message) {
    const rawItems = Array.isArray(message.rawItems) ? message.rawItems : [];
    const errored = rawItems.filter(item => item && item.status === 'error');
    if (errored.length === 0 && !String(message.content || '').trim()) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'error-summary';

    const heading = document.createElement('div');
    heading.className = 'error-summary-title';
    heading.textContent = errored.length > 0
        ? `失败 ${errored.length} 项`
        : '本次任务以失败结束';
    wrapper.appendChild(heading);

    errored.slice(0, 3).forEach(item => {
        const row = document.createElement('div');
        row.className = 'error-summary-row';
        const label = document.createElement('strong');
        const titleText = item.title ? ` · ${item.title}` : '';
        label.textContent = `${workflowKindLabel(item.kind)}${titleText}`;
        row.appendChild(label);
        const content = String(item.content || '').trim();
        if (content) {
            const excerpt = document.createElement('span');
            excerpt.textContent = compactText(content);
            row.appendChild(excerpt);
        }
        wrapper.appendChild(row);
    });

    if (errored.length > 3) {
        const more = document.createElement('div');
        more.className = 'error-summary-more';
        more.textContent = `另有 ${errored.length - 3} 项错误，详情见下方原始事件。`;
        wrapper.appendChild(more);
    }

    return wrapper;
}

function renderDiagnosticsAction(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diagnostics-action';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button';
    button.textContent = '复制本次失败诊断';
    button.addEventListener('click', () => {
        copyText(buildFailureDiagnostics(message));
    });
    wrapper.appendChild(button);
    return wrapper;
}

// P1.2：失败诊断必须能让用户独立判断"是命令、工具调用、连接还是适配器的问题"，
// 复制内容覆盖任务标题、来源、能力层级、错误摘要、报错原始事件、最近相关命令。
function buildFailureDiagnostics(message) {
    const conversation = state.conversations.get(message.conversationId);
    const capability = capabilityForMessage(message);
    const lines = [];
    lines.push('# CodePanion 失败诊断');
    lines.push(`时间：${new Date(message.timestamp).toISOString()}`);
    lines.push(`任务：${conversation?.title || message.conversationTitle || '未命名任务'}`);
    lines.push(`来源：${sourceLabel(message)}（${capability.level}）`);
    if (message.workspace) lines.push(`工作区：${message.workspace}`);
    lines.push('');
    lines.push('## 失败摘要');
    lines.push(String(message.content || '').trim() || '（daemon 未给出摘要）');

    const rawItems = Array.isArray(message.rawItems) ? message.rawItems : [];
    const errored = rawItems.filter(item => item && item.status === 'error');
    if (errored.length > 0) {
        lines.push('');
        lines.push('## 报错原始事件');
        errored.forEach(item => {
            lines.push(`- ${workflowKindLabel(item.kind)}：${item.title || '(无标题)'}`);
            const content = String(item.content || '').trim();
            if (content) {
                lines.push('```');
                lines.push(truncateForDiagnostics(content));
                lines.push('```');
            }
        });
    }

    const recent = rawItems.filter(item => item && (item.kind === 'command' || item.kind === 'tool_call')).slice(-4);
    if (recent.length > 0) {
        lines.push('');
        lines.push('## 最近命令 / 工具调用');
        recent.forEach(item => {
            lines.push(`- [${workflowKindLabel(item.kind)}] ${item.title || ''}`.trim());
            const content = String(item.content || '').trim();
            if (content) {
                lines.push('```');
                lines.push(truncateForDiagnostics(content));
                lines.push('```');
            }
        });
    }

    lines.push('');
    lines.push('（由 CodePanion P1.2 失败诊断导出，可粘贴给 Codex / Claude 继续排查）');
    return lines.join('\n');
}

function truncateForDiagnostics(content) {
    const text = String(content || '');
    const max = 2000;
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n... 已截断，剩余 ${text.length - max} 字符`;
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
            state.batchMode = false;
            state.selectedBatchConversationIds.clear();
            if (state.activeView === 'code' && state.codeBlocks.length > 0) {
                state.activeConversation = state.codeBlocks[state.codeBlocks.length - 1].conversationId;
            }
            renderAll();
        });
    });
}

function bindGroupButtons() {
    document.querySelectorAll('.group-button').forEach(button => {
        button.addEventListener('click', () => {
            const nextMode = normalizeGroupMode(button.dataset.groupMode || 'workspace');
            state.groupMode = nextMode;
            document.querySelectorAll('.group-button').forEach(item => {
                item.classList.toggle('active', normalizeGroupMode(item.dataset.groupMode) === nextMode);
            });
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
    bindGroupButtons();
    renderAll();
    updateConnectionStatus(false);
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('#stage-snooze-task, #drawer-snooze-task, .task-action-menu')) return;
        hideAllSnoozeMenus();
    });
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

const api = { addMessage, clearMessages, updateConnectionStatus };
if (window.CODEPANION_TEST === true) {
    api.__test = {
        handleMessage,
        renderAll,
        state,
        deriveConversationDisplay,
        conversationPriority,
        capabilityForMessage,
        capabilityLevelLabel,
        capabilityChipClass,
        buildFailureDiagnostics,
        buildStageContext,
        buildHandoffPackage
    };
}
window.CodePanion = api;
