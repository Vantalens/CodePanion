import pino from 'pino';
import { LOG_PATH } from './config.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

if (!existsSync(dirname(LOG_PATH))) mkdirSync(dirname(LOG_PATH), { recursive: true });

const isDaemon = process.argv.includes('--daemon');
const defaultLevel = process.env.npm_lifecycle_event === 'test' ? 'silent' : 'info';
const level = process.env.LOG_LEVEL ?? defaultLevel;

const HOME = homedir();
const BEARER_REGEX = /(Bearer\s+)([A-Za-z0-9._\-+/=]{8,})/gi;
const TOKEN_QUERY_REGEX = /([?&](?:token|access_token|apiKey|api_key|key|secret)=)([^&\s"']+)/gi;
const TOKEN_HEX_REGEX = /\b[0-9a-f]{32,}\b/gi;

const REDACT_PATHS = [
  'token',
  '*.token',
  '*.*.token',
  'authorization',
  '*.authorization',
  'headers.authorization',
  '*.headers.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  '*.headers.cookie',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'secret',
  '*.secret',
  'password',
  '*.password',
];

/** Mask sensitive substrings (home path, bearer/query tokens, long hex tokens) in a single string. */
export function maskString(value: string): string {
  if (!value) return value;
  let out = value;
  if (HOME && out.includes(HOME)) {
    out = out.split(HOME).join('~');
  }
  out = out.replace(BEARER_REGEX, '$1[Redacted]');
  out = out.replace(TOKEN_QUERY_REGEX, '$1[Redacted]');
  out = out.replace(TOKEN_HEX_REGEX, '[Redacted]');
  return out;
}

/** Recursively mask sensitive substrings inside a structured log object. */
export function maskValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (value instanceof Error) {
    return maskValue(
      {
        type: value.name,
        message: value.message,
        stack: value.stack,
        // Preserve any custom enumerable properties (e.g. code, status) attached to the Error.
        ...Object.fromEntries(Object.entries(value)),
      },
      seen,
    );
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = maskValue(v, seen);
  }
  return out;
}

type LoggerFactoryOptions = {
  level?: string;
  destination?: pino.DestinationStream;
};

/** Build a logger with redaction wired up. Exported so tests can attach a captured destination. */
export function createLogger(options: LoggerFactoryOptions = {}): pino.Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? level,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    serializers: { err: pino.stdSerializers.err },
    formatters: {
      log(obj) {
        return maskValue(obj) as Record<string, unknown>;
      },
    },
  };
  if (options.destination) return pino(pinoOptions, options.destination);
  if (isDaemon) {
    return pino(pinoOptions, pino.destination({ dest: LOG_PATH, sync: false, mkdir: true }));
  }
  if (level === 'silent') return pino(pinoOptions);
  return pino({
    ...pinoOptions,
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });
}

export const logger = createLogger();
