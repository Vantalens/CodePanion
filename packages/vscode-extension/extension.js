const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

let sourceId = '';

function loadDaemonConfig() {
  const cfg = vscode.workspace.getConfiguration('remindai');
  let port = cfg.get('port') || 7777;
  let token = cfg.get('token') || '';

  if (!token) {
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.remindai', 'config.json'), 'utf8');
      const parsed = JSON.parse(raw);
      port = parsed.port || port;
      token = parsed.token || token;
    } catch {}
  }

  return { port, token };
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
          reject(new Error(`${method} ${route} failed: ${res.statusCode} ${text}`));
          return;
        }
        resolve(text ? JSON.parse(text) : {});
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function workspaceName() {
  return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).join('; ') || '';
}

async function registerSource() {
  const enabled = vscode.workspace.getConfiguration('remindai').get('enabled');
  if (enabled === false) return;

  const source = await request('POST', '/sources/register', {
    kind: 'vscode',
    name: 'VS Code',
    windowTitle: vscode.workspace.name || 'VS Code',
    workspace: workspaceName(),
    pid: process.pid,
    capabilities: ['window', 'tasks', 'terminals']
  });
  sourceId = source.id;
}

function postEvent(type, title, content) {
  if (!sourceId) return;
  request('POST', '/events', {
    type,
    source: 'vscode',
    sourceId,
    title,
    content,
    windowTitle: vscode.workspace.name || 'VS Code',
    workspace: workspaceName(),
    timestamp: Date.now()
  }).catch(() => {});
}

async function activate(context) {
  try {
    await registerSource();
    postEvent('activity', 'VS Code 已连接', 'VS Code 窗口监控已连接到 RemindAI。');
  } catch (err) {
    console.warn('[RemindAI] failed to register source:', err.message);
  }

  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(event => {
    const code = event.exitCode ?? 0;
    postEvent(code === 0 ? 'done' : 'error', `任务结束：${event.execution.task.name}`, `退出码：${code}`);
  }));

  context.subscriptions.push(vscode.window.onDidOpenTerminal(terminal => {
    postEvent('activity', '终端已打开', terminal.name);
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
