const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

let sourceId = '';

// Cached daemon config: avoids re-reading ~/.codepanion/config.json + re-parsing
// VS Code settings on every event. Invalidated by fs.watch + settings change.
let cachedConfig = null;
let configWatcher = null;
let configProbeTimer = null;
let settingsListener = null;
const CONFIG_PATH = path.join(os.homedir(), '.codepanion', 'config.json');
const CONFIG_PROBE_INTERVAL_MS = 5_000;

// V-2: 默认 8s timeout，长任务也不应阻塞 VS Code 状态栏。
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const TERMINAL_OUTPUT_FLUSH_MS = 700;
const TERMINAL_OUTPUT_MAX_CHARS = 12_000;

// V-1: daemon-down 时指数退避 + 静默上限，避免状态栏 / dev console 刷屏。
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const SILENT_AFTER_FAILURES = 3;
let reconnectDelayMs = RECONNECT_INITIAL_MS;
let reconnectTimer = null;
let consecutiveFailures = 0;
let lastLoggedDaemonDown = false;
let daemonOnline = false;
let extensionDisposed = false;

function readConfig() {
  const cfg = vscode.workspace.getConfiguration('codepanion');
  let port = cfg.get('port') || 7777;
  let token = cfg.get('token') || '';

  if (!token) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      port = parsed.port || port;
      token = parsed.token || token;
    } catch {}
  }

  return { port, token };
}

function loadDaemonConfig() {
  if (!cachedConfig) cachedConfig = readConfig();
  return cachedConfig;
}

function invalidateConfig() {
  cachedConfig = null;
}

function isConnectionError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND'
    || code === 'EHOSTUNREACH' || code === 'ETIMEDOUT' || err.name === 'AbortError';
}

function logFailure(label, method, route, err) {
  // daemon-down 类错误只在第一次（或刚从 online 变 offline 时）落一条 warn；
  // 后续相同错误静默，避免 dev console 刷屏。其它错误（4xx/5xx/解析失败）正常落盘。
  const connectionDown = isConnectionError(err);
  if (connectionDown) {
    consecutiveFailures += 1;
    if (consecutiveFailures > SILENT_AFTER_FAILURES) return;
    if (lastLoggedDaemonDown && consecutiveFailures > 1) return;
    lastLoggedDaemonDown = true;
  } else {
    lastLoggedDaemonDown = false;
  }
  const status = err && typeof err.status === 'number' ? ` status=${err.status}` : '';
  const message = (err && err.message) || String(err);
  console.warn(`[CodePanion] ${label} ${method} ${route}${status} — ${message}`);
}

