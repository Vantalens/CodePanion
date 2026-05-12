# RemindAI 用户指南

欢迎使用 RemindAI！本指南将帮助你快速上手并充分利用 RemindAI 的功能。

## 目录

- [什么是 RemindAI？](#什么是-remindai)
- [安装](#安装)
- [快速开始](#快速开始)
- [使用场景](#使用场景)
- [命令参考](#命令参考)
- [配置](#配置)
- [GUI 界面](#gui-界面)
- [常见问题](#常见问题)
- [故障排除](#故障排除)

---

## 什么是 RemindAI？

RemindAI 是一个智能开发助手工具，专为使用 AI 编程工具（如 Claude Code、GitHub Copilot CLI）的开发者设计。

### 核心问题

在使用 AI 编程工具时，你是否遇到过这些情况：

- ✅ Claude 需要确认文件修改，但你正在查看文档
- ✅ 长时间运行的构建完成了，但你没注意到
- ✅ 命令行工具需要输入，但你切换到了其他窗口
- ✅ 需要频繁在终端和编辑器之间切换

### RemindAI 的解决方案

RemindAI 会：

1. **自动检测**：监控命令行工具的输出，识别需要输入的时刻
2. **及时提醒**：通过桌面通知立即告知你
3. **便捷响应**：在图形界面中输入，无需切换到终端
4. **持续监控**：后台守护进程，不影响正常工作

---

## 安装

### 系统要求

- **操作系统**：Windows 10/11、macOS 10.15+、Linux
- **Node.js**：18.0 或更高版本
- **.NET SDK**：6.0 或更高版本（仅 GUI 需要）

### 安装步骤

#### 1. 克隆或下载项目

```bash
git clone https://github.com/Vantalens/RemindAI.git
cd RemindAI
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 构建项目

```bash
npm run build
```

#### 4. 全局安装（可选）

```bash
npm install -g packages/daemon
```

或者使用 npm link：

```bash
cd packages/daemon
npm link
```

#### 5. 验证安装

```bash
remindai --version
```

应该输出：`remindai version 0.1.0`

---

## 快速开始

### 第一步：启动守护进程

守护进程是 RemindAI 的核心，负责监控命令执行。

```bash
remindai start
```

**输出示例**：
```
✓ RemindAI daemon started successfully
  PID: 12345
  Port: 3721
```

**验证守护进程状态**：
```bash
remindai status
```

**输出示例**：
```
✓ RemindAI daemon is running
  PID: 12345
  Uptime: 5 minutes
  Active sessions: 0
```

---

### 第二步：启动 GUI 界面（可选）

GUI 界面提供可视化的提示响应功能。

```bash
npm run gui:run
```

GUI 会自动连接到守护进程，并在系统托盘显示图标。

---

### 第三步：运行你的第一个命令

使用 `remindai run` 包装你想监控的命令：

```bash
remindai run -- claude code
```

**发生了什么？**

1. RemindAI 启动 Claude Code
2. 当 Claude 需要确认时（如 "Modify file.ts? (y/n)"）
3. RemindAI 检测到提示
4. 发送桌面通知
5. 在 GUI 中显示对话框
6. 你点击 "Yes" 或 "No"
7. 响应自动发送给 Claude
8. Claude 继续执行

---

## 使用场景

### 场景 1：使用 Claude Code

Claude Code 经常需要确认文件修改、命令执行等操作。

```bash
remindai run -- claude code
```

**示例交互**：

```
Claude: I'll update the authentication logic in auth.ts
        Modify auth.ts? (y/n)
```

RemindAI 会：
- 🔔 发送通知："Claude 需要确认"
- 💬 在 GUI 显示："Modify auth.ts? (y/n)"
- ⌨️ 等待你的响应

---

### 场景 2：长时间构建

监控构建过程，完成时通知你。

```bash
remindai run -- npm run build
```

构建完成后，你会收到通知，即使你在浏览网页或查看文档。

---

### 场景 3：交互式安装

某些 npm 包安装时需要选择配置。

```bash
remindai run -- npm install some-package
```

**示例**：
```
? Which framework do you use? (Use arrow keys)
  ❯ React
    Vue
    Angular
```

RemindAI 会捕获这个提示，你可以在 GUI 中选择。

---

### 场景 4：Git 操作

Git 命令有时需要确认。

```bash
remindai run -- git push --force
```

**示例**：
```
Warning: You're about to force push. Continue? (y/n)
```

RemindAI 确保你不会错过这个重要的确认。

---

### 场景 5：数据库迁移

运行数据库迁移时的确认。

```bash
remindai run -- npm run migrate
```

**示例**：
```
About to drop table 'users'. Are you sure? (yes/no)
```

---

## 命令参考

### `remindai start`

启动守护进程。

**选项**：
- `--port <port>`: 指定端口（默认：3721）
- `--log-level <level>`: 日志级别（debug/info/warn/error）

**示例**：
```bash
remindai start --port 8080 --log-level debug
```

---

### `remindai stop`

停止守护进程。

```bash
remindai stop
```

---

### `remindai status`

查看守护进程状态。

```bash
remindai status
```

**输出**：
```
✓ RemindAI daemon is running
  PID: 12345
  Uptime: 1 hour 23 minutes
  Active sessions: 2
  Port: 3721
```

---

### `remindai run -- <command> [args...]`

使用 RemindAI 运行命令。

**重要**：`--` 分隔符是必需的！

**示例**：
```bash
# 正确 ✓
remindai run -- claude code
remindai run -- npm install
remindai run -- git commit -m "message"

# 错误 ✗
remindai run claude code  # 缺少 --
```

---

### `remindai notify <message>`

发送测试通知。

```bash
remindai notify "Hello from RemindAI!"
```

**选项**：
- `--title <title>`: 通知标题
- `--type <type>`: 通知类型（info/warning/error）

**示例**：
```bash
remindai notify "Build completed" --title "CI/CD" --type info
```

---

### `remindai reply <sessionId> <input>`

向指定会话发送响应（高级用法）。

```bash
remindai reply abc123 "y"
```

---

### `remindai install`

安装 RemindAI 为系统服务（自动启动）。

```bash
remindai install
```

**支持的系统**：
- Windows: 使用 NSSM
- macOS: 使用 launchd
- Linux: 使用 systemd

---

## 配置

### 配置文件位置

RemindAI 的配置文件位于：

- **Windows**: `C:\Users\<用户名>\.remindai\config.json`
- **macOS/Linux**: `~/.remindai/config.json`

### 默认配置

首次运行时，RemindAI 会创建默认配置：

```json
{
  "daemon": {
    "port": 3721,
    "host": "127.0.0.1",
    "logLevel": "info"
  },
  "notification": {
    "enabled": true,
    "sound": true,
    "timeout": 10
  },
  "promptDetection": {
    "patterns": [
      {
        "name": "yesno-parens",
        "regex": "\\(y/n\\)",
        "type": "yesno"
      },
      {
        "name": "yesno-brackets-yes",
        "regex": "\\[Y/n\\]",
        "type": "yesno"
      },
      {
        "name": "yesno-brackets-no",
        "regex": "\\[y/N\\]",
        "type": "yesno"
      },
      {
        "name": "press-enter",
        "regex": "Press .* to continue",
        "type": "confirm"
      },
      {
        "name": "enter-input",
        "regex": "Enter .*:",
        "type": "input"
      }
    ],
    "bufferSize": 4096,
    "timeout": 300
  },
  "gui": {
    "autoLaunch": false,
    "theme": "system"
  }
}
```

### 配置说明

#### daemon 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 3721 | 守护进程监听端口 |
| `host` | string | "127.0.0.1" | 监听地址（不要改为 0.0.0.0） |
| `logLevel` | string | "info" | 日志级别 |

#### notification 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 是否启用通知 |
| `sound` | boolean | true | 是否播放通知声音 |
| `timeout` | number | 10 | 通知显示时长（秒） |

#### promptDetection 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `patterns` | array | 见上 | 提示检测模式列表 |
| `bufferSize` | number | 4096 | 输出缓冲区大小（字节） |
| `timeout` | number | 300 | 等待输入超时（秒） |

#### gui 配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoLaunch` | boolean | false | 是否随系统启动 |
| `theme` | string | "system" | 主题（light/dark/system） |

### 自定义提示模式

你可以添加自定义的提示检测模式。

**示例**：添加检测 "Continue?" 的模式

编辑 `~/.remindai/config.json`：

```json
{
  "promptDetection": {
    "patterns": [
      // ... 现有模式 ...
      {
        "name": "custom-continue",
        "regex": "Continue\\?",
        "type": "yesno"
      }
    ]
  }
}
```

**模式类型**：
- `yesno`: 是/否问题（响应 "y" 或 "n"）
- `confirm`: 确认（响应 Enter 键）
- `input`: 自定义输入（响应任意文本）

---

## GUI 界面

### 启动 GUI

```bash
npm run gui:run
```

### GUI 功能

#### 1. 系统托盘图标

GUI 启动后会在系统托盘显示图标。

**右键菜单**：
- 显示/隐藏主窗口
- 查看活动会话
- 设置
- 退出

#### 2. 主窗口

显示所有活动会话和历史记录。

**会话列表**：
- 命令名称
- 运行状态
- 开始时间
- 当前提示（如果有）

#### 3. 提示对话框

当检测到提示时，自动弹出对话框。

**对话框内容**：
- 提示文本
- 上下文信息（前面的输出）
- 响应按钮（Yes/No 或输入框）

**示例**：

```
┌─────────────────────────────────────┐
│  RemindAI - 需要输入                │
├─────────────────────────────────────┤
│  会话: claude code                  │
│  命令: claude code                  │
│                                     │
│  提示:                              │
│  Modify auth.ts? (y/n)             │
│                                     │
│  上下文:                            │
│  I'll update the authentication    │
│  logic to use JWT tokens instead   │
│  of sessions.                       │
│                                     │
│  [ Yes ]  [ No ]  [ 自定义输入 ]   │
└─────────────────────────────────────┘
```

#### 4. 设置界面

**通用设置**：
- 主题选择（浅色/深色/跟随系统）
- 语言选择
- 随系统启动

**通知设置**：
- 启用/禁用通知
- 通知声音
- 通知显示时长

**高级设置**：
- 守护进程端口
- 日志级别
- 自定义提示模式

---

## 常见问题

### Q1: RemindAI 支持哪些命令行工具？

**A**: RemindAI 支持所有命令行工具！它通过检测输出模式来识别提示，不依赖特定工具。

已测试的工具：
- Claude Code
- GitHub Copilot CLI
- npm/yarn/pnpm
- git
- 各种构建工具

---

### Q2: 如何知道 RemindAI 正在监控我的命令？

**A**: 使用 `remindai run --` 运行的命令会被监控。你可以通过以下方式确认：

1. 运行 `remindai status` 查看活动会话
2. 查看 GUI 中的会话列表
3. 命令输出会正常显示，RemindAI 在后台工作

---

### Q3: RemindAI 会影响命令执行性能吗？

**A**: 几乎不会。RemindAI 使用高效的流式处理，开销极小（通常 < 1% CPU）。

---

### Q4: 如何添加自定义提示模式？

**A**: 编辑配置文件 `~/.remindai/config.json`，在 `promptDetection.patterns` 中添加新模式。参见[配置](#配置)章节。

---

### Q5: 可以在没有 GUI 的服务器上使用吗？

**A**: 可以！RemindAI 的核心功能（守护进程、CLI）不依赖 GUI。你可以：

1. 只使用 CLI 命令
2. 通过 API 集成到其他工具
3. 使用桌面通知（无需 GUI）

---

### Q6: RemindAI 安全吗？

**A**: 是的。RemindAI：

- 只监听本地回环地址（127.0.0.1）
- 不收集或上传任何数据
- 不修改命令输出
- 开源，代码可审计

---

### Q7: 如何卸载 RemindAI？

**A**: 

```bash
# 停止守护进程
remindai stop

# 卸载全局安装
npm uninstall -g remindai

# 删除配置文件（可选）
rm -rf ~/.remindai
```

---

## 故障排除

### 问题 1：守护进程无法启动

**症状**：运行 `remindai start` 后，`remindai status` 显示未运行。

**解决方案**：

1. 检查端口是否被占用：
   ```bash
   # Windows
   netstat -ano | findstr :3721
   
   # macOS/Linux
   lsof -i :3721
   ```

2. 尝试使用不同端口：
   ```bash
   remindai start --port 8080
   ```

3. 查看日志：
   ```bash
   cat ~/.remindai/logs/daemon.log
   ```

---

### 问题 2：GUI 无法连接到守护进程

**症状**：GUI 显示 "无法连接到守护进程"。

**解决方案**：

1. 确认守护进程正在运行：
   ```bash
   remindai status
   ```

2. 检查防火墙设置（允许本地连接）

3. 重启守护进程：
   ```bash
   remindai stop
   remindai start
   ```

---

### 问题 3：提示检测不工作

**症状**：命令需要输入，但 RemindAI 没有检测到。

**解决方案**：

1. 确认使用了 `remindai run --`：
   ```bash
   remindai run -- your-command
   ```

2. 检查提示模式是否匹配。查看命令输出，确认提示格式。

3. 添加自定义模式（参见[配置](#配置)）

4. 启用 debug 日志查看详情：
   ```bash
   remindai stop
   remindai start --log-level debug
   ```

---

### 问题 4：通知不显示

**症状**：检测到提示，但没有桌面通知。

**解决方案**：

1. 检查系统通知设置（允许 RemindAI 发送通知）

2. 检查配置文件：
   ```json
   {
     "notification": {
       "enabled": true
     }
   }
   ```

3. 测试通知：
   ```bash
   remindai notify "Test notification"
   ```

---

### 问题 5：命令输出乱码

**症状**：使用 RemindAI 运行命令后，输出显示乱码。

**解决方案**：

这通常是终端编码问题。确保：

1. 终端使用 UTF-8 编码
2. 设置环境变量：
   ```bash
   export LANG=en_US.UTF-8
   export LC_ALL=en_US.UTF-8
   ```

---

### 获取帮助

如果以上方法都无法解决问题：

1. 查看日志文件：`~/.remindai/logs/`
2. 提交 Issue：https://github.com/yourusername/remindai/issues
3. 包含以下信息：
   - 操作系统和版本
   - Node.js 版本
   - RemindAI 版本
   - 错误日志
   - 复现步骤

---

## 下一步

- 阅读[架构文档](./ARCHITECTURE.md)了解内部实现
- 查看[API 文档](./API.md)进行集成开发
- 探索[配置选项](#配置)自定义 RemindAI

祝你使用愉快！🎉
