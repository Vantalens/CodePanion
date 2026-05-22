# 本地审计导出

CodePanion daemon 把所有 prompt / output / 回复 / 来源事件留在内存里，按 [docs/RETENTION.md](RETENTION.md) 中的滚动窗口淘汰。`codepanion audit` 提供一个把当前活跃窗口里的状态一次性导出到本地文件的能力，方便事后排错、合规归档或本地分析——**不联网，不上传**。

## 命令速览

```powershell
# 把当前 daemon 内存里的全部审计快照写到 stdout
codepanion audit export

# 写入到本地 JSON 文件，权限 0o600（仅当前用户可读）
codepanion audit export -o C:\Users\me\audit.json

# 只导出某一时刻之后的事件 / 回复 / 会话
codepanion audit export --since "2026-05-22T08:00:00+08:00" -o today.json

# JSON Lines，方便 jq / 流式处理
codepanion audit export --format jsonl -o audit.jsonl

# 对事件标题、内容、选项、回复文本、用户路径做最小脱敏后再导出
codepanion audit export --redact -o audit-redacted.json
```

## 选项

| 选项 | 说明 |
| --- | --- |
| `-o, --output <path>` | 写入文件路径。省略或填 `-` 写入 stdout。文件目录会自动创建，文件权限 0o600。 |
| `--format <json\|jsonl>` | 默认 `json`（带缩进）。`jsonl` 每行一个对象，首行是 `meta`，便于 `jq` 等工具流式消费。 |
| `--since <value>` | 仅导出该时刻之后产生的事件、回复、会话与工作流条目。支持 ISO 8601（`2026-05-22T08:00:00+08:00`）或 epoch 毫秒（`1779000000000`）。 |
| `--redact` | 输出前在内存里对事件标题/内容/选项、回复文本、来源/会话窗口标题、用户家目录路径做最小脱敏。**原始数据不变**。 |

任何一次导出都会在 stderr 上打印一行汇总，例如：

```
[audit] sources=3 events=124 replies=12 sessions=4 threads=6 items=987（redacted, since=2026-05-22T00:00:00.000Z）
```

## 输出结构

JSON 顶层字段：

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": 1779410536204,        // ms
  "since": null,                         // 或 since 入参对应的 ms
  "daemonVersion": "0.x.y",
  "sources": [ /* MonitorSource[] */ ],
  "events": [ /* MonitorEvent + { id, timestamp }[] */ ],
  "eventReplies": [ /* { eventId, sourceId?, text, timestamp }[] */ ],
  "sessions": [ /* SessionInfo[] */ ],
  "workflowThreads": [ /* WorkflowThread[] */ ],
  "workflowItems": [ /* WorkflowItem[] */ ]
}
```

`MonitorSource` / `MonitorEvent` / `SessionInfo` / `WorkflowThread` / `WorkflowItem` 的字段定义见 [docs/API.md](API.md) 与 `packages/daemon/src/shared/protocol.ts`。

JSONL 格式下，每行都是 `{ "kind": "meta|source|session|event|event-reply|workflow-thread|workflow-item", ... }`，首行固定 `kind=meta`。

## 数据边界

- 导出的内容仅限当前 daemon 内存中的滚动窗口。窗口大小由 `~/.codepanion/config.json` 中 `retention` 段控制（默认值见 [docs/RETENTION.md](RETENTION.md)）。**不是历史归档**——超出窗口的数据无法找回。
- 工作流快照（持久化在 `workflow-snapshot.json`）的窗口跟随 `retention.workflow`，会随导出一并落地。
- 没有任何字段会被发送到外部。导出文件是本地写盘，目录默认 `~/.codepanion/`，文件权限 `0o600`。

## 脱敏规则

`--redact` 会在导出前做最小脱敏：

- 长度 ≤ 6 的文本字段（标题/内容/选项/窗口标题/回复/工作流 `title/content/preview/rawText`）整体替换成 `*`，长度 > 6 的保留首尾各 2 字符并附长度信息（例：`是的好的` → `**`；`请确认是否继续？` → `请确***？（9 chars）`）。
- 用户家目录路径打码：`C:\Users\alice\...` → `C:\Users\***\...`；`/Users/alice/...`、`/home/bob/...` 同样替换。

脱敏只影响导出文件，**不影响**正在运行的 daemon 状态。

## 典型用法

1. **故障排查**：CLI 集成异常时，可导出未脱敏的 JSON 文件并与开发者私下共享，体积通常 < 1 MB。
2. **本地合规归档**：定期 `codepanion audit export --since <上次导出时间> -o ...`，按时间拼接成全量历史。
3. **流式分析**：`codepanion audit export --format jsonl | jq 'select(.kind == "event")'`。

## 相关

- [docs/RETENTION.md](RETENTION.md)：内存滚动窗口大小
- [docs/API.md](API.md)：`GET /audit/snapshot` HTTP 接口（CLI 内部调用）
- [docs/ADAPTER_SDK.md](ADAPTER_SDK.md)：第三方工具写入 daemon 的另一条入口
