import { z } from 'zod';

// ============================================================================
// Notification（系统通知，GUI 和 daemon 之间的通知推送）
// ============================================================================

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

// ============================================================================
// Workspace（工作区初始化和配置）
// ============================================================================

export const InitializeWorkspaceRequestSchema = z.object({
  root: z.string().min(1).max(4096),
});
export type InitializeWorkspaceRequest = z.infer<typeof InitializeWorkspaceRequestSchema>;

// ============================================================================
// Workflow（工作流执行和人工审核门）
// ============================================================================

export const ResolveWorkflowGateRequestSchema = z.object({
  decision: z.enum(['approve', 'reject', 'retry']),
  message: z.string().max(8000).optional(),
  constraints: z.array(z.string().min(1).max(500)).max(20).optional(),
  workspace: z.string().min(1).max(4096).optional(),
});
export type ResolveWorkflowGateRequest = z.infer<typeof ResolveWorkflowGateRequestSchema>;

export const StartWorkflowRunRequestSchema = z.object({
  workflow: z.string().min(1).max(120),
  values: z.record(z.string().min(1).max(80), z.string().max(4000)).optional(),
  yes: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  workspace: z.string().min(1).max(4096).optional(),
});
export type StartWorkflowRunRequest = z.infer<typeof StartWorkflowRunRequestSchema>;

// ============================================================================
// WebSocket Events（GUI 和 daemon 之间的实时事件推送）
// ============================================================================

export type WsServerEvent =
  | { type: 'hello'; pid: number; version: string }
  | { type: 'notification'; data: {
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
    }}
  | { type: 'workflow-run-event'; event:
      | { action: 'run-start'; runId: string; workflowName: string; startedAt: number }
      | { action: 'step-start'; runId: string; workflowName: string; stepId: string; tool: string; role?: string; status: string }
      | { action: 'step-output'; runId: string; workflowName: string; stepId: string; stream: 'stdout' | 'stderr'; chunk: string; truncated?: boolean }
      | { action: 'step-finish'; runId: string; workflowName: string; stepId: string; status: string; exitCode?: number; message?: string }
      | { action: 'run-finish'; runId: string; workflowName: string; status: string; stepCount: number; endedAt: number }
    };
