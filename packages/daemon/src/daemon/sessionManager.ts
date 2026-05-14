import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SessionInfo, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';

export interface OutputChunk {
  timestamp: number;
  content: string;
  type: 'output' | 'prompt' | 'reply';
}

export interface SessionRecord extends SessionInfo {
  cliPid: number;
  cliSocket?: WebSocket;
  outputBuffer: string;
  fullOutput: string[];        // 新增：完整输出历史（字符串数组）
  outputChunks: OutputChunk[]; // 新增：结构化输出块
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private listeners = new Set<(event: WsServerEvent) => void>();

  register(input: {
    command: string;
    args: string[];
    cwd?: string;
    cliPid: number;
    source?: string;
    sourceId?: string;
    windowTitle?: string;
    workspace?: string;
  }): SessionInfo {
    const id = randomUUID();
    const rec: SessionRecord = {
      id,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      source: input.source ?? 'cli',
      sourceId: input.sourceId,
      windowTitle: input.windowTitle,
      workspace: input.workspace,
      cliPid: input.cliPid,
      startedAt: Date.now(),
      status: 'running',
      outputBuffer: '',
      fullOutput: [],        // 初始化完整输出
      outputChunks: [],      // 初始化输出块
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

    // 保留滑动窗口（用于提示检测）
    rec.outputBuffer = (rec.outputBuffer + chunk).slice(-8192);

    // 保存完整历史
    rec.fullOutput.push(chunk);

    // 结构化存储
    rec.outputChunks.push({
      timestamp: Date.now(),
      content: chunk,
      type: 'output'
    });

    rec.status = 'running';
    this.broadcast({ type: 'session-output', sessionId: id, chunk });
  }

  markPrompt(id: string, lastLines: string, options?: string[]) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    rec.status = 'waiting';
    rec.lastPrompt = lastLines;

    // 记录提示到输出块
    rec.outputChunks.push({
      timestamp: Date.now(),
      content: lastLines,
      type: 'prompt'
    });

    // 获取完整输出
    const fullOutput = rec.fullOutput.join('');

    this.broadcast({
      type: 'session-prompt',
      sessionId: id,
      lastLines,
      options,
      fullOutput  // 新增：完整输出
    });
  }

  markExited(id: string, exitCode: number) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    rec.status = 'exited';
    rec.exitCode = exitCode;
    const durationMs = Date.now() - rec.startedAt;
    this.broadcast({ type: 'session-exited', sessionId: id, exitCode, durationMs });
    setTimeout(() => this.sessions.delete(id), 60_000);
  }

  injectReply(id: string, text: string): boolean {
    const rec = this.sessions.get(id);
    if (!rec || !rec.cliSocket || rec.cliSocket.readyState !== rec.cliSocket.OPEN) return false;

    // 记录回复到输出块
    rec.outputChunks.push({
      timestamp: Date.now(),
      content: text,
      type: 'reply'
    });

    const event: WsServerEvent = { type: 'inject-input', sessionId: id, text };
    rec.cliSocket.send(JSON.stringify(event));
    this.broadcast({ type: 'reply-injected', sessionId: id, text });
    rec.status = 'running';
    return true;
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
    const { cliSocket, outputBuffer, cliPid, ...info } = rec;
    return info;
  }
}
