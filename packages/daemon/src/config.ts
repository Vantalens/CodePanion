import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const HOME_DIR = join(homedir(), '.remindai');
export const CONFIG_PATH = join(HOME_DIR, 'config.json');
export const PID_PATH = join(HOME_DIR, 'daemon.pid');
export const LOG_PATH = join(HOME_DIR, 'log.jsonl');

const TemplateSchema = z.object({
  label: z.string().min(1),
  text: z.string(),
});

const MonitorsSchema = z
  .object({
    cli: z.boolean().default(true),
    vscode: z.boolean().default(true),
    browserExtension: z.boolean().default(true),
    browserAllowlist: z.array(z.string()).default([
      'chat.openai.com',
      'chatgpt.com',
      'claude.ai',
      'github.com',
    ]),
  })
  .default({
    cli: true,
    vscode: true,
    browserExtension: true,
    browserAllowlist: ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'github.com'],
  });

const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7777),
  token: z.string().min(16),
  promptIdleMs: z.number().int().min(100).default(800),
  toast: z
    .object({
      enabled: z.boolean().default(true),
      soundOnPrompt: z.boolean().default(true),
      soundOnDone: z.boolean().default(true),
    })
    .default({ enabled: true, soundOnPrompt: true, soundOnDone: true }),
  monitors: MonitorsSchema,
  templates: z.array(TemplateSchema).default([
    { label: '继续', text: '继续\n' },
    { label: '全部接受', text: '1\n' },
    { label: '取消', text: 'no\n' },
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Template = z.infer<typeof TemplateSchema>;

function ensureDir() {
  if (!existsSync(HOME_DIR)) mkdirSync(HOME_DIR, { recursive: true });
}

export function loadConfig(): Config {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) {
    const initial: Config = ConfigSchema.parse({
      token: randomBytes(16).toString('hex'),
    });
    writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!raw.token) raw.token = randomBytes(16).toString('hex');
  const parsed = ConfigSchema.parse(raw);
  if (raw.token !== parsed.token || !existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
  }
  return parsed;
}

export function saveConfig(cfg: Config) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
