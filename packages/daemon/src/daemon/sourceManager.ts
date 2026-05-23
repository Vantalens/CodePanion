import { randomUUID } from 'node:crypto';
import type {
  MonitorEvent,
  MonitorSource,
  RegisterSourceRequest,
  SourceCapabilityLevel,
  SourceIntegrationKind,
  SourcePrivacyBoundary,
  WsServerEvent,
} from '../shared/protocol.js';
import { logger } from '../logger.js';
import { RETENTION_DEFAULTS } from '../config.js';

type Listener = (event: WsServerEvent) => void;
type StoredMonitorEvent = MonitorEvent & { id: string; timestamp: number };
type MonitorEventReply = {
  eventId: string;
  sourceId?: string;
  text: string;
  timestamp: number;
};

export type SourceRetentionOptions = {
  events?: number;
  repliesPerEvent?: number;
  offlineSources?: number;
};

export class SourceManager {
  private sources = new Map<string, MonitorSource>();
  private events = new Map<string, StoredMonitorEvent>();
  private replies = new Map<string, MonitorEventReply[]>();
  private listeners = new Set<Listener>();
  private readonly maxEvents: number;
  private readonly maxRepliesPerEvent: number;
  private readonly maxOfflineSources: number;

  constructor(options: { retention?: SourceRetentionOptions } = {}) {
    this.maxEvents = options.retention?.events ?? RETENTION_DEFAULTS.source.events;
    this.maxRepliesPerEvent = options.retention?.repliesPerEvent ?? RETENTION_DEFAULTS.source.repliesPerEvent;
    this.maxOfflineSources = options.retention?.offlineSources ?? RETENTION_DEFAULTS.source.offlineSources;
  }

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
      ...deriveSourceMetadata(input),
      registeredAt: now,
      lastSeenAt: now,
      status: 'online',
    };

    this.sources.set(source.id, source);
    this.broadcast({ type: 'source-registered', source });
    // N-12：日志只留路由字段，windowTitle / workspace / url 等可能含用户内容的字段走 trace。
    logger.info(
      { sourceId: source.id, kind: source.kind, capabilityLevel: source.capabilityLevel, integrationKind: source.integrationKind },
      'monitor source registered',
    );
    logger.trace({ source }, 'monitor source registered detail');
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
    this.pruneOfflineSources();
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
    // N-12：默认仅打路由字段；title / content / windowTitle 等可能携带用户内容，转 trace 等级。
    logger.info(
      {
        eventId: event.id,
        eventKind: event.type,
        sourceId: event.sourceId,
        sessionId: event.sessionId,
        level: event.level,
        contentBytes: event.content ? Buffer.byteLength(event.content, 'utf8') : 0,
        hasOptions: Array.isArray(event.options) && event.options.length > 0,
      },
      'monitor event',
    );
    logger.trace({ event }, 'monitor event detail');
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
    if (replies.length > this.maxRepliesPerEvent) {
      replies.splice(0, replies.length - this.maxRepliesPerEvent);
    }
    this.replies.set(eventId, replies);

    this.broadcast({
      type: 'monitor-event-reply',
      ...reply,
    });
    // N-12：回复正文可能是用户敲下的指令，默认不写日志正文，只写大小；正文走 trace。
    logger.info(
      { eventId, sourceId: event.sourceId, textBytes: Buffer.byteLength(text ?? '', 'utf8') },
      'monitor event reply',
    );
    logger.trace({ eventId, sourceId: event.sourceId, text }, 'monitor event reply detail');
    return true;
  }

  listReplies(eventId: string): MonitorEventReply[] | undefined {
    if (!this.events.has(eventId)) return undefined;
    return this.replies.get(eventId) ?? [];
  }

  exportSnapshot(options: { since?: number } = {}): {
    sources: MonitorSource[];
    events: StoredMonitorEvent[];
    replies: MonitorEventReply[];
  } {
    const since = options.since ?? 0;
    const events = Array.from(this.events.values())
      .filter((event) => event.timestamp >= since)
      .sort((a, b) => a.timestamp - b.timestamp);
    const keptIds = new Set(events.map((event) => event.id));
    const replies: MonitorEventReply[] = [];
    for (const [eventId, list] of this.replies.entries()) {
      if (!keptIds.has(eventId)) continue;
      for (const reply of list) {
        if (reply.timestamp >= since) replies.push(reply);
      }
    }
    replies.sort((a, b) => a.timestamp - b.timestamp);
    const sources = Array.from(this.sources.values())
      .filter((source) => (source.lastSeenAt ?? source.registeredAt ?? 0) >= since)
      .sort((a, b) => (a.registeredAt ?? 0) - (b.registeredAt ?? 0));
    return { sources, events, replies };
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
    if (this.events.size <= this.maxEvents) return;

    const events = Array.from(this.events.values()).sort((a, b) => b.timestamp - a.timestamp);
    const keep = new Set(events.slice(0, this.maxEvents).map((event) => event.id));
    for (const eventId of this.events.keys()) {
      if (keep.has(eventId)) continue;
      this.events.delete(eventId);
      this.replies.delete(eventId);
    }
  }

  private pruneOfflineSources() {
    const offline: MonitorSource[] = [];
    for (const source of this.sources.values()) {
      if (source.status === 'offline') offline.push(source);
    }
    if (offline.length <= this.maxOfflineSources) return;

    offline.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const excess = offline.length - this.maxOfflineSources;
    for (let i = 0; i < excess; i += 1) {
      const stale = offline[i];
      this.sources.delete(stale.id);
      logger.info({ sourceId: stale.id, kind: stale.kind }, 'offline monitor source evicted');
    }
  }
}

