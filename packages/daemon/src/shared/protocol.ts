import { z } from 'zod';

export const NotifyRequestSchema = z.object({
  title: z.string().min(1),
  message: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  level: z.enum(['info', 'prompt', 'done', 'error']).optional().default('info'),
  sessionId: z.string().optional(),
  sourceId: z.string().optional(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
});
export type NotifyRequest = z.infer<typeof NotifyRequestSchema>;

export const SourceKindSchema = z.enum([
  'cli',
  'vscode',
  'claude-code',
  'codex',
  'browser-extension',
  'external',
]);

export const RegisterSourceRequestSchema = z.object({
  kind: SourceKindSchema,
  name: z.string().min(1).max(120),
  windowTitle: z.string().max(240).optional(),
  workspace: z.string().max(500).optional(),
  url: z.string().max(1000).optional(),
  pid: z.number().int().positive().optional(),
  capabilities: z.array(z.string().min(1).max(80)).optional().default([]),
});

export type RegisterSourceRequest = z.infer<typeof RegisterSourceRequestSchema>;

export const MonitorEventSchema = z.object({
  type: z.enum(['prompt', 'done', 'error', 'activity', 'notification']),
  sourceId: z.string().optional(),
  source: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string().max(240).optional(),
  content: z.string().default(''),
  options: z.array(z.string()).optional(),
  level: z.enum(['info', 'prompt', 'done', 'error']).optional(),
  windowTitle: z.string().max(240).optional(),
  workspace: z.string().max(500).optional(),
  url: z.string().max(1000).optional(),
  timestamp: z.number().int().positive().optional(),
});

export type MonitorEvent = z.infer<typeof MonitorEventSchema>;

export interface MonitorSource {
  id: string;
  kind: z.infer<typeof SourceKindSchema>;
  name: string;
  windowTitle?: string;
  workspace?: string;
  url?: string;
  pid?: number;
  capabilities: string[];
  registeredAt: number;
  lastSeenAt: number;
  status: 'online' | 'offline';
}

export const RegisterSessionRequestSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  cliPid: z.number().int().positive(),
  source: z.string().optional(),
  sourceId: z.string().optional(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
});
export type RegisterSessionRequest = z.infer<typeof RegisterSessionRequestSchema>;

export const SessionOutputRequestSchema = z.object({
  chunk: z.string(),
});

export const ReplyRequestSchema = z.object({
  text: z.string(),
});
export type ReplyRequest = z.infer<typeof ReplyRequestSchema>;

export const SessionExitRequestSchema = z.object({
  exitCode: z.number().int(),
  signal: z.number().int().optional(),
});

export const SessionInfoSchema = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  source: z.string().optional(),
  sourceId: z.string().optional(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
  startedAt: z.number(),
  status: z.enum(['running', 'waiting', 'exited']),
  exitCode: z.number().int().nullable().optional(),
  lastPrompt: z.string().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export type WsServerEvent =
  | { type: 'session-registered'; session: SessionInfo }
  | { type: 'session-output'; sessionId: string; chunk: string }
  | { type: 'session-prompt'; sessionId: string; lastLines: string; options?: string[]; fullOutput?: string }
  | { type: 'session-exited'; sessionId: string; exitCode: number; durationMs: number }
  | { type: 'reply-injected'; sessionId: string; text: string }
  | { type: 'inject-input'; sessionId: string; text: string }
  | { type: 'monitor-event-reply'; eventId: string; sourceId?: string; text: string; timestamp: number }
  | { type: 'notification'; data: MonitorEvent & { title: string; message: string; timestamp: number } }
  | { type: 'source-registered'; source: MonitorSource }
  | { type: 'source-disconnected'; sourceId: string }
  | { type: 'monitor-event'; event: MonitorEvent & { id: string; timestamp: number } }
  | { type: 'hello'; pid: number; version: string };
