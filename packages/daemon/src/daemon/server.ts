import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Config } from '../config.js';
import { Notifier } from './notifier.js';
import { SessionManager } from './sessionManager.js';
import {
  NotifyRequestSchema,
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
    const { title, message, source, level } = parsed.data;
    logger.info({ title, message, source, level }, 'notify');
    notifier.show(title, message, { sound: level === 'prompt' });
    res.json({ ok: true });
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
        resolve(httpServer);
      });

      const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
      wss.on('connection', (ws, req) => handleWs(ws, req, cfg, sessions));
    });

  return { start, notifier, sessions };
}

function handleWs(
  ws: WebSocket,
  req: { url?: string; headers: Record<string, string | string[] | undefined> },
  cfg: Config,
  sessions: SessionManager,
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
    const unsubscribe = sessions.onEvent((event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });
    ws.on('close', () => unsubscribe());
    ws.send(JSON.stringify({ type: 'hello', pid: process.pid, version: '0.1.0' }));
  }

  ws.on('error', (err) => logger.warn({ err }, 'ws error'));
}