function deriveSourceMetadata(input: RegisterSourceRequest): {
  capabilityLevel: SourceCapabilityLevel;
  integrationKind: SourceIntegrationKind;
  privacyBoundary: SourcePrivacyBoundary;
} {
  if (input.capabilityLevel && input.integrationKind && input.privacyBoundary) {
    return {
      capabilityLevel: input.capabilityLevel,
      integrationKind: input.integrationKind,
      privacyBoundary: input.privacyBoundary,
    };
  }

  const defaults = defaultSourceMetadata(input.kind, input.capabilities ?? []);
  return {
    capabilityLevel: input.capabilityLevel ?? defaults.capabilityLevel,
    integrationKind: input.integrationKind ?? defaults.integrationKind,
    privacyBoundary: input.privacyBoundary ?? defaults.privacyBoundary,
  };
}

function defaultSourceMetadata(
  kind: RegisterSourceRequest['kind'],
  capabilities: string[],
): {
  capabilityLevel: SourceCapabilityLevel;
  integrationKind: SourceIntegrationKind;
  privacyBoundary: SourcePrivacyBoundary;
} {
  if (kind === 'cli' || kind === 'claude-code' || kind === 'codex') {
    return { capabilityLevel: 'L3', integrationKind: 'cli-pty', privacyBoundary: 'explicit-session' };
  }

  if (kind === 'codex-desktop') {
    return { capabilityLevel: 'L2', integrationKind: 'local-file-sync', privacyBoundary: 'local-history' };
  }

  if (kind === 'vscode') {
    return { capabilityLevel: 'L2', integrationKind: 'extension', privacyBoundary: 'explicit-extension' };
  }

  if (kind === 'cc-switch') {
    return { capabilityLevel: 'L1-L2', integrationKind: 'config-switcher', privacyBoundary: 'config-switcher' };
  }

  if (kind === 'external') {
    return {
      capabilityLevel: capabilities.includes('reply') ? 'L2-L3' : 'L2',
      integrationKind: 'adapter',
      privacyBoundary: 'explicit-adapter',
    };
  }

  return { capabilityLevel: 'L1-L2', integrationKind: 'process-scan', privacyBoundary: 'minimal-process' };
}
