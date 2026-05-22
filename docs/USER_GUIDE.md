# CodePanion 用户指南

本指南面向 Windows Alpha 用户和本地开发者，说明如何用 CodePanion 管住本机上的多个 AI 编程任务。

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

CodePanion 是一个本地优先、供应商中立的 AI 编程工作流中控台，专为同时使用多个 AI 编程工具（如 Claude Code、GitHub Copilot CLI、Codex、Trae、CodeBuddy）的开发者设计。

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
- CodePanion 不是通用个人 Agent、完整 AI IDE、通用启动器或系统进程监控器
- CodePanion 只在公开 API、CLI/PTTY、只读同步、扩展和显式适配器范围内接入工具
- 当前聚焦个人本地使用，不做多用户协作
- 后续会从“本地控制台”演进到“本地工作流操作台”，而不是企业平台

---

## 安装

### 系统要求

- **操作系统**：Windows 10/11 64-bit
- **Node.js**：24.0 或更高版本（普通用户使用 Windows 便携版时由发布包内置）
- **.NET SDK**：8.0 或更高版本（仅源码构建 GUI 需要）
- **WebView2 Runtime**：Windows 11 通常已内置，Windows 10 可安装 Evergreen Runtime

### 安装步骤

普通用户推荐直接使用 Windows 便携版：生成或下载 `dist/CodePanion-win-x64/` 后双击 `CodePanion.Gui.exe`。下面的源码安装步骤主要面向开发者。

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

### 第二步：启动 GUI 界面

普通用户双击 Windows 便携版中的 `CodePanion.Gui.exe`。开发者从源码启动时使用：

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
- `import`: 从 JSON 文件批量导入（适合复用 `packages/daemon/examples/workflows/` 中的预置模板或团队约定）
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

# 从仓库内置示例批量导入（包含 codex-then-claude-review 与 build-test-audit）
codepanion workflow import --file packages/daemon/examples/workflows/build-test-audit.json
codepanion workflow import --file packages/daemon/examples/workflows/codex-then-claude-review.json
```

**与 GUI 的衔接**：

`workflow run` / `replay` 在 daemon 在线时会注册一个临时来源（`kind=cli`、name=`workflow:<name>`），并把每个步骤的启动 / 完成 / 失败 / checkpoint 作为 `monitor-event` 推送给 GUI 的来源活动流；运行结束自动断开。daemon 离线时退回纯 CLI 行为，不影响实际执行。

**预置示例**：

[`packages/daemon/examples/workflows/`](../packages/daemon/examples/workflows/) 提供两个开箱可用模板：

- `codex-then-claude-review`：Codex 起草 → 人工检查点 → Claude Code 复审，演示跨工具串接
- `build-test-audit`：build → test → audit 导出，演示本地交付前的最短闭环

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

### `codepanion audit <action>`

把 daemon 内存中的事件、回复、会话和工作流条目一次性导出到本地，便于排错、合规归档或离线分析。**不联网，文件权限 0o600。**

**动作**：
- `export`: 导出当前活跃窗口里的审计快照

**常用选项**：
- `-o, --output <path>`: 写入文件路径，省略或 `-` 输出到 stdout
- `--format <json|jsonl>`: 默认 `json`，`jsonl` 适合 `jq` 流式处理
- `--since <iso|ms>`: 仅导出该时刻之后的数据，支持 ISO 8601 或 epoch ms
- `--redact`: 对事件文本、回复、家目录路径做最小脱敏

**示例**：
```bash
codepanion audit export -o C:\Users\me\.codepanion\audit.json
codepanion audit export --since "2026-05-22T08:00:00+08:00" --format jsonl -o today.jsonl
codepanion audit export --redact -o audit-redacted.json
```

详细字段定义、保留窗口、脱敏规则见 [docs/LOCAL_AUDIT.md](LOCAL_AUDIT.md)。

---

## 配置

### 配置文件位置

CodePanion 当前 Windows Alpha 的配置文件位于：

- **Windows**: `C:\Users\<用户名>\.codepanion\config.json`

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
# 普通用户：双击便携版 EXE
dist/CodePanion-win-x64/CodePanion.Gui.exe

# 开发者：从源码启动
npm run gui:run
```

GUI 启动后会自动检测本机 daemon，未启动则后台拉起。

### 主任务队列：六档状态

CodePanion GUI 的左侧任务列表对所有来源的任务统一显示六档状态，从上到下按优先级排序：

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| 等待我 | 任务正在等你输入 | CLI prompt、Codex Desktop 等待回复、外部 prompt 事件 |
| 失败 | 任务失败，需要排查 | 非零退出码、`type=error` 事件 |
| 需审阅 | 任务产出待审 | 等待手工 checkpoint |
| 运行中 | 任务正在执行 | activity / 执行中 status |
| 来源在线 | 弱接入来源在线但没有真实任务 | CC Switch / 进程识别等 L1/L2 |
| 完成 | 任务以正常方式结束 | 退出码 0 / done 状态 |

新事件不会抢走你当前选中的任务，主内容区也不会因为输出刷新而弹跳。

### 主视图：助手内容与执行记录分区

每个任务详情里：

- **主区**显示助手消息、用户输入、等待输入提示、关键文件变更与错误摘要。
- **执行记录**（默认折叠）显示原始命令、工具调用、低价值 status，避免命令输出淹没主视图。
- `cmd.exe`、`powershell`、`npm test` 等命令输出会被显式标为"命令输出"，不会伪装成助手内容。

### 等待输入

当任务处于 `等待我` 状态时，底部 omnibar 会展开为可输入区，可以：

- 直接发送自定义文本回复。
- 点击 prompt 选项快速回复。
- 只有真实可写回的会话才会显示输入入口；只读同步（Codex Desktop、VS Code activity 等）不显示。

### 失败诊断复制

失败任务会在主视图渲染一条 `.error-summary`，并提供"复制失败诊断"按钮。复制内容包含来源、能力、最近命令、错误文本，可直接粘贴给 Codex 或 Claude 继续排查。

### 来源与能力层级

每个任务的标题旁会显示来源（CLI/PTTY、Codex Desktop、VS Code、外部适配器、CC Switch …）和能力层级：

- **L1 进程识别**：仅识别进程存在，无法读取任务内容。
- **L1-L2 弱接入**：识别 + 部分元数据，不进入主队列除非有真实 prompt/error。
- **L2 只读事件**：只读同步会话内容。
- **L2-L3 事件可回**：只读事件 + 可写回。
- **L3 可回写会话**：完整双向 CLI/PTTY。
- **L4 工作流编排**：模板 / 多步骤编排。

来源 chip 的颜色与层级一致，避免把只读同步误认为深度接管。

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

# 删除配置目录（可选，PowerShell）
Remove-Item -LiteralPath "$env:USERPROFILE\.codepanion" -Recurse -Force
```

---

## 故障排除

### 问题 1：守护进程无法启动

**症状**：运行 `codepanion start` 后，`codepanion status` 显示未运行。

**解决方案**：

1. 检查端口是否被占用：
   ```powershell
   netstat -ano | findstr :7777
   ```

2. 尝试使用不同端口：
   ```bash
   codepanion start --port 8080
   ```

3. 查看日志：
   ```powershell
   Get-Content -LiteralPath "$env:USERPROFILE\.codepanion\logs\daemon.log" -Tail 80
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

1. 查看日志文件：`%USERPROFILE%\.codepanion\logs\`
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
