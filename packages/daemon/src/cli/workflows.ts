import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  WorkflowArtifactStore,
  WorkflowDefinitionManager,
  WorkflowRunHistory,
  parseWorkflowParams,
  parseWorkflowSteps,
  runWorkflow,
  type WorkflowRun,
  type WorkflowRunHooks,
  type WorkflowStep,
  type WorkflowStepRun,
} from '../workflows/workflowDefinitionManager.js';
import { WORKSPACE_CONFIG_DIR } from '../workflows/workspaceManager.js';

type CliStores = {
  definitions: WorkflowDefinitionManager;
  history: WorkflowRunHistory;
  artifacts: WorkflowArtifactStore;
  resolvedRoot?: string;
};

/**
 * CLI 端的 workspace 解析：
 * 1. 显式 --workspace 优先
 * 2. 否则从 cwd 向上找 .codepanion 目录，找到就用 cwd 作 workspace 根
 * 3. 都没有走 HOME_DIR fallback（与 daemon 端 workspaceFor() 一致）
 *
 * 找到时各 manager 落点都改成 `<workspace>/.codepanion/{workflows.json, workflow-runs.ndjson, workflow-artifacts.ndjson}`。
 */
export function findUpworkspace(start: string): string | undefined {
  let current = resolve(start);
  // 防御性：最多向上 32 层，避免符号链接 / 文件系统环出 hang。
  // 用 `.codepanion/workflow.json` 作 marker 而不是单看目录存在——CodePanionWorkspaceManager.initialize()
  // 一定写这个文件；其他工具（包括 Claude 自身 memory）可能也用 .codepanion/ 目录但里面没 workflow.json，
  // 不该被误判成 workspace 根。
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(current, WORKSPACE_CONFIG_DIR, 'workflow.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

export function resolveCliWorkspaceStores(workspaceFlag?: string): CliStores {
  const explicit = workspaceFlag && workspaceFlag.trim().length > 0 ? resolve(workspaceFlag) : undefined;
  const root = explicit ?? findUpworkspace(process.cwd());
  if (!root) {
    return {
      definitions: new WorkflowDefinitionManager(),
      history: new WorkflowRunHistory(),
      artifacts: new WorkflowArtifactStore(),
    };
  }
  const configDir = join(root, WORKSPACE_CONFIG_DIR);
  return {
    definitions: new WorkflowDefinitionManager(join(configDir, 'workflows.json')),
    history: new WorkflowRunHistory(join(configDir, 'workflow-runs.ndjson')),
    artifacts: new WorkflowArtifactStore(join(configDir, 'workflow-artifacts.ndjson')),
    resolvedRoot: root,
  };
}
import WebSocket from 'ws';
import {
  cancelWorkflowRun,
  checkHealth,
  disconnectSource,
  getWorkflowBoard,
  getWorkflowGates,
  listWorkflowArtifacts,
  postMonitorEvent,
  registerSource,
  resolveWorkflowGate,
  startWorkflowRun,
  wsProtocols,
  wsUrl,
} from '../shared/client.js';
import type { MonitorEvent, MonitorSource } from '../shared/protocol.js';

type MonitorEventType = NonNullable<MonitorEvent['type']>;
type MonitorEventLevel = NonNullable<MonitorEvent['level']>;

export async function workflowAddCommand(args: {
  name: string;
  description?: string;
  param?: string[];
  step?: string[];
  workspace?: string;
}) {
  const steps = parseWorkflowSteps(args.step ?? []);
  if (steps.length === 0) {
    console.error('usage: codepanion workflow add <name> --step "id=test;tool=npm;command=npm;args=test"');
    process.exit(2);
  }
  const { definitions: manager, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  const workflow = manager.save({
    name: args.name,
    description: args.description,
    params: parseWorkflowParams(args.param ?? []),
    steps,
  });
  console.log(`[codepanion] saved workflow: ${workflow.name} (${workflow.steps.length} steps)`);
}

export async function workflowListCommand(args: { workspace?: string } = {}) {
  const { definitions, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  const workflows = definitions.list();
  if (workflows.length === 0) {
    console.log('No workflows saved.');
    return;
  }
  for (const workflow of workflows) {
    console.log(`${workflow.name}\t${workflow.steps.length} steps${workflow.description ? `\t${workflow.description}` : ''}`);
  }
}

export async function workflowShowCommand(args: { name: string; workspace?: string }) {
  const { definitions, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  const workflow = definitions.get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(JSON.stringify(workflow, null, 2));
}

export async function workflowRemoveCommand(args: { name: string; workspace?: string }) {
  const { definitions, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  if (!definitions.remove(args.name)) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(`[codepanion] removed workflow: ${args.name}`);
}

export async function workflowRunCommand(args: { name: string; set?: string[]; dryRun?: boolean; yes?: boolean; workspace?: string }) {
  const { definitions, history, artifacts, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  else console.log('[codepanion] no .codepanion workspace; using global storage. Run `codepanion workspace init` to scope this project.');
  const workflow = definitions.get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  const hooks = args.dryRun ? undefined : await createDaemonHooks(workflow.name);
  let run: WorkflowRun;
  try {
    run = await runWorkflow({
      workflow,
      values: parseWorkflowParams(args.set ?? []),
      dryRun: args.dryRun,
      yes: args.yes,
      hooks: hooks?.handlers,
      artifactStore: artifacts,
    });
  } catch (err) {
    await hooks?.abort((err as Error).message ?? String(err));
    throw err;
  }
  history.append(run);
  await hooks?.finalize(run);
  printRun(run);
  if (run.status === 'failed') process.exit(1);
  if (run.status === 'paused') process.exit(3);
  process.exit(0);
}

export async function workflowImportCommand(args: { file: string; workspace?: string }) {
  const absolute = resolve(args.file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    console.error(`[codepanion] failed to read workflow file ${absolute}: ${(err as Error).message}`);
    process.exit(2);
  }
  const candidates = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { workflows?: unknown[] }).workflows)
      ? (raw as { workflows: unknown[] }).workflows
      : [raw];

  const { definitions: manager, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  let imported = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      failed += 1;
      failures.push('non-object entry');
      console.error('[codepanion] skipped non-object workflow entry');
      continue;
    }
    const entry = candidate as { name?: string; description?: string; params?: Record<string, string>; steps?: WorkflowStep[] };
    if (!entry.name || !Array.isArray(entry.steps) || entry.steps.length === 0) {
      failed += 1;
      const label = entry.name ?? '<unnamed>';
      failures.push(`${label}: missing name or steps`);
      console.error(`[codepanion] workflow entry ${label} missing name or steps; skipping`);
      continue;
    }
    try {
      const saved = manager.save({
        name: entry.name,
        description: entry.description,
        params: entry.params,
        steps: entry.steps,
      });
      console.log(`[codepanion] imported workflow: ${saved.name} (${saved.steps.length} steps)`);
      imported += 1;
    } catch (err) {
      failed += 1;
      const reason = (err as Error).message ?? String(err);
      failures.push(`${entry.name}: ${reason}`);
      console.error(`[codepanion] failed to import ${entry.name}: ${reason}`);
    }
  }
  console.log(`[codepanion] import summary: imported=${imported} failed=${failed}`);
  if (imported === 0) {
    console.error(`[codepanion] no workflows imported from ${absolute}`);
    process.exit(1);
  }
  if (failed > 0) process.exit(2);
}

export async function workflowHistoryCommand(args: { query?: string; workspace?: string }) {
  const { history, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  const runs = history.list(args.query);
  if (runs.length === 0) {
    console.log('No workflow runs found.');
    return;
  }
  for (const run of runs.slice(0, 30)) {
    const when = new Date(run.startedAt).toISOString();
    console.log(`${run.id}\t${run.workflowName}\t${run.status}\t${when}\t${run.steps.length} steps`);
  }
}

export async function workflowReplayCommand(args: { id: string; set?: string[]; dryRun?: boolean; yes?: boolean; workspace?: string }) {
  const { definitions, history, artifacts, resolvedRoot } = resolveCliWorkspaceStores(args.workspace);
  if (resolvedRoot) console.log(`[codepanion] using workspace: ${resolvedRoot}`);
  else console.log('[codepanion] no .codepanion workspace; using global storage. Run `codepanion workspace init` to scope this project.');
  const previous = history.get(args.id);
  if (!previous) {
    console.error(`[codepanion] workflow run not found: ${args.id}`);
    process.exit(1);
  }
  const workflow = definitions.get(previous.workflowName);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${previous.workflowName}`);
    process.exit(1);
  }
  const hooks = args.dryRun ? undefined : await createDaemonHooks(workflow.name);
  let run: WorkflowRun;
  try {
    run = await runWorkflow({
      workflow,
      values: { ...previous.values, ...parseWorkflowParams(args.set ?? []) },
      dryRun: args.dryRun,
      yes: args.yes,
      hooks: hooks?.handlers,
      artifactStore: artifacts,
    });
  } catch (err) {
    await hooks?.abort((err as Error).message ?? String(err));
    throw err;
  }
  history.append(run);
  await hooks?.finalize(run);
  printRun(run);
  if (run.status === 'failed') process.exit(1);
  if (run.status === 'paused') process.exit(3);
  process.exit(0);
}

type DaemonHookBundle = {
  handlers: WorkflowRunHooks;
  finalize: (run: WorkflowRun) => Promise<void>;
  abort: (reason: string) => Promise<void>;
};

async function createDaemonHooks(workflowName: string): Promise<DaemonHookBundle | undefined> {
  const health = await checkHealth();
  if (!health.ok) return undefined;

  let source: MonitorSource | undefined;
  try {
    source = await registerSource({
      kind: 'cli',
      name: `workflow:${workflowName}`,
      capabilities: ['workflow-run', 'cli-detected'],
      capabilityLevel: 'L2',
      integrationKind: 'cli-pty',
      privacyBoundary: 'explicit-session',
    });
  } catch (err) {
    console.warn('[codepanion] workflow events disabled (registerSource failed):', (err as Error).message);
    return undefined;
  }
  const sourceId = source.id;

  const emit = async (type: MonitorEventType, level: MonitorEventLevel, title: string, content: string) => {
    try {
      await postMonitorEvent({ type, level, sourceId, source: 'cli', title, content });
    } catch (err) {
      console.warn('[codepanion] workflow event emit failed:', (err as Error).message);
    }
  };

  const handlers: WorkflowRunHooks = {
    async onWorkflowStart(run) {
      await emit('activity', 'info', `工作流 ${run.workflowName} 开始`, `run=${run.id}`);
    },
    async onStepStart(step) {
      await emit('activity', 'info', `步骤 ${step.id} [${step.tool}] 启动`, formatCommand(step));
    },
    async onStepFinish(step) {
      const stateMap: Record<WorkflowStepRun['status'], { type: MonitorEventType; level: MonitorEventLevel; label: string }> = {
        success: { type: 'done', level: 'done', label: '完成' },
        failed: { type: 'error', level: 'error', label: '失败' },
        skipped: { type: 'error', level: 'error', label: '跳过' },
        checkpoint: { type: 'prompt', level: 'prompt', label: '等待检查点' },
        running: { type: 'activity', level: 'info', label: '运行中' },
        pending: { type: 'activity', level: 'info', label: '待执行' },
      };
      const map = stateMap[step.status] ?? stateMap.running;
      const detail = step.message ? `${formatCommand(step)} :: ${step.message}` : formatCommand(step);
      await emit(map.type, map.level, `步骤 ${step.id} ${map.label}`, detail);
    },
  };

  const finalize = async (run: WorkflowRun) => {
    const finalType: MonitorEventType = run.status === 'failed' ? 'error' : run.status === 'paused' ? 'prompt' : 'done';
    const finalLevel: MonitorEventLevel = run.status === 'failed' ? 'error' : run.status === 'paused' ? 'prompt' : 'done';
    await emit(finalType, finalLevel, `工作流 ${run.workflowName} ${run.status}`, `run=${run.id} steps=${run.steps.length}`);
    try {
      await disconnectSource(sourceId, `workflow-${run.status}`);
    } catch (err) {
      // 来源已被 daemon 自动回收时 disconnect 会失败，忽略即可
      void err;
    }
  };

  const abort = async (reason: string) => {
    // runWorkflow 抛异常时（模板缺失 / executor 透传错误 / schema 校验失败）走这里，
    // 保证 daemon 端注册过的 workflow source 不会一直停在 online 而被 GUI 误读为活任务。
    await emit('error', 'error', `工作流 ${workflowName} 异常中止`, reason || 'unknown error');
    try {
      await disconnectSource(sourceId, 'workflow-aborted');
    } catch (err) {
      void err;
    }
  };

  return { handlers, finalize, abort };
}

function formatCommand(step: WorkflowStepRun): string {
  if (!step.command) return '';
  const args = step.args && step.args.length > 0 ? ` ${step.args.join(' ')}` : '';
  return `${step.command}${args}`;
}

function printRun(run: { id: string; status: string; steps: Array<{ id: string; tool: string; status: string; command?: string; args?: string[]; message?: string }> }) {
  console.log(`[codepanion] workflow run ${run.id}: ${run.status}`);
  for (const step of run.steps) {
    const command = step.command ? ` ${step.command} ${(step.args ?? []).join(' ')}`.trimEnd() : '';
    const message = step.message ? ` (${step.message})` : '';
    console.log(`- ${step.id} [${step.tool}] ${step.status}${command ? ` :: ${command}` : ''}${message}`);
  }
}

// ---- daemon-driven 工作流命令 ----
// 这组命令不在 CLI 进程内跑 step，而是触发 daemon 端的 fire-and-forget runWorkflow，
// CLI 收完 HTTP 响应即退出。GUI / 脚本场景下用户希望"启动后不阻塞终端"，传统的
// `codepanion workflow run` 仍保留给"我现在就要看到 step 输出"的场景。

async function requireDaemon(action: string): Promise<void> {
  const health = await checkHealth();
  if (health.ok) return;
  console.error(`[codepanion] ${action} requires the daemon to be running${health.error ? ` (${health.error})` : ''}.`);
  console.error('[codepanion] run `codepanion start` first.');
  process.exit(2);
}

export async function workflowStartCommand(args: {
  name: string;
  set?: string[];
  yes?: boolean;
  dryRun?: boolean;
  workspace?: string;
}): Promise<void> {
  await requireDaemon('workflow start');
  try {
    const result = await startWorkflowRun({
      workflow: args.name,
      values: parseWorkflowParams(args.set ?? []),
      yes: args.yes,
      dryRun: args.dryRun,
      workspace: args.workspace,
    });
    console.log(`[codepanion] daemon accepted run: ${result.workflowName}`);
    console.log('[codepanion] use `codepanion workflow board` or subscribe to ws://.../ws?role=observer for live progress.');
  } catch (err) {
    console.error('[codepanion] workflow start failed:', (err as Error).message);
    process.exit(1);
  }
}

export async function workflowBoardCommand(args: { workspace?: string } = {}): Promise<void> {
  await requireDaemon('workflow board');
  let board;
  try {
    board = await getWorkflowBoard(args.workspace);
  } catch (err) {
    console.error('[codepanion] workflow board failed:', (err as Error).message);
    process.exit(1);
  }
  console.log(`[codepanion] workflows (${board.workflows.length}):`);
  for (const w of board.workflows) {
    console.log(`- ${w.name}\t${w.stepCount} steps${w.description ? `\t${w.description}` : ''}`);
  }
  console.log(`[codepanion] runs (${board.runs.length}):`);
  for (const r of board.runs) {
    const at = new Date(r.startedAt).toISOString();
    const current = r.currentStepId ? `\tcurrent=${r.currentStepId} (${r.currentStepStatus ?? ''})` : '';
    console.log(`- ${r.id}\t${r.workflowName}\t${r.status}\t${at}${current}`);
  }
  console.log(`[codepanion] gates (${board.gates.length}):`);
  for (const g of board.gates) {
    const decision = g.lastDecision ? `\tlastDecision=${g.lastDecision.decision}` : '';
    console.log(`- ${g.runId}\t${g.workflowName}/${g.stepId}\trole=${g.role ?? '?'}${decision}`);
  }
}

export async function workflowGatesCommand(args: { workspace?: string } = {}): Promise<void> {
  await requireDaemon('workflow gates');
  let resp;
  try {
    resp = await getWorkflowGates(args.workspace);
  } catch (err) {
    console.error('[codepanion] workflow gates failed:', (err as Error).message);
    process.exit(1);
  }
  if (resp.gates.length === 0) {
    console.log('No pending workflow gates.');
    return;
  }
  for (const g of resp.gates) {
    const decision = g.lastDecision ? ` (last: ${g.lastDecision.decision})` : '';
    console.log(`${g.runId}\t${g.workflowName}/${g.stepId}\trole=${g.role ?? '?'}${decision}`);
    if (g.message) console.log(`  ${g.message}`);
  }
}

export async function workflowWatchCommand(args: { run?: string; once?: boolean } = {}): Promise<void> {
  await requireDaemon('workflow watch');
  // 连 observer WS，过滤 workflow-run-event 流式打印。
  // - 不传 --run：跟踪所有 run（适合常驻终端监视）
  // - 传 --run <id>：只打印匹配此 runId 的事件
  // - --once：看到匹配的 run-finish 即退出（脚本场景：start + watch --once 串成同步流程）
  const url = wsUrl('observer');
  const ws = new WebSocket(url, wsProtocols());
  const filterRun = args.run;
  // 退出时清理 socket，避免 Ctrl+C 后留下半 open 连接。
  const cleanup = () => { try { ws.close(); } catch { /* ignore */ } };
  process.once('SIGINT', () => { cleanup(); process.exit(130); });

  await new Promise<void>((resolve, reject) => {
    let opened = false;
    ws.on('open', () => {
      opened = true;
      console.log(`[codepanion] watching workflow-run-event${filterRun ? ` (run=${filterRun})` : ''}; Ctrl+C to stop.`);
    });
    ws.on('error', (err) => {
      if (!opened) reject(err);
      else console.error('[codepanion] ws error:', (err as Error).message);
    });
    ws.on('close', () => { resolve(); });
    ws.on('message', (raw) => {
      let msg: { type?: string; event?: { action?: string; runId?: string; workflowName?: string; stepId?: string; status?: string; message?: string; exitCode?: number; role?: string; tool?: string } } | null = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // 忽略非 JSON 帧
      }
      if (!msg || msg.type !== 'workflow-run-event' || !msg.event) return;
      const ev = msg.event;
      if (filterRun && ev.runId !== filterRun) return;
      printRunEvent(ev);
      if (args.once && ev.action === 'run-finish') {
        cleanup();
      }
    });
  }).catch((err) => {
    console.error('[codepanion] workflow watch failed:', (err as Error).message);
    process.exit(1);
  });
}

function printRunEvent(ev: { action?: string; runId?: string; workflowName?: string; stepId?: string; status?: string; message?: string; exitCode?: number; role?: string; tool?: string }): void {
  const at = new Date().toISOString();
  const head = `[${at}] ${ev.workflowName ?? '?'} run=${ev.runId ?? '?'}`;
  switch (ev.action) {
    case 'run-start':
      console.log(`${head} ▶ run-start`);
      break;
    case 'step-start':
      console.log(`${head}  ▸ step-start ${ev.stepId ?? '?'} [${ev.tool ?? ''}${ev.role ? ` role=${ev.role}` : ''}]`);
      break;
    case 'step-finish':
      console.log(`${head}  ◂ step-finish ${ev.stepId ?? '?'} ${ev.status ?? ''}${ev.exitCode !== undefined ? ` exit=${ev.exitCode}` : ''}${ev.message ? ` :: ${ev.message}` : ''}`);
      break;
    case 'run-finish':
      console.log(`${head} ■ run-finish ${ev.status ?? ''}`);
      break;
    default:
      console.log(`${head} ${ev.action ?? '?'}`);
  }
}

export async function workflowArtifactsCommand(args: { runId: string; workspace?: string; verbose?: boolean }): Promise<void> {
  await requireDaemon('workflow artifacts');
  let resp;
  try {
    resp = await listWorkflowArtifacts(args.runId, args.workspace);
  } catch (err) {
    console.error('[codepanion] workflow artifacts failed:', (err as Error).message);
    process.exit(1);
  }
  if (resp.artifacts.length === 0) {
    console.log(`No artifacts for run ${args.runId}.`);
    return;
  }
  // 按 createdAt 升序（按事件发生顺序读：plan → patch-summary → test-result → ... → delivery-note）。
  const sorted = resp.artifacts.slice().sort((a, b) => a.createdAt - b.createdAt);
  for (const artifact of sorted) {
    const at = new Date(artifact.createdAt).toISOString();
    const where = artifact.stepId ? `${artifact.stepId}` : 'run';
    const role = artifact.role ? ` (${artifact.role})` : '';
    console.log(`${at}\t${artifact.type}\t${where}${role}\t${artifact.title}`);
    if (args.verbose) {
      if (artifact.content) {
        for (const line of artifact.content.split('\n')) console.log(`  ${line}`);
      }
      if (artifact.files.length > 0) console.log(`  files: ${artifact.files.join(', ')}`);
      console.log('');
    }
  }
}

export async function workflowResolveCommand(args: {
  runId: string;
  stepId: string;
  decision: 'approve' | 'reject' | 'retry';
  message?: string;
  constraint?: string[];
  workspace?: string;
}): Promise<void> {
  await requireDaemon('workflow resolve');
  try {
    const result = await resolveWorkflowGate({
      runId: args.runId,
      stepId: args.stepId,
      decision: args.decision,
      message: args.message,
      constraints: args.constraint,
      workspace: args.workspace,
    });
    if (args.decision === 'approve') {
      if (result.resumed) {
        console.log(`[codepanion] approved ${args.runId}/${args.stepId}; daemon is resuming. Watch progress via \`codepanion workflow board\`.`);
      } else if (result.resumeError) {
        console.warn(`[codepanion] approved ${args.runId}/${args.stepId} but resume skipped: ${result.resumeError}`);
        process.exit(1);
      }
    } else if (args.decision === 'reject') {
      console.log(`[codepanion] rejected ${args.runId}/${args.stepId}; gate cleared.`);
    } else {
      console.log(`[codepanion] retry requested for ${args.runId}/${args.stepId}; gate kept open for next decision.`);
    }
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (message.includes('404')) {
      console.error(`[codepanion] run/step not found or not paused: ${args.runId}/${args.stepId}`);
      process.exit(1);
    }
    if (message.includes('400')) {
      console.error(`[codepanion] invalid resolve request: ${message}`);
      process.exit(2);
    }
    console.error('[codepanion] workflow resolve failed:', message);
    process.exit(1);
  }
}

export async function workflowCancelCommand(args: { id: string }): Promise<void> {
  await requireDaemon('workflow cancel');
  try {
    await cancelWorkflowRun(args.id);
    console.log(`[codepanion] cancel requested for run ${args.id}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (message.includes('404')) {
      console.error(`[codepanion] run not active: ${args.id}`);
      process.exit(1);
    }
    console.error('[codepanion] workflow cancel failed:', message);
    process.exit(1);
  }
}
