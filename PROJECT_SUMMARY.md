# RemindAI 项目开发总结

## 项目概述

RemindAI 是一个智能开发助手工具，专为使用 AI 编程工具（如 Claude Code、GitHub Copilot CLI）的开发者设计。它能够自动检测命令行工具执行过程中需要用户输入的时刻，发送桌面通知，并提供图形界面让用户快速响应。

## 开发进度

### ✅ 已完成

#### 1. 项目初始化和文档（2026-05-12）

- [x] 项目结构搭建（Monorepo）
- [x] 完整的中文文档体系
  - README.md - 项目概述和快速开始
  - docs/ARCHITECTURE.md - 架构设计文档
  - docs/API.md - API 参考文档
  - docs/USER_GUIDE.md - 用户使用指南
  - docs/DEVELOPMENT.md - 开发者指南
  - CHANGELOG.md - 版本更新日志

#### 2. Daemon 后端（Node.js/TypeScript）

**核心模块：**

- [x] **CLI 工具** (`src/cli/`)
  - `start` - 启动守护进程
  - `stop` - 停止守护进程
  - `status` - 查看状态
  - `run` - 运行命令并监控
  - `notify` - 发送通知
  - `reply` - 发送响应
  - `install` - 安装 Claude Code 集成

- [x] **守护进程** (`src/daemon/`)
  - HTTP REST API (Express 5.1)
  - WebSocket 实时通信 (ws 8.20)
  - 会话管理（多会话并发）
  - 桌面通知（node-notifier 10.0）
  - PID 文件管理

- [x] **PTY 包装** (`src/pty/`)
  - 伪终端管理（node-pty 1.1）
  - 提示检测器（智能识别输入请求）
  - 输入输出捕获

- [x] **配置和日志**
  - JSON 配置文件 + Zod 验证
  - 结构化日志（Pino 10.3）
  - 自动生成 token

#### 3. GUI 图形界面（C# WPF）

- [x] **主窗口** (`MainWindow.xaml`)
  - 活动会话列表（实时更新）
  - 连接状态指示
  - 日志查看器
  - 工具栏和状态栏

- [x] **提示对话框** (`PromptDialog.xaml`)
  - 显示提示信息和上下文
  - 支持选项按钮（编号选项）
  - 自定义文本输入
  - 自动添加换行符

- [x] **设置窗口** (`SettingsWindow.xaml`)
  - 通用设置（启动、通知、主题）
  - 连接设置（端口、token）
  - 关于页面

- [x] **系统托盘**
  - 最小化到托盘
  - 右键菜单
  - 双击显示主窗口

- [x] **WebSocket 客户端** (`Services/DaemonClient.cs`)
  - 连接到 daemon
  - 接收实时事件
  - 发送回复

- [x] **MVVM 架构** (`Models/SessionViewModel.cs`)
  - 数据绑定
  - 属性变更通知
  - 视图模型

## 技术栈

### 后端（Daemon）

| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | 5.7 | 开发语言 |
| Node.js | 18+ | 运行时 |
| Express | 5.1.0 | HTTP 服务器 |
| ws | 8.20.0 | WebSocket |
| node-pty | 1.1.0 | 伪终端 |
| node-notifier | 10.0.1 | 桌面通知 |
| Pino | 10.3.1 | 日志 |
| Zod | 4.4.3 | 验证 |
| Yargs | 18.0.0 | CLI 参数解析 |

### 前端（GUI）

| 技术 | 版本 | 用途 |
|------|------|------|
| .NET | 8.0 | 框架 |
| WPF | - | UI 框架 |
| Websocket.Client | 5.1.2 | WebSocket 客户端 |
| Newtonsoft.Json | 13.0.3 | JSON 序列化 |
| Hardcodet.NotifyIcon.Wpf | 1.1.0 | 系统托盘 |

## 项目结构

```
remindai-monorepo/
├── packages/
│   ├── daemon/                 # Node.js 守护进程和 CLI
│   │   ├── src/
│   │   │   ├── cli/           # CLI 命令
│   │   │   ├── daemon/        # 守护进程核心
│   │   │   ├── pty/           # PTY 管理
│   │   │   ├── shared/        # 共享模块
│   │   │   ├── config.ts      # 配置管理
│   │   │   ├── logger.ts      # 日志系统
│   │   │   └── index.ts       # 入口
│   │   ├── dist/              # 构建输出
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── gui/                   # C# WPF GUI
│       ├── Models/            # 数据模型
│       ├── Services/          # 服务层
│       ├── *.xaml             # 界面文件
│       ├── *.xaml.cs          # 代码后端
│       ├── RemindAI.Gui.csproj
│       └── README.md
├── docs/                      # 文档
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── USER_GUIDE.md
│   └── DEVELOPMENT.md
├── README.md
├── CHANGELOG.md
├── package.json
└── .gitignore
```

