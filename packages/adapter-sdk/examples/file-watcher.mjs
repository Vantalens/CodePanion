// 示例：把本地文件变更上报为 CodePanion activity 事件。
//
// 运行：
//   node packages/adapter-sdk/examples/file-watcher.mjs <要监控的目录>
//
// 触发条件：目录下任意文件 rename / change 时上报一条 activity，
// 主进程 SIGINT (Ctrl+C) 时优雅退出并 disconnect。
//
// 边界：仅做文件名级别的 fs.watch，不读取文件内容，符合 explicit-adapter 隐私边界。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAdapter } from '../src/index.js';

async function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error('usage: node file-watcher.mjs <directory>');
    process.exit(2);
  }

  const absolute = path.resolve(targetDir);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    console.error(`[adapter] 目录不存在或不是目录：${absolute}`);
    process.exit(2);
  }

  const adapter = createAdapter({
    sourceKind: 'external',
    sourceName: `file-watcher: ${path.basename(absolute)}`,
  });

  const source = await adapter.registerSource({
    workspace: absolute,
    capabilities: ['adapter', 'file-watch'],
    capabilityLevel: 'L2',
  });
  console.log(`[adapter] 已注册来源 sourceId=${source.id}`);

  const watcher = fs.watch(absolute, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    adapter
      .emitEvent({
        type: 'activity',
        title: `文件 ${eventType}`,
        content: filename,
        workspace: absolute,
      })
      .catch((err) => console.warn('[adapter] 上报失败:', err.message));
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[adapter] 收到 ${signal}，正在断开来源 ...`);
    watcher.close();
    try {
      await adapter.disconnect();
    } catch (err) {
      console.warn('[adapter] disconnect 失败:', err.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 仅在被直接执行（非 import）时运行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[adapter] 启动失败:', err);
    process.exit(1);
  });
}
