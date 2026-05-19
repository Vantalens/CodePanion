import { randomUUID } from 'node:crypto';
import type {
  MonitorEvent,
  MonitorSource,
  RegisterSourceRequest,
  WsServerEvent,
} from '../shared/protocol.js';
import { logger } from '../logger.js';

type Listener = (event: WsServerEvent) => void;
type StoredMonitorEvent = MonitorEvent & { id: string; timestamp: number };
type MonitorEventReply = {
  eventId: string;
  sourceId?: string;
  text: string;
  timestamp: number;
};

const MAX_EVENTS = 1000;
const MAX_REPLIES_PER_EVENT = 50;

export class SourceManager {
  private sources = new Map<string, MonitorSource>();
  private events = new Map<string, StoredMonitorEvent>();
  private replies = new Map<string, MonitorEventReply[]>();
  private listeners = new Set<Listener>();

  register(input: RegisterSourceRequest): MonitorSource {
    const now = Date.now();
    const source: MonitorSource = {
      id: randomUUID(),
      kind: input.kind,
      name: input.name,
      windowTitle: input.windowTitle,
      workspace: input.workspace,
      url: input.url,
      pid: input.pid,
      capabilities: input.capabilities ?? [],
      registeredAt: now,
      lastSeenAt: now,
      status: 'online',
    };

    this.sources.set(source.id, source);
    this.broadcast({ type: 'source-registered', source });
    logger.info({ source }, 'monitor source registered');
    return source;
  }

  touch(sourceId: string): MonitorSource | undefined {
    const source = this.sources.get(sourceId);
    if (!source) return undefined;
    source.lastSeenAt = Date.now();
    if (source.status !== 'online') {
      source.status = 'online';
      this.broadcast({ type: 'source-registered', source });
    }
    return source;
  }

  disconnect(sourceId: string): boolean {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    source.status = 'offline';
    source.lastSeenAt = Date.now();
    this.broadcast({ type: 'source-disconnected', sourceId });
    logger.info({ sourceId }, 'monitor source disconnected');
    return true;
  }

  emitEvent(input: MonitorEvent): StoredMonitorEvent {
    if (input.sourceId) this.touch(input.sourceId);
    const event = {
      ...input,
      id: randomUUID(),
      timestamp: input.timestamp ?? Date.now(),
    };
    this.events.set(event.id, event);
    this.pruneEvents();
    this.broadcast({ type: 'monitor-event', event });
    logger.info({ event }, 'monitor event');
    return event;
  }

  reply(eventId: string, text: string): boolean {
    const event = this.events.get(eventId);
    if (!event) return false;

    const reply = {
      eventId,
      sourceId: event.sourceId,
      text,
      timestamp: Date.now(),
    };
    const replies = this.replies.get(eventId) ?? [];
    replies.push(reply);
    if (replies.length > MAX_REPLIES_PER_EVENT) {
      replies.splice(0, replies.length - MAX_REPLIES_PER_EVENT);
    }
    this.replies.set(eventId, replies);

    this.broadcast({
      type: 'monitor-event-reply',
      ...reply,
    });
    logger.info({ eventId, sourceId: event.sourceId, text }, 'monitor event reply');
    return true;
  }

  listReplies(eventId: string): MonitorEventReply[] | undefined {
    if (!this.events.has(eventId)) return undefined;
    return this.replies.get(eventId) ?? [];
  }

  list(): MonitorSource[] {
    return Array.from(this.sources.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  get(sourceId: string): MonitorSource | undefined {
    return this.sources.get(sourceId);
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(event: WsServerEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'source listener failed');
      }
    }
  }

  private pruneEvents() {
    if (this.events.size <= MAX_EVENTS) return;

    const events = Array.from(this.events.values()).sort((a, b) => b.timestamp - a.timestamp);
    const keep = new Set(events.slice(0, MAX_EVENTS).map((event) => event.id));
    for (const eventId of this.events.keys()) {
      if (keep.has(eventId)) continue;
      this.events.delete(eventId);
      this.replies.delete(eventId);
    }
  }
}
