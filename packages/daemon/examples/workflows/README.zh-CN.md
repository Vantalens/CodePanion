# CodePanion 工作流示例模板

[English](README.md) | [简体中文](README.zh-CN.md)

本目录是开箱可用的多步骤工作流模板集。

使用 `codepanion workflow import --file <json>` 把示例加载到本地 workflow store（`~/.codepanion/workflows.json`），然后用 `codepanion workflow run <name>` 运行。运行期间，各步骤进度会通过 daemon 事件总线推送给 GUI。

## 提供的模板

| 文件 | 名称 | 用途 |
| --- | --- | --- |
| [`codex-then-claude-review.json`](./codex-then-claude-review.json) | `codex-then-claude-review` | Codex 起草改动，人工检查点暂停执行，然后 Claude Code 复审结果。 |
| [`build-test-audit.json`](./build-test-audit.json) | `build-test-audit` | 本地交付前 build、test、audit 导出。 |

## 用法

```powershell
# 导入示例
codepanion workflow import --file packages/daemon/examples/workflows/build-test-audit.json

# 查看 workflow
codepanion workflow show build-test-audit

# 干跑：只解析步骤，不执行命令
codepanion workflow run build-test-audit --dry-run

# 实际执行；checkpoint 步骤会暂停，附 --yes 可继续
codepanion workflow run codex-then-claude-review --yes --set feature=add-dark-mode

# 复用一次历史运行的参数
codepanion workflow replay <runId>
```

## 自定义

`workflow import` 接受三种 JSON 形态：

- 单个 workflow 对象：`{ "name": "...", "steps": [...] }`
- 数组：`[ { "name": "..." }, { "name": "..." } ]`
- 带 `workflows` 键的对象：`{ "workflows": [ ... ] }`

每个 step 至少需要 `id` 和 `command` 或 `template`。可选字段包括 `tool`、`args`、`values`、`dependsOn` 和 `checkpoint`。

参数解析使用 `{param}` 占位符。运行时可通过 `--set key=value` 覆盖默认值，未覆盖时使用 `params` 块里的默认值。

## 与 GUI 的衔接

daemon 在线时，`codepanion workflow run` / `replay` 会注册一个临时来源（`kind=cli`、`name=workflow:<name>`），并把每个步骤的启动 / 完成 / 失败 / checkpoint 事件推送到 GUI 活动流。运行结束时该来源自动断开。daemon 离线时命令退回纯 CLI 行为。