## 核心功能实现

### 1. 提示检测算法

**位置**: `packages/daemon/src/pty/promptDetector.ts`

**原理**:
- 使用滑动窗口缓冲区（4KB）
- 空闲超时检测（默认 800ms）
- 正则表达式模式匹配
- 支持 yes/no 问题、编号选项、自定义输入

**检测模式**:
```typescript
- (y/n) - Yes/No 确认
- [Y/n] - 默认 Yes
- [y/N] - 默认 No
- Press ... to continue - 按键继续
- Enter ...: - 自定义输入
- 1. 2. 3. - 编号选项
```

### 2. 会话管理

**位置**: `packages/daemon/src/daemon/sessionManager.ts`

**功能**:
- 多会话并发支持
- 会话状态跟踪（running/waiting/exited）
- WebSocket 连接管理
- 事件广播机制
- 自动清理（60 秒后删除已结束会话）

### 3. WebSocket 通信协议

**服务器 → 客户端事件**:
```typescript
- hello - 连接成功
- session-registered - 新会话注册
- session-prompt - 检测到提示
- session-output - 会话输出
- session-exited - 会话结束
- reply-injected - 回复已注入
```

**客户端 → 服务器事件**:
```typescript
- inject-input - 注入用户输入
```

### 4. GUI 数据流

```
Daemon WebSocket → DaemonClient → MainWindow
                                      ↓
                              SessionViewModel (MVVM)
                                      ↓
                              ListView (数据绑定)
```

**提示处理流程**:
```
1. Daemon 检测到提示
2. 通过 WebSocket 发送 session-prompt 事件
3. DaemonClient 接收并触发 SessionPrompt 事件
4. MainWindow 显示 PromptDialog
5. 用户输入响应
6. DaemonClient 通过 HTTP POST 发送回复
7. Daemon 注入输入到 PTY
8. 命令继续执行
```

## 使用场景

### 场景 1: Claude Code 交互

```bash
# 启动 daemon
remindai start

# 启动 GUI
npm run gui:run

# 使用 remindai 运行 Claude Code
remindai run -- claude code

# 当 Claude 需要确认时：
# 1. 桌面通知弹出
# 2. GUI 显示提示对话框
# 3. 用户点击 Yes/No 或输入文本
# 4. 响应自动发送给 Claude
# 5. Claude 继续执行
```

### 场景 2: Claude Code 集成

```bash
# 安装 Claude Code hooks
remindai install claude-code

# 现在 Claude Code 会自动通知：
# - Stop 事件：回复完成
# - Notification 事件：等待输入
```

## 测试和验证

### 已测试功能

- [x] Daemon 启动/停止
- [x] CLI 命令（start/stop/status/notify）
- [x] 配置文件生成和加载
- [x] 构建成功（TypeScript 编译）

### 待测试功能

- [ ] PTY 包装命令执行
- [ ] 提示检测准确性
- [ ] WebSocket 连接稳定性
- [ ] GUI 与 daemon 通信
- [ ] 多会话并发
- [ ] 系统托盘功能
- [ ] Claude Code 集成

## 已知问题

1. **GUI 图标缺失**: `icon.ico` 文件需要创建
2. **设置保存**: 设置窗口的保存功能未完全实现
3. **错误处理**: 需要添加更多边界情况的错误处理
4. **测试覆盖**: 缺少单元测试和集成测试

## 下一步计划

### 短期（v0.2.0）

- [ ] 创建应用程序图标
- [ ] 完善设置保存功能
- [ ] 添加单元测试
- [ ] 端到端测试
- [ ] 修复已知 bug
- [ ] 性能优化

### 中期（v0.3.0）

- [ ] 添加更多提示检测模式
- [ ] 支持自定义快捷回复模板
- [ ] 会话输出查看器
- [ ] 统计和历史记录
- [ ] 主题系统（浅色/深色）

### 长期（v1.0.0）

- [ ] 插件系统
- [ ] 远程会话支持（SSH）
- [ ] 云同步配置
- [ ] 移动端通知
- [ ] AI 辅助提示识别
- [ ] 多语言支持

## Git 提交历史

```
751f801 feat: 添加 GUI 图形界面（WPF）
61466c1 feat: 初始化 RemindAI 项目
```

## 文件统计

- **总文件数**: 46 个
- **代码行数**: ~8,000 行
- **文档行数**: ~3,000 行
- **提交次数**: 2 次

## 开发时间

- **开始时间**: 2026-05-12
- **当前版本**: v0.1.0
- **开发阶段**: Alpha

## 贡献者

- Claude Opus 4.7 (AI 助手)
- 项目发起人

## 许可证

MIT License

---

**最后更新**: 2026-05-12
**项目状态**: 🟡 开发中
**可用性**: ⚠️ Alpha 版本，仅供测试
