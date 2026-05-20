# CodePanion 监控源说明

CodePanion 采用多源工作流事件中心模型。作为本地优先、供应商中立的 AI 开发工作流控制台 / 控制平面，daemon 不只接收 `codepanion run --` 包装的 PTY 会话，也会统一接收 Codex Desktop、本地 AI 编程工具扫描、VS Code 扩展和外部适配器上报的本地工作流事件。

现有来源能力保留并继续演进，但必须按真实能力分层描述，不把进程级识别包装成深度集成。

## 能力分层

| 等级 | 含义 | 典型能力 |
| --- | --- | --- |
| L1 | 工具存在识别 | 识别进程、窗口标题、路径、命令行，显示来源在线/离线 |
| L2 | 状态与提醒 | 上报最近活动、完成、失败、等待输入等事件 |
| L3 | 回复或继续执行 | 通过 CLI/PTTY、公开扩展 API 或外部适配器把用户回复写回真实任务 |
| L4 | 工作流编排 | 模板、步骤、跨工具交接、历史归档和回放 |

## 支持的来源

| 来源 | 当前保留级别 | 当前能力 | 下一步目标 | 边界 |
| --- | --- | --- | --- | --- |
| CLI / PTY | L3 | 监控 `codepanion run -- <command>` 输出、等待输入、退出码，并支持回复写回 | 补齐测试、持久化和长期运行保留策略 | 只能监控被 CodePanion 启动的命令 |
| Codex Desktop | L2 | 只读同步 `~\.codex\sessions\**\*.jsonl` 中的线程、消息、工具调用、命令输出和代码块 | 改善线程标题、状态识别和归档过滤 | 不读取 auth、token、cookie，不调用私有网络 API |
| VS Code 扩展 | L2 | 每个 VS Code 窗口注册为独立来源，上报任务启动 / 完成 / 失败、终端打开 / 关闭、调试会话起止等公开 API 事件 | 继续在公开 API 范围内丰富事件价值，探索 L3 回复桥接 | 不读取 VS Code 或第三方扩展的私有内部状态，不接入 Copilot Chat 私有 API |
| Claude Code / Codex | L3 | 通过 CLI/PTTY 或 VS Code 窗口/终端事件映射为独立会话 | 作为 Windows Alpha 首批闭环入口稳定验证 | 不强行读取不可公开的内部状态 |
| CC Switch | L1-L2 | 识别常见 CC Switch / Claude Code Switch 进程、CLI 命令和窗口，将账号 / provider 切换器作为独立来源展示 | 后续在显式适配器 API 范围内接收当前 profile 名称或切换事件 | 不读取 `~\.claude`、`~\.codex`、账号、token、cookie 或供应商认证文件；真实切换由 CC Switch 执行 |
| 国产 AI 编程工具 | L1-L2 | 通过进程级识别、Code OSS/VS Code 系兼容、CLI 包装和外部适配器覆盖首批工具 | 对通义灵码 / Qoder、CodeBuddy、Trae、Comate、CodeGeeX 逐步推进 L2/L3 | 只读取进程名、路径、命令行和窗口标题；不读取账号、token、cookie、插件私有数据库或私有 API |
| 外部适配器 | L2-L3 | 任意本地工具可调用 `/sources/register` 和 `/events` 接入控制台，可通过事件回复通道接收用户响应 | 形成适配器 SDK 草案，降低接入成本 | 需要 daemon token，调用方自行保证上游工具许可与数据边界 |

## 国产 AI 工具覆盖策略

第一阶段保留广覆盖入口，但优先级从“尽量多识别”收敛为“先把首批工具做成可验证的控制台能力”。

`packages/daemon/src/adapters/aiToolProcessAdapter.ts` 的 `TOOL_PROFILES` 用 `tier` 字段把每个 profile 明确归入下列三档之一，文档与代码以此互相对账。

### 梯队判定标准

| 梯队 | 判定标准 | 当前能力诉求 |
| --- | --- | --- |
| `first` 首批 | Windows Alpha 想要拿到真实使用样本、有稳定进程或 CLI、能产生可观察事件 | 至少 L1 进程识别已落地；后续要在公开 API / CLI 包装范围内推进 L2/L3 |
| `second` 观察 | 有识别价值但当前样本不足，或形态以插件 / SaaS 为主、Alpha 不作验收要求 | 仅保留 L1 进程识别，不阻塞 Alpha 退出 |
| `switcher` 切换器 | 账号 / provider 切换工具，不参与 AI 任务排序 | 仅作为来源状态展示，回复链路仍由 CLI/PTY 承担 |

### 首批投入（tier=first）

| `kind` | 工具 | 当前状态 |
| --- | --- | --- |
| `lingma` | 通义灵码（含 Qoder 共用进程 / 命令行别名） | L1 进程识别 |
| `codebuddy` | CodeBuddy IDE / CodeBuddy Code | L1 进程识别 + CLI 命令行识别 |
| `trae` | Trae | L1 进程识别 |
| `comate` | 百度 Comate | L1 进程识别 |
| `codegeex` | CodeGeeX | L1 进程识别 |

### 下一梯队观察（tier=second）

| `kind` | 工具 | 备注 |
| --- | --- | --- |
| `marscode` | 豆包 / MarsCode | Code OSS 系，等待真实样本验证 |
| `qwen-code` | Qwen Code | 作为 CLI / provider 方向继续观察，不强行接入 |

不在 `TOOL_PROFILES` 内但保留观察的工具：

