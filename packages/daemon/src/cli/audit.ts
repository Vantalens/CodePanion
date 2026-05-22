import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getAuditSnapshot, type AuditSnapshot } from '../shared/client.js';

export type AuditExportOptions = {
  output?: string;
  format?: 'json' | 'jsonl';
  since?: string;
  redact?: boolean;
};

export async function auditExportCommand(opts: AuditExportOptions): Promise<void> {
  const sinceMs = parseSince(opts.since);
  const snapshot = await getAuditSnapshot({ since: sinceMs });
  const processed = opts.redact ? redactSnapshot(snapshot) : snapshot;

  const format = opts.format ?? 'json';
  const payload = format === 'jsonl' ? toJsonLines(processed) : `${JSON.stringify(processed, null, 2)}\n`;

  if (!opts.output || opts.output === '-') {
    process.stdout.write(payload);
    console.error(formatSummary(processed, opts));
    return;
  }

  const absolute = resolve(opts.output);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, payload, { encoding: 'utf8', mode: 0o600 });
  console.log(`[audit] 已写入 ${absolute}（${payload.length} 字节）`);
  console.error(formatSummary(processed, opts));
}

function formatSummary(snapshot: AuditSnapshot, opts: AuditExportOptions): string {
  const flags: string[] = [];
  if (opts.redact) flags.push('redacted');
  if (snapshot.since !== null) flags.push(`since=${new Date(snapshot.since).toISOString()}`);
  const flagText = flags.length ? `（${flags.join(', ')}）` : '';
  return [
    `[audit] sources=${snapshot.sources.length} events=${snapshot.events.length}`,
    `replies=${snapshot.eventReplies.length} sessions=${snapshot.sessions.length}`,
    `threads=${snapshot.workflowThreads.length} items=${snapshot.workflowItems.length}${flagText}`,
  ].join(' ');
}

function parseSince(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`--since 数值必须为非负 epoch 毫秒：${trimmed}`);
    }
    return num;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`--since 无法解析为时间：${trimmed}，请使用 ISO 8601 字符串或 epoch ms`);
  }
  return parsed;
}

export function redactSnapshot(snapshot: AuditSnapshot): AuditSnapshot {
  return {
    ...snapshot,
    events: snapshot.events.map((event) => ({
      ...event,
      title: event.title ? redactText(event.title) : event.title,
      content: event.content ? redactText(event.content) : event.content,
      options: Array.isArray(event.options) ? event.options.map(redactText) : event.options,
      windowTitle: event.windowTitle ? redactText(event.windowTitle) : event.windowTitle,
      workspace: event.workspace ? redactPath(event.workspace) : event.workspace,
    })),
    eventReplies: snapshot.eventReplies.map((reply) => ({
      ...reply,
      text: redactText(reply.text),
    })),
    sources: snapshot.sources.map((source) => ({
      ...source,
      windowTitle: source.windowTitle ? redactText(source.windowTitle) : source.windowTitle,
      workspace: source.workspace ? redactPath(source.workspace) : source.workspace,
    })),
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      command: session.command ? redactPath(session.command) : session.command,
      args: Array.isArray(session.args) ? session.args.map(redactText) : session.args,
      cwd: session.cwd ? redactPath(session.cwd) : session.cwd,
      windowTitle: session.windowTitle ? redactText(session.windowTitle) : session.windowTitle,
      workspace: session.workspace ? redactPath(session.workspace) : session.workspace,
      lastPrompt: session.lastPrompt ? redactText(session.lastPrompt) : session.lastPrompt,
      lastPromptOptions: Array.isArray(session.lastPromptOptions)
        ? session.lastPromptOptions.map(redactText)
        : session.lastPromptOptions,
    })),
    workflowThreads: snapshot.workflowThreads.map((thread) => redactWorkflowThread(thread)),
    workflowItems: snapshot.workflowItems.map((item) => redactWorkflowItem(item)),
  };
}

function redactWorkflowThread(thread: unknown): unknown {
  if (!thread || typeof thread !== 'object') return thread;
  const copy: Record<string, unknown> = { ...(thread as Record<string, unknown>) };
  if (typeof copy.title === 'string') copy.title = redactText(copy.title);
  if (typeof copy.workspace === 'string') copy.workspace = redactPath(copy.workspace);
  return copy;
}

function redactWorkflowItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const field of ['content', 'preview', 'rawText', 'title']) {
    if (typeof copy[field] === 'string') copy[field] = redactText(copy[field] as string);
  }
  if (typeof copy.filePath === 'string') copy.filePath = redactPath(copy.filePath as string);
  if (Array.isArray(copy.options)) {
    copy.options = (copy.options as unknown[]).map((entry) => (typeof entry === 'string' ? redactText(entry) : entry));
  }
  return copy;
}

function redactText(value: string): string {
  if (!value) return value;
  const len = value.length;
  if (len <= 6) return '*'.repeat(len);
  return `${value.slice(0, 2)}***${value.slice(-2)}（${len} chars）`;
}

function redactPath(value: string): string {
  if (!value) return value;
  return value
    .replace(/[A-Za-z]:\\Users\\[^\\]+/g, 'C:\\Users\\***')
    .replace(/\/Users\/[^/]+/g, '/Users/***')
    .replace(/\/home\/[^/]+/g, '/home/***');
}

function toJsonLines(snapshot: AuditSnapshot): string {
  const lines: string[] = [];
  lines.push(JSON.stringify({ kind: 'meta', schemaVersion: snapshot.schemaVersion, generatedAt: snapshot.generatedAt, since: snapshot.since, daemonVersion: snapshot.daemonVersion }));
  for (const source of snapshot.sources) lines.push(JSON.stringify({ kind: 'source', source }));
  for (const session of snapshot.sessions) lines.push(JSON.stringify({ kind: 'session', session }));
  for (const event of snapshot.events) lines.push(JSON.stringify({ kind: 'event', event }));
  for (const reply of snapshot.eventReplies) lines.push(JSON.stringify({ kind: 'event-reply', reply }));
  for (const thread of snapshot.workflowThreads) lines.push(JSON.stringify({ kind: 'workflow-thread', thread }));
  for (const item of snapshot.workflowItems) lines.push(JSON.stringify({ kind: 'workflow-item', item }));
  return `${lines.join('\n')}\n`;
}
