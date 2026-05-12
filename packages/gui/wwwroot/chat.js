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
    contentDiv.innerHTML = marked.parse(message.content);
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

            button.innerHTML = `
                <span class="option-number">${index + 1}</span>
                <span class="option-label">${escapeHtml(option)}</span>
            `;

            button.onclick = () => selectOption(sessionId, option);
            container.appendChild(button);
        });
    }

    // 自定义输入框
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Tell Claude what to do instead';
    customInput.className = 'custom-input';
    customInput.onkeydown = (e) => {
        if (e.key === 'Enter' && customInput.value.trim()) {
            selectOption(sessionId, customInput.value.trim());
        }
    };
    container.appendChild(customInput);

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
sendToHost({ type: 'ready' });
