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
  sessionId?: string;
  command: string;
  args: string[];
  cwd?: string;
  source?: string;
  sourceId?: string;
  windowTitle?: string;
  workspace?: string;
  parentThreadId?: string;
  initialInput?: string;
  mirrorOutput?: boolean;
  interactiveStdin?: boolean;
}

function debug(...args: unknown[]) {
  if (process.env.CODEPANION_DEBUG === '1' || process.env.LOG_LEVEL === 'debug') {
    console.error('[codepanion-debug]', ...args);
  }
}

// N-15：CVE-2024-27980 —— Windows 上 child_process / node-pty 在生成 .cmd/.bat 时
// 实际由 cmd.exe /c 解释，参数里如果含有 & | < > ^ " 等元字符即使被引号包裹也可能逃逸
// 出 "..." 上下文并执行任意命令。Node ≥ 21.7 在 child_process 层默认拒绝，但 node-pty
// 不走 child_process。这里在 PTY spawn 之前做一次显式过滤：
//   - 仅在 Windows 且解析后的可执行文件后缀是 .cmd/.bat 时启用
//   - 含危险元字符（含换行）的参数直接拒绝，要求上层换成 .exe 或重写参数
//   - 含空白的参数用 "..." 包裹，避免被 cmd.exe 拆分
const WIN_BATCH_DANGEROUS_RE = /[&|<>^"\r\n]/;

export function isWindowsBatchShell(shell: string): boolean {
  if (process.platform !== 'win32') return false;
  return /\.(cmd|bat)$/i.test(shell);
}

export function escapeWindowsBatchArg(arg: string): string {
  if (WIN_BATCH_DANGEROUS_RE.test(arg)) {
    throw new Error(
      `CodePanion 拒绝执行：参数包含 cmd.exe 元字符（& | < > ^ " 或换行），存在 .cmd/.bat 注入风险（CVE-2024-27980）：${JSON.stringify(arg)}`,
    );
  }
  if (arg === '' || /\s/.test(arg)) return `"${arg}"`;
  return arg;
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

/**
 * daemon 进程内部跑 PTY 命令用的最小 executor：
 * - 不调用 checkHealth / registerSession（runWithPty 的那条路径会反向 fetch daemon 自己 + 自注册 session，
 *   在 daemon 内调会造成循环依赖）
 * - 只负责 spawn → 等 exit → 返回 exitCode；输出走 debug 日志
 * - 复用 resolveExecutable + Windows .cmd/.bat 注入防护
 *
 * 用于 W-32 approve 续跑、未来 GUI 触发的 workflow run 等 daemon-driven 场景，让 codex / claude / opencode
 * 这种 TTY-aware CLI 在 daemon 里也能正常跑。
 */
export async function runWithPtyHeadless(input: { command: string; args: string[] }): Promise<number> {
  const shell = resolveExecutable(input.command);
  let finalArgs: string[];
  try {
    finalArgs = isWindowsBatchShell(shell) ? input.args.map(escapeWindowsBatchArg) : input.args;
  } catch (err) {
    debug('runWithPtyHeadless escape failed', err);
    return -1;
  }
  return new Promise((resolve) => {
    let term: pty.IPty;
    try {
      term = pty.spawn(shell, finalArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      debug('runWithPtyHeadless spawn failed', err);
      resolve(-1);
      return;
    }
    term.onData((data) => debug('headless pty output', data.length, 'bytes'));
    term.onExit(({ exitCode }) => resolve(exitCode ?? -1));
  });
}

function replyTextForPromptOption(option: string): string {
  const numbered = option.trim().match(/^(\d+)[.)\]]?\s+/);
  if (numbered) return `${numbered[1]}\n`;
  return `${option.trim()}\n`;
}

export async function runWithPty(input: RunArgs): Promise<number> {
  const cfg = loadConfig();
  const health = await checkHealth();
  if (!health.ok) {
    const reason = health.error ? ` (${health.error})` : '';
    console.error(`[codepanion] daemon is not running${reason}. Run \`codepanion start\` first.`);
    process.exit(2);
  }

  // H-2：先 try pty.spawn 再 registerSession。原顺序会在 spawn 失败时留下 daemon-side ghost session，
  // GUI 会把它误判成"永远 running 的假任务"；现在 spawn 失败时 daemon 端尚未登记，无需清理。
  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 30;
  const shell = resolveExecutable(input.command);

  let finalArgs: string[];
  try {
    finalArgs = isWindowsBatchShell(shell) ? input.args.map(escapeWindowsBatchArg) : input.args;
  } catch (err) {
    console.error(`[codepanion] ${(err as Error).message}`);
    process.exit(2);
  }

  let term: pty.IPty;
  try {
    debug('pty.spawn shell=', shell, 'args=', finalArgs);
    term = pty.spawn(shell, finalArgs, {
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

  let session: Awaited<ReturnType<typeof registerSession>>;
  try {
    session = await registerSession({
      id: input.sessionId,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      cliPid: process.pid,
      source: input.source,
      sourceId: input.sourceId,
      windowTitle: input.windowTitle,
      workspace: input.workspace,
      parentThreadId: input.parentThreadId,
    });
  } catch (err) {
    // registerSession 失败后，把已经起来的 PTY 强制退出，避免成为孤儿。
    try { term.kill(); } catch {}
    console.error(`[codepanion] failed to register session: ${(err as Error).message}`);
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

  let currentPromptOptions: string[] = [];

  const parseWsRecord = (raw: unknown): Record<string, unknown> | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch (err) {
      debug('ws message parse failed', (err as Error).message);
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  };

  const parseInjectInputEvent = (record: Record<string, unknown>): { type: 'inject-input'; sessionId: string; optionIndex: number } | null => {
    if (record.type !== 'inject-input') return null;
    if (typeof record.sessionId !== 'string' || typeof record.optionIndex !== 'number') return null;
    if (!Number.isInteger(record.optionIndex) || record.optionIndex < 0) return null;
    return { type: 'inject-input', sessionId: record.sessionId, optionIndex: record.optionIndex };
  };

  const parseInjectTextEvent = (record: Record<string, unknown>): { type: 'inject-text'; sessionId: string; text: string } | null => {
    if (record.type !== 'inject-text') return null;
    if (typeof record.sessionId !== 'string' || typeof record.text !== 'string') return null;
    // 长度上限与 daemon HTTP schema 对齐（ReplyRequestSchema.text 上限 8192）。
    // 多一层 runner 本地校验，避免畸形或被中间人改写的 WS 消息把超长串塞进 PTY parser。
    if (record.text.length > 8192) return null;
    // 仅允许可打印字符与常见输入空白（\n \r \t），拒绝其余控制字符（尤其 ESC）。
    // 避免通过 WS 注入终端控制序列/不可见控制码影响 PTY 执行与显示。
    if (!/^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n\r\t]*$/u.test(record.text)) return null;
    return { type: 'inject-text', sessionId: record.sessionId, text: record.text };
  };

  ws.on('message', (raw) => {
    const record = parseWsRecord(raw);
    if (!record) return;

    const optionEvent = parseInjectInputEvent(record);
    if (optionEvent && optionEvent.sessionId === session.id && optionEvent.optionIndex < currentPromptOptions.length) {
      term.write(replyTextForPromptOption(currentPromptOptions[optionEvent.optionIndex]));
      currentPromptOptions = [];
      return;
    }

    const textEvent = parseInjectTextEvent(record);
    if (textEvent && textEvent.sessionId === session.id) {
      // P2-C 换行不变量：daemon HTTP / WS 不碰换行；runner 收到 freeform 文本后兜底加 \n，
      // 让等价于用户在终端敲回车。已带 \n 的不重复追加，避免双换行。
      term.write(textEvent.text.endsWith('\n') ? textEvent.text : `${textEvent.text}\n`);
      // 不清 currentPromptOptions——下一次 onPrompt 会覆盖。
    }
  });

  if (input.initialInput) {
    const timer = setTimeout(() => {
      try {
        term.write(input.initialInput!);
      } catch (err) {
        debug('initial input failed', (err as Error).message);
      }
    }, 120);
    if (typeof timer.unref === 'function') timer.unref();
  }

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
      currentPromptOptions = options ?? [];
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
    if (input.mirrorOutput !== false) {
      process.stdout.write(data);
    }
    detector.feed(data);
    // 不在每次输出时清 currentPromptOptions：spinner / 心跳输出仍处于等待用户回复阶段，
    // 清掉会让随后到来的 inject-input 命中空数组导致回复丢失。
    // 选项更新由下一次 onPrompt 覆盖；ws inject-input 处理后由该分支清空。
    outputQueue.push(data);
    if (outputQueue.join('').length > 2048) flush();
    else scheduleFlush();
  });

  const interactiveStdin = input.interactiveStdin !== false;
  const onStdinData = (d: Buffer) => term.write(d.toString('utf8'));
  if (interactiveStdin) {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onStdinData);
  }

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
        if (interactiveStdin && process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {}
      if (interactiveStdin) {
        process.stdin.off('data', onStdinData);
        process.stdin.pause();
      }
      process.stdout.off('resize', onResize);
      try {
        ws.close();
        ws.terminate();
      } catch {}
      resolve(exitCode);
    });
  });
}
