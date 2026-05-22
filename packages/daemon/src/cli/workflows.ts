import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
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
import {
  checkHealth,
  disconnectSource,
  postMonitorEvent,
  registerSource,
} from '../shared/client.js';
import type { MonitorEvent, MonitorSource } from '../shared/protocol.js';

type MonitorEventType = NonNullable<MonitorEvent['type']>;
type MonitorEventLevel = NonNullable<MonitorEvent['level']>;

export async function workflowAddCommand(args: {
  name: string;
  description?: string;
  param?: string[];
  step?: string[];
}) {
  const steps = parseWorkflowSteps(args.step ?? []);
  if (steps.length === 0) {
    console.error('usage: codepanion workflow add <name> --step "id=test;tool=npm;command=npm;args=test"');
    process.exit(2);
  }
  const manager = new WorkflowDefinitionManager();
  const workflow = manager.save({
    name: args.name,
    description: args.description,
    params: parseWorkflowParams(args.param ?? []),
    steps,
  });
  console.log(`[codepanion] saved workflow: ${workflow.name} (${workflow.steps.length} steps)`);
}

export async function workflowListCommand() {
  const workflows = new WorkflowDefinitionManager().list();
  if (workflows.length === 0) {
    console.log('No workflows saved.');
    return;
  }
  for (const workflow of workflows) {
    console.log(`${workflow.name}\t${workflow.steps.length} steps${workflow.description ? `\t${workflow.description}` : ''}`);
  }
}

export async function workflowShowCommand(args: { name: string }) {
  const workflow = new WorkflowDefinitionManager().get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(JSON.stringify(workflow, null, 2));
}

export async function workflowRemoveCommand(args: { name: string }) {
  if (!new WorkflowDefinitionManager().remove(args.name)) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(`[codepanion] removed workflow: ${args.name}`);
}

export async function workflowRunCommand(args: { name: string; set?: string[]; dryRun?: boolean; yes?: boolean }) {
  const workflow = new WorkflowDefinitionManager().get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  const history = new WorkflowRunHistory();
  const hooks = args.dryRun ? undefined : await createDaemonHooks(workflow.name);
  const run = await runWorkflow({
    workflow,
    values: parseWorkflowParams(args.set ?? []),
    dryRun: args.dryRun,
    yes: args.yes,
    hooks: hooks?.handlers,
  });
  history.append(run);
  await hooks?.finalize(run);
  printRun(run);
  if (run.status === 'failed') process.exit(1);
  if (run.status === 'paused') process.exit(3);
  process.exit(0);
}

export async function workflowImportCommand(args: { file: string }) {
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

  const manager = new WorkflowDefinitionManager();
  let imported = 0;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      console.error('[codepanion] skipped non-object workflow entry');
      continue;
    }
    const entry = candidate as { name?: string; description?: string; params?: Record<string, string>; steps?: WorkflowStep[] };
    if (!entry.name || !Array.isArray(entry.steps) || entry.steps.length === 0) {
      console.error('[codepanion] workflow entry missing name or steps; skipping');
      continue;
    }
    const saved = manager.save({
      name: entry.name,
      description: entry.description,
      params: entry.params,
      steps: entry.steps,
    });
    console.log(`[codepanion] imported workflow: ${saved.name} (${saved.steps.length} steps)`);
    imported += 1;
  }
  if (imported === 0) {
    console.error(`[codepanion] no workflows imported from ${absolute}`);
    process.exit(1);
  }
}

export async function workflowHistoryCommand(args: { query?: string }) {
  const runs = new WorkflowRunHistory().list(args.query);
  if (runs.length === 0) {
    console.log('No workflow runs found.');
    return;
  }
  for (const run of runs.slice(0, 30)) {
    const when = new Date(run.startedAt).toISOString();
    console.log(`${run.id}\t${run.workflowName}\t${run.status}\t${when}\t${run.steps.length} steps`);
  }
}

export async function workflowReplayCommand(args: { id: string; set?: string[]; dryRun?: boolean; yes?: boolean }) {
  const previous = new WorkflowRunHistory().get(args.id);
  if (!previous) {
    console.error(`[codepanion] workflow run not found: ${args.id}`);
    process.exit(1);
  }
  const workflow = new WorkflowDefinitionManager().get(previous.workflowName);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${previous.workflowName}`);
    process.exit(1);
  }
  const history = new WorkflowRunHistory();
  const hooks = args.dryRun ? undefined : await createDaemonHooks(workflow.name);
  const run = await runWorkflow({
    workflow,
    values: { ...previous.values, ...parseWorkflowParams(args.set ?? []) },
    dryRun: args.dryRun,
    yes: args.yes,
    hooks: hooks?.handlers,
  });
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

  return { handlers, finalize };
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
