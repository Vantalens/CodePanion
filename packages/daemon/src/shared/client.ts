import { loadConfig } from '../config.js';
import type { NotifyRequest, RegisterSessionRequest, SessionInfo } from './protocol.js';

function baseUrl() {
  const cfg = loadConfig();
  return { url: `http://127.0.0.1:${cfg.port}`, token: cfg.token };
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
    throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function checkHealth(): Promise<{ ok: boolean; pid?: number }> {
  try {
    const { url } = baseUrl();
    const res = await fetch(`${url}/health`);
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; pid?: number };
  } catch {
    return { ok: false };
  }
}

export function notify(payload: NotifyRequest): Promise<unknown> {
  return request('POST', '/notify', payload);
}

export function registerSession(payload: RegisterSessionRequest): Promise<SessionInfo> {
  return request<SessionInfo>('POST', '/sessions', payload);
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

export function wsUrl(role: 'observer' | 'cli', sessionId?: string): string {
  const cfg = loadConfig();
  const params = new URLSearchParams({ token: cfg.token, role });
  if (sessionId) params.set('sessionId', sessionId);
  return `ws://127.0.0.1:${cfg.port}/ws?${params.toString()}`;
}
