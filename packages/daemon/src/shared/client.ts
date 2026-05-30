import { loadConfig } from '../config.js';
import type { NotifyRequest } from './protocol.js';

function baseUrl() {
  const cfg = loadConfig();
  return { url: `http://127.0.0.1:${cfg.port}`, token: cfg.token };
}

/**
 * HTTP failure with structured context. N-10：`Error.message` 仅含 method/path/status，
 * 不再把 response body 拼进字符串，避免被 pino logger / GUI 日志再次落盘。
 * Body 仍保留在 `error.body` 字段，调试时显式取用。
 */
export class DaemonHttpError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} failed: ${status}`);
    this.name = 'DaemonHttpError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body.slice(0, 4096);
  }
}

/**
 * N-11：daemon 卡死 / 单线程被长任务阻塞时，client fetch 必须有超时，
 * 否则 GUI/CLI 会无限挂起。timeout 抛 `DaemonClientTimeoutError`，
 * 调用方据此区分「连不上 daemon」与「daemon 在线但卡死」。
 */
export class DaemonClientTimeoutError extends Error {
  readonly method: string;
  readonly path: string;
  readonly timeoutMs: number;

  constructor(method: string, path: string, timeoutMs: number) {
    super(`${method} ${path} timed out after ${timeoutMs}ms`);
    this.name = 'DaemonClientTimeoutError';
    this.method = method;
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export type RequestOptions = {
  /** 长任务（handoff/workflow run）传更大的超时；普通请求建议保留默认值。 */
  timeoutMs?: number;
  /** 调用方自己控制取消时传 signal；与 timeoutMs 互不冲突。 */
  signal?: AbortSignal;
};

function resolveTimeoutMs(override?: number): number {
  if (override !== undefined && override > 0) return override;
  const raw = process.env.CODEPANION_REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { url, token } = baseUrl();
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', externalAbort, { once: true });
  }
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DaemonHttpError(method, path, res.status, text);
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !options.signal?.aborted) {
      throw new DaemonClientTimeoutError(method, path, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (options.signal) options.signal.removeEventListener('abort', externalAbort);
  }
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

// 监听路线已下线：session/source/event/audit 相关客户端方法随 daemon 端点一并移除。
// 保留 checkHealth / notify / 工作流控制台方法 / wsUrl / wsProtocols。

// ---- workflow daemon-driven endpoints（W-22/W-23/W-32/cancel）----
// CLI 镜像供 `codepanion workflow start/board/cancel/gates` 使用。

export type WorkflowBoardSnapshot = {
  workflows: Array<{ name: string; description?: string; stepCount: number; updatedAt: number }>;
  runs: Array<{
    id: string;
    workflowName: string;
    status: string;
    startedAt: number;
    endedAt: number;
    stepCount: number;
    currentStepId?: string;
    currentStepStatus?: string;
    currentStepRole?: string;
  }>;
  gates: Array<{
    runId: string;
    workflowName: string;
    stepId: string;
    role?: string;
    tool?: string;
    command?: string;
    args: string[];
    message?: string;
    artifacts: string[];
    pausedAt: number;
    lastDecision?: { decision: string; content: string; at: number };
  }>;
};

function workspaceQuery(workspace?: string): string {
  return workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
}

export function getWorkflowBoard(workspace?: string): Promise<WorkflowBoardSnapshot> {
  return request<WorkflowBoardSnapshot>('GET', `/workflow/board${workspaceQuery(workspace)}`);
}

export function getWorkflowGates(workspace?: string): Promise<{ gates: WorkflowBoardSnapshot['gates'] }> {
  return request('GET', `/workflow/gates${workspaceQuery(workspace)}`);
}

export function startWorkflowRun(payload: {
  workflow: string;
  values?: Record<string, string>;
  yes?: boolean;
  dryRun?: boolean;
  workspace?: string;
}): Promise<{ accepted: boolean; workflowName: string }> {
  return request('POST', '/workflow/runs', payload);
}

export function cancelWorkflowRun(runId: string): Promise<{ cancelled: boolean; runId: string }> {
  return request('POST', `/workflow/runs/${encodeURIComponent(runId)}/cancel`, {});
}

export type WorkflowArtifactRecord = {
  id: string;
  runId: string;
  workflowName: string;
  stepId?: string;
  role?: string;
  type: 'plan' | 'patch-summary' | 'test-result' | 'review-report' | 'human-decision' | 'delivery-note';
  title: string;
  content: string;
  files: string[];
  createdAt: number;
};

export function listWorkflowArtifacts(runId: string, workspace?: string): Promise<{ artifacts: WorkflowArtifactRecord[] }> {
  return request('GET', `/workflow/runs/${encodeURIComponent(runId)}/artifacts${workspaceQuery(workspace)}`);
}

export function resolveWorkflowGate(payload: {
  runId: string;
  stepId: string;
  decision: 'approve' | 'reject' | 'retry';
  message?: string;
  constraints?: string[];
  workspace?: string;
}): Promise<{ artifact: unknown; resumed?: boolean; resumeError?: string }> {
  const { runId, stepId, ...body } = payload;
  return request(
    'POST',
    `/workflow/gates/${encodeURIComponent(runId)}/${encodeURIComponent(stepId)}/resolve`,
    body,
  );
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
