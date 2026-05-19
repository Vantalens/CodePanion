# CodePanion

CodePanion 是一个本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面，面向开发者在本机同时使用多个 AI 编程工具的真实场景。它不替代 Codex、Claude Code、VS Code、Trae、CodeBuddy、通义灵码 / Qoder、CodeGeeX、百度 Comate 等工具本身，而是作为上层控制台，把分散在终端、IDE、独立 AI 编辑器和本地适配器中的会话、状态、等待输入、结果与上下文统一收束到一个图形工作台中。

当前产品不推倒重做。阶段 1 保留 Windows Alpha 形态：用户双击 `CodePanion.Gui.exe` 即可打开，自动启动本地 daemon，看到所有活跃 AI 任务、等待输入任务、完成/失败状态，并能在支持的场景中直接回复或接管任务。阶段 2 才在稳定个人控制台基础上演进为本地 AI 工作流操作台，支持模板、编排、历史和回放。

## 🎯 核心功能

- **多源工作流汇聚**：统一接收 CLI/PTTY、Codex Desktop、本地 AI 工具扫描、VS Code 扩展和外部适配器事件
- **任务状态总览**：集中查看运行中、等待输入、已完成和异常任务
- **智能提示检测**：自动识别命令行工具执行过程中的输入请求（yes/no 确认、自定义输入等）
- **单入口多出口**：在 GUI 中查看上下文、直接回复、接管任务、回到原始工具或打开对应工作区
- **国产工具分层覆盖**：优先推进通义灵码 / Qoder、CodeBuddy、Trae、百度 Comate、CodeGeeX；MarsCode、CodeArts 等放入下一梯队验证
- **本地优先**：核心数据保留在本机，后台守护进程低资源运行
- **能力边界透明**：不读取账号、token、cookie、插件私有数据库或全局屏幕内容
- **实时通信**：基于 WebSocket 的实时双向通信

## 🧭 产品保留决策

CodePanion 现有产品是后续控制平面路线的基础，而不是需要废弃的旧版本：

- **保留产品形态**：继续以 Windows Alpha 和 `CodePanion.Gui.exe` 双击运行作为当前普通用户入口。
- **保留技术栈**：Alpha 阶段继续使用 Node daemon、HTTP/WebSocket、WPF/WebView2 GUI，不立即迁移 Tauri 或 Avalonia。
- **保留核心能力**：CLI/PTTY 包装、提示检测、直接回复、系统通知、GUI 时间线、Codex Desktop 本地同步、VS Code 来源注册、外部适配器 API、本地 AI 工具进程识别。
- **策略升级**：从“提醒 + 多源监控工具”收束为本地 AI 开发工作流控制平面，优先解决“谁在运行、谁在等我、谁失败、我能在哪里直接回复”。

## 👥 目标用户

- **重度个人开发者**：同时使用 Claude Code、Codex、VS Code/Copilot、Trae、CodeBuddy 或多个终端任务。
- **AI-native 独立开发者 / 学生**：在多模型、多工具之间切换，希望保留本地上下文、历史和任务归属。
- **企业研发骨干**：关注私有码仓、内网环境、工具中立、任务留痕和后续审计治理，但当前阶段仍以个人本地控制台闭环为先。

## 📦 项目结构

```
CodePanion/
├── packages/
│   ├── daemon/          # Node.js 守护进程和 CLI 工具
│   │   ├── src/
│   │   │   ├── cli/     # 命令行接口
│   │   │   ├── daemon/  # 守护进程核心
│   │   │   ├── pty/     # 伪终端管理
│   │   │   └── shared/  # 共享模块
│   │   └── package.json
│   └── gui/             # C# .NET 图形界面
│       └── CodePanion.Gui.csproj
└── package.json
```

## 🚀 快速开始

### 普通用户使用

下载或生成 Windows 便携版后，打开发布目录并双击：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

GUI 会自动启动本地 daemon。普通使用不需要手动输入 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

