import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { HOME_DIR } from '../config.js';
import { runWithPty } from '../pty/runner.js';
import { WorkflowTemplateManager, parseTemplateValues } from './templateManager.js';

export const WORKFLOW_DEFINITIONS_PATH = `${HOME_DIR}/workflows.json`;
export const WORKFLOW_RUN_HISTORY_PATH = `${HOME_DIR}/workflow-runs.json`;

const definitionsPath = () => process.env.CODEPANION_WORKFLOW_PATH || WORKFLOW_DEFINITIONS_PATH;
const historyPath = () => process.env.CODEPANION_WORKFLOW_HISTORY_PATH || WORKFLOW_RUN_HISTORY_PATH;
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  tool: z.string().min(1).max(80).default('local'),
  template: z.string().min(1).max(120).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  values: z.record(z.string(), z.string()).default({}),
  dependsOn: z.array(z.string()).default([]),
  checkpoint: z.boolean().default(false),
});

const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  description: z.string().optional().default(''),
  params: z.record(z.string(), z.string()).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

const DefinitionStoreSchema = z.object({
  version: z.literal(1).default(1),
  workflows: z.array(WorkflowDefinitionSchema).default([]),
});

const WorkflowStepRunSchema = z.object({
  id: z.string(),
  tool: z.string(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'skipped', 'checkpoint']),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  exitCode: z.number().int().optional(),
  startedAt: z.number().int().optional(),
  endedAt: z.number().int().optional(),
  message: z.string().optional(),
});

const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowName: z.string(),
  status: z.enum(['success', 'failed', 'paused', 'dry-run']),
  values: z.record(z.string(), z.string()).default({}),
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
  steps: z.array(WorkflowStepRunSchema).default([]),
});

const HistoryStoreSchema = z.object({
  version: z.literal(1).default(1),
  runs: z.array(WorkflowRunSchema).default([]),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowStepRun = z.infer<typeof WorkflowStepRunSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
type DefinitionStore = z.infer<typeof DefinitionStoreSchema>;
type HistoryStore = z.infer<typeof HistoryStoreSchema>;

export class WorkflowDefinitionManager {
  constructor(private readonly path = definitionsPath()) {}

  list(): WorkflowDefinition[] {
    return this.load().workflows.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): WorkflowDefinition | undefined {
    return this.load().workflows.find((workflow) => workflow.name === name);
  }

  save(input: {
    name: string;
    description?: string;
    params?: Record<string, string>;
    steps: WorkflowStep[];
  }): WorkflowDefinition {
    const store = this.load();
    const now = Date.now();
    const existing = store.workflows.find((workflow) => workflow.name === input.name);
    const workflow = WorkflowDefinitionSchema.parse({
      ...existing,
      name: input.name,
      description: input.description ?? existing?.description ?? '',
      params: input.params ?? existing?.params ?? {},
      steps: input.steps,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    validateWorkflow(workflow);

    store.workflows = store.workflows.filter((item) => item.name !== workflow.name);
    store.workflows.push(workflow);
    this.write(store);
    return workflow;
  }

  remove(name: string): boolean {
    const store = this.load();
    const next = store.workflows.filter((workflow) => workflow.name !== name);
    if (next.length === store.workflows.length) return false;
    store.workflows = next;
    this.write(store);
    return true;
  }

  private load(): DefinitionStore {
    if (!existsSync(this.path)) return { version: 1, workflows: [] };
    const raw = JSON.parse(readFileSync(this.path, 'utf8'));
    return DefinitionStoreSchema.parse(raw);
  }

  private write(store: DefinitionStore): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(DefinitionStoreSchema.parse(store), null, 2), 'utf8');
  }
}

export class WorkflowRunHistory {
  constructor(private readonly path = historyPath(), private readonly maxRuns = 200) {}

  list(query?: string): WorkflowRun[] {
    const runs = this.load().runs.sort((a, b) => b.startedAt - a.startedAt);
    if (!query) return runs;
    const needle = query.toLowerCase();
    return runs.filter((run) => JSON.stringify(run).toLowerCase().includes(needle));
  }

  get(id: string): WorkflowRun | undefined {
    return this.load().runs.find((run) => run.id === id);
  }

  append(run: WorkflowRun): WorkflowRun {
    const store = this.load();
    store.runs = [WorkflowRunSchema.parse(run), ...store.runs.filter((item) => item.id !== run.id)].slice(0, this.maxRuns);
    this.write(store);
    return run;
  }

  private load(): HistoryStore {
    if (!existsSync(this.path)) return { version: 1, runs: [] };
    const raw = JSON.parse(readFileSync(this.path, 'utf8'));
    return HistoryStoreSchema.parse(raw);
  }

  private write(store: HistoryStore): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(HistoryStoreSchema.parse(store), null, 2), 'utf8');
  }
}

export function parseWorkflowParams(values: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of values) {
    const [name, ...rest] = entry.split('=');
    if (!name || !PARAM_NAME_RE.test(name)) throw new Error(`invalid workflow parameter: ${entry}`);
    out[name] = rest.join('=');
  }
  return out;
}

export function parseWorkflowSteps(values: string[] = []): WorkflowStep[] {
  return values.map(parseWorkflowStep);
}

export function parseWorkflowStep(entry: string): WorkflowStep {
  const fields: Record<string, string> = {};
  for (const segment of entry.split(';')) {
    if (!segment.trim()) continue;
    const [key, ...rest] = segment.split('=');
    if (!key || rest.length === 0) throw new Error(`invalid workflow step segment: ${segment}`);
    fields[key.trim()] = rest.join('=').trim();
  }
  const values = fields.set ? parseTemplateValues(splitList(fields.set)) : {};
  return WorkflowStepSchema.parse({
    id: fields.id,
    tool: fields.tool ?? 'local',
    template: fields.template || undefined,
    command: fields.command || undefined,
    args: fields.args ? splitList(fields.args) : [],
    values,
    dependsOn: fields.after ? splitList(fields.after) : [],
    checkpoint: fields.checkpoint === 'true' || fields.checkpoint === '1' || fields.checkpoint === 'yes',
  });
}

