import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWithPty, type RunArgs } from './runner.js';

// H-5：原实现把 prompt + 启动配置写到 OS tmp，rmSync 静默吞失败，进程崩溃 / 文件锁定都会导致明文残留。
// 改动两点：
//   1) 立即把 config 读入内存，子进程一启动就尝试删；失败时多次重试。
//   2) 最终仍删不掉，把残留路径追加到一个父进程能看到的索引文件 (handoff-leaks.log)，
//      由 daemon 在下一次启动时统一清理，避免静默泄漏。
const LEAK_INDEX_PATH = join(tmpdir(), 'codepanion-handoff', 'leaks.log');
const RM_RETRY_DELAYS_MS = [0, 100, 250, 500];

function tryRemoveWithRetry(path: string): boolean {
  for (const delay of RM_RETRY_DELAYS_MS) {
    if (delay > 0) {
      const end = Date.now() + delay;
      while (Date.now() < end) {
        /* tight wait — runner 是短命子进程，不阻塞 daemon。 */
      }
    }
    try {
      rmSync(path, { force: true });
      return true;
    } catch {
      // try again
    }
  }
  return false;
}

function recordLeak(path: string): void {
  try {
    appendFileSync(LEAK_INDEX_PATH, `${new Date().toISOString()}\t${path}\n`, 'utf8');
  } catch {
    // 索引文件本身写不进去时，无法再升级处理，让 daemon 启动期的 tmp 扫描兜底。
  }
}

export async function runHandoffRunner(configPath: string): Promise<number> {
  const raw = readFileSync(configPath, 'utf8');
  if (!tryRemoveWithRetry(configPath)) recordLeak(configPath);
  const config = JSON.parse(raw) as RunArgs;
  return runWithPty({
    ...config,
    mirrorOutput: false,
    interactiveStdin: false,
  });
}
