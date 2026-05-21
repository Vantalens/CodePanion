# @codepanion/adapter-sdk

零依赖 Node.js 客户端，封装 [CodePanion](https://github.com/Vantalens/CodePanion) daemon 的来源 / 事件 HTTP API。

完整文档：[docs/ADAPTER_SDK.md](../../docs/ADAPTER_SDK.md)

## 快速使用

```javascript
import { createAdapter } from '@codepanion/adapter-sdk';

const adapter = createAdapter({ sourceName: 'my-build' });
await adapter.registerSource({ capabilities: ['adapter'], capabilityLevel: 'L2' });
await adapter.emitEvent({ type: 'done', title: '构建完成' });
await adapter.disconnect();
```

## 示例

- `examples/file-watcher.mjs` — 监听本地目录变更
- `examples/git-hook.mjs` — git hook 触发器

## 测试

```bash
node --test test/*.test.mjs
```
