import type { WorkflowItem, WorkflowSnapshot, WorkflowThread, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type WorkflowListener = (event: WsServerEvent) => void;
type WorkflowManagerOptions = {
  snapshotPath?: string;
};

const MAX_THREADS = 80;
const MAX_ITEMS_PER_THREAD = 500;
const MAX_SEEN_ITEMS = 8000;

export class WorkflowManager {
  private threads = new Map<string, WorkflowThread>();
  private items = new Map<string, WorkflowItem[]>();
  private seenItems = new Set<string>();
  private listeners = new Set<WorkflowListener>();
  private snapshotPath?: string;

  constructor(options: WorkflowManagerOptions = {}) {
    this.snapshotPath = options.snapshotPath;
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
    this.saveSnapshot();
    return thread;
  }

  appendItem(input: WorkflowItem): boolean {
    if (this.seenItems.has(input.id)) return false;
    this.seenItems.add(input.id);

    const list = this.items.get(input.threadId) ?? [];
    list.push(input);
    if (list.length > MAX_ITEMS_PER_THREAD) {
      list.splice(0, list.length - MAX_ITEMS_PER_THREAD);
    }
    this.items.set(input.threadId, list);

    const thread = this.threads.get(input.threadId);
    if (thread) {
      thread.updatedAt = Math.max(thread.updatedAt, input.timestamp);
      thread.itemCount = list.length;
      if (input.status) thread.status = input.status;
      this.threads.set(thread.id, thread);
      this.broadcast({ type: 'workflow-event', event: { action: 'thread-upsert', thread } });
    }

    this.broadcast({ type: 'workflow-event', event: { action: 'item-append', item: input } });
    this.prune();
    this.saveSnapshot();
    return true;
  }

  snapshot(): WorkflowSnapshot {
    const threads = Array.from(this.threads.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    const items = threads.flatMap((thread) => this.items.get(thread.id) ?? []);
    return { threads, items };
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
    const removedThreads = orderedThreads.slice(MAX_THREADS);
    for (const thread of removedThreads) {
      this.threads.delete(thread.id);
      this.items.delete(thread.id);
    }

    if (this.seenItems.size > MAX_SEEN_ITEMS || removedThreads.length > 0) {
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
        list.push(item);
        this.items.set(item.threadId, list.slice(-MAX_ITEMS_PER_THREAD));
      }

      this.prune();
      this.rebuildSeenItems();
    } catch (err) {
      logger.warn({ err, snapshotPath: this.snapshotPath }, 'failed to load workflow snapshot');
    }
  }

  private saveSnapshot() {
    if (!this.snapshotPath) return;

    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true });
      writeFileSync(this.snapshotPath, JSON.stringify(this.snapshot(), null, 2), 'utf8');
    } catch (err) {
      logger.warn({ err, snapshotPath: this.snapshotPath }, 'failed to save workflow snapshot');
    }
  }
}
