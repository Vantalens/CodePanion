import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HOOK_TAG = 'codepanion-managed';

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; timeout?: number; tag?: string }>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

function escapeForShell(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function buildNotifyCommand(source: string, message: string, level: string): string {
  // Delegates auth to `codepanion notify`, which reads the token from the
  // owner-protected config.json. Avoids embedding bearer tokens into a
  // world-readable shell command stored in ~/.claude/settings.json.
  const parts = [
    'codepanion',
    'notify',
    escapeForShell(source),
    '--message',
    escapeForShell(message),
    '--source',
    escapeForShell(source),
    '--level',
    escapeForShell(level),
  ];
  return parts.join(' ');
}

export async function installCommand(args: { target: string }) {
  const target = args.target ?? 'claude-code';
  if (target !== 'claude-code') {
    console.error(`unsupported target: ${target}`);
    process.exit(2);
  }
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.error(`[codepanion] failed to parse ${settingsPath}: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  if (!settings.hooks) settings.hooks = {};

  const events: Array<{ name: string; message: string; level: 'done' | 'prompt' }> = [
    { name: 'Stop', message: 'Claude Code 回复完成', level: 'done' },
    { name: 'Notification', message: 'Claude Code 等待输入', level: 'prompt' },
  ];

  for (const ev of events) {
    const arr = (settings.hooks[ev.name] ??= []);
    const filtered = arr
      .map((entry) => {
        const hooks = entry.hooks.filter((h) => h.tag !== HOOK_TAG);
        return hooks.length === entry.hooks.length ? entry : { ...entry, hooks };
      })
      .filter((entry) => entry.hooks.length > 0);
    filtered.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: buildNotifyCommand('claude-code', ev.message, ev.level),
          tag: HOOK_TAG,
        },
      ],
    });
    settings.hooks[ev.name] = filtered;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (platform() !== 'win32') {
    try {
      chmodSync(settingsPath, 0o600);
    } catch {
      // best-effort
    }
  }
  console.log(`[codepanion] installed Claude Code hooks into ${settingsPath}`);
  console.log(`[codepanion] hooks invoke 'codepanion notify' — ensure 'codepanion' is on PATH (npm link in packages/daemon).`);
}
