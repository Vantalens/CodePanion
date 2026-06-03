import {
  AlertTriangle,
  Archive,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  FolderKanban,
  GitBranch,
  History,
  Loader2,
  Play,
  RefreshCcw,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaemonClient, ensureDaemon, openExternal, stopDaemon } from './daemon-client/client';
import { artifactKind, artifactPreview, splitConstraints } from './state/artifacts';
import { applyRunEvent, buildThreads } from './state/workspace';
import type {
  DaemonConfig,
  ModelBinding,
  ModelInfo,
  ProjectSummary,
  ProviderConfig,
  WorkflowArtifact,
  WorkflowBoard,
  WorkflowGate,
  WorkflowRunDetail,
  WorkflowThread,
} from './types';
import { Button, EmptyState, Field, Panel, StatusChip } from './components/Primitives';

const roles = ['orchestrator', 'planner', 'builder', 'tester', 'reviewer', 'docs'];

export function App() {
  const [config, setConfig] = useState<DaemonConfig | null>(null);
  const [client, setClient] = useState<DaemonClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [board, setBoard] = useState<WorkflowBoard | null>(null);
  const [viewMode, setViewMode] = useState<'project' | 'global'>('project');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [selectedRun, setSelectedRun] = useState<WorkflowRunDetail | null>(null);
  const [selectedGate, setSelectedGate] = useState<WorkflowGate | null>(null);
  const [artifacts, setArtifacts] = useState<WorkflowArtifact[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [delivery, setDelivery] = useState('');
  const [constraints, setConstraints] = useState('');
  const [gateMessage, setGateMessage] = useState('');
  const [gateHistory, setGateHistory] = useState<Record<string, unknown>[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [roleBindings, setRoleBindings] = useState<ModelBinding>({});
  const wsRef = useRef<WebSocket | null>(null);

  const activeProject = projects.find((project) => project.id === projectId);
  const workspace = activeProject?.path || '';
  const threads = useMemo(() => buildThreads(board), [board]);
  const selectedArtifact = useMemo(() => {
    return artifacts.find((artifact) => artifact.id === selectedArtifactId) || null;
  }, [artifacts, selectedArtifactId]);

  const refreshBoard = useCallback(async () => {
    if (!client) return;
    try {
      setError('');
      if (viewMode === 'global') {
        const [runs, gates, workflows] = await Promise.all([
          client.getGlobalRuns(statusFilter),
          client.getGlobalGates(),
          client.getGlobalWorkflows(),
        ]);
        setBoard({
          runs: runs.runs ?? [],
          gates: gates.gates ?? [],
          workflows: workflows.workflows ?? [],
        });
      } else {
        setBoard(await client.getBoard(workspace));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, statusFilter, viewMode, workspace]);

  const refreshProjects = useCallback(async () => {
    if (!client) return;
    const data = await client.getProjects();
    setProjects(data.projects ?? []);
  }, [client]);

  const refreshSettings = useCallback(async () => {
    if (!client) return;
    const [providerData, modelData] = await Promise.all([client.getProviders(), client.getModels()]);
    setProviders(providerData.providers ?? []);
    setModels(modelData.models ?? []);
    setDefaultModel(modelData.defaultModel ?? '');
    setRoleBindings(modelData.roleBindings ?? {});
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    ensureDaemon()
      .then((daemonConfig) => {
        if (cancelled) return;
        const next = new DaemonClient(daemonConfig);
        setConfig(daemonConfig);
        setClient(next);
        next
          .health()
          .then(() => {
            if (!cancelled) setConnected(true);
          })
          .catch((err) => {
            if (!cancelled) {
              setConnected(false);
              setError(err instanceof Error ? err.message : String(err));
            }
          });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!client) return;
    refreshProjects().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    refreshSettings().catch((err) => {
      console.error('Failed to load providers/models:', err);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [client, refreshProjects, refreshSettings]);

  useEffect(() => {
    refreshBoard().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [refreshBoard]);

  useEffect(() => {
    if (!client) return;
    wsRef.current?.close();
    const ws = client.connectRunEvents(
      (event) => {
        setSelectedRun((run) => applyRunEvent(run, event));
        if (event.type === 'run-finish' || event.type === 'step-finish') {
          refreshBoard().catch(() => undefined);
        }
      },
      () => setConnected(false),
    );
    ws.onopen = () => setConnected(true);
    wsRef.current = ws;
    return () => ws.close();
  }, [client, refreshBoard]);

  async function selectThread(thread: WorkflowThread) {
    setSelectedThreadId(thread.id);
    if (thread.kind === 'workflow' && thread.workflow) {
      setSelectedRun(null);
      setSelectedGate(null);
      setArtifacts([]);
      setDelivery('');
      return;
    }
    if (thread.kind === 'gate' && thread.gate) {
      setSelectedGate(thread.gate);
      await selectRun(thread.gate.runId, thread.gate);
      return;
    }
    if (thread.run?.id) {
      setSelectedGate(null);
      await selectRun(thread.run.id);
    }
  }

  async function selectRun(runId: string, gate?: WorkflowGate) {
    if (!client) return;
    const run = await client.getRun(runId, workspace);
    setSelectedRun(run);
    if (gate) setSelectedGate(gate);
    const [artifactData, deliveryData] = await Promise.all([
      client.getArtifacts(runId).catch(() => ({ artifacts: [] })),
      client.getDelivery(runId, 'markdown').catch(() => ({ delivery: '' })),
    ]);
    setArtifacts(artifactData.artifacts ?? []);
    setSelectedArtifactId(artifactData.artifacts?.[0]?.id ?? '');
    setDelivery(typeof deliveryData === 'string' ? deliveryData : deliveryData.delivery ?? '');
  }

  async function launchWorkflow(name: string) {
    if (!client) return;
    await client.launchWorkflow(name, workspace);
    await refreshBoard();
  }

  async function resolveGate(decision: 'approve' | 'reject' | 'retry') {
    if (!client || !selectedGate) return;
    await client.resolveGate(selectedGate.runId, selectedGate.stepId, {
      decision,
      constraints: splitConstraints(constraints),
      message: gateMessage.trim() || undefined,
      workspace: workspace || undefined,
    });
    setConstraints('');
    setGateMessage('');
    setSelectedGate(null);
    await refreshBoard();
  }

  async function loadGateHistory() {
    if (!client || !selectedGate) return;
    const data = await client.getGateHistory(selectedGate.runId, selectedGate.stepId);
    setGateHistory(data.history ?? []);
  }

  async function copyDelivery() {
    try {
      await navigator.clipboard.writeText(delivery || '');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setError('无法复制到剪贴板。请检查浏览器权限或使用安全上下文（HTTPS）。');
    }
  }

  async function cancelRun() {
    if (!client || !selectedRun) return;
    await client.cancelRun(selectedRun.id);
    await refreshBoard();
  }

  if (loading) {
    return (
      <div className="boot-screen">
        <Loader2 className="spin" />
        <span>启动 CodePanion 工作台...</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Bot size={18} />
          <span>CodePanion</span>
        </div>
        <div className="project-switcher">
          <FolderKanban size={15} />
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">全局工作台</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="topbar-actions">
          <span className={`connection ${connected ? 'online' : 'offline'}`}>{connected ? '已连接' : '未连接'}</span>
          <Button onClick={() => refreshBoard()} title="刷新">
            <RefreshCcw size={14} />
          </Button>
          <Button onClick={() => setSettingsOpen(true)} title="设置">
            <Settings size={14} />
          </Button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')}>x</button>
        </div>
      )}

      <main className="workbench">
        <aside className="thread-rail">
          <div className="rail-toolbar">
            <div className="segmented">
              <button className={viewMode === 'project' ? 'active' : ''} onClick={() => setViewMode('project')}>
                项目
              </button>
              <button className={viewMode === 'global' ? 'active' : ''} onClick={() => setViewMode('global')}>
                全局
              </button>
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="running">运行中</option>
              <option value="queued">队列</option>
              <option value="completed">完成</option>
              <option value="failed">失败</option>
            </select>
          </div>
          <div className="thread-list">
            {threads.length === 0 ? (
              <EmptyState title="没有任务线程" body="选择项目或启动一个 workflow 后，线程会出现在这里。" />
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  className={`thread-card ${selectedThreadId === thread.id ? 'selected' : ''}`}
                  onClick={() => selectThread(thread)}
                >
                  <span className="thread-kind">{thread.kind}</span>
                  <strong>{thread.title}</strong>
                  <span>{thread.run?.currentStepId || thread.gate?.stepId || thread.workflow?.description || 'Ready'}</span>
                  <StatusChip status={thread.status} />
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="execution-pane">
          <div className="goal-box">
            <div>
              <span className="eyebrow">Local autonomous workflow</span>
              <h1>{selectedRun?.workflowName || selectedGate?.workflowName || '选择任务线程或启动 workflow'}</h1>
            </div>
            <div className="goal-actions">
              {selectedRun && (
                <Button variant="danger" onClick={cancelRun}>
                  <Square size={14} />
                  取消
                </Button>
              )}
            </div>
          </div>

          {!selectedRun ? (
            <Panel title="可执行 Workflow">
              <div className="workflow-grid">
                {(board?.workflows ?? []).map((workflow) => (
                  <button key={workflow.name} className="workflow-card" onClick={() => launchWorkflow(workflow.name)}>
                    <Play size={16} />
                    <strong>{workflow.name}</strong>
                    <span>{workflow.description || `${workflow.stepCount ?? 0} steps`}</span>
                  </button>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="执行流" action={<StatusChip status={selectedRun.status} />}>
              <div className="timeline">
                {(selectedRun.steps ?? []).length === 0 ? (
                  <EmptyState title="暂无步骤" body="daemon 推送 step 事件后会在这里实时展开。" />
                ) : (
                  selectedRun.steps.map((step) => (
                    <article key={step.id} className="step-card" data-status={step.status || 'pending'}>
                      <header>
                        <ChevronRight size={15} />
                        <strong>{step.name || step.id}</strong>
                        <StatusChip status={step.status} />
                      </header>
                      <div className="step-meta">
                        <span>{step.role || 'role n/a'}</span>
                        <span>{step.provider || 'provider n/a'}</span>
                        <span>{step.model || 'model n/a'}</span>
                      </div>
                      <pre>{step.output || step.stdout || step.stderr || 'No output yet.'}</pre>
                    </article>
                  ))
                )}
              </div>
            </Panel>
          )}
        </section>

        <aside className="context-pane">
          <Panel title="人工门" action={selectedGate ? <StatusChip status="paused" /> : null}>
            {selectedGate ? (
              <div className="gate-panel">
                <strong>{selectedGate.workflowName || selectedGate.stepId}</strong>
                <span className="muted">run={selectedGate.runId}</span>
                <Field label="约束">
                  <textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={4} />
                </Field>
                <Field label="备注">
                  <input value={gateMessage} onChange={(event) => setGateMessage(event.target.value)} />
                </Field>
                <div className="button-row">
                  <Button variant="primary" onClick={() => resolveGate('approve')}>
                    <Check size={14} />
                    通过
                  </Button>
                  <Button onClick={() => resolveGate('retry')}>重试</Button>
                  <Button variant="danger" onClick={() => resolveGate('reject')}>
                    <X size={14} />
                    拒绝
                  </Button>
                  <Button onClick={loadGateHistory}>
                    <History size={14} />
                  </Button>
                </div>
                {gateHistory.length > 0 && <pre className="compact-pre">{JSON.stringify(gateHistory, null, 2)}</pre>}
              </div>
            ) : (
              <EmptyState title="没有选中的人工门" body="从左侧 gate 线程进入后可批准、拒绝或重试。" />
            )}
          </Panel>

          <Panel title="产物与交付" action={<Archive size={15} />}>
            <div className="artifact-list">
              {artifacts.map((artifact, index) => (
                <button
                  key={artifact.id || index}
                  className={selectedArtifact === artifact ? 'selected' : ''}
                  onClick={() => setSelectedArtifactId(artifact.id || '')}
                >
                  <strong>{artifact.title || artifactKind(artifact)}</strong>
                  <span>{artifactKind(artifact)}</span>
                </button>
              ))}
            </div>
            <pre className="artifact-preview">{selectedArtifact ? artifactPreview(selectedArtifact) : '暂无 artifact。'}</pre>
            <div className="button-row">
              <Button onClick={copyDelivery} disabled={!delivery}>
                <Clipboard size={14} />
                复制交付
              </Button>
              {config && (
                <Button variant="ghost" onClick={() => openExternal(config.url)}>
                  <GitBranch size={14} />
                  API
                </Button>
              )}
            </div>
            <pre className="compact-pre">{delivery || '选择 run 后加载 delivery note。'}</pre>
          </Panel>
        </aside>
      </main>

      {settingsOpen && (
        <SettingsDrawer
          client={client}
          providers={providers}
          models={models}
          defaultModel={defaultModel}
          roleBindings={roleBindings}
          onClose={() => setSettingsOpen(false)}
          onRefresh={refreshSettings}
        />
      )}
    </div>
  );
}

function SettingsDrawer({
  client,
  providers,
  models,
  defaultModel,
  roleBindings,
  onClose,
  onRefresh,
}: {
  client: DaemonClient | null;
  providers: ProviderConfig[];
  models: ModelInfo[];
  defaultModel: string;
  roleBindings: ModelBinding;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [providerName, setProviderName] = useState('');
  const [providerType, setProviderType] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  async function addProvider() {
    if (!client || !providerName || !apiKey) return;
    await client.createProvider({
      name: providerName,
      providerType,
      apiKey,
      apiBase,
    });
    setProviderName('');
    setApiKey('');
    setApiBase('');
    await onRefresh();
  }

  return (
    <div className="drawer-backdrop">
      <aside className="settings-drawer">
        <header>
          <h2>设置</h2>
          <Button onClick={onClose}>
            <X size={14} />
          </Button>
        </header>
        <section>
          <h3>Providers</h3>
          <div className="provider-list">
            {providers.map((provider) => (
              <div key={provider.id} className="provider-card">
                <strong>{provider.name}</strong>
                <span>{provider.type || provider.config?.base_url || 'provider'}</span>
                <div className="button-row">
                  <Button onClick={async () => {
                    await client?.activateProvider(provider.id);
                    await onRefresh();
                  }}>激活</Button>
                  <Button onClick={() => client?.testProvider(provider.id)}>测试</Button>
                  <Button variant="danger" onClick={async () => {
                    await client?.deleteProvider(provider.id);
                    await onRefresh();
                  }}>删除</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="settings-form">
            <Field label="名称"><input value={providerName} onChange={(event) => setProviderName(event.target.value)} /></Field>
            <Field label="类型">
              <select value={providerType} onChange={(event) => setProviderType(event.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="API Key"><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
            <Field label="API Base"><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} /></Field>
            <Button variant="primary" onClick={addProvider}>添加 Provider</Button>
          </div>
        </section>
        <section>
          <h3>模型</h3>
          <Field label="默认模型">
            <select value={defaultModel} onChange={async (event) => {
              await client?.setDefaultModel(event.target.value);
              await onRefresh();
            }}>
              <option value="">未设置</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name || model.id}</option>
              ))}
            </select>
          </Field>
          {roles.map((role) => (
            <Field key={role} label={role}>
              <select
                value={roleBindings[role] || ''}
                onChange={async (event) => {
                  await client?.setRoleBinding(role, event.target.value);
                  await onRefresh();
                }}
              >
                <option value="">默认</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name || model.id}</option>
                ))}
              </select>
            </Field>
          ))}
        </section>
        <footer>
          <Button variant="danger" onClick={() => stopDaemon()}>停止 GUI daemon</Button>
        </footer>
      </aside>
    </div>
  );
}