function request(method, route, payload, options = {}) {
  const { port, token } = loadDaemonConfig();
  const body = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : undefined;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body ? body.length : 0
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`${method} ${route} failed: ${res.statusCode} ${text.slice(0, 200)}`);
          err.status = res.statusCode;
          err.method = method;
          err.route = route;
          reject(err);
          return;
        }
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (parseErr) {
          const err = new Error(`${method} ${route} returned non-JSON: ${text.slice(0, 200)}`);
          err.status = res.statusCode;
          err.method = method;
          err.route = route;
          err.cause = parseErr;
          reject(err);
        }
      });
    });
    // V-2: socket-level timeout 兜底，避免 http.request 在异常 socket 上无限挂起。
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`${method} ${route} timed out after ${timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      err.method = method;
      err.route = route;
      req.destroy(err);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function workspaceName() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';
  return folders.map(folder => path.basename(folder.uri.fsPath)).join(' + ');
}

async function registerSource() {
  const enabled = vscode.workspace.getConfiguration('codepanion').get('enabled');
  if (enabled === false) return;

  const source = await request('POST', '/sources/register', {
    kind: 'vscode',
    name: 'VS Code',
    windowTitle: vscode.workspace.name || 'VS Code',
    workspace: workspaceName(),
    pid: process.pid,
    capabilities: ['window', 'tasks', 'terminals', 'debug']
  });
  sourceId = source.id;
}

function markDaemonOnline() {
  if (daemonOnline) return;
  daemonOnline = true;
  reconnectDelayMs = RECONNECT_INITIAL_MS;
  consecutiveFailures = 0;
  lastLoggedDaemonDown = false;
}

function markDaemonOffline() {
  daemonOnline = false;
  sourceId = '';
  scheduleReconnect();
}

function scheduleReconnect() {
  if (extensionDisposed) return;
  if (reconnectTimer) return;
  const delay = reconnectDelayMs;
  // V-1: 指数退避，1s → 2s → 4s → ... 最高 60s，避免 daemon 长期 down 时刷屏。
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (extensionDisposed) return;
    try {
      await registerSource();
      markDaemonOnline();
      postEvent('activity', 'VS Code 已连接', 'VS Code 窗口监控已重新连接到 CodePanion。');
    } catch (err) {
      logFailure('reconnect', 'POST', '/sources/register', err);
      scheduleReconnect();
    }
  }, delay);
}

function postEvent(type, title, content, extra) {
  if (!sourceId) return;
  if (!daemonOnline) return; // daemon-down 时丢弃，避免持续累积失败请求
  // extra goes first so caller-provided fields (e.g. level) layer on top of
  // shared defaults; the core routing fields (type/source/sourceId/timestamp)
  // are written LAST so caller mistakes can't accidentally override them.
  const payload = Object.assign(
    {},
    extra || {},
    {
      type,
      source: (extra && extra.source) || 'vscode',
      sourceId,
      title,
      content,
      windowTitle: vscode.workspace.name || 'VS Code',
      workspace: workspaceName(),
      timestamp: Date.now()
    }
  );
  request('POST', '/events', payload).catch(err => {
    logFailure('postEvent', 'POST', '/events', err);
    if (isConnectionError(err)) markDaemonOffline();
  });
}

function classifyAiTerminalSource(commandLine, terminalName) {
  const text = `${commandLine || ''}\n${terminalName || ''}`.toLowerCase();
  if (/@anthropic-ai[\\/]+claude-code/.test(text) || /(^|[\s"'\\/])claude(\.exe)?($|[\s"'])/.test(text) || /claude code/.test(text)) {
    return { source: 'claude-code', label: 'Claude Code' };
  }
  if (/@openai[\\/]+codex/.test(text) || /(^|[\s"'\\/])codex(\.exe)?($|[\s"'])/.test(text)) {
    return { source: 'codex', label: 'Codex' };
  }
  if (/@sst[\\/]+opencode/.test(text) || /(^|[\s"'\\/])opencode(\.exe)?($|[\s"'])/.test(text)) {
    return { source: 'opencode', label: 'OpenCode' };
  }
  return null;
}

function terminalCommandLine(execution) {
  const value = execution && execution.commandLine;
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.value === 'string') return value.value;
  return String(value);
}

function terminalCwd(execution) {
  const cwd = execution && execution.cwd;
  if (!cwd) return undefined;
  if (typeof cwd === 'string') return cwd;
  if (cwd.fsPath) return cwd.fsPath;
  return String(cwd);
}

function startTerminalOutputCapture(event) {
  const execution = event && event.execution;
  if (!execution || typeof execution.read !== 'function') return;
  const commandLine = terminalCommandLine(execution);
  const terminalName = event.terminal && event.terminal.name;
  const ai = classifyAiTerminalSource(commandLine, terminalName);
  if (!ai) return;

  const workspace = terminalCwd(execution) || workspaceName();
  postEvent('activity', `${ai.label} 开始执行`, commandLine || terminalName || ai.label, {
    source: ai.source,
    workspace,
  });

  let buffer = '';
  let timer = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const text = buffer.trimEnd();
    buffer = '';
    if (!text) return;
    postEvent('activity', `${ai.label} 输出`, text, {
      source: ai.source,
      workspace,
    });
  };
  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(flush, TERMINAL_OUTPUT_FLUSH_MS);
  };

  (async () => {
    try {
      for await (const chunk of execution.read()) {
        buffer += String(chunk || '');
        if (buffer.length >= TERMINAL_OUTPUT_MAX_CHARS) {
          buffer = buffer.slice(-TERMINAL_OUTPUT_MAX_CHARS);
          flush();
        } else {
          scheduleFlush();
        }
      }
      flush();
    } catch (err) {
      postEvent('error', `${ai.label} 输出读取失败`, (err && err.message) || String(err), {
        source: ai.source,
        workspace,
        level: 'error',
      });
    }
  })();
}

function disconnectSource() {
  if (!sourceId) return Promise.resolve();
  const id = sourceId;
  sourceId = '';
  const route = `/sources/${encodeURIComponent(id)}/disconnect`;
  return request('POST', route).catch(err => logFailure('disconnectSource', 'POST', route, err));
}

function watchConfigFile() {
  // V-3: 首次启动时 ~/.codepanion/config.json 可能尚未生成（daemon 未起来），
  // 直接 fs.watch 会抛 ENOENT。改为：若文件存在则 watch；不存在则起 setInterval
  // 周期探测，文件出现后再装上 watch。daemon 启动后会自动 pick up 新 token / port。
  if (configWatcher) {
    try { configWatcher.close(); } catch {}
    configWatcher = null;
  }
  try {
    configWatcher = fs.watch(CONFIG_PATH, () => invalidateConfig());
    if (configProbeTimer) {
      clearInterval(configProbeTimer);
      configProbeTimer = null;
    }
    return true;
  } catch {
    return false;
  }
}

function startConfigProbe() {
  if (configProbeTimer) return;
  configProbeTimer = setInterval(() => {
    if (extensionDisposed) return;
    if (fs.existsSync(CONFIG_PATH) && watchConfigFile()) {
      invalidateConfig();
    }
  }, CONFIG_PROBE_INTERVAL_MS);
  // 不阻塞 VS Code 退出
  if (typeof configProbeTimer.unref === 'function') configProbeTimer.unref();
}

async function activate(context) {
  extensionDisposed = false;
  // Watch the daemon config + VS Code settings so cached token/port refresh
  // when the user re-runs `projects rotate-token` or changes settings.json.
  if (!watchConfigFile()) {
    startConfigProbe();
  }
  settingsListener = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('codepanion')) invalidateConfig();
  });
  context.subscriptions.push(settingsListener);
  context.subscriptions.push({
    dispose: () => {
      extensionDisposed = true;
      try { configWatcher?.close(); } catch {}
      configWatcher = null;
      if (configProbeTimer) {
        clearInterval(configProbeTimer);
        configProbeTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }
  });

  try {
    await registerSource();
    markDaemonOnline();
    postEvent('activity', 'VS Code 已连接', 'VS Code 窗口监控已连接到 CodePanion。');
  } catch (err) {
    logFailure('registerSource', 'POST', '/sources/register', err);
    markDaemonOffline();
  }

  // Tasks: emit both start and end so workflow timeline shows full lifecycle.
  context.subscriptions.push(vscode.tasks.onDidStartTaskProcess(event => {
    const name = event.execution.task.name;
    postEvent('activity', `任务启动：${name}`, `任务进程已启动（pid=${event.processId ?? '?'}）`);
  }));
  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(event => {
    const name = event.execution.task.name;
    const code = event.exitCode ?? 0;
    if (code === 0) {
      postEvent('done', `任务完成：${name}`, `退出码：${code}`, { level: 'done' });
    } else {
      postEvent('error', `任务失败：${name}`, `退出码：${code}`, { level: 'error' });
    }
  }));

  // Terminals: pair open/close so users can see when an AI CLI shell ends.
  context.subscriptions.push(vscode.window.onDidOpenTerminal(terminal => {
    postEvent('activity', '终端已打开', terminal.name);
  }));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    postEvent('activity', '终端已关闭', terminal.name);
  }));
  if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') {
    context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(startTerminalOutputCapture));
  }
  if (typeof vscode.window.onDidEndTerminalShellExecution === 'function') {
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => {
      const execution = event && event.execution;
      const terminalName = event.terminal && event.terminal.name;
      const ai = classifyAiTerminalSource(terminalCommandLine(execution), terminalName);
      if (!ai) return;
      postEvent('activity', `${ai.label} 执行结束`, terminalCommandLine(execution) || terminalName || ai.label, {
        source: ai.source,
        workspace: terminalCwd(execution) || workspaceName(),
      });
    }));
  }

  // Debug sessions: high-signal for AI-assisted debugging workflows.
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    postEvent('activity', `调试开始：${session.name}`, `调试器类型：${session.type}`);
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    postEvent('done', `调试结束：${session.name}`, `调试器类型：${session.type}`, { level: 'done' });
  }));
}

function deactivate() {
  extensionDisposed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  return disconnectSource();
}

module.exports = {
  activate,
  deactivate,
  // 导出常量以便外部测试 / 验证退避语义
  __internals: {
    RECONNECT_INITIAL_MS,
    RECONNECT_MAX_MS,
    SILENT_AFTER_FAILURES,
    DEFAULT_REQUEST_TIMEOUT_MS,
    CONFIG_PROBE_INTERVAL_MS,
    isConnectionError,
    classifyAiTerminalSource,
    terminalCommandLine
  }
};
