import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * daemon 内部 fire-and-forget 续跑 workflow 用的 executor：
 * 直接 child_process.spawn 跑命令，stdio 输出进 daemon log。
 *
 * 为什么不走 PTY：
 * - daemon-side resume 默认是非交互的（fire-and-forget），各 AI CLI 的 `-p` / `exec` / `run`
 *   子命令本来就是给脚本化场景设计的，能在 non-TTY stdin 下正常完成。
 * - Windows ConPTY 在 PTY 终端 onExit 后会留 native handle，导致测试 / 短任务进程不能立即退出。
 * - 未来真要做 daemon-driven 交互式续跑（GUI 输入回流），可以切到 runWithPtyHeadless（runner.ts 里已经
 *   留好）+ 配套 stdin 转发，但不在本段范围。
 */
const STEP_OUTPUT_CHUNK_LIMIT = 4096;
// W-31：每个 step 的整段累积输出 cap，stdout / stderr 各占一半，超过就截断并把 truncated=true 落到 stepRun.output。
// 32KB/流足够装下大多数 provider 的一次完整响应，又不会让 WorkflowRunHistory 的 NDJSON 单行膨胀失控。
const STEP_OUTPUT_BUFFER_LIMIT = 32 * 1024;

function daemonWorkflowExecutor(
  command: string,
  args: string[],
  signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string, truncated: boolean) => void,
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve) => {
    // cwd = 所选 workspace 根目录；这样 GUI/daemon 跑 `npm test`、`npm run build` 这类项目命令时
    // 落在用户选的项目目录，而不是 daemon 进程目录。空（fallback workspace）时 undefined，保持旧行为。
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: cwd || undefined,
    });
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch { /* 子进程可能已退出，忽略 */ }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    // 累积 buffer 用于 W-31 落到 stepRun.output；每条流独立计 cap，命中 cap 就停止累加，
    // 但 onOutput WS 推送 (4KB chunk) 仍继续，让 GUI 看到实时输出，仅历史持久化截断。
    const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    let bufferTruncated = false;
    const wireStream = (stream: 'stdout' | 'stderr', src: NodeJS.ReadableStream | null) => {
      if (!src) return;
      src.on('data', (raw: Buffer) => {
        const text = raw.toString('utf8');
        logger.debug({ command, stream, bytes: text.length }, 'workflow step output');
        const remaining = STEP_OUTPUT_BUFFER_LIMIT - buffers[stream].length;
        if (remaining > 0) {
          buffers[stream] += text.length <= remaining ? text : text.slice(0, remaining);
          if (text.length > remaining) bufferTruncated = true;
        } else {
          bufferTruncated = true;
        }
        if (!onOutput) return;
        // WS chunk 仍按 4KB 截：单条帧不爆但流不停。
        const truncated = text.length > STEP_OUTPUT_CHUNK_LIMIT;
        const chunk = truncated ? text.slice(0, STEP_OUTPUT_CHUNK_LIMIT) : text;
        try { onOutput(stream, chunk, truncated); } catch (err) { logger.warn({ err }, 'step-output emit failed'); }
      });
    };
    wireStream('stdout', child.stdout);
    wireStream('stderr', child.stderr);
    child.on('error', (err) => {
      logger.warn({ err, command, args }, 'workflow step spawn 失败');
      signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode: -1, stdout: buffers.stdout, stderr: buffers.stderr, truncated: bufferTruncated });
    });
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode: code ?? -1, stdout: buffers.stdout, stderr: buffers.stderr, truncated: bufferTruncated });
    });
  });
}
import { readFileSync } from 'node:fs';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import type { Config, ModelBackend } from '../config.js';
import { Notifier } from './notifier.js';
import { WorkflowManager } from './workflowManager.js';
import {
  NotifyRequestSchema,
  InitializeWorkspaceRequestSchema,
  ResolveWorkflowGateRequestSchema,
  StartWorkflowRunRequestSchema,
} from '../shared/protocol.js';
import { CodePanionWorkspaceManager, WORKSPACE_CONFIG_DIR } from '../workflows/workspaceManager.js';
import { ensurePathInside } from '../workflows/pathSafety.js';
import {
  WorkflowArtifactStore,
  WorkflowDefinitionManager,
  WorkflowRunHistory,
  runWorkflow,
  type WorkflowDefinition,
  type WorkflowStepRun,
  type AgentStepRequest,
} from '../workflows/workflowDefinitionManager.js';
import { chatCompletion, ModelClientError, type ChatMessage } from '../models/modelClient.js';
import { logger, maskString } from '../logger.js';
import { VERSION } from '../shared/version.js';

