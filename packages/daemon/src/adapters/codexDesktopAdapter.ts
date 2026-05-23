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
  lastSeenAt: number;
};

export type CodexDesktopAdapterOptions = {
  /** Override the Codex sessions root directory. Defaults to `~/.codex/sessions`. Tests use this. */
  root?: string;
  /** Override the upper bound on tracked files. Default 512 entries. Tests use this. */
  maxTrackedFiles?: number;
  /** Override the idle TTL after which an untouched file is evicted. Default 48h. Tests use this. */
  trackedFileTtlMs?: number;
};

const RECENT_SESSION_LIMIT = 40;
const ACTIVE_SESSION_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
// N-13：原 trackedFiles Map 只增不减，8h 长跑会持续吃内存。引入 LRU + TTL：
//   - 上限 512 条：覆盖 RECENT_SESSION_LIMIT(40) 的 10 倍，足以容纳过去几天的会话。
//   - 48h idle TTL：与 ACTIVE_SESSION_WINDOW_MS(3 天) 同量级，让定期扫描不会反复重生已淘汰的项。
//   - 文件消失（被 Codex 自身 GC）时主动删 Map，配合 evict 双保险。
const DEFAULT_MAX_TRACKED_FILES = 512;
const DEFAULT_TRACKED_FILE_TTL_MS = 48 * 60 * 60 * 1000;