- CodeArts / CodeArts Snap：尚无可靠的本地进程 / 命令行特征，等待样本前不写死正则。
- Qoder 独立 IDE：当前以 `lingma` profile 的 `tongyi` / `通义灵码` 模式覆盖共享进程；如果出现独立可识别的 `qoder` 进程或 CLI，再扩展 `lingma` 的 `processPatterns`，避免在没有样本前堆砌正则。
- 其他有稳定 CLI、公开扩展 API 或本地适配能力的工具：通过外部适配器 `/sources/register` 接入即可，无需进入 `TOOL_PROFILES`。

### 切换器（tier=switcher）

| `kind` | 工具 | 备注 |
| --- | --- | --- |
| `cc-switch` | CC Switch / Claude Code Switch | 见下方「CC Switch 兼容策略」 |

### 操作约定

- 新增 profile **必须**显式声明 `tier`，相应在 `packages/daemon/test/aiToolProcessAdapter.test.mjs` 的 tier 收敛用例里更新 `kind` 列表。
- 首批工具的能力推进顺序：L1 进程识别 → L2 事件价值 → L3 回复或继续执行；L3 仍优先复用 CLI/PTY 或公开扩展 API，不接入插件私有 DB / cookie。
- 插件型工具如果没有独立进程，CodePanion 会先通过其所在 IDE、CLI 包装或外部适配器接入；不会扫描或解析插件私有缓存。

## CC Switch 兼容策略

CodePanion 支持把 CC Switch 作为“账号 / provider 切换器来源”纳入控制台，但不接管或保存上游账号。

- 支持识别常见命令和进程：`cc-switch`、`ccs`、`ccswitch`、`claude-code-switch`、`@*/cc-switch`、`@*/claude-code-switch`。
- 支持在 GUI 中显示为 `CC Switch` 来源，能力层级为 L1/L2 配置切换。
- 使用方式建议：先通过 CC Switch 切换 Claude Code / Codex / Gemini CLI 等工具的目标账号或 provider，再通过 `codepanion run -- <ai-cli>` 启动实际任务；任务回复仍由 CLI/PTTY 链路处理。
- 后续如果 CC Switch 提供公开事件或 CLI 查询接口，可通过 `/sources/register` 和 `/events` 上报当前 profile 名称、切换成功/失败等事件。
- CodePanion 不读取 CC Switch 配置文件、上游工具认证文件或任何账号凭据。

## 不读取的数据

CodePanion 的监控源策略遵循最小采集和显式接入：

- 不读取账号、token、cookie、浏览器登录态或供应商认证文件。
- 不读取 VS Code、JetBrains 或第三方插件的私有数据库和缓存。
- 不调用未公开、未授权或易漂移的上游私有 API。
- 不默认启用系统级 OCR、全局屏幕读取或剪贴板扫描。
- 不把检测到工具进程运行描述为“已深度接入”。

## 配置

配置文件位于 `~/.codepanion/config.json`。

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
    "vscode": true,
    "codexDesktop": true,
    "aiTools": true
  }
}
```

`toast.enabled` 只控制系统通知。GUI 内消息推送由 WebSocket 连接控制，不受 `toast.enabled` 影响。

## 工作流来源 API

所有非 `/health` 请求都需要：

```http
Authorization: Bearer <token>
Content-Type: application/json; charset=utf-8
```

### 注册来源

`POST /sources/register`

```json
{
  "kind": "vscode",
  "name": "VS Code",
  "windowTitle": "CodePanion",
  "workspace": "D:\\CodePanion",
  "capabilities": ["window", "tasks", "terminals"],
  "capabilityLevel": "L2",
  "integrationKind": "extension",
  "privacyBoundary": "explicit-extension"
}
```

`capabilityLevel`、`integrationKind`、`privacyBoundary` 是统一来源元数据。未显式提供时，daemon 会按来源类型派生默认值；GUI 优先使用这些字段展示能力层级和隐私边界。

### 注销或断开来源

`POST /sources/:id/disconnect`

```json
{
  "reason": "extension-deactivated"
}
```

该接口用于 VS Code 扩展、外部适配器或本地桥接进程在窗口关闭、插件停用、进程退出时显式报告离线状态。daemon 会将来源标记为 offline，并通过 WebSocket 广播 `source-disconnected`，GUI 应展示为离线来源而不是静默消失。

### 上报事件

`POST /events`

```json
{
  "type": "prompt",
  "source": "vscode",
  "sourceId": "<source-id>",
  "title": "需要输入",
  "content": "Claude Code 正在等待确认",
  "options": ["继续", "取消"]
}
```

事件类型：

- `prompt`：需要用户输入。
- `done`：任务或对话完成。
- `error`：任务或对话出错。
- `activity`：普通状态更新。
- `notification`：直接通知。

## 阶段边界

- **Alpha**：优先提升个人本地控制台的接入质量、任务总览、提醒、上下文查看和接管能力。
- **Beta**：在 Alpha 闭环稳定后扩展首批国产工具、适配器 SDK、规则模板和本地历史。
- **阶段 2**：在现有来源模型上继续支持工作流模板、任务编排和结果归档。
- 不把多用户协作、共享空间、权限审批流或完整企业平台纳入当前产品路线。

## 验收场景

- 两个 VS Code 窗口同时打开时，GUI 应看到两个独立来源。
- VS Code 窗口关闭或扩展停用后，GUI 应看到对应来源进入离线状态。
- CC Switch / Claude Code Switch 运行或执行切换命令时，GUI 应显示 `CC Switch` 来源，并标注为配置切换器而不是可直接回复的 AI 会话。
- 通义灵码 / Qoder、CodeBuddy、Trae、Comate、CodeGeeX 或其他首批国产 AI 编程工具运行时，GUI 应显示对应来源或活动事件，并明确当前是 L1、L2 还是 L3 能力。
- 两个 `codepanion run --` 会话同时等待输入时，GUI 回复必须写回对应 session。
- 中文标题和正文在 daemon 日志、GUI 日志、WebView 中都不能乱码。