// 监听路线下线后 createServer 无额外选项；保留空类型以兼容既有两段式调用签名。
type CreateServerOptions = Record<string, never>;

export function createServer(cfg: Config): {
  start: () => Promise<Server>;
  notifier: Notifier;
  workflows: WorkflowManager;
};
export function createServer(
  cfg: Config,
  options: CreateServerOptions = {},
): {
  start: () => Promise<Server>;
  notifier: Notifier;
  workflows: WorkflowManager;
} {
  const app = express();
  const notifier = new Notifier(cfg);
  // 监听路线下线后 WorkflowManager 只是 run-event 总线（无构造参数）。
  const workflows = new WorkflowManager();

  // 存储所有观察者 WebSocket 连接
  const observerSockets = new Set<WebSocket>();

  // 设置默认字符编码为 UTF-8
  app.use((_req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next();
    const auth = req.header('authorization');
    if (auth !== `Bearer ${cfg.token}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, pid: process.pid, version: VERSION });
  });

  app.post('/notify', (req, res) => {
    const parsed = NotifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { title, message, source, level, threadId, sessionId, sourceId, windowTitle, workspace } = parsed.data;
    // N-12 关联：日志只留路由元数据，不写 title / message 正文。
    logger.info({ source, level, threadId, sessionId, sourceId }, 'notify');

    // N-7：系统通知 body 走固定模板；详细信息通过 broadcast 留给 GUI。
    const systemBody = level === 'error'
      ? '任务出现错误，请查看 CodePanion'
      : level === 'prompt'
        ? '有任务等待您的回复'
        : level === 'done'
          ? '任务已完成'
          : '点击 CodePanion 查看详情';
    notifier.show(title, systemBody, { sound: level === 'prompt' });
    broadcastNotification(observerSockets, {
      title,
      message,
      source,
      threadId,
      sourceId,
      sessionId,
      level,
      windowTitle,
      workspace,
      timestamp: Date.now(),
    });

    res.json({ ok: true });
  });

  // board / gates 共用：从一段 runs 里挑出 paused + 有 checkpoint step 的，扁平成 gate entry。
  // human-decision artifact 决定 gate 的「最近决策」状态：
  //   - approve / reject：run 已被人工处理，gate 不再出现
  //   - retry：人工要求重新决策，gate 仍保留并附 lastDecision 显示用户上一轮的约束
  //   - 无决策：fresh gate
  const collectPausedGates = (runs: ReturnType<WorkflowRunHistory['list']>, store: WorkflowArtifactStore) => {
    // store.list() 按 createdAt 降序，第一次见到 runId 即最新一条 human-decision。
    const latestDecisionByRun = new Map<
      string,
      { decision: 'approve' | 'reject' | 'retry' | 'unknown'; content: string; createdAt: number }
    >();
    for (const entry of store.list()) {
      if (entry.type !== 'human-decision') continue;
      if (latestDecisionByRun.has(entry.runId)) continue;
      const firstLine = entry.content.split('\n')[0] ?? '';
      const decision = firstLine.startsWith('decision=')
        ? firstLine.slice('decision='.length)
        : 'unknown';
      latestDecisionByRun.set(entry.runId, {
        decision: (['approve', 'reject', 'retry'].includes(decision) ? decision : 'unknown') as
          | 'approve' | 'reject' | 'retry' | 'unknown',
        content: entry.content,
        createdAt: entry.createdAt,
      });
    }
    return runs
      .filter((run) => {
        if (run.status !== 'paused') return false;
        const latest = latestDecisionByRun.get(run.id);
        if (!latest) return true;
        // approve / reject 已闭环；retry / unknown 保留 gate 等下一轮人工决定。
        return latest.decision === 'retry' || latest.decision === 'unknown';
      })
      .map((run) => {
        const checkpoint = run.steps.find((step) => step.status === 'checkpoint');
        if (!checkpoint) return null;
        const latest = latestDecisionByRun.get(run.id);
        return {
          runId: run.id,
          workflowName: run.workflowName,
          stepId: checkpoint.id,
          role: checkpoint.role,
          tool: checkpoint.tool,
          command: checkpoint.command,
          args: checkpoint.args ?? [],
          message: checkpoint.message,
          artifacts: checkpoint.artifacts ?? [],
          pausedAt: run.endedAt,
          lastDecision: latest ? {
            decision: latest.decision,
            content: latest.content,
            at: latest.createdAt,
          } : undefined,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  };

  // W-32 起手：列出当前所有 paused workflow run 中的 checkpoint step，供 GUI 渲染「人工审核门」面板。
  app.get('/workflow/gates', (req, res) => {
    try {
      const { stores } = workspaceFor(typeof req.query.workspace === 'string' ? req.query.workspace : undefined);
      res.json({ gates: collectPausedGates(stores.history.list(), stores.artifactStore) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message ?? 'invalid workspace' });
    }
  });

  // W-10/W-11 接线：暴露 workspace 初始化与读取，供 GUI 在用户选择项目根目录后落 .codepanion/ 结构。
  app.post('/workspace/initialize', (req, res) => {
    const parsed = InitializeWorkspaceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const layout = new CodePanionWorkspaceManager(resolvePath(parsed.data.root)).initialize();
      res.json({ layout });
    } catch (err) {
      logger.warn({ err, root: parsed.data.root }, 'workspace 初始化失败');
      res.status(500).json({ error: (err as Error).message ?? 'workspace initialize failed' });
    }
  });

  app.get('/workspace/config', (req, res) => {
    const rootRaw = req.query.root;
    if (typeof rootRaw !== 'string' || rootRaw.trim().length === 0) {
      res.status(400).json({ error: 'query parameter `root` is required' });
      return;
    }
    // workspace root 是用户选择的项目目录，不限定在 HOME_DIR；仅做绝对路径规范化即可。
    // readConfig 内部用 ensurePathInside 校验 workflowPath 是否逃出 root，是真正的 CodeQL 闭环。
    if (rootRaw.includes('\0')) {
      res.status(400).json({ error: 'workspace root must not contain NUL byte' });
      return;
    }
    const resolvedRoot = resolvePath(rootRaw);
    if (!isAbsolute(resolvedRoot)) {
      res.status(400).json({ error: 'workspace root must resolve to an absolute path' });
      return;
    }
    const manager = new CodePanionWorkspaceManager(resolvedRoot);
    const config = manager.readConfig();
    if (!config) {
      res.status(404).json({ error: 'workspace config not found or corrupted' });
      return;
    }
    res.json({ config, layout: manager.layout() });
  });

  // per-workspace stores 缓存：key 是用户工作区目录的 canonical 绝对路径，或空串表示 fallback（走 HOME_DIR 默认 store）。
  // 不指定 workspace 走原行为（HOME_DIR 全局），指定时 daemon 把 history / artifacts / definitions
  // 都放到 `<workspace>/.codepanion/`，让不同项目互不污染。workspace 可以是任何用户目录。
  type WorkspaceStores = {
    definitions: WorkflowDefinitionManager;
    history: WorkflowRunHistory;
    artifactStore: WorkflowArtifactStore;
  };
  const workspaceStoresCache = new Map<string, WorkspaceStores>();
  const workspaceKey = (raw?: string | null): string => {
    if (typeof raw !== 'string' || raw.trim().length === 0) return '';
    if (raw.includes('\0')) throw new Error('invalid workspace: contains NUL byte');
    const resolved = resolvePath(raw);
    if (!isAbsolute(resolved)) throw new Error('invalid workspace: must resolve to an absolute path');
    return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
  };
  const workspaceFor = (raw?: string | null): { stores: WorkspaceStores; key: string } => {
    const key = workspaceKey(raw);
    let stores = workspaceStoresCache.get(key);
    if (!stores) {
      if (key === '') {
        // fallback：default constructor 走 env / HOME_DIR，保持向后兼容。
        stores = {
          definitions: new WorkflowDefinitionManager(),
          history: new WorkflowRunHistory(),
          artifactStore: new WorkflowArtifactStore(),
        };
      } else {
        const configDir = joinPath(key, WORKSPACE_CONFIG_DIR);
        stores = {
          definitions: new WorkflowDefinitionManager(joinPath(configDir, 'workflows.json')),
          history: new WorkflowRunHistory(joinPath(configDir, 'workflow-runs.ndjson')),
          artifactStore: new WorkflowArtifactStore(joinPath(configDir, 'workflow-artifacts.ndjson')),
        };
      }
      workspaceStoresCache.set(key, stores);
    }
    return { stores, key };
  };
  // 兼容旧引用：原 `artifactStore` 单例变成 fallback workspace 的 artifactStore。
  const fallbackStores = workspaceFor().stores;
  const artifactStore = fallbackStores.artifactStore;

  // W-23：daemon 进程内活跃 run 注册表。runWorkflowOnDaemon 内的 hooks 在 run-start/step-start/step-finish
  // 时更新，run-finish + history.append 完成后清除。GUI 通过 /workflow/board 合并看到 running 状态，
  // 不必等 history 写盘。daemon 重启即清空，符合「未持久化的运行态」语义（重启后 daemon 内就没有正在跑的 run）。
  type ActiveRunSnapshot = {
    id: string;
    workflowName: string;
    // workspace 隔离用 key：和 workspaceStoresCache 的 key 一致（空串 = fallback 全局 workspace）。
    // /workflow/board 用这个过滤，避免 A workspace 的 active run 在 B workspace 视图里露出。
    workspaceKey: string;
    startedAt: number;
    currentStepId?: string;
    currentStepStatus?: string;
    currentStepRole?: string;
    stepsFinished: number;
  };
  const activeRuns = new Map<string, ActiveRunSnapshot>();
  // runId → AbortController：POST /workflow/runs/:runId/cancel 通过它 SIGTERM 当前 step 的子进程。
  const runCancellers = new Map<string, AbortController>();

  // daemon-side runWorkflow 调用模板。approve resume 与 /workflow/runs 启动都共用：
  // - 注入 daemonWorkflowExecutor（child_process.spawn，避开 PTY handle 问题）
  // - 把 4 个生命周期事件 emit 到 workflows 总线，让 WS observer 实时看到进度
  // - 完成后 append 到 WorkflowRunHistory
  // 失败仅 logger.error 留痕，不抛给调用方 —— caller 已经早返回了 HTTP 响应。
  const runWorkflowOnDaemon = (opts: {
    workflow: WorkflowDefinition;
    values: Record<string, string>;
    yes?: boolean;
    dryRun?: boolean;
    stores: WorkspaceStores;
    workspaceKey: string;
    logContext: Record<string, unknown>;
    resumeFrom?: {
      runId: string;
      stepId: string;
      previousSteps: WorkflowStepRun[];
      startedAt: number;
    };
  }) => {
    const { history, artifactStore: store } = opts.stores;
    let pendingRunId: string | undefined;
    // currentContext 跟踪「executor 跑的是哪个 run 的哪个 step」，用于把 stdout/stderr chunk 标注后 emit。
    // step-start hook 在调 executor 之前触发，所以 executor 内拿到 chunk 时 currentContext 已就绪。
    let currentContext: { runId: string; workflowName: string; stepId: string } | undefined;
    const controller = new AbortController();

    // 执行模型两轴重构：architecture=agent 的 step 走这个进程内 agent executor（slice 1 = single-call）。
    // 解析顺序：model 取 step.model → role 绑定.model → cfg.defaultModel 中第一个能在 cfg.models 命中的；
    // role 的 system prompt 取自该 workspace roleBindings[role].promptPath 的 .md。调 modelClient 后把返回
    // 文本通过 step-output 事件实时推 WS，并作为 ExecutorResult.stdout 落进 history。
    const daemonAgentExecutor = async (req: AgentStepRequest) => {
      let systemPrompt: string | undefined;
      let roleModel: string | undefined;
      if (req.role && opts.workspaceKey) {
        try {
          const wsConfig = new CodePanionWorkspaceManager(opts.workspaceKey).readConfig();
          const binding = wsConfig?.roleBindings?.[req.role];
          if (binding) {
            roleModel = binding.model;
            if (binding.promptPath) {
              try {
                // 防越界：promptPath 来自该 workspace 的 .codepanion/workflow.json，必须落在 workspaceKey 内。
                // 否则恶意 config 可用 ../../ 把 system prompt 指到 workspace 外任意文件、再发给模型后端。
                // schema 层（workspaceManager）已拒绝绝对路径/含 .. 的 promptPath，这里是读取前的纵深兜底
                // （同时给 CodeQL 提供 path-injection 的 containment 数据流）。
                const promptFullPath = ensurePathInside(
                  joinPath(opts.workspaceKey, binding.promptPath),
                  opts.workspaceKey,
                  'role prompt path',
                );
                systemPrompt = readFileSync(promptFullPath, 'utf8');
              } catch { /* prompt 文件缺失 / 路径越界 → 无 system prompt，不致命 */ }
            }
          }
        } catch { /* workspace config 读不到 → 退回无 role 信息 */ }
      }
      const candidates = [req.model, roleModel, cfg.defaultModel].filter((x): x is string => Boolean(x));
      let backend: ModelBackend | undefined;
      let chosenModel: string | undefined;
      for (const id of candidates) {
        if (cfg.models && cfg.models[id]) { backend = cfg.models[id]; chosenModel = id; break; }
      }
      if (!backend) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `未找到模型后端：候选 model=[${candidates.join(', ') || '(无)'}]，请在 config.json 的 models / defaultModel 里配置`,
        };
      }
      const messages: ChatMessage[] = [];
      if (systemPrompt && systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: req.prompt });
      try {
        const result = await chatCompletion({ backend, messages, signal: controller.signal });
        // 实时把模型返回推给 WS observer（非流式，一次性整段）。
        workflows.emitRunEvent({
          action: 'step-output',
          runId: req.runId,
          workflowName: opts.workflow.name,
          stepId: req.stepId,
          stream: 'stdout',
          chunk: result.text,
          truncated: false,
        });
        logger.info({ ...opts.logContext, runId: req.runId, stepId: req.stepId, model: chosenModel, usage: result.usage }, 'agent step 完成');
        return { exitCode: 0, stdout: result.text, stderr: '', truncated: false };
      } catch (err) {
        const msg = err instanceof ModelClientError ? err.message : (err instanceof Error ? err.message : String(err));
        return { exitCode: 1, stdout: '', stderr: `模型调用失败：${msg}` };
      }
    };

    const promise = runWorkflow({
      workflow: opts.workflow,
      values: opts.values,
      yes: opts.yes,
      dryRun: opts.dryRun,
      artifactStore: store,
      resumeFrom: opts.resumeFrom,
      agentExecutor: daemonAgentExecutor,
      executor: (command, args) => daemonWorkflowExecutor(
        command,
        args,
        controller.signal,
        (stream, chunk, truncated) => {
          if (!currentContext) return;
          workflows.emitRunEvent({
            action: 'step-output',
            runId: currentContext.runId,
            workflowName: currentContext.workflowName,
            stepId: currentContext.stepId,
            stream,
            chunk,
            truncated,
          });
        },
        // shell step 在所选 workspace 目录执行（空 = fallback workspace，沿用 daemon 进程目录）。
        opts.workspaceKey || undefined,
      ),
      signal: controller.signal,
      hooks: {
        onWorkflowStart: (run) => {
          pendingRunId = run.id;
          // 续跑场景：run.steps 已经被 runWorkflow 灌入了前序 success step，stepsFinished 从那里点算，
          // 让 board 立刻看到正确的进度，而不是 0。
          activeRuns.set(run.id, {
            id: run.id,
            workflowName: run.workflowName,
            workspaceKey: opts.workspaceKey,
            startedAt: run.startedAt,
            stepsFinished: run.steps.filter((s) => s.status === 'success').length,
          });
          runCancellers.set(run.id, controller);
          workflows.emitRunEvent({
            action: 'run-start', runId: run.id, workflowName: run.workflowName, startedAt: run.startedAt,
          });
        },
        onStepStart: (step, run) => {
          currentContext = { runId: run.id, workflowName: run.workflowName, stepId: step.id };
          const snapshot = activeRuns.get(run.id);
          if (snapshot) {
            snapshot.currentStepId = step.id;
            snapshot.currentStepStatus = step.status;
            snapshot.currentStepRole = step.role;
          }
          workflows.emitRunEvent({
            action: 'step-start', runId: run.id, workflowName: run.workflowName,
            stepId: step.id, tool: step.tool, role: step.role, status: step.status,
          });
        },
        onStepFinish: (step, run) => {
          const snapshot = activeRuns.get(run.id);
          if (snapshot) {
            snapshot.currentStepStatus = step.status;
            if (step.status === 'success') snapshot.stepsFinished += 1;
          }
          workflows.emitRunEvent({
            action: 'step-finish', runId: run.id, workflowName: run.workflowName,
            stepId: step.id, status: step.status, exitCode: step.exitCode, message: step.message,
          });
        },
        onWorkflowFinish: (run) => workflows.emitRunEvent({
          action: 'run-finish', runId: run.id, workflowName: run.workflowName,
          status: run.status, stepCount: run.steps.length, endedAt: run.endedAt,
        }),
      },
    });
    return promise
      .then((completed) => {
        history.append(completed);
        activeRuns.delete(completed.id);
        runCancellers.delete(completed.id);
        return completed;
      })
      .catch((err) => {
        // 抛错路径：onWorkflowStart 已经把 run 入活跃表，但 history 没写、completed 拿不到——
        // 用上面记下的 pendingRunId 清掉孤儿条目，避免 board 里看到永远 running 的假任务。
        if (pendingRunId) {
          activeRuns.delete(pendingRunId);
          runCancellers.delete(pendingRunId);
        }
        logger.error({ err, ...opts.logContext }, 'daemon 内 runWorkflow 失败');
        throw err;
      });
  };

  // W-20：返回某次 run 的完整记录（含每个 step 的 W-31 output stdout/stderr）。board 只给摘要，
  // GUI 要在 run 卡片展开 step 输出时走这个详情端点。找不到 → 404。
  app.get('/workflow/runs/:runId', (req, res) => {
    try {
      const { stores } = workspaceFor(typeof req.query.workspace === 'string' ? req.query.workspace : undefined);
      const run = stores.history.get(req.params.runId);
      if (!run) {
        res.status(404).json({ error: 'workflow run not found' });
        return;
      }
      res.json({ run });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message ?? 'invalid workspace' });
    }
  });

  // W-33：列出某次 workflow run 的全部 artifact（plan / patch-summary / test-result / review-report /
  // human-decision / delivery-note），供 GUI 渲染人工审核门面板和交付摘要。
  app.get('/workflow/runs/:runId/artifacts', (req, res) => {
    try {
      const { stores } = workspaceFor(typeof req.query.workspace === 'string' ? req.query.workspace : undefined);
      res.json({ artifacts: stores.artifactStore.list(req.params.runId) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message ?? 'invalid workspace' });
    }
  });

  // W-33：把某次 run 的 delivery-note 拉成可直接喂给外部 AI（Codex / Claude Code / OpenCode）的文本。
  // - format=markdown（默认）：delivery-note 原文加上一个简单的元信息 header，适合做归档或人读。
  // - format=handoff：在原文外再包一层 continuation prompt，可整段粘到 codex exec / claude -p / opencode run。
  // 找不到 delivery-note 时回 404，调用方据此提示 GUI 「该 run 还没产出交付摘要」。
  app.get('/workflow/runs/:runId/delivery', (req, res) => {
    try {
      const { stores } = workspaceFor(typeof req.query.workspace === 'string' ? req.query.workspace : undefined);
      const { runId } = req.params;
      const run = stores.history.get(runId);
      if (!run) {
        res.status(404).json({ error: 'workflow run not found' });
        return;
      }
      // 同一 runId 上可能落多条 delivery-note（续跑时 recordDeliveryNote 会再写一条覆盖语义不强），
      // 这里取最新一条（createdAt 最大）作为当前交付状态。
      const candidates = stores.artifactStore.list(runId).filter((entry) => entry.type === 'delivery-note');
      if (candidates.length === 0) {
        res.status(404).json({ error: 'delivery-note not found for this run' });
        return;
      }
      const note = candidates.reduce((best, cur) => (cur.createdAt > best.createdAt ? cur : best));
      const formatRaw = typeof req.query.format === 'string' ? req.query.format : 'markdown';
      const format = formatRaw === 'handoff' ? 'handoff' : 'markdown';
      const header = [
        `# CodePanion delivery note: ${run.workflowName}`,
        '',
        `- Status: ${run.status}`,
        `- Run ID: ${runId}`,
        `- Steps: ${run.steps.length}`,
        '',
      ].join('\n');
      const body = `${header}${note.content}`;
      const content = format === 'handoff'
        ? [
            'You are continuing a CodePanion workflow that was previously run.',
            'Below is the delivery note from the prior run; treat it as the source of truth for what has already been done.',
            '',
            '---',
            '',
            body,
            '',
            '---',
            '',
            'Please continue this workflow:',
            '- If the previous run ended in `paused` or `failed`, focus on the blocker before doing anything else.',
            '- Honor every constraint recorded above; do not regress prior artifacts.',
            '- If the previous run ended in `success`, propose the next iteration consistent with the existing artifacts.',
            '- Return a short patch summary at the end so the next run can be appended.',
          ].join('\n')
        : body;
      res.json({
        runId,
        workflowName: run.workflowName,
        status: run.status,
        format,
        content,
        files: note.files,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message ?? 'invalid workspace' });
    }
  });

  // W-20 起手：一个 endpoint 聚合 GUI 主面板所需的 board 视图——可选执行的 workflow definitions、
  // 最近若干次 run、当前等待人工审核的 gates。GUI 渲染左侧 workflow 列表 + 中央 board + 右侧人工门。
  app.get('/workflow/board', (req, res) => {
    try {
      const { stores, key: currentWorkspaceKey } = workspaceFor(typeof req.query.workspace === 'string' ? req.query.workspace : undefined);
      const definitions = stores.definitions.list();
      const allRuns = stores.history.list();
      const recentRuns = allRuns.slice(0, 30);
      const gates = collectPausedGates(allRuns, stores.artifactStore);
      // 把 daemon 内活跃的 run 合并到 runs 列表前面，status='running'，让 GUI 立刻看到运行态。
      // 已 append 到历史的 run 已被 .then 从 activeRuns 删除，因此不会与历史条目重复。
      // 必须按 workspaceKey 过滤：activeRuns 是全局 Map，stores/history 已经按 workspace 隔离，
      // 这里不过滤就会让 A workspace 的 run 出现在 B workspace 的 board 上（Codex P2）。
      const activeEntries = Array.from(activeRuns.values())
        .filter((snapshot) => snapshot.workspaceKey === currentWorkspaceKey)
        .map((snapshot) => ({
        id: snapshot.id,
        workflowName: snapshot.workflowName,
        status: 'running' as const,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.startedAt,
        stepCount: snapshot.stepsFinished,
        currentStepId: snapshot.currentStepId,
        currentStepStatus: snapshot.currentStepStatus,
        currentStepRole: snapshot.currentStepRole,
      }));
      const historicalEntries = recentRuns.map((run) => ({
        id: run.id,
        workflowName: run.workflowName,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        stepCount: run.steps.length,
      }));
      res.json({
        workflows: definitions.map((definition) => ({
          name: definition.name,
          description: definition.description,
          stepCount: definition.steps.length,
          updatedAt: definition.updatedAt,
        })),
        runs: [...activeEntries, ...historicalEntries],
        gates,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message ?? 'invalid workspace' });
    }
  });

  // W-32 收尾：人工对当前停在 checkpoint 的 run/step 做决定，落一条 human-decision artifact。
  // 三种决策：
  //   approve  → 复用原 runId 从 checkpoint 之后续跑（PR #8 修复，不重跑前序 step）。
  //   reject   → 只落 artifact，run 永远停在 paused，由上层决定是否归档。
  //   retry    → 复用原 runId，但 resumeFrom 指向 checkpoint 前最近一个真正执行过的 step；
  //              那个 step 被重跑一次后，checkpoint 因为 yes:true 自动跳过，继续向后走。
  // constraints 字段（任何决策都可带）会被并入 values，subsequent step 可通过 {constraints} 模板变量引用。
  app.post('/workflow/gates/:runId/:stepId/resolve', (req, res) => {
    const parsed = ResolveWorkflowGateRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { stores, key: wsKey } = workspaceFor(parsed.data.workspace);
    const { runId, stepId } = req.params;
    const previous = stores.history.get(runId);
    if (!previous || previous.status !== 'paused') {
      res.status(404).json({ error: 'paused workflow run not found' });
      return;
    }
    const checkpoint = previous.steps.find((step) => step.id === stepId && step.status === 'checkpoint');
    if (!checkpoint) {
      res.status(404).json({ error: 'checkpoint step not found in run' });
      return;
    }
    const lines: string[] = [`decision=${parsed.data.decision}`];
    if (parsed.data.message) lines.push(`message=${parsed.data.message}`);
    const constraintList = parsed.data.constraints ?? [];
    if (constraintList.length > 0) {
      lines.push(`constraints=${constraintList.join(' | ')}`);
    }
    let artifact;
    try {
      artifact = stores.artifactStore.append({
        runId,
        workflowName: previous.workflowName,
        stepId,
        role: checkpoint.role,
        type: 'human-decision',
        title: `${previous.workflowName}/${stepId}: ${parsed.data.decision}`,
        content: lines.join('\n'),
        files: [],
      });
    } catch (err) {
      logger.warn({ err, runId, stepId }, 'human-decision artifact 落条失败');
      res.status(500).json({ error: (err as Error).message ?? 'append failed' });
      return;
    }

    if (parsed.data.decision === 'reject') {
      res.json({ artifact });
      return;
    }

    const workflow = stores.definitions.get(previous.workflowName);
    if (!workflow) {
      // approve/retry 了但找不到 definition：仍返回 artifact，前端可显示「需要重新导入 workflow」。
      logger.warn({ runId, workflowName: previous.workflowName, decision: parsed.data.decision }, 'gate resolve 时 workflow definition 缺失，跳过续跑');
      res.json({ artifact, resumeError: 'workflow definition missing' });
      return;
    }

    // retry 时往前找最近一个真正执行过的 step（previous.steps 末尾是 checkpoint 本身，倒数第二就是被审查的那一步）。
    // 找不到（例如 checkpoint 是 workflow 第一步）就退回 approve 语义，从 checkpoint 之后继续。
    let resumeStepId = stepId;
    if (parsed.data.decision === 'retry') {
      const checkpointIdx = previous.steps.findIndex((step) => step.id === stepId);
      for (let i = checkpointIdx - 1; i >= 0; i -= 1) {
        const candidate = previous.steps[i];
        if (candidate.status === 'success') {
          resumeStepId = candidate.id;
          break;
        }
      }
    }

    // constraints 并入 values，让后续 step 的 command/args 通过 {constraints} 模板变量直接拿到人工补充的约束。
    const resumedValues = constraintList.length > 0
      ? { ...previous.values, constraints: constraintList.join(' | ') }
      : previous.values;

    runWorkflowOnDaemon({
      workflow,
      values: resumedValues,
      yes: true,
      stores,
      workspaceKey: wsKey,
      resumeFrom: {
        runId,
        stepId: resumeStepId,
        previousSteps: previous.steps,
        startedAt: previous.startedAt,
      },
      logContext: { runId, workflowName: previous.workflowName, source: `gate-${parsed.data.decision}`, resumeStepId },
    }).catch(() => undefined);
    res.json({ artifact, resumed: true, resumeStepId });
  });

  // W-32 / cancel：让用户停掉 daemon 内正在跑的 workflow。触发 AbortController →
  // daemonWorkflowExecutor 立即 SIGTERM 当前 step 的子进程；runWorkflow 在 step 之间也会
  // 检测 aborted 提前 break。HTTP 立即响应，run-finish 事件由 runWorkflow 自然到达。
  app.post('/workflow/runs/:runId/cancel', (req, res) => {
    const { runId } = req.params;
    const controller = runCancellers.get(runId);
    if (!controller) {
      res.status(404).json({ error: 'run not active or already finished' });
      return;
    }
    controller.abort();
    res.json({ cancelled: true, runId });
  });

  // W-22 起手：GUI / 外部触发的 workflow 从头启动，fire-and-forget，进度走 workflow-run-event WS 流。
  app.post('/workflow/runs', (req, res) => {
    const parsed = StartWorkflowRunRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { stores, key: wsKey } = workspaceFor(parsed.data.workspace);
    const workflow = stores.definitions.get(parsed.data.workflow);
    if (!workflow) {
      res.status(404).json({ error: 'workflow not found' });
      return;
    }
    runWorkflowOnDaemon({
      workflow,
      values: { ...workflow.params, ...(parsed.data.values ?? {}) },
      yes: parsed.data.yes,
      dryRun: parsed.data.dryRun,
      stores,
      workspaceKey: wsKey,
      logContext: { workflowName: workflow.name, source: 'run-start' },
    }).catch(() => undefined);
    res.json({ accepted: true, workflowName: workflow.name });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'request error');
    const safeMessage = maskString(String(err?.message ?? err));
    res.status(500).json({ error: safeMessage });
  });

  const start = (): Promise<Server> =>
    new Promise((resolve) => {
      const httpServer = app.listen(cfg.port, '127.0.0.1', () => {
        logger.info({ port: cfg.port }, 'http listening');
        resolve(httpServer);
      });

      const expectedTokenProtocol = `codepanion.token.${cfg.token}`;
      const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        verifyClient(info, done) {
          if (!isOriginAllowed(info.origin)) {
            logger.warn({ origin: info.origin }, 'ws rejected: forbidden origin');
            done(false, 403, 'forbidden origin');
            return;
          }
          const protoHeader = info.req.headers['sec-websocket-protocol'];
          const offered = parseProtocolHeader(protoHeader);
          if (!offered.includes(expectedTokenProtocol)) {
            logger.warn({ hadSubprotocol: offered.length > 0 }, 'ws rejected: missing or invalid token subprotocol');
            done(false, 401, 'unauthorized');
            return;
          }
          done(true);
        },
        handleProtocols(protocols) {
          return protocols.has(expectedTokenProtocol) ? expectedTokenProtocol : false;
        },
      });
      wss.on('connection', (ws, req) => handleWs(ws, req, workflows, observerSockets));
      httpServer.on('close', () => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close();
      });
    });

  return { start, notifier, workflows };
}

