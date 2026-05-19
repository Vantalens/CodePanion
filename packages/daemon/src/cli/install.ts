import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';

const HOOK_TAG = 'codepanion-managed';

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; timeout?: number; tag?: string }>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

function buildCurlCommand(token: string, port: number, source: string, message: string, level: string): string {
  const body = JSON.stringify({ title: source, message, source, level });
  return `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d "${body.replace(/"/g, '\\"')}" http://127.0.0.1:${port}/notify`;
}

export async function installCommand(args: { target: string }) {
  const target = args.target ?? 'claude-code';
  if (target !== 'claude-code') {
    console.error(`unsupported target: ${target}`);
    process.exit(2);
  }
  const cfg = loadConfig();
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
          command: buildCurlCommand(cfg.token, cfg.port, 'claude-code', ev.message, ev.level),
          tag: HOOK_TAG,
        },
      ],
    });
    settings.hooks[ev.name] = filtered;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`[codepanion] installed Claude Code hooks into ${settingsPath}`);
}
