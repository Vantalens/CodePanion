import { invoke } from '@tauri-apps/api/core';
import type {
  DaemonConfig,
  GateDecisionPayload,
  ModelBinding,
  ModelInfo,
  ProjectSummary,
  ProviderConfig,
  WorkflowArtifact,
  WorkflowBoard,
  WorkflowDefinition,
  WorkflowGate,
  WorkflowRunDetail,
  WorkflowRunEvent,
  WorkflowRunSummary,
} from '../types';

type JsonRecord = Record<string, unknown>;

function isTauriRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function ensureDaemon(): Promise<DaemonConfig> {
  if (!isTauriRuntime()) {
    return {
      url: 'http://127.0.0.1:8318',
      wsUrl: 'ws://127.0.0.1:8318/ws',
      token: '',
      port: 8318,
    };
  }
  await invoke('ensure_daemon');
  const config = await invoke<DaemonConfig>('get_daemon_config');
  return config;
}

export async function stopDaemon(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('stop_daemon');
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_external', { url });
}

export class DaemonClient {
  constructor(private readonly config: DaemonConfig) {}

  connectRunEvents(onEvent: (event: WorkflowRunEvent) => void, onClose: () => void): WebSocket {
    const protocols = this.config.token ? [`codepanion.token.${this.config.token}`] : undefined;
    const ws = new WebSocket(this.config.wsUrl, protocols);
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.type === 'workflow-run-event') {
          onEvent(payload.event ?? payload);
        } else {
          onEvent(payload);
        }
      } catch {
        onEvent({ type: 'ws-message', text: String(event.data) });
      }
    };
    ws.onclose = onClose;
    ws.onerror = onClose;
    return ws;
  }

  health(): Promise<unknown> {
    return this.get('/health');
  }

  getProjects(): Promise<{ projects: ProjectSummary[] }> {
    return this.get('/api/v1/projects');
  }

  createProject(payload: { name: string; path: string; description?: string }): Promise<ProjectSummary> {
    return this.post('/api/v1/projects', payload);
  }

  updateProject(projectId: string, payload: { name: string; path: string; description?: string }): Promise<ProjectSummary> {
    return this.put(`/api/v1/projects/${encodeURIComponent(projectId)}`, payload);
  }

  deleteProject(projectId: string): Promise<unknown> {
    return this.delete(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  }

  activateProject(projectId: string): Promise<ProjectSummary> {
    return this.post(`/api/v1/projects/${encodeURIComponent(projectId)}/activate`, {});
  }

  getBoard(workspace?: string): Promise<WorkflowBoard> {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.get(`/workflow/board${query}`);
  }

  getGlobalRuns(status?: string): Promise<{ runs: WorkflowRunSummary[] }> {
    const normalized = status && status !== 'all' ? status : '';
    const path = normalized ? `/api/v1/global/runs/${encodeURIComponent(normalized)}` : '/api/v1/global/runs';
    return this.get(path);
  }

  getGlobalGates(): Promise<{ gates: WorkflowGate[] }> {
    return this.get('/workflow/gates');
  }

  getGlobalWorkflows(): Promise<{ workflows: WorkflowDefinition[] }> {
    return this.get('/api/v1/orchestrator/workflows');
  }

  getRun(runId: string, workspace?: string): Promise<WorkflowRunDetail> {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.get(`/workflow/runs/${encodeURIComponent(runId)}${query}`);
  }

  launchWorkflow(workflow: string, workspace?: string): Promise<unknown> {
    return this.post('/workflow/runs', workspace ? { workflow, workspace } : { workflow });
  }

  cancelRun(runId: string): Promise<unknown> {
    return this.post(`/api/v1/workflows/${encodeURIComponent(runId)}/cancel`, {});
  }

  resolveGate(runId: string, stepId: string, payload: GateDecisionPayload): Promise<unknown> {
    return this.post(
      `/workflow/gates/${encodeURIComponent(runId)}/${encodeURIComponent(stepId)}/resolve`,
      payload,
    );
  }

  getGateHistory(runId: string, stepId: string): Promise<{ history: JsonRecord[] }> {
    return this.get(`/api/v1/workflow/gates/${encodeURIComponent(runId)}/${encodeURIComponent(stepId)}/history`);
  }

  getArtifacts(runId: string): Promise<{ artifacts: WorkflowArtifact[] }> {
    return this.get(`/workflow/runs/${encodeURIComponent(runId)}/artifacts`);
  }

  getDelivery(runId: string, format: 'markdown' | 'handoff'): Promise<{ delivery: string } | string> {
    return this.get(`/workflow/runs/${encodeURIComponent(runId)}/delivery?format=${format}`);
  }

  getProviders(): Promise<{ providers: ProviderConfig[] }> {
    return this.get('/api/v1/providers');
  }

  createProvider(payload: JsonRecord): Promise<ProviderConfig> {
    return this.post('/api/v1/providers', payload);
  }

  updateProvider(providerId: string, payload: JsonRecord): Promise<ProviderConfig> {
    return this.put(`/api/v1/providers/${encodeURIComponent(providerId)}`, payload);
  }

  deleteProvider(providerId: string): Promise<unknown> {
    return this.delete(`/api/v1/providers/${encodeURIComponent(providerId)}`);
  }

  activateProvider(providerId: string): Promise<ProviderConfig> {
    return this.post(`/api/v1/providers/${encodeURIComponent(providerId)}/activate`, {});
  }

  testProvider(providerId: string): Promise<unknown> {
    return this.post(`/api/v1/providers/${encodeURIComponent(providerId)}/test`, {});
  }

  getModels(): Promise<{ models: ModelInfo[]; defaultModel?: string; roleBindings?: ModelBinding }> {
    return this.get('/api/v1/models');
  }

  setDefaultModel(modelId: string): Promise<unknown> {
    return this.post('/api/v1/models/default', { modelId });
  }

  setRoleBinding(role: string, modelId: string): Promise<unknown> {
    return this.post('/api/v1/models/role-binding', { role, modelId });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const detail = err instanceof Error ? ` ${err.message}` : '';
      throw new Error(
        `Cannot reach CodePanion daemon at ${this.config.url}. Start the desktop app or run the Rust daemon first.${detail}`,
      );
    }
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null
          ? ((data as JsonRecord).error as string | undefined) ??
            ((data as JsonRecord).message as string | undefined) ??
            text
          : text;
      throw new Error(message);
    }
    return data as T;
  }
}