export class CodexDesktopAdapter {
  private readonly root: string;
  private readonly files = new Map<string, TrackedFile>();
  private readonly maxTrackedFiles: number;
  private readonly trackedFileTtlMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private workflows: WorkflowManager, options: CodexDesktopAdapterOptions = {}) {
    this.root = options.root ?? join(homedir(), '.codex', 'sessions');
    this.maxTrackedFiles = Math.max(1, options.maxTrackedFiles ?? DEFAULT_MAX_TRACKED_FILES);
    this.trackedFileTtlMs = Math.max(1000, options.trackedFileTtlMs ?? DEFAULT_TRACKED_FILE_TTL_MS);
  }

  /** Test-only: read the current tracked-file count without exposing the internal Map. */
  trackedFileCountForTests(): number {
    return this.files.size;
  }

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

  /** Run a single scan pass. Public so tests can drive the adapter without setInterval. */
  async scanOnce(): Promise<void> {
    return this.scan();
  }

  private async scan() {
    this.evictStaleTrackedFiles();
    const candidates = this.findRecentSessionFiles(RECENT_SESSION_LIMIT);
    for (const path of candidates) {
      try {
        await this.consume(path);
      } catch (err) {
        // 单个会话文件失败不应让整个 scan pass 退出；带上 file/offset 上下文便于复现。
        const tracked = this.files.get(path);
        logger.warn(
          { err, file: basename(path), offset: tracked?.offset ?? 0 },
          'codex session file consume failed',
        );
      }
    }
    // consume 阶段可能新增 tracked 条目；末尾再 evict 一次，确保 LRU cap 立即生效，
    // 避免单次 scan 就把 Map 撑过 maxTrackedFiles。
    this.evictStaleTrackedFiles();
  }

  // N-13：扫描前先 evict —— 同时处理 TTL 过期 + 文件已被 Codex 删除两种情况，
  // 避免 Map 长跑膨胀。LRU 上限走 lastSeenAt 排序。
  private evictStaleTrackedFiles(): void {
    const now = Date.now();
    for (const [path, tracked] of this.files) {
      if (now - tracked.lastSeenAt > this.trackedFileTtlMs) {
        this.files.delete(path);
        continue;
      }
      if (!existsSync(path)) {
        this.files.delete(path);
      }
    }
    if (this.files.size <= this.maxTrackedFiles) return;
    const sorted = Array.from(this.files.entries()).sort(
      (a, b) => a[1].lastSeenAt - b[1].lastSeenAt,
    );
    const overflow = this.files.size - this.maxTrackedFiles;
    for (let i = 0; i < overflow; i++) this.files.delete(sorted[i][0]);
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
    const now = Date.now();
    const tracked = this.files.get(path) ?? {
      path,
      offset: 0,
      threadId: this.threadIdFromPath(path),
      lastSeenAt: now,
    };
    if (size < tracked.offset) tracked.offset = 0;
    if (size === tracked.offset) {
      // 文件没新内容也要刷新 lastSeenAt，否则活跃但安静的会话会被 TTL 误杀。
      tracked.lastSeenAt = now;
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
    tracked.lastSeenAt = Date.now();
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
        status: isFreshTimestamp(timestamp) ? 'running' : 'done',
        updatedAt: timestamp,
        itemCount: 0,
      });
      return;
    }

    const thread = this.ensureThread(threadId, path, timestamp);
    const item = this.toWorkflowItem(raw, payload, thread, timestamp);
    if (!item) return;
    if (item.kind === 'message' && item.role === 'user' && item.content) {
      this.maybeUpgradeTitle(thread, item.content);
    }
    this.workflows.appendItem(item);
  }

  private ensureThread(threadId: string, path: string, timestamp: number): WorkflowThread {
    const existing = this.workflows.getThread(threadId);
    if (existing) {
      // Already known. Don't clobber terminal status (done/error) set by task_complete
      // and don't reset a meaningful title back to the degraded path-derived form.
      return existing;
    }
    const thread: WorkflowThread = {
      id: threadId,
      source: 'codex-desktop',
      title: titleFromPath(path),
      status: isFreshTimestamp(timestamp) ? 'running' : 'done',
      updatedAt: timestamp,
      itemCount: 0,
    };
    return this.workflows.upsertThread(thread);
  }

  private maybeUpgradeTitle(thread: WorkflowThread, candidate: string): void {
    if (!candidate) return;
    if (!isDegradedTitle(thread.title)) return;
    const upgraded = summarizeUserMessage(candidate);
    if (!upgraded || upgraded === thread.title) return;
    this.workflows.upsertThread({ ...thread, title: upgraded });
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
      // P2.1：Codex Desktop 只读同步严禁把 token 计费 / 内部推理之类内部噪音
      // 暴露到任务视图，否则用户会被一堆 status item 刷屏。
      if (isCodexInternalEvent(eventType)) return null;
      if (eventType === 'user_message') {
        const content = textFrom(payload.message) || textFrom(payload.text_elements) || '';
        if (shouldHideCodexContent(content)) return null;
        return {
          ...base,
          kind: 'message',
          role: 'user',
          title: 'User',
          content,
        };
      }
      if (eventType === 'agent_message') {
        const content = textFrom(payload.message);
        if (shouldHideCodexContent(content)) return null;
        return {
          ...base,
          kind: 'message',
          role: 'assistant',
          title: 'Codex',
          content,
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
      // P2.1：reasoning / token_count 这类只与计费/链路追踪有关的内部 item
      // 不应该当成 status 渲染给用户。
      if (isCodexInternalResponseItem(itemType)) return null;
      if (itemType === 'message') {
        const role = stringOrUndefined(payload.role) ?? 'assistant';
        if (role === 'system' || role === 'developer') return null;
        const content = textFrom(payload.content);
        if (shouldHideCodexContent(content)) return null;
        return {
          ...base,
          kind: 'message',
          role,
          title: role,
          content,
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

export function titleFromPath(path: string): string {
  const name = basename(path, '.jsonl');
  const dateMatch = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) return `Codex ${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  return name;
}

const DEGRADED_TITLE_RE = /^Codex \d{4}-\d{2}-\d{2}$/;

export function isDegradedTitle(title: string | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (DEGRADED_TITLE_RE.test(trimmed)) return true;
  // Legacy form before this commit: "Codex 12-00-00-019abcd-..." or full rollout-... name.
  if (/^Codex \d{2}-\d{2}-\d{2}/.test(trimmed)) return true;
  if (/^rollout-\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
  return false;
}

export function summarizeUserMessage(text: string, maxLen = 60): string {
  // Strip code fences / common control sequences, then collapse whitespace.
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

function stableId(threadId: string, raw: JsonObject, timestamp: number): string {
  const hash = createHash('sha1').update(JSON.stringify(raw)).digest('hex').slice(0, 16);
  return `${threadId}:${timestamp}:${hash}`;
}

export function toTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isFreshTimestamp(timestamp: number): boolean {
  return Date.now() - timestamp <= ACTIVE_SESSION_WINDOW_MS;
}

// P2.1：codex-rs 的 event_msg 中这些类型只面向计费与链路追踪，不展示给用户。
// 关键字保持小写匹配，避免 codex 升级时漏掉同义事件。
export function isCodexInternalEvent(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return normalized === 'token_count'
    || normalized === 'usage'
    || normalized === 'token_usage'
    || normalized === 'tokens'
    || normalized.startsWith('reasoning')
    || normalized === 'cost_update';
}

// P2.1：response_item.reasoning 是模型内部思考，token_count 是 usage 统计，
// 既不可读也无操作价值，直接吞掉。
export function isCodexInternalResponseItem(itemType: string): boolean {
  const normalized = itemType.toLowerCase();
  return normalized.startsWith('reasoning')
    || normalized === 'token_count'
    || normalized === 'usage';
}

export function statusFromEvent(eventType: string): WorkflowItem['status'] | undefined {
  if (/error|failed|fail/i.test(eventType)) return 'error';
  if (/complete|done|end/i.test(eventType)) return 'done';
  if (/wait|prompt/i.test(eventType)) return 'waiting';
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function textFrom(value: unknown): string {
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

export function shouldHideCodexContent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return /^<environment_context>/i.test(text)
    || /^<turn_aborted>/i.test(text)
    || /^<permissions instructions>/i.test(text)
    || /^# Context from my IDE setup:/i.test(text)
    || isCodexApprovalDecision(text);
}

function isCodexApprovalDecision(text: string): boolean {
  if (!text.startsWith('{') || !text.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(text) as JsonObject;
    const keys = Object.keys(parsed);
    if (!keys.includes('risk_level') || !keys.includes('user_authorization')) return false;
    const allowedKeys = new Set(['risk_level', 'user_authorization', 'outcome', 'rationale']);
    return keys.every((key) => allowedKeys.has(key));
  } catch {
    return false;
  }
}

function summarizePayload(payload: JsonObject): string {
  const copy: JsonObject = {};
  for (const key of ['type', 'status', 'name', 'call_id', 'turn_id', 'thread_id', 'duration_ms']) {
    if (payload[key] !== undefined) copy[key] = payload[key];
  }
  return Object.keys(copy).length ? JSON.stringify(copy, null, 2) : textFrom(payload);
}
