# Claude Code 接入指南

本文档固化 CodePanion 接入 Anthropic Claude Code CLI 的所有可验证路径，并按 [监控源能力分层](MONITORING_SOURCES.md#能力分层) 标注每条路径的能力等级、回复链路、限制与验收方式。

> **TL;DR**：日常使用走「路径 A：CLI/PTY 包装」，能完成 L3「看到 → 判断 → 回复」闭环；其他路径作为补充，不能单独完成回复闭环。

## 接入路径总览

| 路径 | 能力等级 | 回复链路 | 适用场景 |
| --- | --- | --- | --- |
| A. `codepanion run -- claude code` | L3 | PTY 写回 | 日常单窗口使用、需要在 GUI 内回复 Claude |
| B. `codepanion install claude-code` hooks | L2 | 仅通知 | 已经习惯直接在终端跑 Claude Code，但想要等待 / 完成的系统通知 |
| C. VS Code 终端中的 Claude Code | L2 | 间接（PTY 不在 CodePanion 中） | 在 VS Code 内开多个 Claude Code 终端，借 VS Code 扩展事件知道终端何时打开 / 关闭 |
| D. 通过 CC Switch 切账号 + A | L3 | PTY 写回 | 多账号 / 多 provider 切换后再启动 Claude Code |

## 路径 A：CLI/PTY 包装（推荐，L3）

把 Claude Code 当作普通 CLI，用 CodePanion 的 PTY 包装它。CodePanion 监控输出、检测 prompt、把 GUI 中的回复写回真实终端。

### 启动

```bash
codepanion start          # 一次性启动 daemon
codepanion run -- claude  # 进入 Claude Code 交互
```

> Claude Code 的 CLI 名是 `claude`（部分发行版别名为 `claude code`）。`codepanion run -- ...` 后面就是真实可执行命令，不要漏掉 `--` 分隔符。

### 工作机制

- CodePanion 给 Claude 分配独立 `sessionId`，所有输出按时间戳进入 workflow 视图。
- PromptDetector 命中 yes/no / 编号选项 / 静默等待时，session 状态转为 `waiting`，GUI 显示「等待输入」。
- 在 GUI 输入框回车 → 通过 `POST /sessions/:id/reply` → PTY 把文本写回 Claude 的 stdin。

### 能力证据

- L1：source 注册为 `cli`，含 windowTitle / workspace。
- L2：`done` / `error` / `prompt` 事件根据退出码与 prompt 检测自动产出。
- L3：GUI 回复经 [`packages/daemon/src/daemon/server.ts`](../packages/daemon/src/daemon/server.ts) 的 `POST /sessions/:id/reply` 路由（`sessions.injectReply`）写回 PTY 的 stdin。

### 限制

- 只能监控由 CodePanion 启动的 Claude Code 实例；已经在另一个终端里跑的不会被接管。
- 写回的内容默认追加 `\n`，要按字符发送时调用 `codepanion reply <sessionId> <text> --newline=false`。
- 中文输入靠 PTY 透传；Windows 上请确认终端字体支持 UTF-8。

### 验收

```bash
codepanion start
codepanion run -- claude
# 在 Claude 中触发任意 y/n 确认（例如让它修改文件）
# 切到 GUI：应该看到等待输入的卡片；在 GUI 输入框回复 y → Claude 终端继续
```

## 路径 B：Claude Code Hooks（L2，仅系统通知）

适合不想被 PTY 接管、但希望知道 Claude 等待 / 完成的开发者。

### 安装

```bash
codepanion install claude-code
```

该命令会在 `~/.claude/settings.json` 写入 `Stop` 与 `Notification` 两个 hook，调用 `codepanion notify`，详见 [packages/daemon/src/cli/install.ts](../packages/daemon/src/cli/install.ts)。

> hooks 命令本身不携带 token，token 由 `codepanion notify` 从 owner-only `~/.codepanion/config.json` 读取，避免写入世界可读的 settings.json，详见 [docs/IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 的 S-3 记录。

### 能力证据

- L1：`claude-code` 来源出现在 GUI source rail（首次 notify 触发时）。
- L2：每次 Claude Stop / Notification 都触发 `done` 或 `prompt` 等级的系统通知（前提是 `toast.enabled=true`）。

### 限制

- 不接管 PTY，CodePanion 拿不到 Claude 的原始输出，**不能** 在 GUI 中回复。
- 如果 PATH 中没有 `codepanion`，hook 会静默失败；安装时 `codepanion install claude-code` 已经在 stdout 提示该前提。

### 卸载

CodePanion 写入的 hooks 全部带 `"tag": "codepanion-managed"`。再次运行 `codepanion install claude-code` 时会先按 tag 清理旧条目；要彻底卸载则手动从 `~/.claude/settings.json` 删除带该 tag 的条目即可，CodePanion 不会动其他 hook。

## 路径 C：VS Code 终端中的 Claude Code（L2）

VS Code 扩展通过公开 API 上报终端的打开 / 关闭，能让 GUI 知道哪个 VS Code 窗口里跑了多少个 Claude Code 终端。

### 启动

- VS Code 中安装 `codepanion-vscode-extension`（仓库内 `packages/vscode-extension/`）。
- 在 VS Code 终端里直接跑 `claude` 即可。

### 能力证据

- L1：每个 VS Code 窗口注册一个 `vscode` 来源（含 workspace、windowTitle）。
- L2：`onDidOpenTerminal` / `onDidCloseTerminal` 在 GUI workflow 中显示终端打开 / 关闭事件，参见 [packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)。

### 限制

- VS Code 扩展不能接管已经在终端里跑的 PTY；要做 L3 必须改走路径 A 或 D。
- 不读取 VS Code / Copilot 私有内部状态，不接入 Copilot Chat 私有 API。

## 路径 D：CC Switch + 路径 A（L3）

多账号 / 多 provider 场景：先用 CC Switch 切到目标账号，再用路径 A 启动 Claude。详见 [MONITORING_SOURCES.md](MONITORING_SOURCES.md#cc-switch-兼容策略)。

```bash
ccs current   # 确认 CC Switch 当前 profile
codepanion run -- claude
```

CC Switch 在 GUI 中显示为 `CC Switch` 来源（tier=switcher），不参与 AI 任务排序，但能帮助判断「为什么 Claude 现在认证到了这个账号」。

## 不做（边界）

- **不读取** `~/.claude/credentials.json`、`~/.claude/conversation/**` 等账号 / 历史文件。
- **不调用** Claude Code 私有内部状态或未公开 API。
- **不**把进程级识别（仅看到 `claude` 进程运行）描述为「深度接管」；CodePanion 只有 PTY 包装路径才能保证 L3 回复。
- **不**做 Claude 模型对话客户端：CodePanion 是控制平面，对话仍交给 Claude Code 自己处理。

## 故障排查

- GUI 看不到 Claude Code 来源 → 确认是用 `codepanion run --` 启动而不是直接跑 `claude`；hook 路径需要 PATH 上有 `codepanion`。
- prompt 没被识别 → 检查 [`packages/daemon/src/pty/runner.ts`](../packages/daemon/src/pty/runner.ts) 的 `promptIdleMs` 配置（默认 800ms），自定义 CLI 输出可能需要调大。
- 回复写到了错误的会话 → 多 Claude 并发时，GUI 一定要点中正确的 source 卡片再回复；`/sessions/:id/reply` 严格按路径 ID 路由，参见 [docs/API.md](API.md#sessionsidreply)。
- 其他通用问题：见 [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
