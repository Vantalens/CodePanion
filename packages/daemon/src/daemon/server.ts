import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Config } from '../config.js';
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
} from '../shared/protocol.js';
import { logger } from '../logger.js';

export function createServer(cfg: Config): {
  start: () => Promise<Server>;
  notifier: Notifier;
  sessions: SessionManager;
} {
  const app = express();
  const notifier = new Notifier(cfg);
  const sessions = new SessionManager();
  const sources = new SourceManager();
  const workflows = new WorkflowManager();
  const codexAdapter = new CodexDesktopAdapter(workflows);
  const aiToolAdapter = new AiToolProcessAdapter(sources);

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
    } else if (event.type === 'session-output') {
      workflows.appendItem({
        id: `session:${event.sessionId}:output:${now}:${Buffer.byteLength(event.chunk, 'utf8')}`,
        threadId: `session:${event.sessionId}`,
        source: 'cli',
        kind: 'command',
        title: '终端输出',
        content: event.chunk,
        timestamp: now,
      });
    } else if (event.type === 'session-prompt') {
      workflows.appendItem({
        id: `session:${event.sessionId}:prompt:${now}`,
        threadId: `session:${event.sessionId}`,
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: event.fullOutput || event.lastLines,
        status: 'waiting',
        timestamp: now,
      });
    } else if (event.type === 'session-exited') {
      workflows.appendItem({
        id: `session:${event.sessionId}:exit:${now}`,
        threadId: `session:${event.sessionId}`,
        source: 'cli',
        kind: 'status',
        title: '会话结束',
        content: `退出码：${event.exitCode}`,
        status: event.exitCode === 0 ? 'done' : 'error',
        timestamp: now,
      });
    }
  });

  sources.onEvent((event) => {
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
    res.json({ ok: true, pid: process.pid, version: '0.1.0' });
  });

  app.post('/notify', (req, res) => {
    const parsed = NotifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { title, message, source, level, sessionId, sourceId, windowTitle, workspace } = parsed.data;
    logger.info({ title, message, source, level }, 'notify');

    notifier.show(title, message, { sound: level === 'prompt' });
    broadcastNotification(observerSockets, {
      title,
      message,
      source,
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
    res.json(workflows.snapshot());
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
      const title = event.title ?? `${event.source ?? 'RemindAI'} ${event.type}`;
      const message = event.content || event.windowTitle || 'RemindAI event';
      notifier.show(title, message, { sound: level === 'prompt' || level === 'done' });
      if (event.type === 'notification') {
        broadcastNotification(observerSockets, {
          title,
          message,
          source: event.source,
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
    const lastLines = String(req.body?.lastLines ?? '');
    const options: string[] | undefined = Array.isArray(req.body?.options)
      ? req.body.options
      : undefined;
    const rec = sessions.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    sessions.markPrompt(req.params.id, lastLines, options);
    const title = `${rec.command} 等待输入`;
    const message = lastLines.split('\n').slice(-2).join('\n').trim() || '请回复';
    notifier.show(title, message, { sound: cfg.toast.soundOnPrompt });
    res.json({ ok: true });
  });

  app.post('/sessions/:id/reply', (req, res) => {
    const parsed = ReplyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const ok = sessions.injectReply(req.params.id, parsed.data.text);
    if (!ok) {
      res.status(404).json({ error: 'session not connected' });
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
    res.status(500).json({ error: String(err?.message ?? err) });
  });

  const start = (): Promise<Server> =>
    new Promise((resolve) => {
      const httpServer = app.listen(cfg.port, '127.0.0.1', () => {
        logger.info({ port: cfg.port }, 'http listening');
        if (cfg.monitors.codexDesktop) codexAdapter.start();
        if (cfg.monitors.aiTools) aiToolAdapter.start();
        resolve(httpServer);
      });

      const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
      wss.on('connection', (ws, req) => handleWs(ws, req, cfg, sessions, sources, workflows, observerSockets));
    });

  return { start, notifier, sessions };
}

function broadcastNotification(
  observerSockets: Set<WebSocket>,
  data: {
    title: string;
    message: string;
    source?: string;
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

function handleWs(
  ws: WebSocket,
  req: { url?: string; headers: Record<string, string | string[] | undefined> },
  cfg: Config,
  sessions: SessionManager,
  sources: SourceManager,
  workflows: WorkflowManager,
  observerSockets: Set<WebSocket>,
): void {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const token = url.searchParams.get('token');
  if (token !== cfg.token) {
    ws.close(4401, 'unauthorized');
    return;
  }
  const role = url.searchParams.get('role') ?? 'observer';
  const sessionId = url.searchParams.get('sessionId');

  if (role === 'cli' && sessionId) {
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

    ws.send(JSON.stringify({ type: 'hello', pid: process.pid, version: '0.1.0' }));
    ws.send(JSON.stringify({ type: 'workflow-snapshot', snapshot: workflows.snapshot() }));
  }

  ws.on('error', (err) => logger.warn({ err }, 'ws error'));
}
