import pino from 'pino';
import { LOG_PATH } from './config.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

if (!existsSync(dirname(LOG_PATH))) mkdirSync(dirname(LOG_PATH), { recursive: true });

const isDaemon = process.argv.includes('--daemon');

export const logger = isDaemon
  ? pino(
      { level: process.env.LOG_LEVEL ?? 'info' },
      pino.destination({ dest: LOG_PATH, sync: false, mkdir: true }),
    )
  : pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
