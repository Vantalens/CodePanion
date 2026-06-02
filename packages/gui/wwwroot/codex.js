// CodePanion Codex - 主交互界面

(function() {
    'use strict';

    // === 状态管理 ===
    const state = {
        connected: false,
        currentSessionId: null,
        sessions: new Map(),
        currentProject: null,
        projects: [],
        providers: [],
        models: [],
        roleBindings: {},
    };

    // === DOM 元素 ===
    const elements = {
        // 侧边栏
        newChatBtn: document.getElementById('new-chat-btn'),
        settingsBtn: document.getElementById('settings-btn'),
        workflowBtn: document.getElementById('workflow-btn'),
        projectsList: document.getElementById('projects-list'),
        projectsAddBtn: document.getElementById('projects-add-btn'),
        sessionsList: document.getElementById('sessions-list'),
        sessionCount: document.getElementById('session-count'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),

        // 主内容
        emptyState: document.getElementById('empty-state'),
        chatContainer: document.getElementById('chat-container'),
        messages: document.getElementById('messages'),
        messageInput: document.getElementById('message-input'),
        sendBtn: document.getElementById('send-btn'),
        attachBtn: document.getElementById('attach-btn'),

        // 对话框
        settingsDialog: document.getElementById('settings-dialog'),
        projectFormDialog: document.getElementById('project-form-dialog'),
    };

    // === WebView 通信 ===
    function sendToHost(message) {
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(message);
        } else {
            console.warn('WebView2 not available', message);
        }
    }

    window.codexApp = {
        sendToHost,
        state,
    };
    window.sendToHost = sendToHost;

    function handleHostMessage(event) {
        try {
            const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            console.log('[Codex] Received:', message.type, message);

            switch (message.type) {
                case 'connection-status':
                    handleConnectionStatus(message.connected);
                    break;
                case 'session-registered':
                    handleSessionRegistered(message.session);
                    break;
                case 'add-message':
                    handleAddMessage(message.data);
                    break;
                case 'session-exited':
                    handleSessionExited(message.data);
                    break;
                case 'session-error':
                    handleSessionError(message);
                    break;
                case 'projects':
                    handleProjects(message.projects);
                    break;
                case 'providers':
                    handleProviders(message.providers);
                    break;
                case 'models':
                    handleModels(message.models, message.defaultModel, message.roleBindings);
                    break;
                default:
                    console.log('[Codex] Unknown message type:', message.type);
            }
        } catch (err) {
            console.error('[Codex] Failed to handle message:', err);
        }
    }

    // === 连接状态 ===
    function handleConnectionStatus(connected) {
        state.connected = connected;
        elements.statusDot.classList.toggle('connected', connected);
        elements.statusText.textContent = connected ? '已连接' : '未连接';

        if (connected) {
            requestProjects();
        }
    }

    // === 会话管理 ===
    function handleSessionRegistered(session) {
        state.sessions.set(session.id, {
            id: session.id,
            command: session.command || '新对话',
            workspace: session.workspace,
            status: session.status || 'running',
            messages: [],
            createdAt: Date.now(),
        });
        renderSessions();
    }

    function handleSessionExited(data) {
        const session = state.sessions.get(data.sessionId);
        if (session) {
            session.status = 'exited';
            session.exitCode = data.exitCode;
            renderSessions();
        }
    }

    function handleSessionError(data) {
        const session = state.sessions.get(data.sessionId);
        if (!session) return;
        session.status = 'error';
        session.messages.push({
            id: generateId(),
            type: 'error',
            role: 'system',
            content: data.message || '会话启动失败。',
            timestamp: Date.now(),
        });
        renderSessions();
        if (data.sessionId === state.currentSessionId) {
            renderMessages();
        }
    }

    function renderSessions() {
        const sessionsArray = Array.from(state.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
        const activeCount = sessionsArray.filter(s => s.status !== 'exited').length;

        elements.sessionsList.innerHTML = '';
        elements.sessionCount.textContent = activeCount;

        sessionsArray.forEach(session => {
            const item = document.createElement('div');
            item.className = 'session-item';
            if (session.id === state.currentSessionId) {
                item.classList.add('active');
            }

            const title = document.createElement('div');
            title.className = 'session-title';
            title.textContent = session.command;

            const meta = document.createElement('div');
            meta.className = 'session-meta';

            const status = document.createElement('span');
            status.className = `session-status ${session.status}`;
            status.textContent = session.status === 'running' ? '进行中' :
                                  session.status === 'waiting' ? '等待' :
                                  session.status === 'error' ? '失败' : '已结束';
            meta.appendChild(status);

            if (session.workspace) {
                const workspace = document.createElement('span');
                workspace.textContent = session.workspace;
                meta.appendChild(workspace);
            }

            item.appendChild(title);
            item.appendChild(meta);

            item.addEventListener('click', () => switchSession(session.id));
            elements.sessionsList.appendChild(item);
        });
    }

    function switchSession(sessionId) {
        if (state.currentSessionId === sessionId) return;

        state.currentSessionId = sessionId;
        renderSessions();
        renderMessages();

        elements.emptyState.hidden = true;
        elements.chatContainer.hidden = false;
    }

    // === 消息处理 ===
    function handleAddMessage(data) {
        const session = state.sessions.get(data.sessionId);
        if (!session) {
            console.warn('Message for unknown session:', data.sessionId);
            return;
        }

        const message = {
            id: data.id || generateId(),
            type: data.type,
            role: data.type === 'output' ? 'assistant' : data.type === 'prompt' ? 'system' : 'user',
            content: data.content || '',
            timestamp: data.timestamp || Date.now(),
        };

        session.messages.push(message);

        // 如果是当前会话，渲染消息
        if (data.sessionId === state.currentSessionId) {
            appendMessage(message);
        }

        // 更新会话状态
        if (data.type === 'prompt') {
            session.status = 'waiting';
            renderSessions();
        }
    }

    function renderMessages() {
        elements.messages.innerHTML = '';
        const session = state.sessions.get(state.currentSessionId);
        if (!session) return;

        session.messages.forEach(msg => appendMessage(msg));
        scrollToBottom();
    }

    function appendMessage(message) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${message.role}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = message.role === 'user' ? 'U' :
                             message.role === 'assistant' ? 'A' : 'S';

        const content = document.createElement('div');
        content.className = 'message-content';

        const header = document.createElement('div');
        header.className = 'message-header';

        const sender = document.createElement('span');
        sender.className = 'message-sender';
        sender.textContent = message.role === 'user' ? '你' :
                             message.role === 'assistant' ? 'CodePanion' : '系统';

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = formatTime(message.timestamp);

        header.appendChild(sender);
        header.appendChild(time);

        const body = document.createElement('div');
        body.className = 'message-body';

        body.innerHTML = renderSafeMarkdown(message.content);

        content.appendChild(header);
        content.appendChild(body);

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(content);

        elements.messages.appendChild(msgDiv);
        scrollToBottom();
    }

    function renderSafeMarkdown(text) {
        const renderer = typeof window.renderMarkdown === 'function'
            ? window.renderMarkdown
            : (value) => `<p>${escapeHtml(value || '')}</p>`;
        return sanitizeHtml(renderer(text || ''));
    }

    function sanitizeHtml(html) {
        const root = document.createElement('div');
        root.innerHTML = html;
        const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input']);
        root.querySelectorAll('*').forEach((node) => {
            if (blockedTags.has(node.tagName.toLowerCase())) {
                node.remove();
                return;
            }
            Array.from(node.attributes).forEach((attr) => {
                const name = attr.name.toLowerCase();
                const value = attr.value.trim().toLowerCase();
                if (name.startsWith('on') || name === 'style' || name === 'srcset') {
                    node.removeAttribute(attr.name);
                    return;
                }
                if ((name === 'href' || name === 'data-external-url') &&
                    /^(javascript:|vbscript:|data:text\/html)/i.test(value)) {
                    node.removeAttribute(attr.name);
                    if (name === 'href') node.removeAttribute('target');
                }
            });
        });
        return root.innerHTML;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    function scrollToBottom() {
        const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
        schedule(() => {
            elements.messages.scrollTop = elements.messages.scrollHeight;
        });
    }

    // === 发送消息 ===
    function sendMessage() {
        const text = elements.messageInput.value.trim();
        if (!text) return;

        if (!state.currentSessionId) {
            showConversationUnavailable(text);
        } else {
            // 发送到现有会话
            sendToHost({
                type: 'reply',
                sessionId: state.currentSessionId,
                value: text,
                mode: 'text'
            });

            // 立即显示用户消息
            const session = state.sessions.get(state.currentSessionId);
            if (session) {
                const message = {
                    id: generateId(),
                    role: 'user',
                    content: text,
                    timestamp: Date.now(),
                };
                session.messages.push(message);
                appendMessage(message);
            }
        }

        elements.messageInput.value = '';
        autoResizeTextarea();
    }

    function showConversationUnavailable(initialMessage) {
        const sessionId = generateId();
        const session = {
            id: sessionId,
            command: initialMessage.slice(0, 80) || '新对话',
            workspace: state.currentProject || '',
            status: 'error',
            messages: [],
            createdAt: Date.now(),
        };
        state.sessions.set(sessionId, session);
        state.currentSessionId = sessionId;
        renderSessions();
        elements.emptyState.hidden = true;
        elements.chatContainer.hidden = false;

        const message = {
            id: generateId(),
            role: 'user',
            content: initialMessage,
            timestamp: Date.now(),
        };
        session.messages.push(message);
        session.messages.push({
            id: generateId(),
            type: 'error',
            role: 'system',
            content: '对话式会话创建接口已下线；请切换到工作流控制台启动 workflow，或把这条请求写入 workflow 步骤。',
            timestamp: Date.now(),
        });
        renderMessages();
    }

    // === 项目管理 ===
    function requestProjects() {
        sendToHost({ type: 'request-projects' });
    }

    function handleProjects(projects) {
        if (!projects || !Array.isArray(projects)) return;

        state.projects = projects;
        if (window.applyProjects) window.applyProjects(projects);

        elements.projectsList.innerHTML = '';

        projects.forEach(project => {
            const item = document.createElement('div');
            item.className = 'project-item';
            if (project.active) {
                item.classList.add('active');
                state.currentProject = project.id;
            }

            const icon = document.createElement('div');
            icon.className = 'project-icon';
            icon.textContent = '📁';

            const info = document.createElement('div');
            info.className = 'project-info';

            const name = document.createElement('div');
            name.className = 'project-name';
            name.textContent = project.name;

            const path = document.createElement('div');
            path.className = 'project-path';
            path.textContent = project.path;

            info.appendChild(name);
            info.appendChild(path);

            item.appendChild(icon);
            item.appendChild(info);

            item.addEventListener('click', () => {
                sendToHost({ type: 'activate-project', projectId: project.id });
            });

            elements.projectsList.appendChild(item);
        });
    }

    // === Provider 管理 ===
    function handleProviders(providers) {
        // 由 settings.js 处理
        if (window.applyProviders) window.applyProviders(providers);
    }

    function handleModels(models, defaultModel, roleBindings) {
        // 由 settings.js 处理
        if (window.applyModels) window.applyModels(models, defaultModel, roleBindings);
    }

    // === UI 交互 ===
    function autoResizeTextarea() {
        elements.messageInput.style.height = 'auto';
        elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';
    }

    function setupEventListeners() {
        // WebView 消息
        window.addEventListener('message', handleHostMessage);
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.addEventListener('message', handleHostMessage);
        }

        // 新对话
        elements.newChatBtn.addEventListener('click', () => {
            state.currentSessionId = null;
            renderSessions();
            elements.emptyState.hidden = false;
            elements.chatContainer.hidden = true;
            elements.messageInput.focus();
        });

        // 可折叠区域切换
        document.querySelectorAll('.section-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const button = e.currentTarget;
                const section = button.dataset.section;
                const sectionEl = button.closest(`.${section}-section`);

                button.classList.toggle('active');
                sectionEl.classList.toggle('expanded');
            });
        });

        // 默认展开会话列表
        document.querySelector('[data-section="sessions"]')?.click();

        // 项目添加按钮
        elements.projectsAddBtn?.addEventListener('click', () => {
            if (window.openProjectForm) {
                window.openProjectForm();
            }
        });

        // 设置
        elements.settingsBtn?.addEventListener('click', () => {
            elements.settingsDialog.hidden = false;
            sendToHost({ type: 'request-providers' });
            sendToHost({ type: 'request-models' });
        });

        // 工作流控制台
        elements.workflowBtn?.addEventListener('click', () => {
            // 切换到 chat.html
            window.location.href = 'https://codepanion.local/chat.html';
        });

        // 发送消息
        elements.sendBtn?.addEventListener('click', sendMessage);

        elements.messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        elements.messageInput?.addEventListener('input', autoResizeTextarea);

        // 关闭对话框
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dialogId = e.currentTarget.dataset.close;
                const dialog = document.getElementById(dialogId);
                if (dialog) dialog.hidden = true;
            });
        });

        // 点击对话框外部关闭
        document.querySelectorAll('.dialog-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.hidden = true;
                }
            });
        });
    }

    // === 工具函数 ===
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // === 初始化 ===
    function init() {
        console.log('[Codex] Initializing...');
        setupEventListeners();

        // 初始化 settings.js 和 projects.js
        if (typeof initProviderManagement === 'function') {
            initProviderManagement();
        }
        if (typeof initProjectManagement === 'function') {
            initProjectManagement();
        }

        // 通知 host 页面已就绪
        sendToHost({ type: 'ready' });

        // 初始焦点
        elements.messageInput?.focus();
    }

    // DOM 加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
