import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SessionInfo, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { RETENTION_DEFAULTS } from '../config.js';

export type SessionRetentionOptions = {
  fullOutputChars?: number;
  outputChunks?: number;
};

export interface OutputChunk {
  timestamp: number;
  content: string;
  type: 'output' | 'prompt' | 'reply';
}

export interface SessionRecord extends SessionInfo {
  cliPid: number;
  cliSocket?: WebSocket;
  outputBuffer: string;
  fullOutput: string[];
  fullOutputChars: number;
  outputChunks: OutputChunk[];
  lastPromptOptions?: string[];
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private listeners = new Set<(event: WsServerEvent) => void>();
  private readonly maxFullOutputChars: number;
  private readonly maxOutputChunks: number;

  constructor(options: { retention?: SessionRetentionOptions } = {}) {
    this.maxFullOutputChars = options.retention?.fullOutputChars ?? RETENTION_DEFAULTS.session.fullOutputChars;
    this.maxOutputChunks = options.retention?.outputChunks ?? RETENTION_DEFAULTS.session.outputChunks;
  }

  register(input: {
    id?: string;
    command: string;
    args: string[];
    cwd?: string;
    cliPid: number;
    source?: string;
    sourceId?: string;
    windowTitle?: string;
    workspace?: string;
    parentThreadId?: string;
  }): SessionInfo {
    const id = input.id ?? randomUUID();
    const rec: SessionRecord = {
      id,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      source: input.source ?? 'cli',
      sourceId: input.sourceId,
      windowTitle: input.windowTitle,
      workspace: input.workspace,
      parentThreadId: input.parentThreadId,
      cliPid: input.cliPid,
      startedAt: Date.now(),
      status: 'running',
      outputBuffer: '',
      fullOutput: [],
      fullOutputChars: 0,
      outputChunks: [],
    };
    this.sessions.set(id, rec);
    this.broadcast({ type: 'session-registered', session: this.toInfo(rec) });
    logger.info({ id, command: input.command }, 'session registered');
    return this.toInfo(rec);
  }

  attachCliSocket(id: string, ws: WebSocket): boolean {
    const rec = this.sessions.get(id);
    if (!rec) return false;
    rec.cliSocket = ws;
    return true;
  }

  appendOutput(id: string, chunk: string) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    // 已 exited 的会话在 60s 删除窗口内可能仍收到延迟输出，绝不能把状态拉回 running。
    if (rec.status === 'exited') return;

    rec.outputBuffer = (rec.outputBuffer + chunk).slice(-8192);
    this.appendFullOutput(rec, chunk);
    this.appendOutputChunk(rec, {
      timestamp: Date.now(),
      content: chunk,
      type: 'output'
    });

    // 区分 spinner 心跳与真实输出：
    // - spinner 只用 \r 覆盖当前行（无 \n）→ 仍属"等待用户回复"阶段，保留 options + waiting
    //   否则随后到来的 inject reply 会拿不到 option 列表而被判 invalid-reply
    // - 含 \n 的输出代表 CLI 已越过当前 prompt → 清掉 options 并把 waiting 转回 running，
    //   避免用户在 CLI 终端直接回车（不走 daemon inject）后 GUI 卡在「等待但无选项」死锁态
    if (chunk.includes('\n')) {
      rec.lastPromptOptions = undefined;
      if (rec.status === 'waiting') rec.status = 'running';
    }
    this.broadcast({ type: 'session-output', sessionId: id, chunk });
  }

  markPrompt(id: string, lastLines: string, options?: string[]) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    rec.status = 'waiting';
    rec.lastPrompt = lastLines;
    rec.lastPromptOptions = options;

    this.appendOutputChunk(rec, {
      timestamp: Date.now(),
      content: lastLines,
      type: 'prompt'
    });

    const fullOutput = rec.fullOutput.join('');

    this.broadcast({
      type: 'session-prompt',
      sessionId: id,
      lastLines,
      options,
      fullOutput
    });
  }

  markExited(id: string, exitCode: number) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    rec.status = 'exited';
    rec.exitCode = exitCode;
    rec.lastPromptOptions = undefined;
    const durationMs = Date.now() - rec.startedAt;
    this.broadcast({ type: 'session-exited', sessionId: id, exitCode, durationMs });
    setTimeout(() => this.sessions.delete(id), 60_000).unref();
  }

  injectReply(id: string, text: string): 'ok' | 'not-connected' | 'invalid-reply' {
    const rec = this.sessions.get(id);
    if (!rec || !rec.cliSocket || rec.cliSocket.readyState !== rec.cliSocket.OPEN) return 'not-connected';
    const optionIndex = this.resolvePromptOption(rec, text);
    if (optionIndex < 0) return 'invalid-reply';

    this.appendOutputChunk(rec, {
      timestamp: Date.now(),
      content: text,
      type: 'reply'
    });

    const event: WsServerEvent = { type: 'inject-input', sessionId: id, optionIndex };
    rec.cliSocket.send(JSON.stringify(event));
    this.broadcast({ type: 'reply-injected', sessionId: id, text });
    rec.status = 'running';
    rec.lastPromptOptions = undefined;
    return 'ok';
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((r) => this.toInfo(r));
  }

  get(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  getFullOutput(id: string): string | null {
    const rec = this.sessions.get(id);
    if (!rec) return null;
    return rec.fullOutput.join('');
  }

  getOutputChunks(id: string): OutputChunk[] | null {
    const rec = this.sessions.get(id);
    if (!rec) return null;
    return rec.outputChunks;
  }

  onEvent(listener: (event: WsServerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(event: WsServerEvent) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        logger.error({ err }, 'listener failed');
      }
    }
  }

  private toInfo(rec: SessionRecord): SessionInfo {
    const { cliSocket, outputBuffer, fullOutputChars, cliPid, fullOutput, outputChunks, ...info } = rec;
    return info;
  }

  private appendFullOutput(rec: SessionRecord, chunk: string) {
    rec.fullOutput.push(chunk);
    rec.fullOutputChars += chunk.length;

    while (rec.fullOutputChars > this.maxFullOutputChars && rec.fullOutput.length > 1) {
      const removed = rec.fullOutput.shift() ?? '';
      rec.fullOutputChars -= removed.length;
    }

    if (rec.fullOutputChars > this.maxFullOutputChars && rec.fullOutput.length === 1) {
      rec.fullOutput[0] = rec.fullOutput[0].slice(-this.maxFullOutputChars);
      rec.fullOutputChars = rec.fullOutput[0].length;
    }
  }

  private appendOutputChunk(rec: SessionRecord, chunk: OutputChunk) {
    rec.outputChunks.push(chunk);
    if (rec.outputChunks.length > this.maxOutputChunks) {
      rec.outputChunks.splice(0, rec.outputChunks.length - this.maxOutputChunks);
    }
  }

  private resolvePromptOption(rec: SessionRecord, text: string): number {
    const options = rec.lastPromptOptions;
    if (!options?.length) return -1;
    const normalized = normalizeReplyText(text);
    return options.findIndex((option) => {
      const normalizedOption = normalizeReplyText(option);
      return normalized === normalizedOption || normalized === optionReplyToken(normalizedOption);
    });
  }
}

function normalizeReplyText(text: string): string {
  return text.trim().replace(/\r?\n$/, '');
}

function optionReplyToken(option: string): string {
  const numbered = option.match(/^(\d+)[.)\]]?\s+/);
  if (numbered) return numbered[1];
  return option;
}
