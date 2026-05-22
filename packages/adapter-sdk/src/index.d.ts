export type SourceKind =
  | 'cli'
  | 'vscode'
  | 'claude-code'
  | 'codex'
  | 'codex-desktop'
  | 'cursor'
  | 'antigravity'
  | 'ai-ide'
  | 'trae'
  | 'codebuddy'
  | 'lingma'
  | 'qoder'
  | 'marscode'
  | 'codegeex'
  | 'comate'
  | 'qwen-code'
  | 'cc-switch'
  | 'external';

export type SourceCapabilityLevel = 'L1' | 'L1-L2' | 'L2' | 'L2-L3' | 'L3' | 'L4';

export type SourceIntegrationKind =
  | 'cli-pty'
  | 'local-file-sync'
  | 'extension'
  | 'process-scan'
  | 'config-switcher'
  | 'adapter'
  | 'manual';

export type SourcePrivacyBoundary =
  | 'explicit-session'
  | 'local-history'
  | 'explicit-extension'
  | 'minimal-process'
  | 'config-switcher'
  | 'explicit-adapter';

export type MonitorEventType = 'prompt' | 'done' | 'error' | 'activity' | 'notification';

export type MonitorEventLevel = 'info' | 'prompt' | 'done' | 'error';

export interface RegisterSourceInput {
  kind?: SourceKind;
  name?: string;
  windowTitle?: string;
  workspace?: string;
  url?: string;
  pid?: number;
  capabilities?: string[];
  capabilityLevel?: SourceCapabilityLevel;
  integrationKind?: SourceIntegrationKind;
  privacyBoundary?: SourcePrivacyBoundary;
}

export interface MonitorSource {
  id: string;
  kind: SourceKind;
  name: string;
  windowTitle?: string;
  workspace?: string;
  url?: string;
  pid?: number;
  capabilities: string[];
  capabilityLevel: SourceCapabilityLevel;
  integrationKind: SourceIntegrationKind;
  privacyBoundary: SourcePrivacyBoundary;
}

export interface EmitEventInput {
  type?: MonitorEventType;
  sourceId?: string;
  source?: string;
  sessionId?: string;
  title?: string;
  content?: string;
  options?: string[];
  level?: MonitorEventLevel;
  windowTitle?: string;
  workspace?: string;
  url?: string;
  timestamp?: number;
}

export interface AdapterOptions {
  hostname?: string;
  port?: number;
  token?: string;
  basePath?: string;
  configPath?: string;
  timeoutMs?: number;
  sourceKind?: SourceKind;
  sourceName?: string;
}

export interface DaemonConfigSummary {
  port: number;
  token: string;
}

export class CodePanionAdapterError extends Error {
  status?: number;
  method?: string;
  route?: string;
  cause?: unknown;
}

export class CodePanionAdapter {
  constructor(options?: AdapterOptions);
  readonly sourceId: string;
  readonly endpoint: { hostname: string; port: number; basePath: string };
  setSourceId(value: string): void;
  registerSource(payload?: RegisterSourceInput): Promise<MonitorSource>;
  emitEvent(payload?: EmitEventInput): Promise<{ ok: boolean; event: unknown }>;
  disconnect(sourceId?: string): Promise<{ ok: boolean; reason?: string }>;
  replyToEvent(eventId: string, text: string): Promise<{ ok: boolean }>;
  listReplies(eventId: string): Promise<{ eventId: string; replies: unknown[] }>;
}

export function readDaemonConfig(options?: { configPath?: string }): DaemonConfigSummary;
export function createAdapter(options?: AdapterOptions): CodePanionAdapter;