export type WorkflowRunHooks = {
  onWorkflowStart?: (run: WorkflowRun) => void | Promise<void>;
  onStepStart?: (step: WorkflowStepRun, run: WorkflowRun) => void | Promise<void>;
  onStepFinish?: (step: WorkflowStepRun, run: WorkflowRun) => void | Promise<void>;
  onWorkflowFinish?: (run: WorkflowRun) => void | Promise<void>;
};

export async function runWorkflow(input: {
  workflow: WorkflowDefinition;
  values?: Record<string, string>;
  dryRun?: boolean;
  yes?: boolean;
  executor?: (command: string, args: string[]) => Promise<number>;
  templateManager?: WorkflowTemplateManager;
  hooks?: WorkflowRunHooks;
}): Promise<WorkflowRun> {
  const startedAt = Date.now();
  const run: WorkflowRun = {
    id: `run-${startedAt}-${Math.random().toString(16).slice(2, 10)}`,
    workflowName: input.workflow.name,
    status: input.dryRun ? 'dry-run' : 'success',
    values: { ...input.workflow.params, ...(input.values ?? {}) },
    startedAt,
    endedAt: startedAt,
    steps: [],
  };

  const templateManager = input.templateManager ?? new WorkflowTemplateManager();
  const executor = input.executor ?? ((command, args) => runWithPty({ command, args }));
  const hooks = input.hooks ?? {};
  const successful = new Set<string>();

  await invokeHook(hooks.onWorkflowStart, run);
  for (const step of input.workflow.steps) {
    const missing = step.dependsOn.filter((dep) => !successful.has(dep));
    if (missing.length > 0) {
      run.status = 'failed';
      const skipped: WorkflowStepRun = {
        id: step.id,
        tool: step.tool,
        status: 'skipped',
        args: [],
        message: `missing dependencies: ${missing.join(', ')}`,
      };
      run.steps.push(skipped);
      await invokeHook(hooks.onStepFinish, skipped, run);
      break;
    }

    const resolved = resolveWorkflowStep(step, run.values, templateManager);
    if (step.checkpoint && !input.yes) {
      run.status = 'paused';
      const checkpointStep: WorkflowStepRun = {
        id: step.id,
        tool: step.tool,
        status: 'checkpoint',
        command: resolved.command,
        args: resolved.args,
        message: 'manual checkpoint required; rerun with --yes to continue',
      };
      run.steps.push(checkpointStep);
      await invokeHook(hooks.onStepFinish, checkpointStep, run);
      break;
    }

    const stepRun: WorkflowStepRun = {
      id: step.id,
      tool: step.tool,
      status: input.dryRun ? 'success' : 'running',
      command: resolved.command,
      args: resolved.args,
      startedAt: Date.now(),
    };
    run.steps.push(stepRun);
    await invokeHook(hooks.onStepStart, stepRun, run);
    if (input.dryRun) {
      stepRun.endedAt = Date.now();
      successful.add(step.id);
      await invokeHook(hooks.onStepFinish, stepRun, run);
      continue;
    }
    const exitCode = await executor(resolved.command, resolved.args);
    stepRun.exitCode = exitCode;
    stepRun.endedAt = Date.now();
    stepRun.status = exitCode === 0 ? 'success' : 'failed';
    await invokeHook(hooks.onStepFinish, stepRun, run);
    if (exitCode !== 0) {
      run.status = 'failed';
      break;
    }
    successful.add(step.id);
  }
  run.endedAt = Date.now();
  const finalRun = WorkflowRunSchema.parse(run);
  await invokeHook(hooks.onWorkflowFinish, finalRun);
  return finalRun;
}

async function invokeHook<T extends unknown[]>(
  hook: ((...args: T) => void | Promise<void>) | undefined,
  ...args: T
): Promise<void> {
  if (!hook) return;
  try {
    await hook(...args);
  } catch (err) {
    // hooks are best-effort: 不让事件总线问题阻断真实工作流执行
    console.warn('[workflow] hook failed:', err instanceof Error ? err.message : err);
  }
}

export function resolveWorkflowStep(
  step: WorkflowStep,
  values: Record<string, string>,
  templateManager = new WorkflowTemplateManager(),
): { command: string; args: string[] } {
  if (step.template) {
    const templateValues = renderValues(step.values, values);
    const resolved = templateManager.resolve(step.template, { ...values, ...templateValues });
    return {
      command: render(resolved.command, values),
      args: resolved.args.map((arg) => render(arg, values)),
    };
  }
  if (!step.command) throw new Error(`workflow step ${step.id} requires command or template`);
  return {
    command: render(step.command, values),
    args: step.args.map((arg) => render(arg, values)),
  };
}

function validateWorkflow(workflow: WorkflowDefinition): void {
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (ids.has(step.id)) throw new Error(`duplicate workflow step id: ${step.id}`);
    ids.add(step.id);
    if (!step.template && !step.command) throw new Error(`workflow step ${step.id} requires command or template`);
  }
  for (const step of workflow.steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) throw new Error(`workflow step ${step.id} depends on unknown step: ${dep}`);
    }
  }
}

function renderValues(values: Record<string, string>, scope: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, render(value, scope)]));
}

function render(value: string, values: Record<string, string>): string {
  return value.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (match, key) => values[key] ?? match);
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
