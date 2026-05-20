# CodePanion 重新设计方案（历史草案）

## 文档版本
- **版本**: v2.0
- **日期**: 2026-05-12
- **状态**: 历史草案 — 部分要点已落地（控制平面定位、能力分层、L1/L2/L3 来源边界），代码片段中的 Focus Assist 等示例**未实现**，仅作设计参考；当前可靠信息以 [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[MONITORING_SOURCES.md](MONITORING_SOURCES.md) 为准。

## 变更原因

基于用户反馈和实际使用场景，原有设计存在以下问题：

### 原设计的问题
1. **上下文缺失**: 只捕获最后几行输出，用户看不到 AI 的完整思路
2. **交互不直观**: 简单的 Yes/No 对话框，缺少选项和上下文
3. **信息丢失**: 长输出（如 Plan）会被截断
4. **体验割裂**: 通知和响应分离，不够流畅

### 新设计目标
1. **完整上下文**: 显示 AI 的完整输出（结论 + Plan + 代码 + 问题）
2. **对话式交互**: 类似 CherryStudio/Claude Code 的对话体验
3. **丰富的选项**: 编号选项按钮 + 自定义输入
4. **Markdown 渲染**: 美观显示 Plan、代码块、列表等

---

## 核心需求

### 1. 用户场景
**典型场景**: 用户在电脑前，但可能在其他界面或做其他事情

**痛点**: AI 开发中断需要输入，但用户不知道，导致时间浪费

**解决方案**:
- 声音提示 + Windows 通知弹窗
- 尊重免打扰模式（Windows Focus Assist）
- 通知持久化到 Windows 通知中心

### 2. 通知策略
| 事件 | 提示音 | 桌面通知 | 免打扰模式 |
|------|--------|----------|-----------|
| 需要输入 | ✅ 系统提示音 | ✅ 弹窗 | 🔇 静音 |
| 任务完成 | ✅ 系统提示音 | ✅ 弹窗 | 🔇 静音 |
| 普通输出 | ❌ | ❌ | - |

### 3. 界面设计
**主界面**: 对话流式界面（类似聊天软件）
- 左侧：会话列表
- 右侧：对话历史
- 底部：输入区域

**提示界面**: 类似 Claude Code 的选项界面
- 大标题：问题描述
- 代码块：高亮显示
- 编号选项：蓝色高亮推荐选项
- 自定义输入框
- 取消提示

---

## 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         用户层                               │
│  ┌──────────────┐              ┌──────────────┐            │
│  │   Terminal   │              │  GUI (WPF)   │            │
│  │              │              │  + WebView2  │            │
│  └──────┬───────┘              └──────┬───────┘            │
└─────────┼──────────────────────────────┼──────────────────┘
          │                              │
          │ codepanion run -- <cmd>        │ WebSocket
          │                              │
┌─────────┼──────────────────────────────┼──────────────────┐
│         │         Daemon 层             │                  │
│  ┌──────▼───────┐              ┌──────▼───────┐          │
│  │  PTY Runner  │◄────────────►│  Session     │          │
│  │              │              │  Manager     │          │
│  │  [改进]      │              │  [改进]      │          │
│  │  完整输出    │              │  完整历史    │          │
│  │  捕获        │              │  存储        │          │
│  └──────┬───────┘              └──────┬───────┘          │
│         │                             │                   │
│  ┌──────▼───────┐              ┌─────▼────────┐         │
│  │   Prompt     │─────────────►│  Notifier    │         │
│  │   Detector   │              │  [改进]      │         │
│  │              │              │  提示音      │         │
│  └──────────────┘              └──────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### 技术栈

**后端 (Daemon)**
- Node.js 24+ / TypeScript 5.7
- Express 5.1 (HTTP API)
- ws 8.20 (WebSocket)
- node-pty 1.1 (PTY)
- 系统通知适配（Windows PowerShell Toast / macOS osascript / Linux notify-send）

**前端 (GUI)**
- .NET 8.0 / C# 12
- WPF (窗口框架)
- WebView2 (Web 渲染)
- HTML/CSS/JavaScript (对话界面)
- marked.js (Markdown 解析)
- highlight.js (代码高亮)

---

## 阶段 1：优化 Daemon 数据捕获

### 目标
捕获 AI 的**完整输出**，而不是只保留最后几行。

### 当前问题

**`promptDetector.ts` 的问题**:
```typescript
// 当前实现
private buffer = '';

feed(chunk: string) {
  this.buffer = (this.buffer + chunk).slice(-4096);  // ❌ 只保留 4KB
  // ...
}
```

**问题**:
- 滑动窗口只保留 4KB，长输出会被截断
- 检测到提示时只发送最后 6 行
- 无法获取完整的 AI 输出（Plan、代码块等）

### 解决方案

#### 1.1 修改 `sessionManager.ts`

**新增字段**:
```typescript
export interface SessionRecord extends SessionInfo {
  cliPid: number;
  cliSocket?: WebSocket;
  outputBuffer: string;        // 保留
  fullOutput: string[];        // 新增：完整输出历史
  outputChunks: OutputChunk[]; // 新增：结构化输出
}

interface OutputChunk {
  timestamp: number;
  content: string;
  type: 'output' | 'prompt';
}
```

**实现**:
```typescript
appendOutput(id: string, chunk: string) {
  const rec = this.sessions.get(id);
  if (!rec) return;
  
  // 保留滑动窗口（用于提示检测）
  rec.outputBuffer = (rec.outputBuffer + chunk).slice(-8192);
  
  // 保存完整历史
  rec.fullOutput.push(chunk);
  
  // 结构化存储
  rec.outputChunks.push({
    timestamp: Date.now(),
    content: chunk,
    type: 'output'
  });
  
  rec.status = 'running';
  this.broadcast({ type: 'session-output', sessionId: id, chunk });
}
```

#### 1.2 修改 `promptDetector.ts`

**保持检测逻辑不变**，但返回更多信息:
```typescript
export interface PromptMatch {
  lastLines: string;      // 保留：最后几行
  options?: string[];     // 保留：编号选项
  fullContext: string;    // 新增：完整上下文
}
```

#### 1.3 修改 API

**新增端点**: `GET /sessions/:id/output`

返回完整的会话输出:
```typescript
app.get('/sessions/:id/output', (req, res) => {
  const rec = sessions.get(req.params.id);
  if (!rec) {
    res.status(404).json({ error: 'no such session' });
    return;
  }
  
  res.json({
    fullOutput: rec.fullOutput.join(''),
    chunks: rec.outputChunks
  });
});
```

---

## 阶段 2：重构 GUI 为对话流界面

### 目标
将 GUI 从简单的通知窗口改造为对话流界面，类似 CherryStudio。

### 技术方案：WPF + WebView2

#### 2.1 添加 WebView2 依赖

**修改 `CodePanion.Gui.csproj`**:
```xml
<ItemGroup>
  <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2592.51" />
  <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  <PackageReference Include="Websocket.Client" Version="5.1.2" />
  <PackageReference Include="Hardcodet.NotifyIcon.Wpf" Version="1.1.0" />
</ItemGroup>
```

#### 2.2 主窗口布局

**新的 `MainWindow.xaml` 结构**:
```xml
<Grid>
  <Grid.ColumnDefinitions>
    <ColumnDefinition Width="250"/>  <!-- 会话列表 -->
    <ColumnDefinition Width="*"/>    <!-- 对话区域 -->
  </Grid.ColumnDefinitions>
  
  <!-- 左侧：会话列表 -->
  <Border Grid.Column="0" BorderBrush="#E0E0E0" BorderThickness="0,0,1,0">
    <ListView x:Name="SessionListView" />
  </Border>
  
  <!-- 右侧：对话区域 (WebView2) -->
  <Grid Grid.Column="1">
    <wv2:WebView2 x:Name="ChatWebView" />
  </Grid>
</Grid>
```

#### 2.3 WebView2 内容

**创建 `wwwroot/chat.html`**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="chat.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css">
</head>
<body>
  <div id="chat-container"></div>
  <script src="chat.js"></script>
</body>
</html>
```

#### 2.4 C# 与 JavaScript 通信

**C# 端**:
```csharp
// 初始化 WebView2
await ChatWebView.EnsureCoreWebView2Async();
ChatWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

// 发送消息到 JavaScript
public void SendMessageToWeb(object message)
{
    var json = JsonConvert.SerializeObject(message);
    ChatWebView.CoreWebView2.PostWebMessageAsJson(json);
}

// 接收来自 JavaScript 的消息
private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
{
    var json = e.WebMessageAsJson;
    var message = JsonConvert.DeserializeObject<WebMessage>(json);
    HandleWebMessage(message);
}
```

**JavaScript 端**:
```javascript
// 接收来自 C# 的消息
window.chrome.webview.addEventListener('message', (event) => {
  const message = event.data;
  handleMessage(message);
});

// 发送消息到 C#
function sendToHost(message) {
  window.chrome.webview.postMessage(message);
}
```

---

## 阶段 3：实现 Markdown 渲染和选项按钮

### 目标
在 WebView2 中实现美观的对话界面，支持 Markdown 渲染和编号选项按钮。

### 3.1 对话消息格式

**消息类型**:
```typescript
interface ChatMessage {
  id: string;
  sessionId: string;
  timestamp: number;
  type: 'ai-output' | 'prompt' | 'user-reply';
  content: string;
  options?: PromptOption[];
}

interface PromptOption {
  id: number;
  label: string;
  value: string;
  recommended?: boolean;
}
```

### 3.2 Markdown 渲染

**`chat.js` 实现**:
```javascript
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

// 渲染消息
function renderMessage(message) {
  const html = marked.parse(message.content);
  const messageDiv = document.createElement('div');
  messageDiv.className = `message message-${message.type}`;
  messageDiv.innerHTML = html;
  
  if (message.type === 'prompt' && message.options) {
    messageDiv.appendChild(renderOptions(message.options));
  }
  
  return messageDiv;
}
```

### 3.3 选项按钮界面

**类似 Claude Code 的样式**:
```css
.prompt-options {
  margin-top: 16px;
}

.option-button {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin-bottom: 8px;
  border: 1px solid #404040;
  border-radius: 6px;
  background: #2a2a2a;
  color: #e0e0e0;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.option-button:hover {
  background: #353535;
  border-color: #505050;
}

.option-button.recommended {
  background: #0066cc;
  border-color: #0066cc;
  color: white;
}

.option-button.recommended:hover {
  background: #0052a3;
}

.option-number {
  display: inline-block;
  width: 24px;
  font-weight: bold;
}
```

**HTML 结构**:
```javascript
function renderOptions(options) {
  const container = document.createElement('div');
  container.className = 'prompt-options';
  
  options.forEach(option => {
    const button = document.createElement('button');
    button.className = 'option-button';
    if (option.recommended) {
      button.classList.add('recommended');
    }
    
    button.innerHTML = `
      <span class="option-number">${option.id}</span>
      <span class="option-label">${option.label}</span>
    `;
    
    button.onclick = () => selectOption(option);
    container.appendChild(button);
  });
  
  // 自定义输入框
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = 'Tell Claude what to do instead';
  customInput.className = 'custom-input';
  container.appendChild(customInput);
  
  return container;
}
```

---

## 阶段 4：完善通知系统

### 目标
实现提示音、免打扰模式检测、通知持久化。

### 4.1 提示音实现

**修改 `notifier.ts`**:
```typescript
export class Notifier {
  constructor(private cfg: Config) {}

  show(title: string, message: string, opts?: { 
    sound?: boolean;
    level?: 'prompt' | 'done' | 'info' 
  }) {
    if (!this.cfg.toast.enabled) return;
    
    // 检查免打扰模式
    const focusAssistEnabled = this.checkFocusAssist();
    const shouldPlaySound = opts?.sound && !focusAssistEnabled;
    
    notifier.notify(
      {
        title,
        message: message || ' ',
        sound: shouldPlaySound,
        wait: true,  // 持久化到通知中心
        appID: 'CodePanion',
      },
      (err) => {
        if (err) logger.warn({ err }, 'toast failed');
      },
    );
  }
  
  private checkFocusAssist(): boolean {
    // Windows Focus Assist 检测
    if (process.platform !== 'win32') return false;
    
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        'powershell -Command "Get-WinUserLanguageList | Select-Object -First 1"',
        { encoding: 'utf8' }
      );
      // TODO: 实现实际的 Focus Assist 检测逻辑
      return false;
    } catch {
      return false;
    }
  }
}
```

### 4.2 通知配置

**修改 `config.ts`**:
```typescript
const ConfigSchema = z.object({
  // ... 现有配置
  toast: z.object({
    enabled: z.boolean().default(true),
    soundOnPrompt: z.boolean().default(true),
    soundOnDone: z.boolean().default(true),
    respectFocusAssist: z.boolean().default(true),  // 新增
  }).default({
    enabled: true,
    soundOnPrompt: true,
    soundOnDone: true,
    respectFocusAssist: true
  }),
});
```

### 4.3 通知触发时机

**修改 `server.ts`**:
```typescript
// 需要输入时
app.post('/sessions/:id/prompt', (req, res) => {
  // ...
  notifier.show(title, message, { 
    sound: cfg.toast.soundOnPrompt,
    level: 'prompt'
  });
  res.json({ ok: true });
});

