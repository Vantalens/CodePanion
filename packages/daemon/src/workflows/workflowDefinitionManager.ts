import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { HOME_DIR } from '../config.js';
import { logger } from '../logger.js';
import { runWithPty } from '../pty/runner.js';
import { WorkflowTemplateManager, parseTemplateValues } from './templateManager.js';

// N-9：daemon 启动时 load 这些文件，如果用户在外部编辑器写坏（trailing comma、半截写入、BOM）
// 不能让一次单文件损坏阻塞整个 daemon。统一隔离损坏文件后返回空 store，让 daemon 继续启动。
function quarantineBrokenStore(path: string, err: unknown, kind: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${path}.broken-${stamp}.json`;
  try {
    renameSync(path, target);
    logger.warn({ err, kind, path, quarantined: target }, '损坏的存储文件已隔离，daemon 继续启动');
  } catch (renameErr) {
    logger.error({ err, renameErr, kind, path }, '损坏的存储文件解析失败，且隔离也失败');
  }
}

export const WORKFLOW_DEFINITIONS_PATH = `${HOME_DIR}/workflows.json`;
export const WORKFLOW_RUN_HISTORY_PATH = `${HOME_DIR}/workflow-runs.json`;
export const WORKFLOW_ARTIFACTS_PATH = `${HOME_DIR}/workflow-artifacts.ndjson`;

const definitionsPath = () => process.env.CODEPANION_WORKFLOW_PATH || WORKFLOW_DEFINITIONS_PATH;
const historyPath = () => process.env.CODEPANION_WORKFLOW_HISTORY_PATH || WORKFLOW_RUN_HISTORY_PATH;
const artifactsPath = () => process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH || WORKFLOW_ARTIFACTS_PATH;
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const WorkflowPermissionSchema = z.enum(['read', 'write', 'command', 'network', 'delegate', 'approve']);

// W-31：内置 provider，决定 step.command 怎么被实际拼成 CLI invocation。
// - local: 完全保持 step.command/args 不变（向后兼容当前所有 workflow）
// - codex / claude-code / opencode: step.command 当 prompt 文本，daemon 用对应 CLI 模板包装
export const WORKFLOW_PROVIDERS = ['local', 'codex', 'claude-code', 'opencode'] as const;
const WorkflowProviderSchema = z.enum(WORKFLOW_PROVIDERS);
export type WorkflowProvider = z.infer<typeof WorkflowProviderSchema>;

// step.artifacts 是该 step 完成后会产出的 artifact 类型列表，类型与 WorkflowArtifactSchema.type 共享 enum，
// runWorkflow 完成 step 后会按这个清单往 artifactStore 落占位条目。
export const WORKFLOW_ARTIFACT_TYPES = ['plan', 'patch-summary', 'test-result', 'review-report', 'human-decision', 'delivery-note'] as const;
const WorkflowArtifactTypeSchema = z.enum(WORKFLOW_ARTIFACT_TYPES);
export type WorkflowArtifactType = z.infer<typeof WorkflowArtifactTypeSchema>;

// 拒绝 path traversal / 绝对路径 / 空段，避免 contextInclude=../../etc/passwd 落进 workflows.json。
const ContextGlobSchema = z.string().min(1).max(200).refine((value) => {
  if (value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment !== '..');
}, { message: 'context glob must be a relative path without .. segments' });

const WorkflowContextPolicySchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  include: z.array(ContextGlobSchema).default([]),
  exclude: z.array(ContextGlobSchema).default([]),
}).default({ include: [], exclude: [] });

const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  tool: z.string().min(1).max(80).default('local'),
  role: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).optional(),
  model: z.string().min(1).max(120).optional(),
  provider: WorkflowProviderSchema.default('local'),
  permissions: z.array(WorkflowPermissionSchema).default([]),
  contextPolicy: WorkflowContextPolicySchema,
  humanGate: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).optional(),
  artifacts: z.array(WorkflowArtifactTypeSchema).default([]),
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
  role: z.string().optional(),
  model: z.string().optional(),
  provider: WorkflowProviderSchema.optional(),
  artifacts: z.array(z.string()).default([]),
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

const WorkflowArtifactSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  workflowName: z.string().min(1),
  stepId: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  type: WorkflowArtifactTypeSchema,
  title: z.string().min(1),
  content: z.string().default(''),
  files: z.array(z.string()).default([]),
  createdAt: z.number().int().positive(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowStepRun = z.infer<typeof WorkflowStepRunSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;
export type WorkflowArtifactInput = Omit<WorkflowArtifact, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};
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
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      return DefinitionStoreSchema.parse(raw);
    } catch (err) {
      quarantineBrokenStore(this.path, err, 'workflow-definitions');
      return { version: 1, workflows: [] };
    }
  }

  private write(store: DefinitionStore): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(DefinitionStoreSchema.parse(store), null, 2), 'utf8');
  }
}

// N-16：旧实现把 history 当成单个 JSON 对象（`{ version, runs:[] }`），append = 读全文件 + 校验整段 schema +
// 追加 + 全量写回。中间任何一条历史 schema 失败 → catch 里就把整个文件隔离为 broken-* 重置为空，
// 几百条 workflow run 一次坏 entry 全丢。改为 NDJSON：append 不读旧文件、坏行只跳过不 truncate、
// 周期性 compaction 维护 maxRuns 上限。第一次遇到旧版 JSON 文件时自动迁移到 NDJSON。
const HISTORY_COMPACTION_RATIO = 1.5;

export class WorkflowRunHistory {
  constructor(private readonly path = historyPath(), private readonly maxRuns = 200) {}

  list(query?: string): WorkflowRun[] {
    const runs = this.load().sort((a, b) => b.startedAt - a.startedAt);
    if (!query) return runs;
    const needle = query.toLowerCase();
    return runs.filter((run) => JSON.stringify(run).toLowerCase().includes(needle));
  }

  get(id: string): WorkflowRun | undefined {
    return this.load().find((run) => run.id === id);
  }

  append(run: WorkflowRun): WorkflowRun {
    const parsed = WorkflowRunSchema.parse(run);
    mkdirSync(dirname(this.path), { recursive: true });
    // 关键：appendFileSync 单行追加，不再 load + 全量 rewrite —— 不读旧文件意味着哪怕旧文件里有
    // 坏行也不会影响这次写入，新 run 永远落得下来。
    appendFileSync(this.path, JSON.stringify(parsed) + '\n', 'utf8');
    this.maybeCompact();
    return parsed;
  }

  private load(): WorkflowRun[] {
    if (!existsSync(this.path)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (err) {
      logger.warn({ err, path: this.path }, 'workflow-run-history 读取失败，返回空列表');
      return [];
    }
    if (!raw.trim()) return [];
    // 关键：NDJSON 每行也以 `{` 开头，所以不能光看首字符判断「旧版整体 JSON」，否则 NDJSON 文件
    // 会被误判成损坏的 legacy 容器，触发 quarantine 后整个文件被改名 —— append 还能写但 list 永远空。
    // 改成尝试 JSON.parse 整段：NDJSON 第二条 JSON 一开始就会破坏 parse，因此 parse 成功 ≈ 真的是
    // 单个 JSON 容器；再校验是否带 `runs` 字段才走 legacy 迁移分支。
    const legacy = this.tryLoadLegacy(raw);
    if (legacy !== null) return legacy;
    return parseNdjsonRuns(raw, this.path);
  }

  private tryLoadLegacy(raw: string): WorkflowRun[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 多行 NDJSON 文件在第二条 JSON 处 parse 必败 —— 视为 NDJSON，交给 parseNdjsonRuns 兜底。
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('runs' in (parsed as object))) {
      // parse 成功但不是 `{ version, runs }` 容器；交给 NDJSON 单行解析（也覆盖只写了一条 run 的极端情况）。
      return null;
    }
    try {
      const result = HistoryStoreSchema.parse(parsed);
      this.rewriteNdjson(result.runs);
      logger.info({ path: this.path, runs: result.runs.length }, 'workflow-run-history 已从旧版 JSON 迁移为 NDJSON');
      return result.runs;
    } catch (err) {
      // 确认是 legacy 容器形状但 schema 不过：保留隔离语义，避免把可疑文件直接当成空 NDJSON 用。
      quarantineBrokenStore(this.path, err, 'workflow-run-history');
      return [];
    }
  }

  private rewriteNdjson(runs: WorkflowRun[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const body = runs.map((run) => JSON.stringify(WorkflowRunSchema.parse(run))).join('\n') + (runs.length ? '\n' : '');
    // tmp + rename：避免 compaction 中 daemon 崩溃留下半段文件。
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, this.path);
  }

  private maybeCompact(): void {
    // 用文件大小做廉价启发：单条 run 通常几 KB，maxRuns=200 时 ~1MB 量级。
    // 超过 maxRuns × 1.5 行就 compact 一次，把 dedup / 排序成本摊到很多次 append 上。
    let lineCount = 0;
    try {
      const raw = readFileSync(this.path, 'utf8');
      for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) lineCount++;
    } catch {
      return;
    }
    if (lineCount <= this.maxRuns * HISTORY_COMPACTION_RATIO) return;
    try {
      const all = this.load();
      const recent = all.sort((a, b) => b.startedAt - a.startedAt).slice(0, this.maxRuns);
      this.rewriteNdjson(recent);
    } catch (err) {
      logger.warn({ err, path: this.path }, 'workflow-run-history compaction 失败，下次 append 时重试');
    }
  }
}

export class WorkflowArtifactStore {
  constructor(private readonly path = artifactsPath(), private readonly maxArtifacts = 1000) {}

  append(input: WorkflowArtifactInput): WorkflowArtifact {
    const now = Date.now();
    // ?? 只在 null/undefined 时回退；空字符串 id 也视作未提供，避免持久化空 id。
    const providedId = typeof input.id === 'string' && input.id.length > 0 ? input.id : undefined;
    const artifact = WorkflowArtifactSchema.parse({
      ...input,
      id: providedId ?? `artifact-${now}-${Math.random().toString(16).slice(2, 10)}`,
      createdAt: input.createdAt ?? now,
    });
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(artifact) + '\n', 'utf8');
    this.maybeCompact();
    return artifact;
  }

  list(runId?: string): WorkflowArtifact[] {
    // 与 WorkflowRunHistory.list 一致：按 createdAt 降序，最近的在前。
    const artifacts = this.load().sort((a, b) => b.createdAt - a.createdAt);
    return runId ? artifacts.filter((artifact) => artifact.runId === runId) : artifacts;
  }

  private load(): WorkflowArtifact[] {
    if (!existsSync(this.path)) return [];
    let raw = '';
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (err) {
      logger.warn({ err, path: this.path }, 'workflow-artifacts 读取失败，返回空列表');
      return [];
    }
    const artifacts: WorkflowArtifact[] = [];
    let badLineCount = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        artifacts.push(WorkflowArtifactSchema.parse(JSON.parse(line)));
      } catch {
        badLineCount++;
      }
    }
    if (badLineCount > 0) {
      logger.warn({ path: this.path, badLineCount }, 'workflow-artifacts 跳过损坏行（其余产物保留）');
    }
    return artifacts;
  }

  private maybeCompact(): void {
    // 与 WorkflowRunHistory 对齐：先字节扫描估算行数，超阈值才走全量解析 + compaction。
    let lineCount = 0;
    try {
      const raw = readFileSync(this.path, 'utf8');
      for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) lineCount++;
    } catch {
      return;
    }
    if (lineCount <= this.maxArtifacts * HISTORY_COMPACTION_RATIO) return;
    try {
      const artifacts = this.load();
      const recent = artifacts.sort((a, b) => b.createdAt - a.createdAt).slice(0, this.maxArtifacts).reverse();
      mkdirSync(dirname(this.path), { recursive: true });
      const body = recent.map((artifact) => JSON.stringify(artifact)).join('\n') + (recent.length ? '\n' : '');
      const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, body, 'utf8');
      renameSync(tmp, this.path);
    } catch (err) {
      logger.warn({ err, path: this.path }, 'workflow-artifacts compaction 失败，下次 append 时重试');
    }
  }
}

function parseNdjsonRuns(raw: string, path: string): WorkflowRun[] {
  const seen = new Map<string, WorkflowRun>();
  let badLineCount = 0;
  let firstBadSample: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = WorkflowRunSchema.parse(JSON.parse(line));
      // 同 id 重复（同一 run 被多次 append）时保留后写入的，便于 dry-run 后真实跑覆盖旧记录。
      seen.set(parsed.id, parsed);
    } catch (err) {
      badLineCount++;
      if (!firstBadSample) firstBadSample = line.slice(0, 200);
    }
  }
  if (badLineCount > 0) {
    logger.warn(
      { path, badLineCount, sample: firstBadSample },
      'workflow-run-history 跳过损坏行（其余历史保留）',
    );
  }
  return Array.from(seen.values());
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
    role: fields.role || undefined,
    model: fields.model || undefined,
    provider: fields.provider || 'local',
    permissions: fields.permissions ? splitList(fields.permissions) : [],
    contextPolicy: parseContextPolicy(fields),
    humanGate: fields.humanGate || undefined,
    artifacts: fields.artifacts ? splitList(fields.artifacts) : [],
    template: fields.template || undefined,
    command: fields.command || undefined,
    args: fields.args ? splitList(fields.args) : [],
    values,
    dependsOn: fields.after ? splitList(fields.after) : [],
    checkpoint: fields.checkpoint === 'true' || fields.checkpoint === '1' || fields.checkpoint === 'yes',
  });
}

function parseContextPolicy(fields: Record<string, string>): z.infer<typeof WorkflowContextPolicySchema> {
  let maxTokens: number | undefined;
  if (fields.contextMaxTokens) {
    const parsed = Number(fields.contextMaxTokens);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid contextMaxTokens: ${fields.contextMaxTokens}`);
    }
    maxTokens = parsed;
  }
  return {
    maxTokens,
    include: fields.contextInclude ? splitList(fields.contextInclude) : [],
    exclude: fields.contextExclude ? splitList(fields.contextExclude) : [],
  };
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
  /** 可选 artifact store：每个 step 成功或停在 checkpoint 时，按 step.artifacts 列表落一条占位 artifact。 */
  artifactStore?: WorkflowArtifactStore;
  /** 可选 AbortSignal：触发后当前 step 由 executor 自行中断，外层在 step 之间发现 abort 也会立刻收尾。 */
  signal?: AbortSignal;
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
    // signal 在 step 之间检查：如果用户/上层取消，立刻收尾，留一条标记 cancelled 的 stepRun。
    if (input.signal?.aborted) {
      run.status = 'failed';
      const cancelled: WorkflowStepRun = {
        ...stepMetaFrom(step),
        status: 'failed',
        args: [],
        message: 'workflow run cancelled before step started',
      };
      run.steps.push(cancelled);
      await invokeHook(hooks.onStepFinish, cancelled, run);
      break;
    }
    const missing = step.dependsOn.filter((dep) => !successful.has(dep));
    if (missing.length > 0) {
      run.status = 'failed';
      const skipped: WorkflowStepRun = {
        ...stepMetaFrom(step),
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
        ...stepMetaFrom(step),
        status: 'checkpoint',
        command: resolved.command,
        args: resolved.args,
        message: 'manual checkpoint required; rerun with --yes to continue',
      };
      run.steps.push(checkpointStep);
      await invokeHook(hooks.onStepFinish, checkpointStep, run);
      // checkpoint 停顿时也落一条 human-decision 占位（如果 step.artifacts 包含），方便 W-32 人工门挂条目。
      recordStepArtifacts(input.artifactStore, run, step);
      break;
    }

    const stepRun: WorkflowStepRun = {
      ...stepMetaFrom(step),
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
      // dry-run 也落 artifact 占位条目，便于后续模板化校验；caller 可按 createdAt 区分。
      recordStepArtifacts(input.artifactStore, run, step);
      continue;
    }
    // N-14：原来直接 await executor(...)，pty.spawn 抛错会把异常一路 reject 到 daemon，
    // onStepFinish 不会触发，GUI 看到 step 一直 running。把同步 / 异步抛错都归一化成
    // failed step，让事件总线和上层调用方拿到完整的失败语义。
    let exitCode: number;
    try {
      exitCode = await executor(resolved.command, resolved.args);
    } catch (err) {
      stepRun.exitCode = -1;
      stepRun.endedAt = Date.now();
      stepRun.status = 'failed';
      stepRun.message = `executor threw: ${err instanceof Error ? err.message : String(err)}`;
      await invokeHook(hooks.onStepFinish, stepRun, run);
      run.status = 'failed';
      break;
    }
    stepRun.exitCode = exitCode;
    stepRun.endedAt = Date.now();
    stepRun.status = exitCode === 0 ? 'success' : 'failed';
    // 如果是因为 cancel 被打断（executor 内 child 被 SIGTERM），message 给出明确原因，
    // 方便 delivery-note / GUI 区分「执行失败」与「用户主动取消」。
    if (exitCode !== 0 && input.signal?.aborted) {
      stepRun.message = 'workflow run cancelled mid-step';
    }
    await invokeHook(hooks.onStepFinish, stepRun, run);
    if (exitCode !== 0) {
      run.status = 'failed';
      break;
    }
    // 仅成功 step 落 artifact 占位；失败/跳过的步骤不产生产物，避免污染审查门。
    recordStepArtifacts(input.artifactStore, run, step);
    successful.add(step.id);
  }
  run.endedAt = Date.now();
  const finalRun = WorkflowRunSchema.parse(run);
  // W-33：workflow 结束（含 paused/failed）总结成一条 delivery-note artifact，便于复盘与外部续作。
  recordDeliveryNote(input.artifactStore, finalRun);
  await invokeHook(hooks.onWorkflowFinish, finalRun);
  return finalRun;
}

