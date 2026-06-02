# CodePanion GUI 界面改进

## 概述

新增了类似 Cursor Codex 的对话式交互界面，提供更人性化的用户体验。

## 文件变更

### 新增文件

1. **`packages/gui/wwwroot/codex.html`**
   - 对话式主界面
   - 左侧：会话列表、项目选择、连接状态
   - 右侧：消息流 + 输入框
   - 布局类似 Cursor Codex / ChatGPT

2. **`packages/gui/wwwroot/codex.css`**
   - 现代化深色主题
   - VS Code 风格配色
   - 响应式布局
   - 流畅的动画过渡

3. **`packages/gui/wwwroot/codex.js`**
   - 主交互逻辑
   - WebView2 ↔ Native 通信
   - 会话管理
   - 消息渲染

4. **`packages/gui/wwwroot/markdown.js`**
   - 简单的 Markdown 渲染器
   - 支持代码块、链接、列表等
   - 外部链接安全处理

### 修改文件

1. **`packages/gui/MainWindow.xaml.cs`**
   - 默认加载 `codex.html`（对话界面）
   - 添加 `reply` 消息类型到白名单
   - 添加 `reply` 消息处理逻辑
   - 保留 `chat.html`（工作流控制台）可通过按钮切换

## 界面特性

### 对话式交互
- ✅ 左右分栏布局
- ✅ 会话列表显示
- ✅ 实时消息流
- ✅ Markdown 渲染
- ✅ 代码高亮支持
- ✅ 响应式设计

### 会话管理
- ✅ 多会话支持
- ✅ 会话状态显示（进行中/等待/已结束）
- ✅ 会话切换
- ✅ 会话计数

### 输入体验
- ✅ 自动调整高度的多行输入框
- ✅ Enter 发送 / Shift+Enter 换行
- ✅ 发送按钮
- ✅ 附件按钮（预留）

### 项目管理
- ✅ 项目选择下拉框
- ✅ 项目管理对话框（复用）
- ✅ 项目激活

### 设置
- ✅ Provider 管理（复用）
- ✅ 模型配置（复用）
- ✅ 设置对话框（复用）

### 工作流控制台
- ✅ 通过顶栏按钮切换到 `chat.html`
- ✅ 保留原有工作流管理功能

## 使用方式

### 启动应用
```bash
# 编译并运行
dotnet build packages/gui
dotnet run --project packages/gui
```

### 界面切换
- **对话界面**（默认）：`codex.html`
- **工作流控制台**：点击顶栏的工作流按钮（方块图标）

### 发送消息
1. 在底部输入框输入消息
2. 按 `Enter` 发送（`Shift+Enter` 换行）
3. 或点击发送按钮（纸飞机图标）

## 技术实现

### 通信协议
- **WebView → Native**: `window.chrome.webview.postMessage()`
- **Native → WebView**: `CoreWebView2.PostWebMessageAsJson()`

### 消息类型
```javascript
// 用户发送消息
{
  type: 'reply',
  sessionId: 'session-id',
  value: 'user message',
  mode: 'text'
}

// 添加消息到对话
{
  type: 'add-message',
  data: {
    sessionId: 'session-id',
    type: 'output', // output / prompt / notification
    content: 'message content',
    timestamp: 1234567890
  }
}

// 连接状态
{
  type: 'connection-status',
  connected: true
}

// 会话注册
{
  type: 'session-registered',
  session: { id, command, workspace, status }
}
```

## 后续优化

### 功能增强
- [ ] 集成更强大的 Markdown 渲染库（如 marked.js）
- [ ] 代码块语法高亮（如 Prism.js / highlight.js）
- [ ] 流式输出支持（打字机效果）
- [ ] 文件附件上传
- [ ] 消息搜索功能
- [ ] 会话导出

### UI/UX 优化
- [ ] 消息编辑/删除
- [ ] 代码块一键复制
- [ ] 主题切换（亮色/暗色）
- [ ] 自定义字体大小
- [ ] 键盘快捷键
- [ ] 拖拽调整侧边栏宽度

### 性能优化
- [ ] 虚拟滚动（长对话）
- [ ] 消息分页加载
- [ ] 会话持久化到本地数据库

## 与原有架构兼容

### 保留的功能
- ✅ Daemon 连接机制
- ✅ 会话管理（SessionManager）
- ✅ 项目管理（G-01）
- ✅ Provider 管理（G-06）
- ✅ 工作流控制台（chat.html）
- ✅ 系统托盘
- ✅ 自动重连

### 架构复用
- ✅ `DaemonClient` 通信
- ✅ `projects.js` 项目管理逻辑
- ✅ `settings.js` 设置管理逻辑
- ✅ WebView2 虚拟主机映射
- ✅ 外部链接安全拦截

## 设计理念

### 对话式 vs 工作流控制台

| 特性 | 对话界面（codex.html） | 工作流控制台（chat.html） |
|------|---------------------|----------------------|
| **用途** | 日常 AI 对话交互 | Workflow 管理和监控 |
| **布局** | 左右分栏（会话+消息） | 三栏（列表+时间线+详情） |
| **交互** | 输入框 + 实时对话 | 启动/审批/查看运行 |
| **目标用户** | 开发者日常使用 | Workflow 执行管理 |

### 为什么需要两个界面？

1. **职责分离**：对话交互 ≠ 工作流管理
2. **降低认知负担**：简单任务用对话，复杂编排用工作流
3. **用户体验**：对话界面类似 ChatGPT，学习成本低

## 总结

这次更新为 CodePanion 添加了更人性化的对话式界面，同时保留了原有的工作流控制台功能。两个界面可以无缝切换，满足不同场景的使用需求。

**核心改进**：
- ✅ 类似 Cursor Codex 的对话体验
- ✅ 现代化 UI 设计
- ✅ 与现有架构完全兼容
- ✅ 低成本切换（一个按钮）

**下一步**：
- 增强 Markdown 渲染
- 添加流式输出
- 优化长对话性能
