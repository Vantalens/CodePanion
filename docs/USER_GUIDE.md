# CodePanion 用户指南

欢迎使用 CodePanion！本指南将帮助你快速上手并充分利用 CodePanion 的功能。

## 目录

- [什么是 CodePanion？](#什么是-codepanion)
- [安装](#安装)
- [快速开始](#快速开始)
- [使用场景](#使用场景)
- [命令参考](#命令参考)
- [配置](#配置)
- [GUI 界面](#gui-界面)
- [常见问题](#常见问题)
- [故障排除](#故障排除)

---

## 什么是 CodePanion？

CodePanion 是一个本地优先的个人 AI 工作流中控台，专为同时使用多个 AI 编程工具（如 Claude Code、GitHub Copilot CLI、Codex）的开发者设计。

### 核心问题

当多个 AI 任务同时进行时，你是否遇到过这些情况：

- ✅ Claude 需要确认文件修改，但你正在查看文档
- ✅ 长时间运行的构建完成了，但你没注意到
- ✅ 命令行工具需要输入，但你切换到了其他窗口
- ✅ 需要频繁在终端、编辑器和多个 AI 会话之间切换
- ✅ 同时开了多个任务，却没有一个统一界面能看清全局状态

### CodePanion 的解决方案

CodePanion 会：

1. **统一接入**：汇聚本机上的多个 AI 工具和命令会话
2. **自动检测**：识别等待输入、完成和异常状态
3. **及时提醒**：通过桌面通知立即告知你
4. **便捷接管**：在图形界面查看上下文并直接回复
5. **持续监控**：后台守护进程，不影响正常工作

### 产品边界

- CodePanion 不是聊天客户端，而是 AI 工作流控制层
- 当前聚焦个人本地使用，不做多用户协作
- 后续会从“本地控制台”演进到“本地工作流操作台”，而不是企业平台

---

## 安装

### 系统要求

- **操作系统**：Windows 10/11、macOS 10.15+、Linux
- **Node.js**：24.0 或更高版本（普通用户使用便携版时由发布包内置）
- **.NET SDK**：6.0 或更高版本（仅 GUI 需要）

### 安装步骤

#### 1. 克隆或下载项目

```bash
git clone https://github.com/Vantalens/CodePanion.git
cd CodePanion
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 构建项目

```bash
npm run build
```

#### 4. 全局安装 CLI 工具

```bash
cd packages/daemon
npm link
cd ../..
```

#### 5. 验证安装

```bash
codepanion --version
```

应该输出：`0.1.0`

详细安装说明请参考 [INSTALL.md](../INSTALL.md)。

---

## 快速开始

### 第一步：启动守护进程

守护进程是 CodePanion 的核心，负责监控命令执行。

```bash
codepanion start
```

**输出示例**：
```
[codepanion] starting daemon (child pid=12345)...
[codepanion] daemon ready (pid=12345)
```

**验证守护进程状态**：
```bash
codepanion status
```

**输出示例**：
```
[codepanion] daemon running (pid=12345, port=7777)
```

---

### 第二步：启动 GUI 界面（可选）

GUI 界面提供可视化的提示响应功能。

```bash
npm run gui:run
```

GUI 会自动连接到守护进程，并显示实时会话信息。

---

### 第三步：运行你的第一个命令

使用 `codepanion run` 包装你想监控的命令：

```bash
codepanion run -- bash -c 'read -p "请输入你的名字: " name && echo "你好, $name!"'
```

**发生了什么？**

1. CodePanion 启动命令并监控输出
2. 当检测到提示 "请输入你的名字:" 时
3. CodePanion 检测到提示模式
4. 发送桌面通知（如果启用）
5. 在 GUI 中显示提示对话框
6. 你在输入框中输入名字并点击发送
7. 响应自动发送给命令
8. 命令继续执行并显示结果

---

## 使用场景

### 多窗口监控

CodePanion 支持多源事件中心：

- 使用 `codepanion run --` 启动的 CLI 会话会被作为 `cli` 来源监控。
- VS Code 扩展会把每个 VS Code 窗口注册为独立来源。
- 浏览器页面不再作为内置监控对象；需要监控 Web 端时，应通过外部适配器显式上报事件。
- Codex / Claude Code 多窗口优先通过 CLI/PTTY 或 VS Code 终端来源区分。

GUI 会在时间线中显示来源、窗口标题、工作区和事件类型。多个来源同时触发时，回复会按 `sessionId` 写回对应会话。

### 场景 1：使用 Claude Code

Claude Code 经常需要确认文件修改、命令执行等操作。完整接入路径（CLI/PTY、hooks、VS Code 终端、CC Switch 配合）见 [docs/INTEGRATIONS_CLAUDE_CODE.md](INTEGRATIONS_CLAUDE_CODE.md)。

```bash
codepanion run -- claude
```

**示例交互**：

```
Claude: I'll update the authentication logic in auth.ts
        Modify auth.ts? (y/n)
```

CodePanion 会：
- 🔔 发送通知："Claude 需要确认"
- 💬 在 GUI 显示："Modify auth.ts? (y/n)"
- ⌨️ 等待你的响应

---

### 场景 2：长时间构建

监控构建过程，完成时通知你。

```bash
codepanion run -- npm run build
```

构建完成后，你会收到通知，即使你在浏览网页或查看文档。

---

### 场景 3：交互式安装

某些 npm 包安装时需要选择配置。

```bash
codepanion run -- npm install some-package
```

**示例**：
```
? Which framework do you use? (Use arrow keys)
  ❯ React
    Vue
    Angular
```

CodePanion 会捕获这个提示，你可以在 GUI 中选择。

---

### 场景 4：Git 操作

Git 命令有时需要确认。

```bash
codepanion run -- git push --force
```

**示例**：
```
Warning: You're about to force push. Continue? (y/n)
```

CodePanion 确保你不会错过这个重要的确认。

---

### 场景 5：数据库迁移

运行数据库迁移时的确认。

```bash
codepanion run -- npm run migrate
```

**示例**：
```
About to drop table 'users'. Are you sure? (yes/no)
```

---

## 命令参考

### `codepanion start`

启动守护进程。

```bash
codepanion start
```

**输出**：
```
[codepanion] starting daemon (child pid=12345)...
[codepanion] daemon ready (pid=12345)
```

---

### `codepanion stop`

停止守护进程。

```bash
codepanion stop
```

---

### `codepanion restart`

重启守护进程。

```bash
codepanion restart
```

---

### `codepanion status`

查看守护进程状态。

```bash
codepanion status
```

**输出**：
```
[codepanion] daemon running (pid=12345, port=7777)
```

---

### `codepanion run -- <command> [args...]`

使用 CodePanion 运行命令。

**重要**：`--` 分隔符是必需的！

**示例**：
```bash
# 正确 ✓
codepanion run -- bash -c 'read -p "输入: " var && echo $var'
codepanion run -- npm install
codepanion run -- git commit

# 错误 ✗
codepanion run bash -c 'read -p "输入: " var'  # 缺少 --
```

---

### `codepanion template <action> [name]`

管理本地工作流模板。模板保存在 `~/.codepanion/workflow-templates.json`，适合把常用的 Codex / Claude / npm / git 命令沉淀成可重复运行的入口。

**动作**：
- `add`: 新增或覆盖模板
- `list`: 列出模板
- `show`: 查看模板详情
- `run`: 运行模板
- `remove`: 删除模板

**常用选项**：
- `--command <command>`: 模板主命令，`add` 时必需
- `--arg <arg>`: 模板参数，可重复使用
- `--param <name=default>`: 声明 `{name}` 占位参数和默认值，可重复使用
- `--set <name=value>`: 运行时覆盖参数值，可重复使用
- `--dry-run`: 只输出解析后的命令，不实际运行

**示例**：
```bash
codepanion template add review --command codex --arg review --arg "{target}" --param target=.
codepanion template list
codepanion template show review
codepanion template run review --set target=packages/daemon --dry-run
codepanion template remove review
```

---

### `codepanion workflow <action> [name]`

管理、运行、搜索和重放本地多步骤工作流。工作流定义保存在 `~/.codepanion/workflows.json`，执行历史保存在 `~/.codepanion/workflow-runs.json`。

**动作**：
- `add`: 新增或覆盖工作流
- `list`: 列出工作流
- `show`: 查看工作流 JSON
- `run`: 运行工作流
- `remove`: 删除工作流
- `history`: 搜索最近执行历史
- `replay`: 用历史运行的参数重跑

**步骤格式**：

`--step` 使用分号分隔的键值对：

```bash
"id=test;tool=npm;command=npm;args=test;after=build;checkpoint=true"
```

常用字段：
- `id`: 步骤 ID，工作流内唯一
- `tool`: 产出工具标记，例如 `codex`、`claude`、`npm`
- `command`: 要运行的命令
- `args`: 逗号分隔参数，支持 `{param}` 占位
- `template`: 使用已保存的 `codepanion template`
- `set`: 传给模板步骤的参数，例如 `target={target}`
- `after`: 依赖的步骤 ID，多个用逗号分隔
- `checkpoint`: `true` 时需要 `--yes` 才会继续执行

**示例**：
```bash
codepanion workflow add quality --param target=packages/daemon \
  --step "id=build;tool=npm;command=npm;args=run,build" \
  --step "id=test;tool=npm;command=npm;args=test;after=build;checkpoint=true"

codepanion workflow run quality --set target=packages/gui --dry-run --yes
codepanion workflow history --query quality
codepanion workflow replay <runId> --dry-run --yes
```

---

### `codepanion notify <title> [options]`

发送测试通知。

```bash
codepanion notify "测试通知"
```

**选项**：
- `-m, --message <text>`: 通知消息内容
- `-l, --level <level>`: 通知级别（info/prompt/done/error）
- `-s, --source <source>`: 通知来源

**示例**：
```bash
codepanion notify "构建完成" -m "项目已成功构建" -l done
codepanion notify "错误" -m "构建失败" -l error
```

---

### `codepanion reply <sessionId> <text>`

向指定会话发送响应（高级用法）。

```bash
codepanion reply abc123 "yes"
```

**说明**：通常不需要手动使用此命令，GUI 会自动调用。

---

## 配置

### 配置文件位置

CodePanion 的配置文件位于：

- **Windows**: `C:\Users\<用户名>\.codepanion\config.json`
- **macOS/Linux**: `~/.codepanion/config.json`

### 默认配置

首次运行时，CodePanion 会创建默认配置：

```json
{
  "port": 7777,
  "token": "随机生成的32字符token",
  "promptIdleMs": 800,
  "toast": {
    "enabled": true,
    "soundOnPrompt": true,
    "soundOnDone": true
  },
  "templates": [
    {
      "label": "继续",
      "text": "继续\n"
    },
    {
      "label": "全部接受",
      "text": "1\n"
    },
    {
      "label": "取消",
      "text": "no\n"
    }
  ]
}
```

### 配置说明

#### 核心配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 7777 | HTTP/WebSocket 服务端口 |
| `token` | string | 随机生成 | API 认证 token（32字符） |
| `promptIdleMs` | number | 800 | 提示检测空闲时间（毫秒） |

#### toast 通知配置

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 是否启用桌面通知 |
| `soundOnPrompt` | boolean | true | 检测到提示时播放声音 |
| `soundOnDone` | boolean | true | 命令完成时播放声音 |

#### templates 快捷回复模板

快捷回复模板允许你预设常用的响应。

**示例**：
```json
{
  "templates": [
    {
      "label": "是",
      "text": "y\n"
    },
    {
      "label": "否",
      "text": "n\n"
    },
    {
      "label": "继续",
      "text": "\n"
    }
  ]
}
```

### 自定义提示模式

CodePanion 使用智能算法检测命令行提示。如果某些提示未被检测到，你可以调整 `promptIdleMs` 参数。

**示例**：增加检测等待时间

编辑 `~/.codepanion/config.json`：

```json
{
  "promptIdleMs": 1500
}
```

**说明**：
- `promptIdleMs` 是检测提示前等待的空闲时间（毫秒）
- 默认值 800ms 适合大多数情况
- 如果命令输出很快，可以减少到 500ms
- 如果提示检测不准确，可以增加到 1500ms 或更高

重启 daemon 使配置生效：
```bash
codepanion restart
```

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
│  CodePanion - 需要输入                │
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

### Q1: CodePanion 支持哪些命令行工具？

**A**: CodePanion 支持所有命令行工具！它通过检测输出模式来识别提示，不依赖特定工具。

已测试的工具：
- Claude Code
- GitHub Copilot CLI
- npm/yarn/pnpm
- git
- 各种构建工具

---

### Q2: 如何知道 CodePanion 正在监控我的命令？

**A**: 使用 `codepanion run --` 运行的命令会被监控。你可以通过以下方式确认：

1. 运行 `codepanion status` 查看活动会话
2. 查看 GUI 中的会话列表
3. 命令输出会正常显示，CodePanion 在后台工作

---

### Q3: CodePanion 会影响命令执行性能吗？

**A**: 几乎不会。CodePanion 使用高效的流式处理，开销极小（通常 < 1% CPU）。

---

### Q4: 如何添加自定义提示模式？

**A**: 编辑配置文件 `~/.codepanion/config.json`，在 `promptDetection.patterns` 中添加新模式。参见[配置](#配置)章节。

---

### Q5: 可以在没有 GUI 的服务器上使用吗？

**A**: 可以！CodePanion 的核心功能（守护进程、CLI）不依赖 GUI。你可以：

1. 只使用 CLI 命令
2. 通过 API 集成到其他工具
3. 使用桌面通知（无需 GUI）

---

### Q6: CodePanion 安全吗？

**A**: 是的。CodePanion：

- 只监听本地回环地址（127.0.0.1）
- 不收集或上传任何数据
- 不修改命令输出
- 开源，代码可审计

---

### Q7: 如何卸载 CodePanion？

**A**: 

```bash
# 停止守护进程
codepanion stop

# 卸载全局安装
npm uninstall -g codepanion

# 删除配置文件（可选）
rm -rf ~/.codepanion
```

---

## 故障排除

### 问题 1：守护进程无法启动

**症状**：运行 `codepanion start` 后，`codepanion status` 显示未运行。

**解决方案**：

1. 检查端口是否被占用：
   ```bash
   # Windows
   netstat -ano | findstr :7777
   
   # macOS/Linux
   lsof -i :7777
   ```

2. 尝试使用不同端口：
   ```bash
   codepanion start --port 8080
   ```

3. 查看日志：
   ```bash
   cat ~/.codepanion/logs/daemon.log
   ```

---

### 问题 2：GUI 无法连接到守护进程

**症状**：GUI 显示 "无法连接到守护进程"。

**解决方案**：

1. 确认守护进程正在运行：
   ```bash
   codepanion status
   ```

2. 检查防火墙设置（允许本地连接）

3. 重启守护进程：
   ```bash
   codepanion stop
   codepanion start
   ```

---

### 问题 3：提示检测不工作

**症状**：命令需要输入，但 CodePanion 没有检测到。

**解决方案**：

1. 确认使用了 `codepanion run --`：
   ```bash
   codepanion run -- your-command
   ```

2. 检查提示模式是否匹配。查看命令输出，确认提示格式。

3. 添加自定义模式（参见[配置](#配置)）

4. 启用 debug 日志查看详情：
   ```bash
   codepanion stop
   codepanion start --log-level debug
   ```

---

### 问题 4：通知不显示

**症状**：检测到提示，但没有桌面通知。

**解决方案**：

1. 检查系统通知设置（允许 CodePanion 发送通知）

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
   codepanion notify "Test notification"
   ```

---

### 问题 5：命令输出乱码

**症状**：使用 CodePanion 运行命令后，输出显示乱码。

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

1. 查看日志文件：`~/.codepanion/logs/`
2. 提交 Issue：https://github.com/Vantalens/CodePanion/issues
3. 包含以下信息：
   - 操作系统和版本
   - Node.js 版本
   - CodePanion 版本
   - 错误日志
   - 复现步骤

---

## 下一步

- 阅读[架构文档](./ARCHITECTURE.md)了解内部实现
- 查看[API 文档](./API.md)进行集成开发
- 探索[配置选项](#配置)自定义 CodePanion

祝你使用愉快！🎉
