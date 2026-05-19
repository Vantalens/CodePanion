# RemindAI 监控源说明

RemindAI 采用多源工作流事件中心模型。作为本地优先、供应商中立的 AI 开发工作流控制台 / 控制平面，daemon 不只接收 `remindai run --` 包装的 PTY 会话，也会统一接收 Codex Desktop、本地 AI 编程工具扫描、VS Code 扩展和外部适配器上报的本地工作流事件。

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
| CLI / PTY | L3 | 监控 `remindai run -- <command>` 输出、等待输入、退出码，并支持回复写回 | 补齐测试、持久化和长期运行保留策略 | 只能监控被 RemindAI 启动的命令 |
| Codex Desktop | L2 | 只读同步 `~\.codex\sessions\**\*.jsonl` 中的线程、消息、工具调用、命令输出和代码块 | 改善线程标题、状态识别和归档过滤 | 不读取 auth、token、cookie，不调用私有网络 API |
| VS Code 扩展 | L2 | 每个 VS Code 窗口注册为独立来源，上报任务结束、终端打开等事件 | 在公开 API 范围内提高事件价值，并探索 L3 回复桥接 | 不读取 VS Code 或第三方扩展的私有内部状态 |
| Claude Code / Codex | L3 | 通过 CLI/PTTY 或 VS Code 窗口/终端事件映射为独立会话 | 作为 Windows Alpha 首批闭环入口稳定验证 | 不强行读取不可公开的内部状态 |
| 国产 AI 编程工具 | L1-L2 | 通过进程级识别、Code OSS/VS Code 系兼容、CLI 包装和外部适配器覆盖首批工具 | 对通义灵码 / Qoder、CodeBuddy、Trae、Comate、CodeGeeX 逐步推进 L2/L3 | 只读取进程名、路径、命令行和窗口标题；不读取账号、token、cookie、插件私有数据库或私有 API |
| 外部适配器 | L2-L3 | 任意本地工具可调用 `/sources/register` 和 `/events` 接入控制台，可通过事件回复通道接收用户响应 | 形成适配器 SDK 草案，降低接入成本 | 需要 daemon token，调用方自行保证上游工具许可与数据边界 |

## 国产 AI 工具覆盖策略

第一阶段保留广覆盖入口，但优先级从“尽量多识别”收敛为“先把首批工具做成可验证的控制台能力”。

首批重点工具：

1. 通义灵码 / Qoder、Qoder CLI
2. CodeBuddy IDE / CodeBuddy Code
3. Trae
4. 百度 Comate
5. CodeGeeX

下一梯队验证：

- MarsCode
- CodeArts / CodeArts Snap
- 其他有稳定 CLI、公开扩展 API 或本地适配能力的工具
- Qwen Code 作为 CLI / provider 方向保留观察

插件型工具如果没有独立进程，RemindAI 会先通过其所在 IDE、CLI 包装或外部适配器接入；不会扫描或解析插件私有缓存。

## 不读取的数据

RemindAI 的监控源策略遵循最小采集和显式接入：

- 不读取账号、token、cookie、浏览器登录态或供应商认证文件。
- 不读取 VS Code、JetBrains 或第三方插件的私有数据库和缓存。
- 不调用未公开、未授权或易漂移的上游私有 API。
- 不默认启用系统级 OCR、全局屏幕读取或剪贴板扫描。
- 不把检测到工具进程运行描述为“已深度接入”。

## 配置

配置文件位于 `~/.remindai/config.json`。

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
  "windowTitle": "RemindAI",
  "workspace": "D:\\RemindAI",
  "capabilities": ["window", "tasks", "terminals"]
}
```

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
- 通义灵码 / Qoder、CodeBuddy、Trae、Comate、CodeGeeX 或其他首批国产 AI 编程工具运行时，GUI 应显示对应来源或活动事件，并明确当前是 L1、L2 还是 L3 能力。
- 两个 `remindai run --` 会话同时等待输入时，GUI 回复必须写回对应 session。
- 中文标题和正文在 daemon 日志、GUI 日志、WebView 中都不能乱码。
