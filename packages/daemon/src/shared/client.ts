import { loadConfig } from '../config.js';
import type {
  MonitorEvent,
  MonitorSource,
  NotifyRequest,
  RegisterSessionRequest,
  RegisterSourceRequest,
  SessionInfo,
} from './protocol.js';

function baseUrl() {
  const cfg = loadConfig();
  return { url: `http://127.0.0.1:${cfg.port}`, token: cfg.token };
}

/**
 * HTTP failure with enough structured context that callers logging `{ err }` via pino
 * (or printing err.message) can pinpoint the call without re-parsing a free-form string.
 * Fields are intentionally enumerable so they survive pino's stdSerializers.err / our maskValue serializer.
 */
export class DaemonHttpError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    const snippet = body.slice(0, 200);
    super(`${method} ${path} failed: ${status}${snippet ? ` ${snippet}` : ''}`);
    this.name = 'DaemonHttpError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body.slice(0, 4096);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, token } = baseUrl();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DaemonHttpError(method, path, res.status, text);
  }
  return (await res.json()) as T;
}

export async function checkHealth(): Promise<{ ok: boolean; pid?: number; error?: string }> {
  try {
    const { url } = baseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${url}/health`, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as { ok: boolean; pid?: number };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function notify(payload: NotifyRequest): Promise<unknown> {
  return request('POST', '/notify', payload);
}

export function registerSession(payload: RegisterSessionRequest): Promise<SessionInfo> {
  return request<SessionInfo>('POST', '/sessions', payload);
}

export function registerSource(payload: RegisterSourceRequest): Promise<MonitorSource> {
  return request<MonitorSource>('POST', '/sources/register', payload);
}

export function postMonitorEvent(payload: MonitorEvent): Promise<unknown> {
  return request('POST', '/events', payload);
}

export function postMonitorEventReply(eventId: string, text: string): Promise<unknown> {
  return request('POST', `/events/${encodeURIComponent(eventId)}/reply`, { text });
}

export function listMonitorEventReplies(eventId: string): Promise<{
  eventId: string;
  replies: Array<{ eventId: string; sourceId?: string; text: string; timestamp: number }>;
}> {
  return request('GET', `/events/${encodeURIComponent(eventId)}/replies`);
}

export function listSources(): Promise<MonitorSource[]> {
  return request<MonitorSource[]>('GET', '/sources');
}

export function postOutput(id: string, chunk: string): Promise<unknown> {
  return request('POST', `/sessions/${id}/output`, { chunk });
}

export function postPrompt(id: string, lastLines: string, options?: string[]): Promise<unknown> {
  return request('POST', `/sessions/${id}/prompt`, { lastLines, options });
}

export function postExit(id: string, exitCode: number): Promise<unknown> {
  return request('POST', `/sessions/${id}/exit`, { exitCode });
}

export function postReply(id: string, text: string): Promise<unknown> {
  return request('POST', `/sessions/${id}/reply`, { text });
}

export function listSessions(): Promise<SessionInfo[]> {
  return request<SessionInfo[]>('GET', '/sessions');
}

export function getSessionOutput(id: string): Promise<{ fullOutput: string; chunks: any[] }> {
  return request<{ fullOutput: string; chunks: any[] }>('GET', `/sessions/${id}/output`);
}

export type AuditSnapshot = {
  schemaVersion: number;
  generatedAt: number;
  since: number | null;
  daemonVersion: string;
  sources: MonitorSource[];
  events: Array<MonitorEvent & { id: string; timestamp: number }>;
  eventReplies: Array<{ eventId: string; sourceId?: string; text: string; timestamp: number }>;
  sessions: SessionInfo[];
  workflowThreads: unknown[];
  workflowItems: unknown[];
};

export function getAuditSnapshot(options: { since?: number } = {}): Promise<AuditSnapshot> {
  const query = options.since !== undefined ? `?since=${encodeURIComponent(String(options.since))}` : '';
  return request<AuditSnapshot>('GET', `/audit/snapshot${query}`);
}

export function wsUrl(role: 'observer' | 'cli', sessionId?: string): string {
  const cfg = loadConfig();
  const params = new URLSearchParams({ role });
  if (sessionId) params.set('sessionId', sessionId);
  return `ws://127.0.0.1:${cfg.port}/ws?${params.toString()}`;
}

export function wsProtocols(): string[] {
  const cfg = loadConfig();
  return [`codepanion.token.${cfg.token}`];
}