function recordDeliveryNote(store: WorkflowArtifactStore | undefined, run: WorkflowRun): void {
  if (!store) return;
  // 已落条目：每个 step 在成功 / 检查点 / dry-run 时已经 recordStepArtifacts 写过 type=plan / patch-summary / ...，
  // delivery-note 是 run 的最后一条，汇总「谁用什么 provider/model 做了什么 → 产出哪些 artifact」让人 1 条就能复盘。
  const priorArtifacts = store.list(run.id);
  const lines: string[] = [
    `workflow=${run.workflowName}`,
    `runId=${run.id}`,
    `status=${run.status}`,
    `steps=${run.steps.length}`,
    '',
    '## Steps',
  ];
  for (const step of run.steps) {
    const facets = [step.tool];
    if (step.provider && step.provider !== 'local') facets.push(`provider=${step.provider}`);
    if (step.role) facets.push(`role=${step.role}`);
    if (step.model) facets.push(`model=${step.model}`);
    const detail = step.message ? ` :: ${step.message}` : '';
    lines.push(`- ${step.id} [${facets.join(' ')}] ${step.status}${detail}`);
  }
  if (priorArtifacts.length > 0) {
    lines.push('', '## Artifacts');
    for (const artifact of priorArtifacts.slice().sort((a, b) => a.createdAt - b.createdAt)) {
      const where = artifact.stepId ? `${artifact.stepId}` : 'run';
      lines.push(`- ${artifact.type} @ ${where}${artifact.role ? ` (${artifact.role})` : ''}: ${artifact.title}`);
    }
  }
  // 把所有 prior artifact 的 files 合并去重，让 delivery-note 自己也带完整文件清单。
  const files = Array.from(new Set(priorArtifacts.flatMap((entry) => entry.files)));
  try {
    store.append({
      runId: run.id,
      workflowName: run.workflowName,
      type: 'delivery-note',
      title: `${run.workflowName} ${run.status}`,
      content: lines.join('\n'),
      files,
    });
  } catch (err) {
    logger.warn({ err, runId: run.id }, 'delivery-note artifact 落条失败');
  }
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
  let base: { command: string; args: string[] };
  if (step.template) {
    const templateValues = renderValues(step.values, values);
    const resolved = templateManager.resolve(step.template, { ...values, ...templateValues });
    base = {
      command: render(resolved.command, values),
      args: resolved.args.map((arg) => render(arg, values)),
    };
  } else {
    if (!step.command) throw new Error(`workflow step ${step.id} requires command or template`);
    base = {
      command: render(step.command, values),
      args: step.args.map((arg) => render(arg, values)),
    };
  }
  return providerInvocation(step.provider ?? 'local', step.model, base);
}

