import type { WorkflowItem, WorkflowSnapshot, WorkflowThread, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RETENTION_DEFAULTS } from '../config.js';

type WorkflowListener = (event: WsServerEvent) => void;
export type WorkflowRetentionOptions = {
  threads?: number;
  itemsPerThread?: number;
  seenItems?: number;
};
type WorkflowManagerOptions = {
  snapshotPath?: string;
  /** Debounce window for async snapshot persistence. Set to 0 to write synchronously (tests only). */
  snapshotDebounceMs?: number;
  retention?: WorkflowRetentionOptions;
};

const DEFAULT_SNAPSHOT_DEBOUNCE_MS = 200;
const MAX_WORKFLOW_ITEM_CONTENT_CHARS = 12000;

export class WorkflowManager {
  private threads = new Map<string, WorkflowThread>();
  private items = new Map<string, WorkflowItem[]>();
  private seenItems = new Set<string>();
  private listeners = new Set<WorkflowListener>();
  private snapshotPath?: string;
  private snapshotDebounceMs: number;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private snapshotWriting = false;
  private snapshotPendingWhileWriting = false;
  private snapshotDirEnsured = false;
  private readonly maxThreads: number;
  private readonly maxItemsPerThread: number;
  private readonly maxSeenItems: number;

  constructor(options: WorkflowManagerOptions = {}) {
    this.snapshotPath = options.snapshotPath;
    this.snapshotDebounceMs = options.snapshotDebounceMs ?? DEFAULT_SNAPSHOT_DEBOUNCE_MS;
    this.maxThreads = options.retention?.threads ?? RETENTION_DEFAULTS.workflow.threads;
    this.maxItemsPerThread = options.retention?.itemsPerThread ?? RETENTION_DEFAULTS.workflow.itemsPerThread;
    this.maxSeenItems = options.retention?.seenItems ?? RETENTION_DEFAULTS.workflow.seenItems;
    this.loadSnapshot();
  }

  upsertThread(input: WorkflowThread): WorkflowThread {
    const current = this.threads.get(input.id);
    const thread: WorkflowThread = {
      ...current,
      ...input,
      itemCount: this.items.get(input.id)?.length ?? current?.itemCount ?? input.itemCount ?? 0,
    };
    this.threads.set(thread.id, thread);
    this.broadcast({ type: 'workflow-event', event: { action: 'thread-upsert', thread } });
    this.scheduleSnapshot();
    return thread;
  }

  appendItem(input: WorkflowItem): boolean {
    if (this.seenItems.has(input.id)) {
      logger.debug({ itemId: input.id, threadId: input.threadId, kind: input.kind }, 'workflow item dedup skipped');
      return false;
    }
    this.seenItems.add(input.id);

    const item = this.clampItem(input);
    const list = this.items.get(item.threadId) ?? [];
    list.push(item);
    if (list.length > this.maxItemsPerThread) {
      list.splice(0, list.length - this.maxItemsPerThread);
    }
    this.items.set(item.threadId, list);

    const thread = this.threads.get(item.threadId);
    if (thread) {
      thread.updatedAt = Math.max(thread.updatedAt, item.timestamp);
      thread.itemCount = list.length;
      if (item.status) thread.status = item.status;
      this.threads.set(thread.id, thread);
      this.broadcast({ type: 'workflow-event', event: { action: 'thread-upsert', thread } });
    }

    this.broadcast({ type: 'workflow-event', event: { action: 'item-append', item } });
    this.prune();
    this.scheduleSnapshot();
    return true;
  }

  async flushSnapshot(): Promise<void> {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    await this.writeSnapshotNow();
  }

  /** Test-only helper: synchronously flush any pending writes. */
  flushSnapshotSync(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.writeSnapshotSyncForTests();
  }

