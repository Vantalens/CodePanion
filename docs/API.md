# RemindAI API 文档

## 概述

RemindAI 提供 HTTP REST API 和 WebSocket API 用于与守护进程通信。

**基础 URL**: `http://127.0.0.1:3721`

**WebSocket URL**: `ws://127.0.0.1:3721`

## HTTP REST API

### 1. 发送通知

向用户发送桌面通知。

**端点**: `POST /api/notify`

**请求体**:
```json
{
  "message": "string",      // 必需：通知消息
  "title": "string",        // 可选：通知标题
  "sessionId": "string",    // 可选：关联的会话 ID
  "type": "info" | "warning" | "error"  // 可选：通知类型
}
```

**响应**:
```json
{
  "success": true,
  "notificationId": "string"
}
```

**示例**:
```bash
curl -X POST http://127.0.0.1:3721/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Build completed successfully",
    "title": "RemindAI",
    "type": "info"
  }'
```

---

### 2. 发送响应到会话

向指定会话发送用户输入。

**端点**: `POST /api/reply`

**请求体**:
```json
{
  "sessionId": "string",    // 必需：会话 ID
  "input": "string"         // 必需：用户输入
}
```

**响应**:
```json
{
  "success": true,
  "sessionId": "string"
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND"
}
```

**示例**:
```bash
curl -X POST http://127.0.0.1:3721/api/reply \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "abc123",
    "input": "y"
  }'
```

---

### 3. 获取所有会话

获取当前所有活动会话的列表。

**端点**: `GET /api/sessions`

**响应**:
```json
{
  "sessions": [
    {
      "id": "string",
      "command": "string",
      "args": ["string"],
      "status": "running" | "waiting_input" | "ended",
      "createdAt": "2026-05-12T10:30:00.000Z",
      "lastActivity": "2026-05-12T10:35:00.000Z",
      "pendingPrompt": {
        "text": "string",
        "type": "yesno" | "input" | "confirm",
        "context": "string"
      }
    }
  ]
}
```

**示例**:
```bash
curl http://127.0.0.1:3721/api/sessions
```

---

### 4. 获取守护进程状态

获取守护进程的运行状态。

**端点**: `GET /api/status`

**响应**:
```json
{
  "running": true,
  "uptime": 3600,           // 运行时长（秒）
  "sessions": 2,            // 活动会话数
  "version": "0.1.0",
  "pid": 12345
}
```

**示例**:
```bash
curl http://127.0.0.1:3721/api/status
```

---

### 5. 获取特定会话详情

获取指定会话的详细信息。

**端点**: `GET /api/sessions/:sessionId`

**响应**:
```json
{
  "id": "string",
  "command": "string",
  "args": ["string"],
  "status": "running" | "waiting_input" | "ended",
  "createdAt": "2026-05-12T10:30:00.000Z",
  "lastActivity": "2026-05-12T10:35:00.000Z",
  "exitCode": 0,
  "pendingPrompt": {
    "text": "string",
    "type": "yesno" | "input" | "confirm",
    "context": "string"
  }
}
```

**错误响应**:
```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND"
}
```

---

## WebSocket API

### 连接

**URL**: `ws://127.0.0.1:3721`

**连接示例** (JavaScript):
```javascript
const ws = new WebSocket('ws://127.0.0.1:3721');

ws.onopen = () => {
  console.log('Connected to RemindAI daemon');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from RemindAI daemon');
};
```

---

### 消息格式

所有 WebSocket 消息都是 JSON 格式。

#### 客户端 → 服务器

##### 1. 订阅事件

订阅所有会话事件或特定会话的事件。

```json
{
  "type": "subscribe",
  "sessionId": "string"  // 可选：订阅特定会话，省略则订阅所有
}
```

**示例**:
```javascript
// 订阅所有会话
ws.send(JSON.stringify({
  type: 'subscribe'
}));

// 订阅特定会话
ws.send(JSON.stringify({
  type: 'subscribe',
  sessionId: 'abc123'
}));
```

---

##### 2. 取消订阅

取消订阅事件。

```json
{
  "type": "unsubscribe",
  "sessionId": "string"  // 可选：取消特定会话，省略则取消所有
}
```

---

##### 3. 发送响应

向会话发送用户输入。

```json
{
  "type": "reply",
  "sessionId": "string",
  "input": "string"
}
```

**示例**:
```javascript
ws.send(JSON.stringify({
  type: 'reply',
  sessionId: 'abc123',
  input: 'y'
}));
```

---

##### 4. 心跳

保持连接活跃。

```json
{
  "type": "ping"
}
```

**响应**:
```json
{
  "type": "pong",
  "timestamp": 1715520000000
}
```

---

#### 服务器 → 客户端

##### 1. 检测到提示

当检测到命令需要用户输入时发送。

```json
{
  "type": "prompt",
  "sessionId": "string",
  "prompt": {
    "text": "string",           // 提示文本
    "type": "yesno" | "input" | "confirm",
    "context": "string",        // 提示上下文（前面的输出）
    "timestamp": 1715520000000
  }
}
```

**示例**:
```json
{
  "type": "prompt",
  "sessionId": "abc123",
  "prompt": {
    "text": "Modify file.ts? (y/n)",
    "type": "yesno",
    "context": "Found 3 changes in file.ts:\n- Line 10: ...\n- Line 25: ...\n",
    "timestamp": 1715520000000
  }
}
```

---

##### 2. 会话开始

新会话启动时发送。

```json
{
  "type": "session_start",
  "sessionId": "string",
  "command": "string",
  "args": ["string"],
  "timestamp": 1715520000000
}
```

---

##### 3. 会话结束

