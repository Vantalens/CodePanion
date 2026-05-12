import * as pty from 'node-pty';
import WebSocket from 'ws';
import { execSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import {
  registerSession,
  postOutput,
  postPrompt,
  postExit,
  wsUrl,
  checkHealth,
} from '../shared/client.js';
import { PromptDetector } from './promptDetector.js';
import type { WsServerEvent } from '../shared/protocol.js';

export interface RunArgs {
  command: string;
  args: string[];
  cwd?: string;
}

function resolveExecutable(name: string): string {
  if (/[\\/]/.test(name)) return name;
  const isWin = process.platform === 'win32';
  const cmd = isWin ? `where "${name}"` : `command -v "${name}"`;
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (first) return first;
  } catch {}
  if (isWin && !/\.[a-z0-9]+$/i.test(name)) {
    for (const ext of ['.cmd', '.bat', '.exe']) {
      try {
        const out = execSync(`where "${name}${ext}"`, {
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString();
        const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
        if (first) return first;
      } catch {}
    }
  }
  return name;
}

export async function runWithPty(input: RunArgs): Promise<number> {
  const cfg = loadConfig();
  const health = await checkHealth();
  if (!health.ok) {
    console.error('[remindai] daemon is not running. Run `remindai start` first.');
    process.exit(2);
  }

  const session = await registerSession({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    cliPid: process.pid,
  });

  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 30;
  const shell = resolveExecutable(input.command);

  let term: pty.IPty;
  try {
    console.error('[remindai-debug] pty.spawn shell=', shell, 'args=', input.args);
    term = pty.spawn(shell, input.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: input.cwd ?? process.cwd(),
      env: { ...process.env } as Record<string, string>,
    });
    console.error('[remindai-debug] pty spawned pid=', term.pid);
  } catch (err) {
    console.error(`[remindai] failed to spawn pty for ${shell}: ${(err as Error).message}`);
    process.exit(2);
  }

  console.error('[remindai-debug] connecting ws...');
  const ws = new WebSocket(wsUrl('cli', session.id));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      console.error('[remindai-debug] ws open');
      resolve();
    });
    ws.once('error', reject);
  });

  ws.on('message', (raw) => {
    try {
      const event = JSON.parse(raw.toString()) as WsServerEvent;
      if (event.type === 'inject-input' && event.sessionId === session.id) {
        term.write(event.text);
      }
    } catch {}
  });

  const detector = new PromptDetector({
    idleMs: cfg.promptIdleMs,
    onPrompt: (lastLines, options) => {
      postPrompt(session.id, lastLines, options).catch(() => {});
    },
  });

  let outputQueue: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (outputQueue.length === 0) return;
    const chunk = outputQueue.join('');
    outputQueue = [];
    flushTimer = null;
    postOutput(session.id, chunk).catch(() => {});
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 80);
  };

  term.onData((data) => {
    process.stdout.write(data);
    detector.feed(data);
    outputQueue.push(data);
    if (outputQueue.join('').length > 2048) flush();
    else scheduleFlush();
  });

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (d) => term.write(d.toString('utf8')));

  const onResize = () => {
    const c = process.stdout.columns ?? 120;
    const r = process.stdout.rows ?? 30;
    try {
      term.resize(c, r);
    } catch {}
  };
  process.stdout.on('resize', onResize);

  return await new Promise<number>((resolve) => {
    term.onExit(({ exitCode }) => {
      detector.stop();
      flush();
      postExit(session.id, exitCode).catch(() => {});
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {}
      try {
        ws.close();
      } catch {}
      resolve(exitCode);
    });
  });
}
