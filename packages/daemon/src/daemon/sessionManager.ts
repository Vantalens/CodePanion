import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SessionInfo, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';

export interface SessionRecord extends SessionInfo {
  cliPid: number;
  cliSocket?: WebSocket;
  outputBuffer: string;
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private listeners = new Set<(event: WsServerEvent) => void>();

  register(input: {
    command: string;
    args: string[];
    cwd?: string;
    cliPid: number;
  }): SessionInfo {
    const id = randomUUID();
    const rec: SessionRecord = {
      id,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      cliPid: input.cliPid,
      startedAt: Date.now(),
      status: 'running',
      outputBuffer: '',
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
    rec.outputBuffer = (rec.outputBuffer + chunk).slice(-8192);
    rec.status = 'running';
    this.broadcast({ type: 'session-output', sessionId: id, chunk });
  }

  markPrompt(id: string, lastLines: string, options?: string[]) {
    const rec = this.sessions.get(id);
    if (!rec) return;
    rec.status = 'waiting';
    rec.lastPrompt = lastLines;
    this.broadcast({ type: 'session-prompt', sessionId: id, lastLines, options });
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
