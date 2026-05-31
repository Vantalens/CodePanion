import { homedir, platform, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
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

// 执行模型两轴重构：模型 API 后端。architecture=agent 的 step 通过 modelClient 调这里配置的后端。
// 目前只支持 OpenAI 兼容的 /chat/completions（DeepSeek 等都用这套），baseURL 不带末尾 /chat/completions。
// apiKey 是敏感凭据：config.json 由 writeOwnerOnly 以 0600 / Windows ACL 保护，logger 已对 apiKey 脱敏。
const ModelBackendSchema = z.object({
  kind: z.literal('openai-compatible').default('openai-compatible'),
  baseURL: z.string().min(1),
  apiKey: z.string().default(''),
  model: z.string().min(1),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
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
  // 模型后端注册表：key 是 model id（被 step.model / roleBinding.model / defaultModel 引用）。
  models: z.record(z.string().min(1), ModelBackendSchema).default({}),
  // 未在 step / role 指定 model 时回退的 model id。
  defaultModel: z.string().optional(),
  // agent tool-use 循环参数。maxTurns 是单个 agent step 内「模型↔工具」的最大往返轮数上限。
  agent: z
    .object({
      maxTurns: z.number().int().positive().max(100).default(12),
    })
    .default({ maxTurns: 12 }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ModelBackend = z.infer<typeof ModelBackendSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type RetentionConfig = z.infer<typeof RetentionSchema>;

function ensureDir(homeDir = HOME_DIR) {
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    if (platform() === 'win32') {
      lockdownWindowsAcl(homeDir);
    } else {
      try {
        chmodSync(homeDir, OWNER_ONLY_DIR_MODE);
      } catch {
        // best-effort
      }
    }
  }
}

function buildDefaultConfig(): Config {
  return ConfigSchema.parse({
    token: randomBytes(16).toString('hex'),
  });
}

function quarantineConfigFile(configPath: string, reason: string): void {
  // 与 N-9 / N-16 工作流定义和模板的损坏隔离策略保持一致：把损坏的 config.json 改名为
  // `config.json.broken-<ts>.json`，把 daemon 启动路径从「crash」改成「降级到默认 config 并写一条 warn」。
  // 这样用户手动编辑 config.json 出错、断电写入中断都不会让 daemon 整体起不来。
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${configPath}.broken-${ts}.json`;
    renameSync(configPath, target);
    // 不能 import logger.ts（循环依赖：logger.ts 用 config 的 LOG_PATH），写到 stderr 即可，
    // logger 起来后 daemon 的运行循环里只会读到 default config，不再触碰损坏文件。
    console.warn(`[config] config.json 已隔离到 ${target}（${reason}），使用默认配置继续。`);
  } catch (err) {
    console.warn(`[config] config.json 隔离失败：${(err as Error).message}`);
  }
}

export function loadConfig(): Config {
  return loadConfigFromPath(CONFIG_PATH);
}

export function loadConfigFromPath(configPath: string): Config {
  ensureDir(dirname(configPath));
  if (!existsSync(configPath)) {
    const initial = buildDefaultConfig();
    writeOwnerOnly(configPath, JSON.stringify(initial, null, 2));
    return initial;
  }
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    quarantineConfigFile(configPath, `JSON 解析失败：${(err as Error).message}`);
    const fresh = buildDefaultConfig();
    writeOwnerOnly(configPath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  if (!raw || typeof raw !== 'object') {
    quarantineConfigFile(configPath, 'JSON 顶层不是对象');
    const fresh = buildDefaultConfig();
    writeOwnerOnly(configPath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  if (!raw.token) raw.token = randomBytes(16).toString('hex');
  let parsed: Config;
  try {
    parsed = ConfigSchema.parse(raw);
  } catch (err) {
    quarantineConfigFile(configPath, `schema 校验失败：${(err as Error).message}`);
    const fresh = buildDefaultConfig();
    writeOwnerOnly(configPath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  const migrated = migrateLegacyDefaults(raw, parsed);
  if (raw.token !== parsed.token || migrated || !existsSync(configPath)) {
    writeOwnerOnly(configPath, JSON.stringify(parsed, null, 2));
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
