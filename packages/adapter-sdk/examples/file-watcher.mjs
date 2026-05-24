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
// 平台支持：
//   - Windows / macOS：使用 fs.watch({ recursive: true }) 原生支持子目录递归。
//   - Linux：Node 20+ 的 fs.watch 已支持 recursive（基于 inotify），20 以下回退到
//     手动递归 watch（每个目录单独 watch），缺点是无法捕获后续新建的深层子目录。
//     若需要 Linux 大目录稳定监控，推荐配合 chokidar 等专用库。
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

  // 维护所有打开的 watcher：Linux 老版本 Node 在 recursive 不可用时需要手动逐目录监控。
  const watchers = new Set();

  const onChange = (relPath, eventType) => {
    if (!relPath) return;
    if (shouldIgnore(relPath)) return;
    // 后到的 eventType 覆盖前一次：rename 通常更值得保留
    pending.set(relPath, eventType);
    if (flushTimer) return;
    flushTimer = setTimeout(flush, DEBOUNCE_MS);
  };

  function watchRecursiveFallback(rootDir) {
    // Linux Node <20 不支持 recursive：手动遍历目录树，每个目录单独 watch。
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      const rel = path.relative(absolute, dir);
      if (rel && shouldIgnore(rel)) continue;
      try {
        const w = fs.watch(dir, (eventType, filename) => {
          if (!filename) return;
          const joined = rel ? path.join(rel, String(filename)) : String(filename);
          onChange(joined, eventType);
        });
        watchers.add(w);
      } catch (err) {
        console.warn(`[adapter] watch 失败 ${dir}: ${err.message}`);
        continue;
      }
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (DEFAULT_IGNORE.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
      }
    }
  }

  function tryRecursiveWatch() {
    try {
      const w = fs.watch(absolute, { recursive: true }, (eventType, filename) => {
        onChange(filename ? String(filename) : '', eventType);
      });
      watchers.add(w);
      return true;
    } catch (err) {
      // Linux Node <20：fs.watch recursive 抛 ERR_FEATURE_UNAVAILABLE_ON_PLATFORM
      if (err && (err.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || /recursive/i.test(err.message))) {
        return false;
      }
      throw err;
    }
  }

  if (!tryRecursiveWatch()) {
    console.warn('[adapter] fs.watch recursive 不可用（多见于 Linux Node <20），回退到手动递归监控。');
    console.warn('[adapter] 提示：手动递归无法捕获启动后新建的深层子目录，建议升级 Node 20+ 或使用 chokidar。');
    watchRecursiveFallback(absolute);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[adapter] 收到 ${signal}，正在断开来源 ...`);
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
    watchers.clear();
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