会话完成或终止时发送。

```json
{
  "type": "session_end",
  "sessionId": "string",
  "exitCode": 0,
  "duration": 5000,  // 运行时长（毫秒）
  "timestamp": 1715520000000
}
```

---

##### 4. 会话输出

会话的标准输出/错误输出（可选，需要订阅）。

```json
{
  "type": "output",
  "sessionId": "string",
  "stream": "stdout" | "stderr",
  "data": "string",
  "timestamp": 1715520000000
}
```

---

##### 5. 错误

发生错误时发送。

```json
{
  "type": "error",
  "code": "string",
  "message": "string",
  "sessionId": "string",  // 可选：关联的会话
  "timestamp": 1715520000000
}
```

**错误代码**:
- `SESSION_NOT_FOUND`: 会话不存在
- `INVALID_INPUT`: 无效的输入
- `TIMEOUT`: 操作超时
- `INTERNAL_ERROR`: 内部错误

---

## 完整示例

### GUI 客户端示例 (JavaScript)

```javascript
class RemindAIClient {
  constructor(url = 'ws://127.0.0.1:3721') {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Connected to RemindAI');
        this.subscribe();
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('Connection error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from RemindAI');
        // 自动重连
        setTimeout(() => this.connect(), 5000);
      };
    });
  }

  subscribe(sessionId = null) {
    this.send({
      type: 'subscribe',
      sessionId
    });
  }

  reply(sessionId, input) {
    this.send({
      type: 'reply',
      sessionId,
      input
    });
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);
  }

  handleMessage(message) {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
  }
}

// 使用示例
const client = new RemindAIClient();

client.on('prompt', (message) => {
  console.log('Prompt detected:', message.prompt.text);
  
  // 显示对话框
  const userInput = showPromptDialog(message.prompt);
  
  // 发送响应
  client.reply(message.sessionId, userInput);
});

client.on('session_end', (message) => {
  console.log('Session ended:', message.sessionId);
  showNotification(`Command completed with exit code ${message.exitCode}`);
});

client.connect();
```

---

### CLI 客户端示例 (Node.js)

```javascript
import fetch from 'node-fetch';

const API_BASE = 'http://127.0.0.1:3721/api';

// 发送通知
async function notify(message, title = 'RemindAI') {
  const response = await fetch(`${API_BASE}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, title })
  });
  return response.json();
}

// 获取所有会话
async function getSessions() {
  const response = await fetch(`${API_BASE}/sessions`);
  return response.json();
}

// 发送响应
async function reply(sessionId, input) {
  const response = await fetch(`${API_BASE}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, input })
  });
  return response.json();
}

// 使用示例
(async () => {
  // 发送测试通知
  await notify('Hello from RemindAI!');

  // 获取活动会话
  const { sessions } = await getSessions();
  console.log('Active sessions:', sessions);

  // 如果有等待输入的会话，发送响应
  const waitingSession = sessions.find(s => s.status === 'waiting_input');
  if (waitingSession) {
    await reply(waitingSession.id, 'y');
  }
})();
```

---

## 错误处理

### HTTP 错误码

| 状态码 | 说明 |
|-------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在（如会话不存在） |
| 500 | 服务器内部错误 |

### WebSocket 关闭码

| 关闭码 | 说明 |
|-------|------|
| 1000 | 正常关闭 |
| 1001 | 端点离开 |
| 1006 | 异常关闭（连接丢失） |
| 1011 | 服务器错误 |

---

## 认证与安全

当前版本的 RemindAI 仅监听本地回环地址（127.0.0.1），不需要认证。

**安全建议**:
- 不要将守护进程暴露到公网
- 如需远程访问，使用 SSH 隧道或 VPN
- 未来版本将支持 token 认证

---

## 速率限制

当前版本没有速率限制。建议客户端：
- 避免频繁轮询，使用 WebSocket 接收实时更新
- 批量操作时添加适当延迟

---

## 版本兼容性

API 版本遵循语义化版本控制（Semantic Versioning）。

**当前版本**: v0.1.0

**兼容性承诺**:
- 主版本号变更：可能包含不兼容的 API 变更
- 次版本号变更：向后兼容的功能添加
- 修订版本号变更：向后兼容的问题修复

---

## 调试

### 启用详细日志

```bash
# 设置日志级别为 debug
remindai start --log-level debug
```

### 测试 WebSocket 连接

使用 `wscat` 工具测试：

```bash
npm install -g wscat
wscat -c ws://127.0.0.1:3721

# 发送订阅消息
> {"type":"subscribe"}

# 等待事件...
```

### 测试 HTTP API

```bash
# 检查守护进程状态
curl http://127.0.0.1:3721/api/status

# 发送测试通知
curl -X POST http://127.0.0.1:3721/api/notify \
  -H "Content-Type: application/json" \
  -d '{"message":"Test notification"}'
```

---

## 常见问题

### Q: WebSocket 连接失败？

**A**: 检查守护进程是否运行：
```bash
remindai status
```

### Q: 如何订阅特定会话的事件？

**A**: 在订阅消息中指定 `sessionId`：
```json
{"type": "subscribe", "sessionId": "abc123"}
```

### Q: 如何获取会话的完整输出？

**A**: 订阅会话后，监听 `output` 类型的消息。

### Q: 会话 ID 从哪里获取？

**A**: 
1. 通过 `GET /api/sessions` 获取所有会话
2. 监听 `session_start` WebSocket 事件
3. 在 `remindai run` 命令输出中查看

---

## 更新日志

### v0.1.0 (2026-05-12)

- 初始版本
- HTTP REST API
- WebSocket 实时通信
- 基础会话管理
- 桌面通知支持
