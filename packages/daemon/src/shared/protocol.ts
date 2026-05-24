import { z } from 'zod';

export const NotifyRequestSchema = z.object({
  title: z.string().min(1),
  message: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  level: z.enum(['info', 'prompt', 'done', 'error']).optional().default('info'),
  threadId: z.string().optional(),
  sessionId: z.string().optional(),
  sourceId: z.string().optional(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
});
export type NotifyRequest = z.infer<typeof NotifyRequestSchema>;

export const HandoffTargetSchema = z.enum(['generic', 'codex', 'claude-code', 'opencode']);
export type HandoffTarget = z.infer<typeof HandoffTargetSchema>;

export const SourceKindSchema = z.enum([
  'cli',
  'vscode',
  'claude-code',
  'codex',
  'codex-desktop',
  'cursor',
  'antigravity',
  'ai-ide',
  'trae',
  'codebuddy',
  'lingma',
  'qoder',
  'marscode',
  'codegeex',
  'comate',
  'qwen-code',
  'cc-switch',
  'external',
]);

export const SourceCapabilityLevelSchema = z.enum(['L1', 'L1-L2', 'L2', 'L2-L3', 'L3', 'L4']);
export type SourceCapabilityLevel = z.infer<typeof SourceCapabilityLevelSchema>;

export const SourceIntegrationKindSchema = z.enum([
  'cli-pty',
  'local-file-sync',
  'extension',
  'process-scan',
  'config-switcher',
  'adapter',
  'manual',
]);
export type SourceIntegrationKind = z.infer<typeof SourceIntegrationKindSchema>;

export const SourcePrivacyBoundarySchema = z.enum([
  'explicit-session',
  'local-history',
  'explicit-extension',
  'minimal-process',
  'config-switcher',
  'explicit-adapter',
]);
export type SourcePrivacyBoundary = z.infer<typeof SourcePrivacyBoundarySchema>;

export const RegisterSourceRequestSchema = z.object({
  kind: SourceKindSchema,
  name: z.string().min(1).max(120),
  windowTitle: z.string().max(240).optional(),
  workspace: z.string().max(500).optional(),
  url: z.string().max(1000).optional(),
  pid: z.number().int().positive().optional(),
  capabilities: z.array(z.string().min(1).max(80)).optional().default([]),
  capabilityLevel: SourceCapabilityLevelSchema.optional(),
  integrationKind: SourceIntegrationKindSchema.optional(),
  privacyBoundary: SourcePrivacyBoundarySchema.optional(),
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

export const MonitorSourceSchema = z.object({
  id: z.string(),
  kind: SourceKindSchema,
  name: z.string(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
  url: z.string().optional(),
  pid: z.number().int().positive().optional(),
  capabilities: z.array(z.string()),
  capabilityLevel: SourceCapabilityLevelSchema,
  integrationKind: SourceIntegrationKindSchema,
  privacyBoundary: SourcePrivacyBoundarySchema,
  registeredAt: z.number().int(),
  lastSeenAt: z.number().int(),
  status: z.enum(['online', 'offline']),
});
export type MonitorSource = z.infer<typeof MonitorSourceSchema>;

export const WorkflowItemKindSchema = z.enum([
  'message',
  'tool_call',
  'command',
  'file_change',
  'artifact',
  'prompt',
  'status',
]);

export const WorkflowStatusSchema = z.enum([
  'running',
  'waiting',
  'done',
  'error',
  'paused',
]);

export const WorkflowTaskStateSchema = z.object({
  pinned: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  snoozedUntil: z.number().int().positive().nullable().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
  sortOrder: z.number().finite().optional(),
  handoffStatus: z.enum(['idle', 'pending', 'active', 'returned']).optional().default('idle'),
  handoffTarget: HandoffTargetSchema.nullable().optional(),
  handoffSessionId: z.string().nullable().optional(),
  updatedAt: z.number().int().positive().optional(),
});
export type WorkflowTaskState = z.infer<typeof WorkflowTaskStateSchema>;

export const WorkflowItemSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  source: z.string().default('codex-desktop'),
  kind: WorkflowItemKindSchema,
  role: z.string().optional(),
  title: z.string().optional(),
  content: z.string().default(''),
  options: z.array(z.string().max(500)).max(32).optional(),
  language: z.string().optional(),
  filePath: z.string().optional(),
  status: WorkflowStatusSchema.optional(),
  timestamp: z.number().int().positive(),
});
export type WorkflowItem = z.infer<typeof WorkflowItemSchema>;

export const WorkflowThreadSchema = z.object({
  id: z.string(),
  source: z.string().default('codex-desktop'),
  title: z.string(),
  workspace: z.string().optional(),
  status: WorkflowStatusSchema.default('running'),
  updatedAt: z.number().int().positive(),
  itemCount: z.number().int().nonnegative().default(0),
  taskState: WorkflowTaskStateSchema.optional(),
  // 来源是否在线。不影响 status 语义（任务管理逻辑保持不变），仅用于让 GUI 把"运行中"
  // 状态在来源离线时显示为「来源已离线」灰色，避免出现「Codex 已关但 GUI 仍显示运行中」
  // 这种与现实不符的状态。可选字段——旧 snapshot 没有时视作 undefined（GUI 默认按在线）。
  sourceOnline: z.boolean().optional(),
});
export type WorkflowThread = z.infer<typeof WorkflowThreadSchema>;

export type WorkflowSnapshot = {
  threads: WorkflowThread[];
  items: WorkflowItem[];
};

export const UpdateWorkflowTaskStateRequestSchema = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  snoozedUntil: z.number().int().positive().nullable().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  sortOrder: z.number().finite().optional(),
  handoffStatus: z.enum(['idle', 'pending', 'active', 'returned']).optional(),
  handoffTarget: HandoffTargetSchema.nullable().optional(),
  handoffSessionId: z.string().nullable().optional(),
});
export type UpdateWorkflowTaskStateRequest = z.infer<typeof UpdateWorkflowTaskStateRequestSchema>;

