# Codex 接入指南

本文档固化 CodePanion 接入 OpenAI Codex 全部可验证路径，按 [监控源能力分层](MONITORING_SOURCES.md#能力分层) 标注每条路径的能力等级、回复链路、限制与验收方式。

> **TL;DR**：CLI 实时使用走「路径 A：CLI/PTY 包装」可完成 L3 回复；Codex Desktop 历史 / 进行中的会话走「路径 B：本地 jsonl 同步」只读到 L2，不能在 CodePanion 中向 Codex Desktop 写回。

## 接入路径总览

| 路径 | 能力等级 | 回复链路 | 适用场景 |
| --- | --- | --- | --- |
| A. `codepanion run -- codex` | L3 | PTY 写回 | Codex CLI 实时使用，需要在 GUI 内回复 |
| B. Codex Desktop 本地 jsonl 同步 | L2 | 无（只读） | 想要在控制台看到 Codex Desktop 的线程与消息时间线 |
| C. VS Code 终端中的 Codex CLI | L2 | 间接（PTY 不在 CodePanion 中） | VS Code 内多终端跑 Codex CLI，借扩展事件知道终端何时打开 / 关闭 |
| D. 通过 CC Switch 切账号 + A | L3 | PTY 写回 | 多账号 / 多 provider 切换后再启动 Codex CLI |

## 路径 A：CLI/PTY 包装（推荐，L3）

把 Codex CLI 当作普通 CLI，用 CodePanion 的 PTY 包装。CodePanion 监控输出、检测 prompt、把 GUI 回复写回真实终端。

### 启动

```bash
codepanion start
codepanion run -- codex
```

> Codex CLI 的二进制名通常是 `codex`。如果你装的是 `@openai/codex` npm 包，确保它在 PATH 上。`--` 分隔符不能省。

### 工作机制

- 独立 `sessionId`，所有输出按时间戳进入 workflow 视图。
- PromptDetector 命中 yes/no / 编号选项 / 静默等待时，session 转 `waiting`，GUI 显示「等待输入」。
- GUI 回车 → `POST /sessions/:id/reply` → PTY 写回 stdin。

### 能力证据

- L1：source 注册为 `cli`，含 workspace / windowTitle。
- L2：`done` / `error` / `prompt` 自动产出（依据 prompt 检测和退出码）。
- L3：GUI 回复经 [`packages/daemon/src/daemon/server.ts`](../packages/daemon/src/daemon/server.ts) 的 `POST /sessions/:id/reply` 路由（`sessions.injectReply`）写回 PTY 的 stdin。

### 限制

- 只能接管 CodePanion 启动的 Codex CLI 实例。
- 中文输入靠 PTY 透传；Windows 终端字体需支持 UTF-8。
- Codex CLI 的多轮对话状态保留在 Codex 进程内，CodePanion 不持久化对话内容（只持久化 prompt / 回复事件）。

### 验收

```bash
codepanion start
codepanion run -- codex
# 在 Codex CLI 中触发任意需要确认的操作（编辑文件 / 执行命令）
# GUI：看到等待输入卡片；输入框回复 → Codex CLI 继续
```

## 路径 B：Codex Desktop 本地 jsonl 同步（L2，只读）

Codex Desktop 把每个对话写到 `~/.codex/sessions/**/*.jsonl`。CodePanion 通过 [packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts) 增量解析这些文件，得到线程、用户消息、Codex 输出、命令调用和代码块。

### 启动

默认开启。可在 `~/.codepanion/config.json` 关闭：

```json
{
  "monitors": {
    "codexDesktop": false
  }
}
```

### 工作机制

- 扫描根目录默认 `~/.codex/sessions`，每 2 秒一次。
- 单次扫描只取最近 40 个 jsonl 文件，且只对最近 3 天内有更新的会话保持 `running` 状态，超出窗口的标 `done`，避免把陈年历史当活跃任务。
- 每个 `.jsonl` 用 `(path, offset)` 跟踪进度，支持从断点续读，不重复发送已处理的行。
- 线程标题用首条用户消息升级（命中 `isDegradedTitle` 才替换），否则保留路径 / 日期标题。
- `ensureThread` 早返回已存在的 thread，避免后写的旧时间戳事件把已完结状态清回 `running`，详见 [docs/IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 的「改善 Codex Desktop 线程标题与状态识别质量」记录。

### 能力证据

- L1：每个 jsonl 文件→一个 `codex-desktop` 线程（带 workspace 推断）。
- L2：消息、工具调用、命令输出、代码块在 workflow 时间线中可读，可用于复盘 / 检索。
- **不能** L3：不向 Codex Desktop 写回任何内容。CodePanion 只读 jsonl，不调用 Codex Desktop 私有 API 或 IPC。

### 限制

- 不读取 `~/.codex/auth.json`、`~/.codex/credentials.*` 等账号 / token 文件。
- 不解析 Codex Desktop 内部 protocol buffer 或私有缓存，只解析公开的 jsonl rollout 格式。
- 当 Codex Desktop 升级了文件格式，CodePanion 可能解析出空内容；不会崩溃，但需要回归 [packages/daemon/test/codexDesktopAdapter.test.mjs](../packages/daemon/test/codexDesktopAdapter.test.mjs) 中的样本测试再扩展正则。

### 验收

```bash
# 1. 在 Codex Desktop 中开一个新会话，发几条消息
# 2. GUI source rail：应看到 codex-desktop 来源
# 3. workflow 时间线：用户消息 / Codex 输出 / 工具调用按时间顺序排列
# 4. 关闭 Codex Desktop 后超过 3 天再启动 CodePanion：旧会话应显示为 done 而不是 running
```

## 路径 C：VS Code 终端中的 Codex CLI（L2）

VS Code 扩展通过公开 API 上报终端的打开 / 关闭，能让 GUI 知道哪个 VS Code 窗口里跑了 Codex CLI。

### 启动

- VS Code 中安装 `codepanion-vscode-extension`（仓库内 `packages/vscode-extension/`）。
- 在 VS Code 终端里跑 `codex` 即可。

### 能力证据

- L1：每个 VS Code 窗口注册一个 `vscode` 来源。
- L2：终端打开 / 关闭事件进入 workflow，参见 [packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)。

### 限制

- VS Code 扩展不能接管已在终端里跑的 PTY；L3 必须改走路径 A 或 D。
- 不接入 Copilot Chat 私有 API。

## 路径 D：CC Switch + 路径 A（L3）

多账号 / 多 provider 场景：先用 CC Switch 切到目标账号，再用路径 A 启动 Codex CLI。详见 [MONITORING_SOURCES.md](MONITORING_SOURCES.md#cc-switch-兼容策略)。

```bash
ccs current   # 确认当前 profile
codepanion run -- codex
```

CC Switch 在 GUI 中显示为 `CC Switch` 来源（tier=switcher），不参与 AI 任务排序。

## 不做（边界）

- **不读取** `~/.codex/auth.json`、`~/.codex/credentials.*` 等账号 / token 文件。
- **不调用** Codex Desktop 私有 API、IPC 或 SQLite 缓存。
- **不**向 Codex Desktop 写回任何内容；路径 B 只读。
- **不**把进程级识别（仅看到 `codex` 进程运行）描述为「深度接管」；L3 回复只在路径 A 与路径 D 中可用。

## 故障排查

- 看不到 Codex Desktop 来源 → 确认 `~/.codex/sessions` 目录存在、`monitors.codexDesktop=true`、有最近 3 天内的 jsonl 文件。
- 已完结的线程被反复刷成 `running` → 检查 daemon 日志是否回退到旧版本；正确实现见 [`codexDesktopAdapter.ts`](../packages/daemon/src/adapters/codexDesktopAdapter.ts) 的 `ensureThread`：若 `workflows.getThread()` 已返回 `done` / `error` 不会回退到 `running`。
- Codex CLI 的 prompt 没被识别 → 检查 `promptIdleMs` 配置；Codex 的输出风格与 Claude 不完全一致，必要时调大 idle 阈值。
- 其他通用问题：见 [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
