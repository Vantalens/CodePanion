import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.codepanion', 'config.json');
const DEFAULT_PORT = 7777;
const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 5000;

export class CodePanionAdapterError extends Error {
  constructor(message, { status, method, route, cause } = {}) {
    super(message);
    this.name = 'CodePanionAdapterError';
    this.status = status;
    this.method = method;
    this.route = route;
    if (cause) this.cause = cause;
  }
}

export function readDaemonConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      port: Number.isFinite(parsed.port) ? parsed.port : DEFAULT_PORT,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return { port: DEFAULT_PORT, token: '' };
  }
}

function joinPath(base, route) {
  if (!base) return route;
  const left = base.endsWith('/') ? base.slice(0, -1) : base;
  const right = route.startsWith('/') ? route : `/${route}`;
  return `${left}${right}`;
}

function isValidKind(kind) {
  return typeof kind === 'string' && kind.length > 0;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CodePanionAdapterError(`${label} must be a non-empty string`);
  }
}

export class CodePanionAdapter {
  #hostname;
  #port;
  #token;
  #basePath;
  #timeoutMs;
  #sourceId = '';
  #defaultSourceKind;
  #defaultSourceName;

  constructor(options = {}) {
    const config = options.configPath
      ? readDaemonConfig({ configPath: options.configPath })
      : readDaemonConfig();
    this.#hostname = options.hostname || DEFAULT_HOSTNAME;
    this.#port = Number.isFinite(options.port) ? options.port : config.port;
    this.#token = options.token || config.token || '';
    this.#basePath = options.basePath || '';
    this.#timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#defaultSourceKind = options.sourceKind || 'external';
    this.#defaultSourceName = options.sourceName || '';
  }

  get sourceId() {
    return this.#sourceId;
  }

  get endpoint() {
    return { hostname: this.#hostname, port: this.#port, basePath: this.#basePath };
  }

  setSourceId(value) {
    this.#sourceId = typeof value === 'string' ? value : '';
  }

  async registerSource(payload = {}) {
    const body = {
      kind: payload.kind || this.#defaultSourceKind,
      name: payload.name || this.#defaultSourceName,
      windowTitle: payload.windowTitle,
      workspace: payload.workspace,
      url: payload.url,
      pid: payload.pid,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : undefined,
      capabilityLevel: payload.capabilityLevel,
      integrationKind: payload.integrationKind || 'adapter',
      privacyBoundary: payload.privacyBoundary || 'explicit-adapter',
    };
    if (!isValidKind(body.kind)) {
      throw new CodePanionAdapterError('source kind is required');
    }
    assertNonEmptyString(body.name, 'source name');

    const result = await this.#request('POST', '/sources/register', body);
    if (result && typeof result.id === 'string') {
      this.#sourceId = result.id;
    }
    return result;
  }

  async emitEvent(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new CodePanionAdapterError('event payload must be an object');
    }
    const type = payload.type || 'activity';
    const body = {
      type,
      sourceId: payload.sourceId || this.#sourceId || undefined,
      source: payload.source,
      sessionId: payload.sessionId,
      title: payload.title,
      content: typeof payload.content === 'string' ? payload.content : '',
      options: Array.isArray(payload.options) ? payload.options : undefined,
      level: payload.level,
      windowTitle: payload.windowTitle,
      workspace: payload.workspace,
      url: payload.url,
      timestamp: payload.timestamp,
    };
    return this.#request('POST', '/events', body);
  }

  async disconnect(sourceId) {
    const id = sourceId || this.#sourceId;
    if (!id) return { ok: false, reason: 'no-source-id' };
    const result = await this.#request('POST', `/sources/${encodeURIComponent(id)}/disconnect`, null);
    if (id === this.#sourceId) this.#sourceId = '';
    return result;
  }

  async replyToEvent(eventId, text) {
    assertNonEmptyString(eventId, 'eventId');
    if (typeof text !== 'string') {
      throw new CodePanionAdapterError('reply text must be a string');
    }
    return this.#request('POST', `/events/${encodeURIComponent(eventId)}/reply`, { text });
  }

  async listReplies(eventId) {
    assertNonEmptyString(eventId, 'eventId');
    return this.#request('GET', `/events/${encodeURIComponent(eventId)}/replies`, null);
  }

  #request(method, route, payload) {
    const body = payload === null || payload === undefined
      ? undefined
      : Buffer.from(JSON.stringify(payload), 'utf8');
    const fullRoute = joinPath(this.#basePath, route);

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: this.#hostname,
        port: this.#port,
        path: fullRoute,
        method,
        headers: {
          'Authorization': this.#token ? `Bearer ${this.#token}` : '',
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body ? body.length : 0,
        },
        timeout: this.#timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new CodePanionAdapterError(
              `${method} ${fullRoute} failed: ${res.statusCode} ${text.slice(0, 200)}`,
              { status: res.statusCode, method, route: fullRoute },
            ));
            return;
          }
          if (!text) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (parseErr) {
            reject(new CodePanionAdapterError(
              `${method} ${fullRoute} returned non-JSON: ${text.slice(0, 200)}`,
              { status: res.statusCode, method, route: fullRoute, cause: parseErr },
            ));
          }
        });
      });
      req.on('error', (err) => reject(new CodePanionAdapterError(err.message, { method, route: fullRoute, cause: err })));
      req.on('timeout', () => {
        req.destroy();
        reject(new CodePanionAdapterError(
          `${method} ${fullRoute} timed out after ${this.#timeoutMs}ms`,
          { method, route: fullRoute },
        ));
      });
      if (body) req.write(body);
      req.end();
    });
  }
}

export function createAdapter(options = {}) {
  return new CodePanionAdapter(options);
}
