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
let settingsListener = null;
const CONFIG_PATH = path.join(os.homedir(), '.codepanion', 'config.json');

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

function logFailure(label, method, route, err) {
  const status = err && typeof err.status === 'number' ? ` status=${err.status}` : '';
  const message = (err && err.message) || String(err);
  console.warn(`[CodePanion] ${label} ${method} ${route}${status} — ${message}`);
}

function request(method, route, payload) {
  const { port, token } = loadDaemonConfig();
  const body = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : undefined;

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

function postEvent(type, title, content, extra) {
  if (!sourceId) return;
  // extra goes first so caller-provided fields (e.g. level) layer on top of
  // shared defaults; the core routing fields (type/source/sourceId/timestamp)
  // are written LAST so caller mistakes can't accidentally override them.
  const payload = Object.assign(
    {},
    extra || {},
    {
      type,
      source: 'vscode',
      sourceId,
      title,
      content,
      windowTitle: vscode.workspace.name || 'VS Code',
      workspace: workspaceName(),
      timestamp: Date.now()
    }
  );
  request('POST', '/events', payload).catch(err => logFailure('postEvent', 'POST', '/events', err));
}

function disconnectSource() {
  if (!sourceId) return Promise.resolve();
  const id = sourceId;
  sourceId = '';
  const route = `/sources/${encodeURIComponent(id)}/disconnect`;
  return request('POST', route).catch(err => logFailure('disconnectSource', 'POST', route, err));
}

async function activate(context) {
  // Watch the daemon config + VS Code settings so cached token/port refresh
  // when the user re-runs `projects rotate-token` or changes settings.json.
  try {
    configWatcher = fs.watch(CONFIG_PATH, () => invalidateConfig());
  } catch {
    // config file may not exist yet; the next event will populate cache.
  }
  settingsListener = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('codepanion')) invalidateConfig();
  });
  context.subscriptions.push(settingsListener);
  context.subscriptions.push({ dispose: () => { try { configWatcher?.close(); } catch {} configWatcher = null; } });

  try {
    await registerSource();
    postEvent('activity', 'VS Code 已连接', 'VS Code 窗口监控已连接到 CodePanion。');
  } catch (err) {
    logFailure('registerSource', 'POST', '/sources/register', err);
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

  // Debug sessions: high-signal for AI-assisted debugging workflows.
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    postEvent('activity', `调试开始：${session.name}`, `调试器类型：${session.type}`);
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    postEvent('done', `调试结束：${session.name}`, `调试器类型：${session.type}`, { level: 'done' });
  }));
}

function deactivate() {
  return disconnectSource();
}

module.exports = { activate, deactivate };
