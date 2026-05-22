// 示例：把本地文件变更上报为 CodePanion activity 事件。
//
// 运行：
//   node packages/adapter-sdk/examples/file-watcher.mjs <要监控的目录>
//
// 触发条件：目录下任意文件 rename / change 时上报一条 activity，
// 主进程 SIGINT (Ctrl+C) 时优雅退出并 disconnect。
//
// 边界：仅做文件名级别的 fs.watch，不读取文件内容，符合 explicit-adapter 隐私边界。
//
// 已内置降噪：
//   - 默认忽略 node_modules / .git / dist / build / .next / .cache / out / target；
//     避免 `npm install` 等命令把成千上万次 change 推给 daemon。
//   - 同一相对路径 200 ms 去抖（合并相邻的 rename + change）。
//   - 建议监控具体子目录而不是仓库根，以进一步降低事件量。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAdapter } from '../src/index.js';

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'coverage',
]);
const DEBOUNCE_MS = 200;

function shouldIgnore(relPath) {
  if (!relPath) return true;
  const segments = relPath.split(/[\\/]/);
  return segments.some((segment) => DEFAULT_IGNORE.has(segment));
}

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

  // path → 最近一次事件类型；去抖窗口内的事件合并成一条上报。
  const pending = new Map();
  let flushTimer = null;

  const flush = () => {
    flushTimer = null;
    if (pending.size === 0) return;
    const batch = Array.from(pending.entries());
    pending.clear();
    for (const [relPath, eventType] of batch) {
      adapter
        .emitEvent({
          type: 'activity',
          title: `文件 ${eventType}`,
          content: relPath,
          workspace: absolute,
        })
        .catch((err) => console.warn('[adapter] 上报失败:', err.message));
    }
  };

  const watcher = fs.watch(absolute, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const relPath = String(filename);
    if (shouldIgnore(relPath)) return;
    // 后到的 eventType 覆盖前一次：rename 通常更值得保留
    pending.set(relPath, eventType);
    if (flushTimer) return;
    flushTimer = setTimeout(flush, DEBOUNCE_MS);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[adapter] 收到 ${signal}，正在断开来源 ...`);
    if (flushTimer) clearTimeout(flushTimer);
    flush();
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

// 导出便于单元测试。
export { shouldIgnore, DEFAULT_IGNORE, DEBOUNCE_MS };