  snapshot(): WorkflowSnapshot {
    const threads = Array.from(this.threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    const items = threads.flatMap((thread) => this.items.get(thread.id) ?? []);
    return { threads, items };
  }

  /** Look up a thread without constructing a snapshot wrapper. Adapter code uses this
   * to avoid clobbering already-known terminal status (done/error) when a stale-timestamp
   * item arrives later. */
  getThread(threadId: string): WorkflowThread | undefined {
    return this.threads.get(threadId);
  }

  threadSnapshot(threadId: string): WorkflowSnapshot | undefined {
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;
    return { threads: [thread], items: this.items.get(threadId) ?? [] };
  }

  onEvent(listener: WorkflowListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(event: WsServerEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'workflow listener failed');
      }
    }
  }

  private prune() {
    const orderedThreads = Array.from(this.threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    const removedThreads = orderedThreads.slice(this.maxThreads);
    for (const thread of removedThreads) {
      this.threads.delete(thread.id);
      this.items.delete(thread.id);
    }

    if (this.seenItems.size > this.maxSeenItems || removedThreads.length > 0) {
      this.rebuildSeenItems();
    }
  }

  private rebuildSeenItems() {
    this.seenItems = new Set(
      Array.from(this.items.values())
        .flat()
        .map((item) => item.id),
    );
  }

  private clampItem(item: WorkflowItem): WorkflowItem {
    if (typeof item.content !== 'string' || item.content.length <= MAX_WORKFLOW_ITEM_CONTENT_CHARS) {
      return item;
    }
    return {
      ...item,
      content: `${item.content.slice(0, MAX_WORKFLOW_ITEM_CONTENT_CHARS)}\n\n[CodePanion: content truncated for local workflow snapshot]`,
    };
  }

  private loadSnapshot() {
    if (!this.snapshotPath || !existsSync(this.snapshotPath)) return;

    try {
      const raw = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as WorkflowSnapshot;
      const threads = Array.isArray(raw.threads) ? raw.threads : [];
      const items = Array.isArray(raw.items) ? raw.items : [];

      for (const thread of threads) {
        this.threads.set(thread.id, {
          ...thread,
          status: thread.status === 'done' || thread.status === 'error' ? thread.status : 'paused',
        });
      }

      for (const item of items) {
        if (!this.threads.has(item.threadId)) continue;
        const list = this.items.get(item.threadId) ?? [];
        list.push(this.clampItem(item));
        this.items.set(item.threadId, list.slice(-this.maxItemsPerThread));
      }

      this.prune();
      this.rebuildSeenItems();
    } catch (err) {
      logger.warn({ err, snapshotPath: this.snapshotPath }, 'failed to load workflow snapshot');
    }
  }

  private scheduleSnapshot() {
    if (!this.snapshotPath) return;
    if (this.snapshotDebounceMs <= 0) {
      this.writeSnapshotSyncForTests();
      return;
    }
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.writeSnapshotNow().catch((err) => {
        logger.warn({ err, snapshotPath: this.snapshotPath }, 'failed to save workflow snapshot');
      });
    }, this.snapshotDebounceMs);
    if (typeof this.snapshotTimer.unref === 'function') this.snapshotTimer.unref();
  }

  private async writeSnapshotNow(): Promise<void> {
    if (!this.snapshotPath) return;
    if (this.snapshotWriting) {
      this.snapshotPendingWhileWriting = true;
      return;
    }
    this.snapshotWriting = true;
    try {
      do {
        this.snapshotPendingWhileWriting = false;
        const payload = JSON.stringify(this.snapshot(), null, 2);
        await this.ensureSnapshotDir();
        const tmpPath = `${this.snapshotPath}.tmp`;
        try {
          await writeFile(tmpPath, payload, 'utf8');
          await rename(tmpPath, this.snapshotPath);
        } catch (err) {
          await unlink(tmpPath).catch(() => undefined);
          throw err;
        }
      } while (this.snapshotPendingWhileWriting);
    } finally {
      this.snapshotWriting = false;
    }
  }

  private writeSnapshotSyncForTests(): void {
    if (!this.snapshotPath) return;
    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true });
      const payload = JSON.stringify(this.snapshot(), null, 2);
      const tmpPath = `${this.snapshotPath}.tmp`;
      try {
        writeFileSync(tmpPath, payload, 'utf8');
        renameSync(tmpPath, this.snapshotPath);
      } catch (err) {
        try { unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
      }
      this.snapshotDirEnsured = true;
    } catch (err) {
      logger.warn({ err, snapshotPath: this.snapshotPath }, 'failed to save workflow snapshot');
    }
  }

  private async ensureSnapshotDir(): Promise<void> {
    if (this.snapshotDirEnsured || !this.snapshotPath) return;
    mkdirSync(dirname(this.snapshotPath), { recursive: true });
    this.snapshotDirEnsured = true;
  }
}
