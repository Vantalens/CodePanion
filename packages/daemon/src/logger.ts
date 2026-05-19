import pino from 'pino';
import { LOG_PATH } from './config.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

if (!existsSync(dirname(LOG_PATH))) mkdirSync(dirname(LOG_PATH), { recursive: true });

const isDaemon = process.argv.includes('--daemon');
const defaultLevel = process.env.npm_lifecycle_event === 'test' ? 'silent' : 'info';
const level = process.env.LOG_LEVEL ?? defaultLevel;

export const logger = isDaemon
  ? pino({ level }, pino.destination({ dest: LOG_PATH, sync: false, mkdir: true }))
  : level === 'silent'
    ? pino({ level })
    : pino({
        level,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      });
