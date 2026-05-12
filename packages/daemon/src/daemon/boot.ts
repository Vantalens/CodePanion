import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { acquireLock, clearPid } from './pidfile.js';
import { createServer } from './server.js';

export async function bootDaemon(): Promise<void> {
  if (!acquireLock()) {
    console.error('[remindai] daemon already running');
    process.exit(1);
  }
  const cfg = loadConfig();
  const { start } = createServer(cfg);
  const httpServer = await start();
  logger.info({ pid: process.pid, port: cfg.port }, 'daemon started');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    httpServer.close(() => {
      clearPid();
      process.exit(0);
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
