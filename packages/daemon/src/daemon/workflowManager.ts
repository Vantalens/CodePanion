import type { WorkflowItem, WorkflowSnapshot, WorkflowThread, WsServerEvent } from '../shared/protocol.js';
import { logger } from '../logger.js';

type WorkflowListener = (event: WsServerEvent) => void;

export class WorkflowManager {
  private threads = new Map<string, WorkflowThread>();
  private items = new Map<string, WorkflowItem[]>();
  private seenItems = new Set<string>();
  private listeners = new Set<WorkflowListener>();

  upsertThread(input: WorkflowThread): WorkflowThread {
    const current = this.threads.get(input.id);
    const thread: WorkflowThread = {
      ...current,
      ...input,
      itemCount: this.items.get(input.id)?.length ?? current?.itemCount ?? input.itemCount ?? 0,
    };
    this.threads.set(thread.id, thread);
    this.broadcast({ type: 'workflow-event', event: { action: 'thread-upsert', thread } });
    return thread;
  }

  appendItem(input: WorkflowItem): boolean {
    if (this.seenItems.has(input.id)) return false;
    this.seenItems.add(input.id);

    const list = this.items.get(input.threadId) ?? [];
    list.push(input);
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
}
