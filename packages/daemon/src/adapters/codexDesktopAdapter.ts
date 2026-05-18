import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { WorkflowItem, WorkflowThread } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { WorkflowManager } from '../daemon/workflowManager.js';

type JsonObject = Record<string, any>;

type TrackedFile = {
  path: string;
  offset: number;
  threadId: string;
};

export class CodexDesktopAdapter {
  private readonly root = join(homedir(), '.codex', 'sessions');
  private readonly files = new Map<string, TrackedFile>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private workflows: WorkflowManager) {}

  start() {
    if (!existsSync(this.root)) {
      logger.warn({ root: this.root }, 'codex sessions directory not found');
      return;
    }
    this.scan().catch((err) => logger.warn({ err }, 'codex workflow initial scan failed'));
    this.timer = setInterval(() => {
      this.scan().catch((err) => logger.warn({ err }, 'codex workflow scan failed'));
    }, 2000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scan() {
    const candidates = this.findRecentSessionFiles(80);
    for (const path of candidates) {
      await this.consume(path);
    }
  }

  private findRecentSessionFiles(limit: number): string[] {
    const out: Array<{ path: string; mtime: number }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          out.push({ path, mtime: statSync(path).mtimeMs });
        }
      }
    };
    walk(this.root);
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((item) => item.path);
  }

  private async consume(path: string) {
    const size = statSync(path).size;
    const tracked = this.files.get(path) ?? {
      path,
      offset: 0,
      threadId: this.threadIdFromPath(path),
    };
    if (size < tracked.offset) tracked.offset = 0;
    if (size === tracked.offset) {
      this.files.set(path, tracked);
      return;
    }

    const stream = createReadStream(path, {
      encoding: 'utf8',
      start: tracked.offset,
    });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let consumed = 0;

    for await (const line of reader) {
      consumed += Buffer.byteLength(line, 'utf8') + 1;
      if (!line.trim()) continue;
      this.handleLine(path, tracked.threadId, line);
    }

    tracked.offset = Math.min(size, tracked.offset + consumed);
    this.files.set(path, tracked);
  }

  private handleLine(path: string, threadId: string, line: string) {
    let raw: JsonObject;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }

    const timestamp = toTimestamp(raw.timestamp) ?? Date.now();
    const payload = (raw.payload ?? {}) as JsonObject;

    if (raw.type === 'session_meta') {
      this.workflows.upsertThread({
        id: threadId,
        source: 'codex-desktop',
        title: titleFromMeta(payload, path),
        workspace: stringOrUndefined(payload.cwd),
        status: 'running',
        updatedAt: timestamp,
        itemCount: 0,
      });
      return;
    }

    const thread = this.ensureThread(threadId, path, timestamp);
    const item = this.toWorkflowItem(raw, payload, thread, timestamp);
    if (item) this.workflows.appendItem(item);
  }

  private ensureThread(threadId: string, path: string, timestamp: number): WorkflowThread {
    const thread: WorkflowThread = {
      id: threadId,
      source: 'codex-desktop',
      title: titleFromPath(path),
      status: 'running',
      updatedAt: timestamp,
      itemCount: 0,
    };
    return this.workflows.upsertThread(thread);
  }

  private toWorkflowItem(raw: JsonObject, payload: JsonObject, thread: WorkflowThread, timestamp: number): WorkflowItem | null {
    const base = {
      id: stableId(thread.id, raw, timestamp),
      threadId: thread.id,
      source: 'codex-desktop',
      timestamp,
    };

    if (raw.type === 'event_msg') {
      const eventType = String(payload.type ?? 'event');
      if (eventType === 'user_message') {
        return {
          ...base,
          kind: 'message',
          role: 'user',
          title: 'User',
          content: textFrom(payload.message) || textFrom(payload.text_elements) || '',
        };
      }
      if (eventType === 'agent_message') {
        return {
          ...base,
          kind: 'message',
          role: 'assistant',
          title: 'Codex',
          content: textFrom(payload.message),
        };
      }
      if (eventType === 'task_started') {
        return { ...base, kind: 'status', title: '任务开始', status: 'running', content: 'Codex 开始处理任务。' };
      }
      if (eventType === 'task_complete') {
        return { ...base, kind: 'status', title: '任务完成', status: 'done', content: 'Codex 任务已完成。' };
      }
      if (eventType.includes('patch') || eventType.includes('apply')) {
        return { ...base, kind: 'file_change', title: eventType, content: textFrom(payload) };
      }
      return { ...base, kind: 'status', title: eventType, content: summarizePayload(payload), status: statusFromEvent(eventType) };
    }

    if (raw.type === 'response_item') {
      const itemType = String(payload.type ?? 'response');
      if (itemType === 'message') {
        const role = stringOrUndefined(payload.role) ?? 'assistant';
        if (role === 'system' || role === 'developer') return null;
        return {
          ...base,
          kind: 'message',
          role,
          title: role,
          content: textFrom(payload.content),
        };
      }
      if (itemType.includes('tool_call') || itemType === 'function_call') {
        return {
          ...base,
          kind: 'tool_call',
          title: stringOrUndefined(payload.name) ?? itemType,
          content: textFrom(payload.input ?? payload.arguments ?? payload),
          status: payload.status === 'failed' ? 'error' : 'running',
        };
      }
      if (itemType.includes('tool_call_output') || itemType === 'function_call_output') {
        return {
          ...base,
          kind: 'command',
          title: itemType,
          content: textFrom(payload.output),
          status: 'done',
        };
      }
      return { ...base, kind: 'status', title: itemType, content: summarizePayload(payload) };
    }

    if (raw.type === 'turn_context') return null;
    if (raw.type === 'compacted') return { ...base, kind: 'status', title: '上下文压缩', content: 'Codex 会话上下文已压缩。' };
    return null;
  }

  private threadIdFromPath(path: string): string {
    const name = basename(path, '.jsonl');
    const match = name.match(/(019[a-z0-9-]+)/i);
    return match?.[1] ?? createHash('sha1').update(path).digest('hex').slice(0, 16);
  }
}

function titleFromMeta(payload: JsonObject, path: string): string {
  const cwd = stringOrUndefined(payload.cwd);
  if (cwd) return basename(cwd);
  return titleFromPath(path);
}

function titleFromPath(path: string): string {
  return basename(path, '.jsonl').replace(/^rollout-\d{4}-\d{2}-\d{2}T/, 'Codex ');
}

function stableId(threadId: string, raw: JsonObject, timestamp: number): string {
  const hash = createHash('sha1').update(JSON.stringify(raw)).digest('hex').slice(0, 16);
  return `${threadId}:${timestamp}:${hash}`;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function statusFromEvent(eventType: string): WorkflowItem['status'] | undefined {
  if (/error|failed|fail/i.test(eventType)) return 'error';
  if (/complete|done|end/i.test(eventType)) return 'done';
  if (/wait|prompt/i.test(eventType)) return 'waiting';
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function textFrom(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join('\n\n');
  if (typeof value === 'object') {
    const obj = value as JsonObject;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) return textFrom(obj.content);
    if (typeof obj.message === 'string') return obj.message;
  }
  return JSON.stringify(value, null, 2);
}

function summarizePayload(payload: JsonObject): string {
  const copy: JsonObject = {};
  for (const key of ['type', 'status', 'name', 'call_id', 'turn_id', 'thread_id', 'duration_ms']) {
    if (payload[key] !== undefined) copy[key] = payload[key];
  }
  return Object.keys(copy).length ? JSON.stringify(copy, null, 2) : textFrom(payload);
}
