import { readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { acquireLock, clearPid } from './pidfile.js';
import { createServer } from './server.js';

// H-5：daemon 启动期清理 handoff 临时目录里 24h 前的残留文件。
// 这是子进程 runHandoffRunner 重试失败时的最终兜底，确保 prompt 明文不会无限累积。
const HANDOFF_TMP_DIR = join(tmpdir(), 'codepanion-handoff');
const HANDOFF_TMP_TTL_MS = 24 * 60 * 60 * 1000;

function cleanupStaleHandoffTmp(): void {
  let entries: string[];
  try {
    entries = readdirSync(HANDOFF_TMP_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  const leakIndex = join(HANDOFF_TMP_DIR, 'leaks.log');
  for (const name of entries) {
    const path = join(HANDOFF_TMP_DIR, name);
    if (path === leakIndex) continue;
    try {
      const st = statSync(path);
      if (now - st.mtimeMs > HANDOFF_TMP_TTL_MS) {
        rmSync(path, { force: true });
      }
    } catch {
      // 单个条目失败不阻塞整体清理。
    }
  }
  // 处理 leaks.log 中登记过的路径——子进程没删成的，daemon 起来再补一刀。
  try {
    const raw = readFileSync(leakIndex, 'utf8');
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    for (const line of lines) {
      const parts = line.split('\t');
      const path = parts[1];
      if (!path) continue;
      try { rmSync(path, { force: true }); } catch {}
    }
    unlinkSync(leakIndex);
  } catch {
    // 没有 leaks.log 或读取失败都是正常情况。
  }
}

export async function bootDaemon(): Promise<void> {
  if (!acquireLock()) {
    console.error('[codepanion] daemon already running');
    process.exit(1);
  }
  cleanupStaleHandoffTmp();
  const cfg = loadConfig();
  const { start, workflows } = createServer(cfg);
  const httpServer = await start();
  logger.info({ pid: process.pid, port: cfg.port }, 'daemon started');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    workflows
      .flushSnapshot()
      .catch((err) => logger.warn({ err }, 'snapshot flush failed during shutdown'))
      .finally(() => {
        httpServer.close(() => {
          clearPid();
          process.exit(0);
        });
      });
    setTimeout(() => {
      clearPid();
      process.exit(0);
    }, 2000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', () => clearPid());
}
