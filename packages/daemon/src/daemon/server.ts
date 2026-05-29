import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { spawn, execFile } from 'node:child_process';
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

function daemonWorkflowExecutor(
  command: string,
  args: string[],
  signal?: AbortSignal,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string, truncated: boolean) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch { /* 子进程可能已退出，忽略 */ }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const wireStream = (stream: 'stdout' | 'stderr', src: NodeJS.ReadableStream | null) => {
      if (!src) return;
      src.on('data', (raw: Buffer) => {
        const text = raw.toString('utf8');
        logger.debug({ command, stream, bytes: text.length }, 'workflow step output');
        if (!onOutput) return;
        // 截断到 4KB 防止单条 WS 帧爆掉；超长时附 truncated 标记，CLI 可显示「(truncated)」。
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
      resolve(-1);
    });
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(code ?? -1);
    });
  });
}
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { WORKFLOW_SNAPSHOT_PATH } from '../config.js';
import { Notifier } from './notifier.js';
import { SessionManager } from './sessionManager.js';
import { SourceManager } from './sourceManager.js';
import { WorkflowManager } from './workflowManager.js';
import { CodexDesktopAdapter } from '../adapters/codexDesktopAdapter.js';
import { AiToolProcessAdapter } from '../adapters/aiToolProcessAdapter.js';
import {
  MonitorEventSchema,
  NotifyRequestSchema,
  RegisterSourceRequestSchema,
  RegisterSessionRequestSchema,
  ReplyRequestSchema,
  SessionExitRequestSchema,
  SessionOutputRequestSchema,
  SessionPromptRequestSchema,
  LaunchHandoffRequestSchema,
  UpdateWorkflowTaskStateRequestSchema,
  InitializeWorkspaceRequestSchema,
  ResolveWorkflowGateRequestSchema,
  StartWorkflowRunRequestSchema,
  type WorkflowThread,
  type HandoffTarget,
  type LaunchHandoffResponse,
} from '../shared/protocol.js';
import { CodePanionWorkspaceManager, WORKSPACE_CONFIG_DIR } from '../workflows/workspaceManager.js';
import {
  WorkflowArtifactStore,
  WorkflowDefinitionManager,
  WorkflowRunHistory,
  runWorkflow,
  type WorkflowDefinition,
  type WorkflowStepRun,
} from '../workflows/workflowDefinitionManager.js';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import { logger, maskString } from '../logger.js';
import { VERSION } from '../shared/version.js';

type CreateServerOptions = {
  workflowSnapshotPath?: string | null;
  launchHandoffSession?: (request: {
    originThread: WorkflowThread;
    target: HandoffTarget;
    prompt: string;
    preview: string;
  }) => Promise<LaunchHandoffResponse>;
};

const HANDOFF_TMP_DIR = join(tmpdir(), 'codepanion-handoff');
const GUI_WORKFLOW_SNAPSHOT_LIMITS = {
  maxThreads: 20,
  maxItemsPerThread: 40,
} as const;