export const LaunchHandoffRequestSchema = z.object({
  target: HandoffTargetSchema,
  prompt: z.string().min(1).max(200000),
  preview: z.string().optional().default(''),
});
export type LaunchHandoffRequest = z.infer<typeof LaunchHandoffRequestSchema>;

export const LaunchHandoffResponseSchema = z.object({
  ok: z.literal(true),
  threadId: z.string(),
  sessionId: z.string(),
  target: HandoffTargetSchema,
  launchMode: z.enum(['tool', 'fallback']),
  command: z.string(),
  args: z.array(z.string()),
});
export type LaunchHandoffResponse = z.infer<typeof LaunchHandoffResponseSchema>;

export const RegisterSessionRequestSchema = z.object({
  id: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  cliPid: z.number().int().positive(),
  source: z.string().optional(),
  sourceId: z.string().optional(),
  windowTitle: z.string().optional(),
  workspace: z.string().optional(),
  parentThreadId: z.string().optional(),
});
export type RegisterSessionRequest = z.infer<typeof RegisterSessionRequestSchema>;

export const SessionOutputRequestSchema = z.object({
  chunk: z.string(),
});

export const SessionPromptRequestSchema = z.object({
  lastLines: z.string().max(16384).default(''),
  options: z.array(z.string().max(500)).max(32).optional(),
});
export type SessionPromptRequest = z.infer<typeof SessionPromptRequestSchema>;

export const ReplyRequestSchema = z.object({
  text: z.string().max(8192),
  mode: z.enum(['option', 'freeform']).optional().default('option'),
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
  parentThreadId: z.string().optional(),
  startedAt: z.number().int(),
  status: z.enum(['running', 'waiting', 'exited']),
  exitCode: z.number().int().nullable().optional(),
  lastPrompt: z.string().optional(),
  lastPromptOptions: z.array(z.string().max(500)).max(32).optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export type WsServerEvent =
  | { type: 'session-registered'; session: SessionInfo }
  | { type: 'session-output'; sessionId: string; chunk: string }
  | { type: 'session-prompt'; sessionId: string; lastLines: string; options?: string[]; fullOutput?: string }
  | { type: 'session-exited'; sessionId: string; exitCode: number; durationMs: number }
  | { type: 'reply-injected'; sessionId: string; text: string }
  | { type: 'inject-input'; sessionId: string; optionIndex: number }
  | { type: 'inject-text'; sessionId: string; text: string }
  | { type: 'monitor-event-reply'; eventId: string; sourceId?: string; text: string; timestamp: number }
  | { type: 'notification'; data: MonitorEvent & { title: string; message: string; timestamp: number; threadId?: string } }
  | { type: 'source-registered'; source: MonitorSource }
  | { type: 'source-disconnected'; sourceId: string }
  | { type: 'monitor-event'; event: MonitorEvent & { id: string; timestamp: number } }
  | { type: 'workflow-snapshot'; snapshot: WorkflowSnapshot }
  | { type: 'workflow-event'; event: { action: 'thread-upsert' | 'item-append' | 'status'; thread?: WorkflowThread; item?: WorkflowItem } }
  | { type: 'sessions-snapshot'; sessions: SessionInfo[] }
  | { type: 'sources-snapshot'; sources: MonitorSource[] }
  | { type: 'hello'; pid: number; version: string };
