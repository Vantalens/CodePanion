// 配置 marked
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

// 消息存储
let messages = [];
let currentSessionId = null;

// 显示空状态
function showEmptyState() {
    const container = document.getElementById('chat-container');
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">💬</div>
            <div class="empty-state-title">等待会话</div>
            <div class="empty-state-description">
                当 AI 需要输入时，对话将显示在这里。<br>
                您可以在左侧选择不同的会话。
            </div>
        </div>
    `;
}

// 渲染消息
function renderMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${message.type}`;
    messageDiv.dataset.messageId = message.id;

    // 时间戳
    const timestamp = new Date(message.timestamp).toLocaleTimeString('zh-CN');
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    timestampDiv.textContent = timestamp;
    messageDiv.appendChild(timestampDiv);

    // Markdown 内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    try {
        contentDiv.innerHTML = marked.parse(message.content);

        // 为代码块添加语言标签
        const codeBlocks = contentDiv.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            const pre = block.parentElement;
            const language = block.className.match(/language-(\w+)/)?.[1] || 'text';

            const header = document.createElement('div');
            header.className = 'code-block-header';
            header.innerHTML = `
                <span class="code-language">${language}</span>
            `;

            pre.insertBefore(header, block);
        });
    } catch (error) {
        console.error('Markdown parsing error:', error);
        contentDiv.textContent = message.content;
    }

    messageDiv.appendChild(contentDiv);

    // 如果是提示消息，添加选项按钮
    if (message.type === 'prompt' && message.options) {
        const optionsDiv = renderOptions(message.sessionId, message.options);
        messageDiv.appendChild(optionsDiv);
    }

    return messageDiv;
}

// 渲染选项按钮
function renderOptions(sessionId, options) {
    const container = document.createElement('div');
    container.className = 'prompt-options';

    // 编号选项
    if (Array.isArray(options) && options.length > 0) {
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'option-button';
            if (index === 0) {
                button.classList.add('recommended');
            }

            const numberSpan = document.createElement('span');
            numberSpan.className = 'option-number';
            numberSpan.textContent = index + 1;

            const labelSpan = document.createElement('span');
            labelSpan.className = 'option-label';
            labelSpan.textContent = option;

            button.appendChild(numberSpan);
            button.appendChild(labelSpan);

            button.onclick = () => selectOption(sessionId, option);
            container.appendChild(button);
        });
    }

    // 自定义输入框容器
    const inputContainer = document.createElement('div');
    inputContainer.className = 'custom-input-container';

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Tell Claude what to do instead';
    customInput.className = 'custom-input';
    customInput.onkeydown = (e) => {
        if (e.key === 'Enter' && customInput.value.trim()) {
            selectOption(sessionId, customInput.value.trim());
        }
    };

    const hint = document.createElement('div');
    hint.className = 'custom-input-hint';
    hint.textContent = 'Press Enter to send';

    inputContainer.appendChild(customInput);
    inputContainer.appendChild(hint);
    container.appendChild(inputContainer);

    return container;
}

// 选择选项
function selectOption(sessionId, value) {
    // 发送到 C#
    sendToHost({
        type: 'reply',
        sessionId: sessionId,
        value: value
    });

    // 添加用户回复消息
    addMessage({
        id: generateId(),
        sessionId: sessionId,
        timestamp: Date.now(),
        type: 'user-reply',
        content: '**回复**: ' + value
    });
}

// 添加消息
function addMessage(message) {
    messages.push(message);
    const container = document.getElementById('chat-container');
    const messageElement = renderMessage(message);
    container.appendChild(messageElement);

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 清空消息
function clearMessages() {
    messages = [];
    document.getElementById('chat-container').innerHTML = '';
}

// 发送消息到 C# 宿主
function sendToHost(message) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
    } else {
        console.log('WebView2 not available, message:', message);
    }
}

// 接收来自 C# 的消息
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (event) => {
        const message = event.data;
        handleMessage(message);
    });
}

// 处理消息
function handleMessage(message) {
    switch (message.type) {
        case 'add-message':
            addMessage(message.data);
            break;
        case 'clear':
            clearMessages();
            break;
        case 'init':
            // 初始化，加载历史消息
            if (message.messages) {
                message.messages.forEach(msg => addMessage(msg));
            }
            break;
        default:
            console.log('Unknown message type:', message.type);
    }
}

// 工具函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 初始化
console.log('RemindAI Chat initialized');
showEmptyState();
sendToHost({ type: 'ready' });