export function createServer(cfg: Config): {
  start: () => Promise<Server>;
  notifier: Notifier;
  sessions: SessionManager;
  workflows: WorkflowManager;
};
export function createServer(
  cfg: Config,
  options: CreateServerOptions = {},
): {
  start: () => Promise<Server>;
  notifier: Notifier;
  sessions: SessionManager;
  workflows: WorkflowManager;
} {
  const app = express();
  const notifier = new Notifier(cfg);
  const sessions = new SessionManager({ retention: cfg.retention.session });
  const sources = new SourceManager({ retention: cfg.retention.source });
  const workflows = new WorkflowManager({
    snapshotPath: options.workflowSnapshotPath === null ? undefined : (options.workflowSnapshotPath ?? WORKFLOW_SNAPSHOT_PATH),
    retention: cfg.retention.workflow,
  });
  const codexAdapter = new CodexDesktopAdapter(workflows);
  const aiToolAdapter = new AiToolProcessAdapter(sources);
  const launchHandoffSession = options.launchHandoffSession ?? createDefaultHandoffLauncher();
  const snoozeTimers = new Map<string, NodeJS.Timeout>();
  const sessionWorkflowItemCounters = new Map<string, number>();
  const nextSessionWorkflowItemId = (sessionId: string, kind: string, timestamp: number) => {
    const next = (sessionWorkflowItemCounters.get(sessionId) ?? 0) + 1;
    sessionWorkflowItemCounters.set(sessionId, next);
    return `session:${sessionId}:${kind}:${timestamp}:${next}`;
  };

  // P2-D：把同一会话短时间内连发的 PTY 输出合并到一条 workflow item，
  // 避免高频 chunk 把 workflow items / id 计数器撑爆；50ms 边界足以把一次
  // CLI tick 的多块 chunk 合并，但仍能跟住人能感知的滚动节奏。
  // 收到 prompt / exit 时强制 flush，保证顺序与边界正确。
  const OUTPUT_MERGE_MS = 50;
  type PendingOutput = {
    id: string;
    threadId: string;
    content: string;
    timestamp: number;
    timer: NodeJS.Timeout;
  };
  const pendingOutputs = new Map<string, PendingOutput>();
  const clearSnoozeTimer = (threadId: string) => {
    const timer = snoozeTimers.get(threadId);
    if (!timer) return;
    clearTimeout(timer);
    snoozeTimers.delete(threadId);
  };
  const emitSnoozeDueNotification = (thread: WorkflowThread) => {
    // N-7：系统通知 body 不再回放用户线程标题；broadcast 给 GUI 仍保留以便列表更新。
    const title = '稍后任务已到期';
    const message = '点击 CodePanion 查看任务';
    notifier.show(title, message, { sound: cfg.toast.soundOnPrompt });
    broadcastNotification(observerSockets, {
      title,
      message,
      source: 'codepanion',
      threadId: thread.id,
      level: 'prompt',
      windowTitle: thread.title,
      workspace: thread.workspace,
      timestamp: Date.now(),
    });
  };
  const onSnoozeDue = (threadId: string) => {
    snoozeTimers.delete(threadId);
    const thread = workflows.getThread(threadId);
    if (!thread) return;
    const dueAt = thread.taskState?.snoozedUntil ?? null;
    if (!dueAt || thread.taskState?.archived) return;
    const remaining = dueAt - Date.now();
    if (remaining > 0) {
      scheduleSnoozeReminder(thread);
      return;
    }
    const updated = workflows.updateTaskState(threadId, { snoozedUntil: null });
    if (!updated) return;
    emitSnoozeDueNotification(updated);
  };
  const scheduleSnoozeReminder = (thread: WorkflowThread | undefined) => {
    if (!thread) return;
    clearSnoozeTimer(thread.id);
    const dueAt = thread.taskState?.snoozedUntil ?? null;
    if (!dueAt || thread.taskState?.archived) return;
    const delayMs = dueAt - Date.now();
    if (delayMs <= 0) {
      onSnoozeDue(thread.id);
      return;
    }
    const timer = setTimeout(() => onSnoozeDue(thread.id), delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    snoozeTimers.set(thread.id, timer);
  };
  const buildHandoffReturnSummary = (sessionId: string, exitCode: number, session?: ReturnType<SessionManager['get']>) => {
    const threadId = `session:${sessionId}`;
    const snapshot = workflows.threadSnapshot(threadId);
    const chunks = sessions.getOutputChunks(sessionId) ?? [];
    const sessionLabel = session?.windowTitle || session?.command || sessionId;
    const excerpt = pickHandoffSummaryExcerpt(snapshot?.items ?? [], chunks);
    const touchedFiles = pickHandoffTouchedFiles(snapshot?.items ?? [], chunks);
    const issueType = classifyHandoffIssueType(exitCode, snapshot?.items ?? [], chunks, excerpt);
    const resultLabel = exitCode === 0 ? '成功' : '失败';
    const conclusion = exitCode === 0 ? '待审阅' : '失败待处理';
    const targetLabel = inferHandoffTargetLabel(session);
    const retrySuggested = exitCode === 0 ? '否' : '是';
    const manualHandling = exitCode === 0 ? '建议' : '需要';
    const handlingAdvice = buildHandoffHandlingAdvice(exitCode, issueType);
    const nextAction = exitCode === 0
      ? '审阅接力结果并决定下一步'
      : '查看失败摘要并决定是否重试';
    const lines = [
      '**接力结果摘要**',
      '',
      `- 工具：${targetLabel}`,
      `- 会话：${sessionLabel}`,
      `- 回流结论：${conclusion}`,
      `- 结果：${resultLabel}`,
      `- 人工处理：${manualHandling}`,
      ...(issueType ? [`- 问题类型：${issueType}`] : []),
      `- 退出码：${exitCode}`,
      `- 建议重试：${retrySuggested}`,
      `- 处理建议：${handlingAdvice}`,
      `- 后续动作：${nextAction}`,
    ];
    if (touchedFiles.length > 0) {
      lines.push('', '## 涉及文件', ...touchedFiles.map((file) => `- ${file}`));
    }
    if (excerpt) {
      lines.push('', '## 最近进展', excerpt);
    }
    return lines.join('\n');
  };
  const flushPendingOutput = (sessionId: string): void => {
    const pending = pendingOutputs.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingOutputs.delete(sessionId);
    workflows.appendItem({
      id: pending.id,
      threadId: pending.threadId,
      source: 'cli',
      kind: 'command',
      title: '终端输出',
      content: pending.content,
      timestamp: pending.timestamp,
    });
  };

  sessions.onEvent((event) => {
    const now = Date.now();
    if (event.type === 'session-registered') {
      workflows.upsertThread({
        id: `session:${event.session.id}`,
        source: event.session.source ?? 'cli',
        title: event.session.command,
        workspace: event.session.cwd ?? event.session.workspace,
        status: 'running',
        updatedAt: event.session.startedAt,
        itemCount: 0,
      });
      workflows.appendItem({
        id: `session:${event.session.id}:registered`,
        threadId: `session:${event.session.id}`,
        source: event.session.source ?? 'cli',
        kind: 'status',
        title: '会话开始',
        content: `${event.session.command} ${event.session.args.join(' ')}`.trim(),
        status: 'running',
        timestamp: event.session.startedAt,
      });
      if (event.session.parentThreadId) {
        workflows.appendItem({
          id: `handoff:${event.session.parentThreadId}:session:${event.session.id}:started`,
          threadId: event.session.parentThreadId,
          source: 'codepanion',
          kind: 'status',
          title: '转交会话已启动',
          content: `${event.session.windowTitle || event.session.command} 已作为接力会话启动`,
          status: 'running',
          timestamp: event.session.startedAt,
        });
      }
    } else if (event.type === 'session-output') {
      const existing = pendingOutputs.get(event.sessionId);
      if (existing) {
        existing.content += event.chunk;
        return;
      }
      const id = nextSessionWorkflowItemId(event.sessionId, 'output', now);
      const sessionId = event.sessionId;
      const timer = setTimeout(() => flushPendingOutput(sessionId), OUTPUT_MERGE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      pendingOutputs.set(sessionId, {
        id,
        threadId: `session:${sessionId}`,
        content: event.chunk,
        timestamp: now,
        timer,
      });
    } else if (event.type === 'session-prompt') {
      flushPendingOutput(event.sessionId);
      workflows.appendItem({
        id: nextSessionWorkflowItemId(event.sessionId, 'prompt', now),
        threadId: `session:${event.sessionId}`,
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: event.fullOutput || event.lastLines,
        options: event.options,
        status: 'waiting',
        timestamp: now,
      });
    } else if (event.type === 'session-exited') {
      flushPendingOutput(event.sessionId);
      const session = sessions.get(event.sessionId);
      workflows.appendItem({
        id: nextSessionWorkflowItemId(event.sessionId, 'exit', now),
        threadId: `session:${event.sessionId}`,
        source: 'cli',
        kind: 'status',
        title: '会话结束',
        content: `退出码：${event.exitCode}`,
        status: event.exitCode === 0 ? 'done' : 'error',
        timestamp: now,
      });
      if (session?.parentThreadId) {
        const returnStatus = event.exitCode === 0 ? 'waiting' : 'error';
        workflows.updateTaskState(session.parentThreadId, {
          handoffStatus: 'returned',
          handoffSessionId: session.id,
        });
        workflows.appendItem({
          id: `handoff:${session.parentThreadId}:session:${session.id}:returned:${now}`,
          threadId: session.parentThreadId,
          source: 'codepanion',
          kind: 'status',
          title: event.exitCode === 0 ? '接力结果待审阅' : '转交会话异常回流',
          content: event.exitCode === 0
            ? `${session.windowTitle || session.command} 已结束，请审阅接力结果并决定下一步`
            : `${session.windowTitle || session.command} 已异常结束，请查看失败摘要并决定是否重试`,
          status: returnStatus,
          timestamp: now,
        });
        workflows.appendItem({
          id: `handoff:${session.parentThreadId}:session:${session.id}:summary:${now}`,
          threadId: session.parentThreadId,
          source: 'codepanion',
          kind: 'message',
          title: 'assistant',
          role: 'assistant',
          content: buildHandoffReturnSummary(session.id, event.exitCode, session),
          timestamp: now,
        });
        broadcastNotification(observerSockets, {
          title: event.exitCode === 0 ? '转交任务已回流' : '转交任务异常回流',
          message: `${session.windowTitle || session.command} 已结束，原任务重新回到当前队列`,
          source: 'codepanion',
          threadId: session.parentThreadId,
          sessionId: session.id,
          level: event.exitCode === 0 ? 'done' : 'error',
          windowTitle: session.windowTitle,
          workspace: session.workspace,
          timestamp: now,
        });
      }
      sessionWorkflowItemCounters.delete(event.sessionId);
    }
  });

  sources.onEvent((event) => {
    // source 离线 / 重新上线时同步刷新所有关联 thread 的 sourceOnline 字段。
    // 否则 Codex / Claude Code 进程已退出，GUI 仍把对应任务显示成「运行中」。
    if (event.type === 'source-disconnected') {
      workflows.setSourceOnline(event.sourceId, false);
      return;
    }
    if (event.type === 'source-registered') {
      workflows.setSourceOnline(event.source.id, true);
      return;
    }
    if (event.type !== 'monitor-event') return;
    const monitor = event.event;
    const threadId = `source:${monitor.sourceId ?? monitor.source ?? 'external'}`;
    const timestamp = monitor.timestamp ?? Date.now();
    workflows.upsertThread({
      id: threadId,
      source: monitor.source ?? 'external',
      title: monitor.windowTitle ?? monitor.title ?? monitor.source ?? '外部事件',
      workspace: monitor.workspace,
      status: monitor.type === 'prompt' ? 'waiting' : monitor.type === 'error' ? 'error' : monitor.type === 'done' ? 'done' : 'running',
      updatedAt: timestamp,
      itemCount: 0,
      // 既然事件能到达，说明 source 当前在线。下次 source 断开时 setSourceOnline 会把它翻成 false。
      sourceOnline: true,
    });
    workflows.appendItem({
      id: `monitor:${event.event.id}`,
      threadId,
      source: monitor.source ?? 'external',
      kind: monitor.type === 'prompt' ? 'prompt' : monitor.type === 'done' || monitor.type === 'error' ? 'status' : 'message',
      title: monitor.title,
      content: monitor.content,
      status: monitor.type === 'prompt' ? 'waiting' : monitor.type === 'error' ? 'error' : monitor.type === 'done' ? 'done' : undefined,
      timestamp,
    });
  });

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

  app.post('/sources/register', (req, res) => {
    const parsed = RegisterSourceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const source = sources.register(parsed.data);
    res.json(source);
  });

  app.get('/sources', (_req, res) => {
    res.json(sources.list());
  });

  app.post('/sources/:id/disconnect', (req, res) => {
    const ok = sources.disconnect(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/workflow/threads', (_req, res) => {
    res.json(workflows.snapshot().threads);
  });

  app.get('/workflow/threads/:id', (req, res) => {
    const snapshot = workflows.threadSnapshot(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: 'thread not found' });
      return;
    }
    res.json(snapshot);
  });

  app.get('/workflow/snapshot', (_req, res) => {
    res.json(workflows.snapshot(GUI_WORKFLOW_SNAPSHOT_LIMITS));
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
    const promise = runWorkflow({
      workflow: opts.workflow,
      values: opts.values,
      yes: opts.yes,
      dryRun: opts.dryRun,
      artifactStore: store,
      resumeFrom: opts.resumeFrom,
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
  // approve 分支会在 daemon 内 fire-and-forget 触发同 workflow 的续跑（带 yes:true），返回 newRunId；
  // reject / retry 仅落 artifact 不续跑（retry 留给后续轮次让人重新发起）。
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
    if (parsed.data.constraints && parsed.data.constraints.length > 0) {
      lines.push(`constraints=${parsed.data.constraints.join(' | ')}`);
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

    if (parsed.data.decision !== 'approve') {
      res.json({ artifact });
      return;
    }

    const workflow = stores.definitions.get(previous.workflowName);
    if (!workflow) {
      // approve 了但找不到 definition：仍返回 artifact，前端可显示「需要重新导入 workflow」。
      logger.warn({ runId, workflowName: previous.workflowName }, 'approve 时 workflow definition 缺失，跳过续跑');
      res.json({ artifact, resumeError: 'workflow definition missing' });
      return;
    }
    // 复用原 runId/startedAt 续跑，runWorkflow 会跳过 stepId 之前的成功 step，从 checkpoint 重新执行；
    // 这样不会重复跑前面的 step（Codex P1）。同 runId 由 WorkflowRunHistory.append 在写入时覆盖旧条目。
    runWorkflowOnDaemon({
      workflow,
      values: previous.values,
      yes: true,
      stores,
      workspaceKey: wsKey,
      resumeFrom: {
        runId,
        stepId,
        previousSteps: previous.steps,
        startedAt: previous.startedAt,
      },
      logContext: { runId, workflowName: previous.workflowName, source: 'gate-approve' },
    }).catch(() => undefined);
    res.json({ artifact, resumed: true });
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

  app.post('/workflow/threads/:id/task-state', (req, res) => {
    const parsed = UpdateWorkflowTaskStateRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const thread = workflows.updateTaskState(req.params.id, parsed.data);
    if (!thread) {
      res.status(404).json({ error: 'thread not found' });
      return;
    }
    scheduleSnoozeReminder(thread);
    res.json(thread);
  });

  app.post('/workflow/threads/:id/handoff', async (req, res) => {
    const parsed = LaunchHandoffRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const originThread = workflows.getThread(req.params.id);
    if (!originThread) {
      res.status(404).json({ error: 'thread not found' });
      return;
    }

    try {
      const launched = await launchHandoffSession({
        originThread,
        target: parsed.data.target,
        prompt: parsed.data.prompt,
        preview: parsed.data.preview,
      });

      const updated = workflows.updateTaskState(originThread.id, {
        archived: false,
        handoffStatus: 'active',
        handoffTarget: parsed.data.target,
        handoffSessionId: launched.sessionId,
      });
      if (updated) {
        workflows.appendItem({
          id: `handoff:${originThread.id}:launch:${launched.sessionId}`,
          threadId: originThread.id,
          source: 'codepanion',
          kind: 'status',
          title: launched.launchMode === 'tool' ? '任务已转交' : '已创建转交准备会话',
          content: launched.launchMode === 'tool'
            ? `已启动 ${handoffTargetLabel(parsed.data.target)} 接力会话`
            : `未检测到 ${handoffTargetLabel(parsed.data.target)} 可执行入口，已创建本地交接会话`,
          status: 'running',
          timestamp: Date.now(),
        });
      }

      notifier.show(
        launched.launchMode === 'tool' ? '已启动任务转交' : '已创建转交准备会话',
        launched.launchMode === 'tool'
          ? `${handoffTargetLabel(parsed.data.target)} 接力会话已启动`
          : `${handoffTargetLabel(parsed.data.target)} 不可用，已回退到本地交接会话`,
        { sound: cfg.toast.soundOnPrompt },
      );

      res.json(launched);
    } catch (err) {
      logger.error({ err, threadId: originThread.id, target: parsed.data.target }, 'handoff launch failed');
      res.status(500).json({ error: maskString((err as Error)?.message ?? 'handoff launch failed') });
    }
  });

  app.post('/events', (req, res) => {
    const parsed = MonitorEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const event = sources.emitEvent(parsed.data);
    const level = event.level ?? (
      event.type === 'prompt'
        ? 'prompt'
        : event.type === 'error'
          ? 'error'
          : event.type === 'done'
            ? 'done'
            : 'info'
    );

    if (event.type === 'prompt' || event.type === 'done' || event.type === 'error' || event.type === 'notification') {
      const title = event.title ?? `${event.source ?? 'CodePanion'} ${event.type}`;
      const message = event.content || event.windowTitle || 'CodePanion event';
      // N-7：system 通道用固定模板，原始 event.content / windowTitle 留给 GUI broadcast。
      const systemBody = event.type === 'prompt'
        ? '有任务等待您的回复'
        : event.type === 'done'
          ? '任务已完成'
          : event.type === 'error'
            ? '任务出现错误，请查看 CodePanion'
            : '有新通知';
      notifier.show(title, systemBody, { sound: level === 'prompt' || level === 'done' });
      if (event.type === 'notification') {
        broadcastNotification(observerSockets, {
          title,
          message,
          source: event.source,
          threadId: undefined,
          sourceId: event.sourceId,
          sessionId: event.sessionId,
          level,
          windowTitle: event.windowTitle,
          workspace: event.workspace,
          timestamp: event.timestamp,
        });
      }
    }

    res.json({ ok: true, event });
  });

  app.post('/events/:id/reply', (req, res) => {
    const parsed = ReplyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const ok = sources.reply(req.params.id, parsed.data.text);
    if (!ok) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/events/:id/replies', (req, res) => {
    const replies = sources.listReplies(req.params.id);
    if (!replies) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    res.json({ eventId: req.params.id, replies });
  });

  app.get('/audit/snapshot', (req, res) => {
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since : undefined;
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    if (sinceRaw !== undefined && (!Number.isFinite(since) || since! < 0)) {
      res.status(400).json({ error: 'since must be a non-negative epoch milliseconds value' });
      return;
    }
    const sourceSnapshot = sources.exportSnapshot({ since });
    const sessionList = sessions.list().filter((s) => (s.startedAt ?? 0) >= (since ?? 0));
    const workflowSnapshot = workflows.snapshot();
    const filteredThreads = since
      ? workflowSnapshot.threads.filter((t) => (t.updatedAt ?? 0) >= since)
      : workflowSnapshot.threads;
    const filteredItems = since
      ? workflowSnapshot.items.filter((i) => (i.timestamp ?? 0) >= since)
      : workflowSnapshot.items;
    res.json({
      schemaVersion: 1,
      generatedAt: Date.now(),
      since: since ?? null,
      daemonVersion: VERSION,
      sources: sourceSnapshot.sources,
      events: sourceSnapshot.events,
      eventReplies: sourceSnapshot.replies,
      sessions: sessionList,
      workflowThreads: filteredThreads,
      workflowItems: filteredItems,
    });
  });

  app.post('/sessions', (req, res) => {
    const parsed = RegisterSessionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const info = sessions.register(parsed.data);
    res.json(info);
  });

  app.get('/sessions', (_req, res) => {
    res.json(sessions.list());
  });

  app.get('/sessions/:id/output', (req, res) => {
    const fullOutput = sessions.getFullOutput(req.params.id);
    const chunks = sessions.getOutputChunks(req.params.id);

    if (fullOutput === null || chunks === null) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    res.json({
      fullOutput,
      chunks
    });
  });

  app.post('/sessions/:id/output', (req, res) => {
    const parsed = SessionOutputRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    sessions.appendOutput(req.params.id, parsed.data.chunk);
    res.json({ ok: true });
  });

  app.post('/sessions/:id/prompt', (req, res) => {
    const parsed = SessionPromptRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const rec = sessions.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    const { lastLines, options } = parsed.data;
    sessions.markPrompt(req.params.id, lastLines, options);
    // N-7：title 仅放工具命令名首段（已被 notifier 内部 mask + 截断），message 用固定模板，
    // 不把 PTY 最后两行原文喂进系统通知。
    const title = `${rec.command} 等待输入`;
    const message = '有任务等待您的回复';
    notifier.show(title, message, { sound: cfg.toast.soundOnPrompt });
    res.json({ ok: true });
  });

  app.post('/sessions/:id/reply', (req, res) => {
    const parsed = ReplyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = sessions.injectReply(req.params.id, parsed.data.text, parsed.data.mode);
    if (result === 'not-connected') {
      res.status(404).json({ error: 'session not connected' });
      return;
    }
    if (result === 'invalid-reply') {
      res.status(400).json({ error: 'reply must match a current prompt option' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/sessions/:id/exit', (req, res) => {
    const parsed = SessionExitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const rec = sessions.get(req.params.id);
    sessions.markExited(req.params.id, parsed.data.exitCode);
    if (rec) {
      const ok = parsed.data.exitCode === 0;
      const title = `${rec.command} ${ok ? '已完成' : '已退出'}`;
      const message = `退出码 ${parsed.data.exitCode}`;
      notifier.show(title, message, { sound: cfg.toast.soundOnDone });
    }
    res.json({ ok: true });
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
        if (cfg.monitors.codexDesktop) codexAdapter.start();
        if (cfg.monitors.aiTools) aiToolAdapter.start();
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
      wss.on('connection', (ws, req) => handleWs(ws, req, sessions, sources, workflows, observerSockets));
      httpServer.on('close', () => {
        for (const timer of snoozeTimers.values()) {
          clearTimeout(timer);
        }
        snoozeTimers.clear();
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close();
      });
    });

  // H-1：启动时若用户机器睡了一夜，多个 snooze 已经过期。原来逐条调 scheduleSnoozeReminder
  // 会立刻触发 emitSnoozeDueNotification，把 N 条系统通知一次性弹出来抢焦点，违反 P0.1 "不乱跳"。
  // 现在做法：未过期的正常排程；已过期的批量清 snoozedUntil + 单条聚合通知 + 仍逐条 broadcast 给 GUI。
  const dueAtStartup: WorkflowThread[] = [];
  for (const thread of workflows.snapshot().threads) {
    const dueAt = thread.taskState?.snoozedUntil ?? null;
    if (!dueAt || thread.taskState?.archived) continue;
    if (dueAt - Date.now() > 0) {
      scheduleSnoozeReminder(thread);
      continue;
    }
    const updated = workflows.updateTaskState(thread.id, { snoozedUntil: null });
    if (updated) dueAtStartup.push(updated);
  }
  if (dueAtStartup.length > 0) {
    const title = '稍后任务已到期';
    const message = dueAtStartup.length === 1
      ? '1 个稍后任务已回到待处理队列'
      : `${dueAtStartup.length} 个稍后任务已回到待处理队列`;
    notifier.show(title, message, { sound: cfg.toast.soundOnPrompt });
    for (const thread of dueAtStartup) {
      broadcastNotification(observerSockets, {
        title,
        message,
        source: 'codepanion',
        threadId: thread.id,
        level: 'prompt',
        windowTitle: thread.title,
        workspace: thread.workspace,
        timestamp: Date.now(),
      });
    }
  }

  return { start, notifier, sessions, workflows };
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

function createDefaultHandoffLauncher() {
  return async (request: {
    originThread: WorkflowThread;
    target: HandoffTarget;
    prompt: string;
    preview: string;
  }): Promise<LaunchHandoffResponse> => {
    mkdirSync(HANDOFF_TMP_DIR, { recursive: true });
    const sessionId = randomUUID();
    const targetSpec = resolveHandoffTarget(request.target);
    const promptPath = join(HANDOFF_TMP_DIR, `${sessionId}.txt`);
    writeFileSync(promptPath, request.prompt, 'utf8');

    const runConfigPath = join(HANDOFF_TMP_DIR, `${sessionId}.json`);
    // H-3：原 commandExists 走 execSync，多次 handoff 会同步阻塞 daemon 主线程；
    // 改异步 + 5min TTL 结果缓存，常见 codex / claude / opencode 三个目标只需首次实测。
    const fallback = !targetSpec.command || !(await commandExists(targetSpec.command));
    const launchMode: LaunchHandoffResponse['launchMode'] = fallback ? 'fallback' : 'tool';
    const launchCommand = fallback ? 'cmd.exe' : targetSpec.command!;
    const launchArgs = fallback
      ? ['/d', '/k', `type "${promptPath}"`]
      : targetSpec.args;

    writeFileSync(runConfigPath, JSON.stringify({
      sessionId,
      command: launchCommand,
      args: launchArgs,
      cwd: request.originThread.workspace || undefined,
      source: fallback ? 'cli' : targetSpec.source,
      windowTitle: `${handoffTargetLabel(request.target)} · ${request.originThread.title}`,
      workspace: request.originThread.workspace || undefined,
      parentThreadId: request.originThread.id,
      initialInput: fallback ? undefined : `${request.prompt}\n`,
    }), 'utf8');

    const entry = process.argv[1];
    if (!entry) {
      throw new Error('handoff runner entry is unavailable');
    }
    const child = spawn(process.execPath, [entry, '__handoff-runner', runConfigPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: request.originThread.workspace || process.cwd(),
      env: { ...process.env },
    });
    child.unref();

    return {
      ok: true,
      threadId: request.originThread.id,
      sessionId,
      target: request.target,
      launchMode,
      command: launchCommand,
      args: launchArgs,
    };
  };
}

function resolveHandoffTarget(target: HandoffTarget): { command: string | null; args: string[]; source: string } {
  if (target === 'codex') return { command: 'codex', args: [], source: 'codex' };
  if (target === 'claude-code') return { command: 'claude', args: [], source: 'claude-code' };
  if (target === 'opencode') return { command: 'opencode', args: [], source: 'opencode' };
  return { command: null, args: [], source: 'cli' };
}

// H-3：commandExists 结果按工具名 + 平台缓存 5 分钟。daemon 长跑期间用户不会反复装/卸命令，
// 但每次 handoff 都同步 fork 进程会卡主线程；用 Map<name, {result, expiresAt}> 把热点命中变成 O(1)。
const COMMAND_EXISTS_TTL_MS = 5 * 60 * 1000;
const commandExistsCache = new Map<string, { result: boolean; expiresAt: number }>();

function execFileAsync(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

async function commandExists(name: string): Promise<boolean> {
  if (!name) return false;
  const now = Date.now();
  const cached = commandExistsCache.get(name);
  if (cached && cached.expiresAt > now) return cached.result;
  const isWin = process.platform === 'win32';
  let result = false;
  try {
    // POSIX `command -v` 是 shell builtin，execFile 不可达；改用真正的 which。
    const out = isWin
      ? await execFileAsync('where', [name])
      : await execFileAsync('which', [name]);
    result = out.split(/\r?\n/).some((line) => line.trim().length > 0);
  } catch {
    result = false;
  }
  commandExistsCache.set(name, { result, expiresAt: now + COMMAND_EXISTS_TTL_MS });
  return result;
}

function handoffTargetLabel(target: HandoffTarget): string {
  if (target === 'codex') return 'Codex';
  if (target === 'claude-code') return 'Claude Code';
  if (target === 'opencode') return 'OpenCode';
  return '通用目标';
}

function inferHandoffTargetLabel(session?: { source?: string; windowTitle?: string; command?: string }): string {
  const source = String(session?.source || '').toLowerCase();
  if (source === 'codex' || /codex/i.test(session?.windowTitle || '') || /codex/i.test(session?.command || '')) return 'Codex';
  if (source === 'claude-code' || /claude/i.test(session?.windowTitle || '') || /claude/i.test(session?.command || '')) return 'Claude Code';
  if (source === 'opencode' || /opencode/i.test(session?.windowTitle || '') || /opencode/i.test(session?.command || '')) return 'OpenCode';
  return '通用';
}

function pickHandoffSummaryExcerpt(items: Array<{ kind?: string; status?: string; content?: string }>, chunks: Array<{ content?: string; type?: string }>): string {
  for (const item of [...items].reverse()) {
    const excerpt = compactHandoffExcerpt(item.content);
    if (!excerpt) continue;
    if (item.status === 'error') return excerpt;
    if (item.kind === 'message' || item.kind === 'artifact' || item.kind === 'prompt' || item.kind === 'command') return excerpt;
  }
  for (const chunk of [...chunks].reverse()) {
    if (chunk.type === 'reply') continue;
    const excerpt = compactHandoffExcerpt(chunk.content);
    if (excerpt) return excerpt;
  }
  return '';
}

function pickHandoffTouchedFiles(
  items: Array<{ kind?: string; filePath?: string; content?: string }>,
  chunks: Array<{ content?: string; type?: string }>,
): string[] {
  const files = new Set<string>();
  const push = (value: string | undefined) => {
    const normalized = normalizeHandoffFilePath(value);
    if (normalized) files.add(normalized);
  };

  for (const item of items) {
    if (item.kind === 'file_change' || item.kind === 'artifact' || item.kind === 'command' || item.kind === 'message') {
      push(item.filePath);
      for (const candidate of extractHandoffFilePaths(item.content)) push(candidate);
    }
  }
  for (const chunk of chunks) {
    if (chunk.type === 'reply') continue;
    for (const candidate of extractHandoffFilePaths(chunk.content)) push(candidate);
  }

  return Array.from(files).slice(0, 6);
}

function compactHandoffExcerpt(content: string | undefined): string {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^退出码[:：]?\s*-?\d+$/i.test(line))
    .filter((line) => !/^running tests\.{0,3}$/i.test(line));
  const text = lines.at(-1) || '';
  if (!text) return '';
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

function extractHandoffFilePaths(content: string | undefined): string[] {
  const text = String(content || '');
  if (!text) return [];
  return text.match(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,8}/g) ?? [];
}

function normalizeHandoffFilePath(value: string | undefined): string {
  const trimmed = String(value || '').trim().replace(/^["'`]+|["'`.,:;]+$/g, '');
  if (!trimmed) return '';
  const normalized = trimmed.replace(/\\/g, '/');
  if (!normalized.includes('/') || !/\.[A-Za-z0-9]{1,8}$/.test(normalized)) return '';
  return normalized.replace(/^[.][/]/, '');
}

// H-4：原实现对 200KB stdout 做 6 次 regex 扫描会卡 50~100ms 主线程。
// 改造点：
//   1) 预编译 regex 数组，避免每次调用重建。
//   2) 只取摘要 + 最近 50 行 + items 末尾若干条，构造 ≤8KB 的窄语料。
//   3) 模式以确定性短关键字为主，无 `.*?` 类回溯。
const HANDOFF_ISSUE_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: '配置问题', pattern: /appdata|config|configuration|dotenv|missing env|environment variable|未配置|配置缺失|配置文件/ },
  { kind: '权限问题', pattern: /eacces|eperm|access denied|permission denied|权限|拒绝访问|unauthorized|forbidden/ },
  { kind: '网络问题', pattern: /timed out|timeout|econnrefused|enotfound|network|fetch failed|dns|socket|连接失败|网络|超时/ },
  { kind: '依赖问题', pattern: /npm err|pnpm err|module not found|cannot find module|missing package|dependency|依赖|lockfile/ },
  { kind: '测试问题', pattern: /test failed|failing tests|jest|vitest|node --test|assert|测试失败/ },
  { kind: '构建问题', pattern: /build failed|compile|compilation|tsc|dotnet build|msbuild|syntaxerror|parsererror|构建失败|编译失败/ },
];

const HANDOFF_CORPUS_TAIL_LINES = 50;
const HANDOFF_CORPUS_MAX_BYTES = 8 * 1024;

function classifyHandoffIssueType(
  exitCode: number,
  items: Array<{ content?: string; title?: string; status?: string }>,
  chunks: Array<{ content?: string; type?: string }>,
  excerpt: string,
): string {
  if (exitCode === 0) return '';
  const corpus = buildHandoffClassificationCorpus(excerpt, items, chunks);
  for (const { kind, pattern } of HANDOFF_ISSUE_PATTERNS) {
    if (pattern.test(corpus)) return kind;
  }
  return '未知问题';
}

function buildHandoffClassificationCorpus(
  excerpt: string,
  items: Array<{ content?: string; title?: string; status?: string }>,
  chunks: Array<{ content?: string; type?: string }>,
): string {
  const parts: string[] = [];
  if (excerpt) parts.push(excerpt);
  // 倒序拿最近的 items / chunks，限定 8KB；早期的栈底信息对故障分类没有增量。
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.title) parts.push(item.title);
    if (item.content) parts.push(item.content);
    if (parts.join('\n').length >= HANDOFF_CORPUS_MAX_BYTES) break;
  }
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk.type === 'reply') continue;
    if (chunk.content) parts.push(chunk.content);
    if (parts.join('\n').length >= HANDOFF_CORPUS_MAX_BYTES) break;
  }
  const joined = parts.join('\n');
  // 只保留最后 HANDOFF_CORPUS_TAIL_LINES 行；编译器/解释器错误通常落在末尾。
  const tailLines = joined.split(/\r?\n/).slice(-HANDOFF_CORPUS_TAIL_LINES);
  let tail = tailLines.join('\n');
  if (tail.length > HANDOFF_CORPUS_MAX_BYTES) tail = tail.slice(-HANDOFF_CORPUS_MAX_BYTES);
  return tail.toLowerCase();
}

function buildHandoffHandlingAdvice(exitCode: number, issueType: string): string {
  if (exitCode === 0) {
    return '先审阅涉及文件与最近进展，再决定是否继续处理';
  }
  if (issueType === '配置问题') return '检查 APPDATA 或相关环境变量配置后再重试';
  if (issueType === '权限问题') return '检查文件或目录权限后再决定是否重试';
  if (issueType === '网络问题') return '先确认网络连通性与远端服务状态，再决定是否重试';
  if (issueType === '依赖问题') return '先安装或修复缺失依赖，再决定是否重试';
  if (issueType === '测试问题') return '先查看失败用例与断言，再决定是否修复后重试';
  if (issueType === '构建问题') return '先查看构建报错位置并修复，再决定是否重试';
  return '先查看最近进展与失败摘要，再决定是否重试';
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
  sessions: SessionManager,
  sources: SourceManager,
  workflows: WorkflowManager,
  observerSockets: Set<WebSocket>,
): void {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const role = url.searchParams.get('role') ?? 'observer';
  const sessionId = url.searchParams.get('sessionId');

  if (role === 'cli') {
    if (!sessionId) {
      ws.close(4400, 'missing sessionId');
      return;
    }
    if (!sessions.attachCliSocket(sessionId, ws)) {
      ws.close(4404, 'no such session');
      return;
    }
    logger.info({ sessionId }, 'cli ws attached');
  } else {
    logger.info({ role }, 'observer ws attached');

    // 添加到观察者集合
    observerSockets.add(ws);

    const unsubscribeSessions = sessions.onEvent((event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });
    const unsubscribeSources = sources.onEvent((event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });
    const unsubscribeWorkflows = workflows.onEvent((event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });

    ws.on('close', () => {
      unsubscribeSessions();
      unsubscribeSources();
      unsubscribeWorkflows();
      observerSockets.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'hello', pid: process.pid, version: VERSION }));
    // Observer 重连后必须能从 snapshot 恢复完整视图（sessions / sources / workflows），
    // 否则左侧任务列表会因只接收增量事件而保持为空。
    ws.send(JSON.stringify({ type: 'sessions-snapshot', sessions: sessions.list() }));
    ws.send(JSON.stringify({ type: 'sources-snapshot', sources: sources.list() }));
    ws.send(JSON.stringify({ type: 'workflow-snapshot', snapshot: workflows.snapshot(GUI_WORKFLOW_SNAPSHOT_LIMITS) }));
  }

  ws.on('error', (err) => logger.warn({ err }, 'ws error'));
}
