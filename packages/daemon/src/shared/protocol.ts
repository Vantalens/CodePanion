import { z } from 'zod';

export const NotifyRequestSchema = z.object({
  title: z.string().min(1),
  message: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  level: z.enum(['info', 'prompt', 'done', 'error']).optional().default('info'),
  sessionId: z.string().optional(),
});
export type NotifyRequest = z.infer<typeof NotifyRequestSchema>;

export const RegisterSessionRequestSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  cliPid: z.number().int().positive(),
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
  startedAt: z.number(),
  status: z.enum(['running', 'waiting', 'exited']),
  exitCode: z.number().int().nullable().optional(),
  lastPrompt: z.string().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export type WsServerEvent =
  | { type: 'session-registered'; session: SessionInfo }
  | { type: 'session-output'; sessionId: string; chunk: string }
  | { type: 'session-prompt'; sessionId: string; lastLines: string; options?: string[] }
  | { type: 'session-exited'; sessionId: string; exitCode: number; durationMs: number }
  | { type: 'reply-injected'; sessionId: string; text: string }
  | { type: 'inject-input'; sessionId: string; text: string }
  | { type: 'hello'; pid: number; version: string };
