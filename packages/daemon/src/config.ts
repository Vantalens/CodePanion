import { homedir, platform, userInfo } from 'node:os';
import { join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const OWNER_ONLY_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;

function lockdownWindowsAcl(path: string) {
  // NTFS ignores POSIX mode bits, so on Windows we drop inheritance and
  // grant only the current user full control. Best-effort: any failure
  // leaves the inherited ACL in place rather than aborting the write.
  try {
    const username = userInfo().username;
    if (!username) return;
    execFileSync('icacls', [path, '/inheritance:r'], { stdio: 'ignore', windowsHide: true });
    execFileSync('icacls', [path, '/grant:r', `${username}:F`], { stdio: 'ignore', windowsHide: true });
  } catch {
    // best-effort; downstream reads still work because the user owns the file
  }
}

export function writeOwnerOnly(path: string, content: string) {
  writeFileSync(path, content, { encoding: 'utf8', mode: OWNER_ONLY_MODE });
  if (platform() === 'win32') {
    lockdownWindowsAcl(path);
  } else {
    try {
      chmodSync(path, OWNER_ONLY_MODE);
    } catch {
      // best-effort — surface via downstream read check
    }
  }
}

export const HOME_DIR = join(homedir(), '.codepanion');
export const CONFIG_PATH = join(HOME_DIR, 'config.json');
export const PID_PATH = join(HOME_DIR, 'daemon.pid');
export const LOG_PATH = join(HOME_DIR, 'log.jsonl');
export const WORKFLOW_SNAPSHOT_PATH = join(HOME_DIR, 'workflow-snapshot.json');

const TemplateSchema = z.object({
  label: z.string().min(1),
  text: z.string(),
});

const MonitorsSchema = z
  .object({
    cli: z.boolean().default(true),
    vscode: z.boolean().default(true),
    codexDesktop: z.boolean().default(true),
    aiTools: z.boolean().default(true),
  })
  .default({
    cli: true,
    vscode: true,
    codexDesktop: true,
    aiTools: true,
  });

// 保留策略默认值与各 manager 内部默认值保持一致；改动前请同步 docs/RETENTION.md。
export const RETENTION_DEFAULTS = {
  session: {
    fullOutputChars: 256 * 1024,
    outputChunks: 1000,
  },
  source: {
    events: 1000,
    repliesPerEvent: 50,
    offlineSources: 50,
  },
  workflow: {
    threads: 30,
    itemsPerThread: 120,
    seenItems: 4000,
  },
} as const;

const LEGACY_RETENTION_DEFAULTS = {
  workflow: {
    threads: 80,
    itemsPerThread: 500,
    seenItems: 8000,
  },
} as const;

const RetentionSchema = z
  .object({
    session: z
      .object({
        fullOutputChars: z.number().int().positive().default(RETENTION_DEFAULTS.session.fullOutputChars),
        outputChunks: z.number().int().positive().default(RETENTION_DEFAULTS.session.outputChunks),
      })
      .default({ ...RETENTION_DEFAULTS.session }),
    source: z
      .object({
        events: z.number().int().positive().default(RETENTION_DEFAULTS.source.events),
        repliesPerEvent: z.number().int().positive().default(RETENTION_DEFAULTS.source.repliesPerEvent),
        offlineSources: z.number().int().positive().default(RETENTION_DEFAULTS.source.offlineSources),
      })
      .default({ ...RETENTION_DEFAULTS.source }),
    workflow: z
      .object({
        threads: z.number().int().positive().default(RETENTION_DEFAULTS.workflow.threads),
        itemsPerThread: z.number().int().positive().default(RETENTION_DEFAULTS.workflow.itemsPerThread),
        seenItems: z.number().int().positive().default(RETENTION_DEFAULTS.workflow.seenItems),
      })
      .default({ ...RETENTION_DEFAULTS.workflow }),
  })
  .default({
    session: { ...RETENTION_DEFAULTS.session },
    source: { ...RETENTION_DEFAULTS.source },
    workflow: { ...RETENTION_DEFAULTS.workflow },
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
  retention: RetentionSchema,
  templates: z.array(TemplateSchema).default([
    { label: '继续', text: '继续\n' },
    { label: '全部接受', text: '1\n' },
    { label: '取消', text: 'no\n' },
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type RetentionConfig = z.infer<typeof RetentionSchema>;

function ensureDir() {
  if (!existsSync(HOME_DIR)) {
    mkdirSync(HOME_DIR, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    if (platform() === 'win32') {
      lockdownWindowsAcl(HOME_DIR);
    } else {
      try {
        chmodSync(HOME_DIR, OWNER_ONLY_DIR_MODE);
      } catch {
        // best-effort
      }
    }
  }
}

export function loadConfig(): Config {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) {
    const initial: Config = ConfigSchema.parse({
      token: randomBytes(16).toString('hex'),
    });
    writeOwnerOnly(CONFIG_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (!raw.token) raw.token = randomBytes(16).toString('hex');
  const parsed = ConfigSchema.parse(raw);
  const migrated = migrateLegacyDefaults(raw, parsed);
  if (raw.token !== parsed.token || migrated || !existsSync(CONFIG_PATH)) {
    writeOwnerOnly(CONFIG_PATH, JSON.stringify(parsed, null, 2));
  }
  return parsed;
}

function migrateLegacyDefaults(raw: any, parsed: Config): boolean {
  const workflow = raw?.retention?.workflow;
  if (!workflow) return false;
  let changed = false;
  if (workflow.threads === LEGACY_RETENTION_DEFAULTS.workflow.threads) {
    parsed.retention.workflow.threads = RETENTION_DEFAULTS.workflow.threads;
    changed = true;
  }
  if (workflow.itemsPerThread === LEGACY_RETENTION_DEFAULTS.workflow.itemsPerThread) {
    parsed.retention.workflow.itemsPerThread = RETENTION_DEFAULTS.workflow.itemsPerThread;
    changed = true;
  }
  if (workflow.seenItems === LEGACY_RETENTION_DEFAULTS.workflow.seenItems) {
    parsed.retention.workflow.seenItems = RETENTION_DEFAULTS.workflow.seenItems;
    changed = true;
  }
  return changed;
}

export function saveConfig(cfg: Config) {
  ensureDir();
  writeOwnerOnly(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
