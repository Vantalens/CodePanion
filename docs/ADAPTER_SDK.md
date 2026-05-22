# CodePanion Adapter SDK

`@codepanion/adapter-sdk`（位于 [packages/adapter-sdk/](../packages/adapter-sdk/)）是一个零依赖、纯 Node.js 的轻量客户端，封装了 daemon 的 `/sources/register`、`/events`、`/events/:id/reply` 等 HTTP 接口。任何能跑 Node 20+ 的脚本或服务，都可以把自己注册为 CodePanion 的一个监控来源，并把活动 / 提示 / 完成 / 错误事件上报到统一队列。

> 适配器只能上报你显式发出的事件。SDK 默认 `integrationKind=adapter` / `privacyBoundary=explicit-adapter`，daemon 不会主动读取你的日志、文件或屏幕内容。

## 适用场景

- 自家 IDE 或工具想接入 CodePanion 任务队列，但不打算重写 VS Code 扩展。
- CI、git hook、文件监听器、构建脚本想把"完成 / 失败 / 等待确认"这类节点直接进入 CodePanion 主视图。
- 自己写的中间件 / 守护进程想被识别为来源（标注能力层级、所属工作区），用于本地审计。

不适合：
- 替代 `codepanion run --` 的全双向 CLI 接管（SDK 不暴露 PTY 主从端，写回需要走 `inject-input` 协议，由 daemon 内置 CLI 完成）。
- 跨主机上报（daemon 只绑 `127.0.0.1`，SDK 默认也只连本机）。

## 安装

SDK 目前与仓库一起发布，可以直接相对路径引用：

```bash
# 本机使用：直接 import
node -e "import('./packages/adapter-sdk/src/index.js').then(m => console.log(Object.keys(m)))"
```

或在自己的 package.json 里通过本地路径声明依赖：

```json
{
  "dependencies": {
    "@codepanion/adapter-sdk": "file:./packages/adapter-sdk"
  }
}
```

## 快速上手

```javascript
import { createAdapter } from '@codepanion/adapter-sdk';

const adapter = createAdapter({
  sourceKind: 'external',
  sourceName: 'my-build-script',
});

await adapter.registerSource({
  capabilities: ['adapter', 'build'],
  capabilityLevel: 'L2',
  workspace: process.cwd(),
});

await adapter.emitEvent({
  type: 'activity',
  title: '构建开始',
  content: 'npm run build',
});

// ... 跑真正的工作 ...

await adapter.emitEvent({
  type: 'done',
  title: '构建完成',
  content: '产物已写入 dist/',
});

await adapter.disconnect();
```

默认从 `~/.codepanion/config.json` 读取 `port` 和 `token`；也可以通过构造参数覆盖：

```javascript
createAdapter({
  hostname: '127.0.0.1',
  port: 7777,
  token: process.env.CODEPANION_TOKEN,
});
```

## API 参考

### `createAdapter(options?)` / `new CodePanionAdapter(options?)`

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `hostname` | string | `'127.0.0.1'` | daemon 主机名 |
| `port` | number | 配置文件 / `7777` | daemon HTTP 端口 |
| `token` | string | 配置文件 / `''` | API token；为空时所有调用会被 daemon 401 |
| `basePath` | string | `''` | 反代或路径前缀 |
| `configPath` | string | `~/.codepanion/config.json` | 自定义配置文件位置 |
| `timeoutMs` | number | `5000` | 单个 HTTP 调用超时 |
| `sourceKind` | string | `'external'` | 默认来源类型 |
| `sourceName` | string | `''` | 默认来源名称 |

### `adapter.registerSource(payload?)`

把当前进程注册为一个来源。常用字段：

```javascript
await adapter.registerSource({
  kind: 'external',                    // 可选，默认取构造参数
  name: 'my-build-script',             // 必填（构造时给了 sourceName 也算）
  workspace: '/path/to/repo',
  windowTitle: 'build-script@v1',
  capabilities: ['adapter', 'build'],
  capabilityLevel: 'L2',               // L1 / L1-L2 / L2 / L2-L3 / L3 / L4
  integrationKind: 'adapter',          // 默认 adapter
  privacyBoundary: 'explicit-adapter', // 默认 explicit-adapter
  pid: process.pid,
});
```

返回 `MonitorSource`，并把 `id` 缓存在 `adapter.sourceId`，后续 `emitEvent` 会自动带上。

### `adapter.emitEvent(payload)`

```javascript
await adapter.emitEvent({
  type: 'prompt',          // prompt / done / error / activity / notification
  title: '需要确认',
  content: '继续？',
  options: ['继续', '取消'],
  level: 'prompt',
});
```

返回 `{ ok: true, event }`，其中 `event.id` 可用于后续 `replyToEvent`。

### `adapter.replyToEvent(eventId, text)` / `adapter.listReplies(eventId)`

把外部 UI 收到的回复写回 daemon，供 GUI 与 CLI 端一致地拿到结果。

### `adapter.disconnect(sourceId?)`

正常退出时调用，让 daemon 把对应来源标为 offline。

### `readDaemonConfig({ configPath? })`

无侧效用的工具函数，单独读 `~/.codepanion/config.json`。

## 示例适配器

- [examples/file-watcher.mjs](../packages/adapter-sdk/examples/file-watcher.mjs)：用 `fs.watch` 监控本地目录变更，上报 `activity` 事件。
- [examples/git-hook.mjs](../packages/adapter-sdk/examples/git-hook.mjs)：作为 git `post-commit` / `pre-push` hook 上报关键节点。
- [examples/local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs)：监控任意"国产 AI 编程工具"的本地日志 / 状态文件，把行级输出分类为 `error`/`prompt`/`done`/`activity`，把来源从 L1（进程在不在）升级到 L2（真事件级）。适配通义灵码 / Qoder / CodeBuddy / Trae / Comate / CodeGeeX 等已被 process-scan 识别但还缺事件价值的工具。

三个示例都使用 `integrationKind: 'adapter'`，与 GUI 的来源徽章和能力层级显示完全一致；`local-tool-bridge.mjs` 支持 `--kind` 把来源映射到对应国产工具 `kind`，事件能直接落到工具维度的统计上。

## 错误处理

所有失败都会抛 `CodePanionAdapterError`，带 `status` / `method` / `route` / `cause`：

```javascript
try {
  await adapter.registerSource();
} catch (err) {
  if (err.status === 401) {
    console.error('CodePanion token 不匹配');
  } else {
    throw err;
  }
}
```

参数校验失败（缺 name、空 eventId 等）以 reject 形式抛出，不会发出真实 HTTP 请求。

## 测试

```bash
node --test packages/adapter-sdk/test/*.test.mjs
```

测试在临时实例上启动 daemon，验证 register / emit / reply / disconnect / auth 失败 / 参数校验等路径，全部不依赖外部网络或现有 `~/.codepanion` 状态。

## 边界

- 不要把 token 写进示例脚本或日志；推荐让 SDK 自动读 `~/.codepanion/config.json`。
- daemon 默认只听 `127.0.0.1`：若要远端上报，应自行做反向代理 + 鉴权，并把流量收敛到本机。
- 适配器只是 CodePanion 的旁路输入；CodePanion 自身不会调用你的代码、不会运行你定义的脚本。