// 任务完成时
app.post('/sessions/:id/exit', (req, res) => {
  // ...
  notifier.show(title, message, { 
    sound: cfg.toast.soundOnDone,
    level: 'done'
  });
  res.json({ ok: true });
});
```

---

## 阶段 5：端到端测试和优化

### 测试计划

#### 5.1 单元测试
- [ ] `promptDetector.ts` - 提示检测准确性
- [ ] `sessionManager.ts` - 会话管理和历史存储
- [ ] `notifier.ts` - 通知和提示音

#### 5.2 集成测试
- [ ] Daemon 启动/停止
- [ ] PTY 命令包装
- [ ] WebSocket 通信
- [ ] 完整输出捕获

#### 5.3 端到端测试
- [ ] 运行 `codepanion run -- echo "test"`
- [ ] 运行 `codepanion run -- claude code`
- [ ] 测试长输出（Plan 格式）
- [ ] 测试多会话并发
- [ ] 测试通知和提示音
- [ ] 测试免打扰模式

#### 5.4 性能测试
- [ ] 内存占用（长时间运行）
- [ ] CPU 占用
- [ ] WebSocket 连接稳定性
- [ ] GUI 渲染性能

---

## 实现时间表

### 第 1 周：Daemon 优化
- **Day 1-2**: 修改 `sessionManager.ts`，实现完整输出存储
- **Day 3**: 修改 `promptDetector.ts`，返回完整上下文
- **Day 4**: 添加新的 API 端点
- **Day 5**: 单元测试和集成测试

### 第 2 周：GUI 重构
- **Day 1-2**: 集成 WebView2，创建基础对话界面
- **Day 3**: 实现 C# ↔ JavaScript 通信
- **Day 4**: 实现会话列表和切换
- **Day 5**: 测试和调试

### 第 3 周：Markdown 和选项界面
- **Day 1-2**: 实现 Markdown 渲染（marked.js + highlight.js）
- **Day 3**: 实现选项按钮界面（类似 Claude Code）
- **Day 4**: 样式优化和响应式设计
- **Day 5**: 测试和调试

### 第 4 周：通知系统和测试
- **Day 1**: 实现提示音
- **Day 2**: 实现免打扰模式检测
- **Day 3**: 端到端测试
- **Day 4**: 性能优化
- **Day 5**: Bug 修复和文档更新

---

## 风险和挑战

### 技术风险
1. **WebView2 兼容性**: 需要 Windows 10/11，旧系统不支持
2. **内存占用**: 完整输出存储可能导致内存增长
3. **Markdown 渲染性能**: 大量消息时可能卡顿
4. **Focus Assist 检测**: Windows API 可能不稳定

### 缓解措施
1. **降级方案**: WebView2 不可用时，回退到简单界面
2. **内存管理**: 限制历史消息数量（如最近 100 条）
3. **虚拟滚动**: 只渲染可见区域的消息
4. **配置选项**: 允许用户禁用 Focus Assist 检测

---

## 成功标准

### 功能完整性
- [x] 捕获完整的 AI 输出
- [x] 对话流界面
- [x] Markdown 渲染
- [x] 选项按钮界面
- [x] 提示音和通知
- [x] 免打扰模式

### 性能指标
- 内存占用 < 200MB（正常使用）
- CPU 占用 < 5%（空闲时）
- 通知延迟 < 500ms
- GUI 响应时间 < 100ms

### 用户体验
- 界面美观，类似 Claude Code
- 操作流畅，无卡顿
- 通知及时，不漏过
- 上下文完整，易于理解

---

## 附录

### A. 参考资料
- [WebView2 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)
- [marked.js 文档](https://marked.js.org/)
- [highlight.js 文档](https://highlightjs.org/)
- [Windows Focus Assist API](https://learn.microsoft.com/en-us/windows/uwp/design/shell/tiles-and-notifications/notification-listener)

### B. 相关项目
- [CherryStudio](https://github.com/kangfenmao/cherry-studio) - 对话界面参考
- [Claude Code](https://claude.ai/code) - 选项界面参考
- [VS Code](https://github.com/microsoft/vscode) - WebView 使用参考

---

**文档结束**

下一步：开始实现阶段 1 - 优化 Daemon 数据捕获
