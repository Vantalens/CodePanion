# 保留策略

daemon 在内存里维护三类历史：会话 (`SessionManager`)、来源事件 (`SourceManager`)、工作流 (`WorkflowManager`)。所有 cap 默认值集中在 [packages/daemon/src/config.ts](../packages/daemon/src/config.ts) 的 `RETENTION_DEFAULTS`，可在 `~/.codepanion/config.json` 的 `retention` 字段覆盖。

修改本文档前请同步 `RETENTION_DEFAULTS`，并确保 [docs/IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 有对应记录。

## cap 一览

| 域 | 配置键 | 默认值 | 单位 / 触发位置 |
| --- | --- | --- | --- |
| 会话整体输出 | `retention.session.fullOutputChars` | `262144`（256 KiB） | 字符；`SessionManager.appendOutput` → `appendFullOutput` 滑窗 |
| 会话分块历史 | `retention.session.outputChunks` | `1000` | 条；`SessionManager.appendOutputChunk` 末端裁剪 |
| 来源事件总量 | `retention.source.events` | `1000` | 条；`SourceManager.pruneEvents` 按 `timestamp` 保留最新 N 条 |
| 单事件回复数 | `retention.source.repliesPerEvent` | `50` | 条；`SourceManager.reply` 中末端裁剪 |
| 离线来源缓存 | `retention.source.offlineSources` | `50` | 条；`SourceManager.disconnect` 后按 `lastSeenAt` 淘汰最旧的 offline 来源 |
| 工作流线程数 | `retention.workflow.threads` | `30` | 条；`WorkflowManager.prune` 按 `updatedAt` 保留最新 N 条 |
| 单线程条目数 | `retention.workflow.itemsPerThread` | `120` | 条；`WorkflowManager.appendItem` / `loadSnapshot` 末端裁剪 |
| 去重指纹缓存 | `retention.workflow.seenItems` | `4000` | 条；`WorkflowManager.prune` 触发 `rebuildSeenItems` |

## 触发与丢弃语义

- **滑窗类**（`fullOutputChars`）：按字符长度滚动剔除最旧块，单块过长时再裁尾。
- **末端裁剪类**（`outputChunks` / `repliesPerEvent` / `itemsPerThread`）：超过 cap 时 `splice` 掉头部最旧的若干条。
- **整体修剪类**（`source.events` / `workflow.threads`）：超过 cap 时按时间戳排序，丢弃尾部线程或事件并联动清理关联回复 / 条目。
- **离线来源回收**（`source.offlineSources`）：`disconnect` 已广播 `source-disconnected`，daemon 内部按 `lastSeenAt` 升序淘汰最旧的 offline 来源；不向 GUI 额外广播，避免出现「来源消失」的歧义视觉。
- 工作流 `seenItems` 既受自身 cap 限制，也在 `prune` 清线程时重建，避免长跑后误判去重。

## 持久化交互

- 仅 `WorkflowManager` 持久化到 `~/.codepanion/workflow-snapshot.json`，使用 200ms 去抖 + 临时文件 rename（详见 [IMPLEMENTATION_LOG.md P-1](IMPLEMENTATION_LOG.md#p-1-工作流快照去抖--原子写)）。
- `SessionManager` / `SourceManager` 不写盘，daemon 进程结束即丢失。
- 重启读快照时仍走 `itemsPerThread` 裁剪与 `prune`，保留策略变更立即对历史生效。

## 配置示例

`~/.codepanion/config.json` 中可只覆盖关心的项：

```json
{
  "retention": {
    "session": { "fullOutputChars": 524288 },
    "workflow": { "threads": 60, "itemsPerThread": 200 }
  }
}
```

未列出的字段自动回落到 `RETENTION_DEFAULTS`。Zod 拒绝非正整数。

## 验证

- 单元测试覆盖：
  - [test/sessionManager.test.mjs](../packages/daemon/test/sessionManager.test.mjs) `SessionManager respects custom retention caps`
  - [test/sourceManager.test.mjs](../packages/daemon/test/sourceManager.test.mjs) `SourceManager respects custom retention caps`
  - [test/workflowManager.test.mjs](../packages/daemon/test/workflowManager.test.mjs) `WorkflowManager respects custom retention caps from constructor`
- 长跑稳态：见 [scripts/stress-workflow.mjs](../scripts/stress-workflow.mjs)；8h 真机实测已降级为 Beta 前稳态验证，不阻塞 Windows Alpha 与阶段 2 第一批模板能力，结果后续写回 [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)。