/**
 * W-31：按 provider 把 step 的 base invocation 包装成对应 CLI 调用。
 *
 * - local: base 原样返回（向后兼容所有不带 provider 字段的 workflow）
 * - codex: `codex exec [--model M] [<base-args>...] <base-command-as-prompt>`
 *   step.command 视为给 codex 的 prompt 文本；step.args 透传给 codex（用户可以塞 `--cwd` 等）
 * - claude-code: `claude -p <prompt> [<base-args>...] [--model M]`
 * - opencode: `opencode run [<base-args>...] [--model M] <prompt>`
 *
 * 这套模板是各 CLI 当前文档中的常见调用形态；用户后续若要换模板，可以走 step.template 走通用路径。
 */
function providerInvocation(
  provider: WorkflowProvider,
  model: string | undefined,
  base: { command: string; args: string[] },
): { command: string; args: string[] } {
  if (provider === 'local') return base;
  const prompt = base.command;
  if (!prompt) {
    // template 分支也可能落到这里，但 template.command 始终非空，仅 paranoia
    throw new Error(`provider ${provider} requires a non-empty step command/prompt`);
  }
  const modelFlag = model ? ['--model', model] : [];
  switch (provider) {
    case 'codex':
      return { command: 'codex', args: ['exec', ...modelFlag, ...base.args, prompt] };
    case 'claude-code':
      return { command: 'claude', args: ['-p', prompt, ...base.args, ...modelFlag] };
    case 'opencode':
      return { command: 'opencode', args: ['run', ...modelFlag, ...base.args, prompt] };
  }
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

function stepMetaFrom(step: WorkflowStep): Pick<WorkflowStepRun, 'id' | 'tool' | 'role' | 'model' | 'provider' | 'artifacts'> {
  return {
    id: step.id,
    tool: step.tool,
    role: step.role,
    model: step.model,
    provider: step.provider,
    artifacts: step.artifacts,
  };
}

/**
 * 按 step.artifacts 清单为 step 完成事件落占位 artifact。caller 可以后续读 store.list(run.id)
 * 拿到全部产物并补 content；store/落条失败不影响 workflow 主流程。
 */
function recordStepArtifacts(
  store: WorkflowArtifactStore | undefined,
  run: WorkflowRun,
  step: WorkflowStep,
): void {
  if (!store || step.artifacts.length === 0) return;
  for (const type of step.artifacts) {
    try {
      store.append({
        runId: run.id,
        workflowName: run.workflowName,
        stepId: step.id,
        role: step.role,
        type,
        title: `${run.workflowName}/${step.id}: ${type}`,
        content: '',
        files: [],
      });
    } catch (err) {
      logger.warn({ err, runId: run.id, stepId: step.id, type }, 'workflow-artifacts 落条失败，跳过该 artifact');
    }
  }
}