### 开发者构建

前置要求：

- Node.js >= 18
- .NET SDK >= 8.0
- Windows 10/11

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/codepanion.git
cd codepanion

# 2. 安装依赖
npm install

# 3. 构建 daemon
npm run build

# 4. 构建 Windows 便携版
npm run package:windows

# 5. 双击发布目录中的 EXE
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

### 首次使用

```bash
# 测试通知功能（开发者 CLI 路径）
codepanion notify "测试通知" -m "CodePanion 已就绪！"
```

### 使用方法

#### 1. 启动守护进程

```bash
# 启动后台守护进程
codepanion start

# 查看守护进程状态
codepanion status

# 停止守护进程
codepanion stop

# 重启守护进程
codepanion restart
```

#### 2. 启动 GUI 界面

```bash
# 普通用户路径：双击便携版 EXE
dist/CodePanion-win-x64/CodePanion.Gui.exe

# 开发者路径：从源码启动
npm run gui:run
```

#### 3. 使用 CodePanion 包装命令

```bash
# 使用 CodePanion 运行需要监控的命令
codepanion run -- claude code

# 或者运行其他需要交互的命令
codepanion run -- npm install
codepanion run -- git commit
codepanion run -- python script.py
```

#### 4. 发送通知

```bash
# 发送简单通知
codepanion notify "任务完成"

# 发送带消息的通知
codepanion notify "构建完成" -m "项目已成功构建"

# 指定通知级别
codepanion notify "错误" -m "构建失败" -l error
```

## 💡 使用场景

### 场景 1：统一接管多个 AI 编程任务

在使用 Claude Code、GitHub Copilot CLI 等工具时，经常需要确认操作：

```bash
codepanion run -- claude code
```

当 Claude 需要确认文件修改、执行命令等操作时，CodePanion 会：
1. 检测到提示信息
2. 发送桌面通知
3. 在 GUI 中显示提示内容
4. 等待你的响应（yes/no 或自定义输入）
5. 将响应发送回命令行工具

### 场景 2：长时间运行的命令

```bash
codepanion run -- npm run build
```

构建完成或需要输入时，立即收到通知，无需一直盯着终端。

### 场景 3：批量操作确认

```bash
codepanion run -- git push --force
```

在执行危险操作前，通过 GUI 界面仔细确认。

### 场景 4：多窗口 AI 工作流总览

VS Code 扩展和 CLI 会话会分别注册为监控源。多个 VS Code 窗口、多个 Codex/Claude Code 终端同时工作时，CodePanion 会在 GUI 中按来源显示事件，帮助你从一个界面掌握本机 AI 工作流全局状态。

## 🧭 产品路线

### 阶段 1：Windows Alpha 个人本地控制台

- 围绕 Claude Code、Codex、VS Code/Copilot、CLI/PTTY、Codex Desktop 形成最小可用闭环
- 汇总任务状态、提醒和等待输入
- 提供上下文查看与统一回复
- 目标：让一个人能够稳定掌控多个并行 AI 任务

### 阶段 2：本地 AI 工作流操作台

- 在统一监控基础上增加工作流模板
- 支持多步骤任务编排和跨工具协作
- 归档任务结果，复用常见流程
- 目标：让一个人不只“看住 AI”，还能更系统地组织 AI 完成复杂工作

### 明确边界

- 不做团队版或多用户协作
- 不把 CodePanion 做成完整 AI IDE 或模型聊天客户端
- 不默认 OCR 或读取全局屏幕内容
- 不读取 token、cookie、私有插件数据库或上游工具私有 API
- 不做 token 二次分销，不把 CodePanion 变成模型平台
- Pro / Enterprise 的本地审计、治理和规则能力放入中后期路线，不用企业平台复杂度换取当前阶段的可用性

