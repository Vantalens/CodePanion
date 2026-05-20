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
  wsProtocols,
  checkHealth,
} from '../shared/client.js';
import { PromptDetector } from './promptDetector.js';
import type { WsServerEvent } from '../shared/protocol.js';

export interface RunArgs {
  command: string;
  args: string[];
  cwd?: string;
}

function debug(...args: unknown[]) {
  if (process.env.CODEPANION_DEBUG === '1' || process.env.LOG_LEVEL === 'debug') {
    console.error('[codepanion-debug]', ...args);
  }
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
    const reason = health.error ? ` (${health.error})` : '';
    console.error(`[codepanion] daemon is not running${reason}. Run \`codepanion start\` first.`);
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
    debug('pty.spawn shell=', shell, 'args=', input.args);
    term = pty.spawn(shell, input.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: input.cwd ?? process.cwd(),
      env: { ...process.env } as Record<string, string>,
    });
    debug('pty spawned pid=', term.pid);
  } catch (err) {
    console.error(`[codepanion] failed to spawn pty for ${shell}: ${(err as Error).message}`);
    process.exit(2);
  }

  debug('connecting ws...');
  const ws = new WebSocket(wsUrl('cli', session.id), wsProtocols());
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      debug('ws open');
      resolve();
    });
    ws.once('error', (err) => {
      // Surface url-stripped reason so the user can tell daemon-down from auth failure.
      debug('ws connect failed', (err as Error).message);
      reject(err);
    });
  });

  ws.on('message', (raw) => {
    try {
      const event = JSON.parse(raw.toString()) as WsServerEvent;
      if (event.type === 'inject-input' && event.sessionId === session.id) {
        term.write(event.text);
      }
    } catch (err) {
      debug('ws message parse failed', (err as Error).message);
    }
  });

  // `.catch(() => {})` previously swallowed daemon-side failures whole, so a half-broken daemon
  // would silently drop prompts/output/exit without the user ever noticing. Now we route each
  // failure through `debug()` — silent in normal runs, but `CODEPANION_DEBUG=1` / `LOG_LEVEL=debug`
  // surfaces method/path/status from DaemonHttpError. PTY stdout stays clean.
  const reportClientFailure = (label: string) => (err: Error) => {
    const httpErr = err as Partial<{ method: string; path: string; status: number }> & Error;
    if (httpErr.method && httpErr.path) {
      debug(`${label} failed`, `${httpErr.method} ${httpErr.path}`, `status=${httpErr.status ?? '?'}`, httpErr.message);
    } else {
      debug(`${label} failed`, err.message);
    }
  };

  const detector = new PromptDetector({
    idleMs: cfg.promptIdleMs,
    onPrompt: (lastLines, options) => {
      postPrompt(session.id, lastLines, options).catch(reportClientFailure('postPrompt'));
    },
  });

  let outputQueue: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (outputQueue.length === 0) return;
    const chunk = outputQueue.join('');
    outputQueue = [];
    flushTimer = null;
    postOutput(session.id, chunk).catch(reportClientFailure('postOutput'));
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
  const onStdinData = (d: Buffer) => term.write(d.toString('utf8'));
  process.stdin.on('data', onStdinData);

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
      postExit(session.id, exitCode).catch(reportClientFailure('postExit'));
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {}
      process.stdin.off('data', onStdinData);
      process.stdin.pause();
      process.stdout.off('resize', onResize);
      try {
        ws.close();
        ws.terminate();
      } catch {}
      resolve(exitCode);
    });
  });
}