function broadcastNotification(
  observerSockets: Set<WebSocket>,
  data: {
    title: string;
    message: string;
    source?: string;
    threadId?: string;
    sourceId?: string;
    sessionId?: string;
    level?: string;
    windowTitle?: string;
    workspace?: string;
    timestamp: number;
  },
) {
  const notification = JSON.stringify({ type: 'notification', data });
  observerSockets.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(notification);
  });
}

const ALLOWED_ORIGINS = new Set(['null', 'https://codepanion.local']);

function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function parseProtocolHeader(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : value;
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function handleWs(
  ws: WebSocket,
  req: { url?: string; headers: Record<string, string | string[] | undefined> },
  workflows: WorkflowManager,
  observerSockets: Set<WebSocket>,
): void {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const role = url.searchParams.get('role') ?? 'observer';
  logger.info({ role }, 'observer ws attached');

  // 监听路线下线后只剩 observer：订阅 run-event 总线（workflow-run-event）+ notification 广播。
  observerSockets.add(ws);
  const unsubscribeWorkflows = workflows.onEvent((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });
  ws.on('close', () => {
    unsubscribeWorkflows();
    observerSockets.delete(ws);
  });
  ws.send(JSON.stringify({ type: 'hello', pid: process.pid, version: VERSION }));

  ws.on('error', (err) => logger.warn({ err }, 'ws error'));
}