## 🔧 CLI 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `codepanion start` | 启动守护进程 | `codepanion start` |
| `codepanion stop` | 停止守护进程 | `codepanion stop` |
| `codepanion restart` | 重启守护进程 | `codepanion restart` |
| `codepanion status` | 查看守护进程状态 | `codepanion status` |
| `codepanion run -- <command>` | 使用 CodePanion 运行命令 | `codepanion run -- npm test` |
| `codepanion notify <title>` | 发送通知 | `codepanion notify "完成" -m "任务已完成"` |
| `codepanion sessions` | 查看活动会话 | `codepanion sessions` |
| `codepanion reply <sessionId> <input>` | 向会话发送响应 | `codepanion reply abc123 "yes"` |
| `codepanion --version` | 查看版本 | `codepanion --version` |
| `codepanion --help` | 查看帮助 | `codepanion --help` |

## 🔌 多源监控

- CLI/PTTY：使用 `codepanion run -- <command>`。
- Codex Desktop：只读同步 `~\.codex\sessions\**\*.jsonl`，镜像所有 Codex 线程的消息、工具调用、输出和代码块。
- VS Code：加载 `packages/vscode-extension/` 扩展，每个 VS Code 窗口独立上报。
- 外部工具：调用 `POST /sources/register` 和 `POST /events`。

详细说明见 [docs/MONITORING_SOURCES.md](docs/MONITORING_SOURCES.md)。

### 常见问题

**Q: 提示 `codepanion` 命令未找到？**

A: 需要先执行 `npm link` 来全局安装 CLI：
```bash
cd packages/daemon
npm link
```

**Q: daemon 启动失败？**

A: 检查端口是否被占用，或查看日志：
```bash
codepanion status
# 查看配置文件：~/.codepanion/config.json
```

**Q: GUI 无法连接到 daemon？**

A: 确保 daemon 正在运行，并检查配置文件中的端口设置是否一致。

## 🏗️ 架构设计

### 核心组件

1. **PTY Runner**
   - 使用伪终端（PTY）包装命令执行
   - 捕获所有输入输出
   - 检测提示模式（prompt detection）

2. **Prompt Detector**
   - 识别常见的输入提示模式
   - 支持 yes/no 问题
   - 支持自定义输入请求
   - 可扩展的模式匹配

3. **Daemon Server**
   - HTTP + WebSocket 服务器
   - 管理多个命令会话
   - 路由通知和响应

4. **Notifier**
   - 跨平台桌面通知
   - 支持 Windows、macOS、Linux

5. **GUI Client**
   - .NET WPF + WebView2 界面
   - 实时显示提示信息
   - 输入响应界面

### 通信流程

```
命令执行 → PTY → Prompt Detector → Daemon Server → WebSocket → GUI
                                                              ↓
                                                          用户输入
                                                              ↓
命令继续 ← PTY ← Session Manager ← Daemon Server ← WebSocket ← GUI
```

## 📝 配置

配置文件位置：`~/.codepanion/config.json`

```json
{
  "port": 7777,
  "token": "generated-token",
  "promptIdleMs": 800,
  "toast": {
    "enabled": true,
    "soundOnPrompt": true,
    "soundOnDone": true
  },
  "monitors": {
    "cli": true,
    "vscode": true
  }
}
```

## 🔍 提示检测模式

CodePanion 可以识别以下常见提示模式：

- `(y/n)` - 是/否确认
- `[Y/n]` - 默认为 Yes 的确认
- `[y/N]` - 默认为 No 的确认
- `Press Enter to continue` - 按键继续
- `Enter your choice:` - 自定义输入
- 自定义正则表达式模式

## 🛠️ 开发

### 开发环境设置

```bash
# 安装依赖
npm install

# 开发模式运行 daemon
npm run dev:daemon

# 构建
npm run build

# 构建 GUI
npm run gui:build
```

### 项目技术栈

- **Daemon**: TypeScript, Node.js, Express, WebSocket, node-pty
- **GUI**: C#, .NET, WPF
- **通信**: WebSocket, HTTP REST API
- **日志**: Pino

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请提交 Issue。
