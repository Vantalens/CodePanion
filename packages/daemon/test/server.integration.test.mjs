import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../dist/daemon/server.js';

function testConfig() {
  return {
    port: 0,
    token: 'test-token-1234567890',
    promptIdleMs: 100,
    toast: {
      enabled: false,
      soundOnPrompt: false,
      soundOnDone: false,
    },
    monitors: {
      cli: false,
      vscode: false,
      codexDesktop: false,
      aiTools: false,
    },
    retention: {
      session: { fullOutputChars: 256 * 1024, outputChunks: 1000 },
      source: { events: 1000, repliesPerEvent: 50, offlineSources: 50 },
      workflow: { threads: 30, itemsPerThread: 120, seenItems: 4000 },
    },
    templates: [],
  };
}

async function withServer(run, options = {}) {
  const created = createServer(testConfig(), { workflowSnapshotPath: null, ...options });
  const server = await created.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run({ port, token: testConfig().token, created });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withServerSnapshot(snapshotPath, run) {
  const created = createServer(testConfig(), { workflowSnapshotPath: snapshotPath });
  const server = await created.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run({ port, token: testConfig().token, created });
  } finally {
    // 触发 pending 快照在 server.close 前刷盘，保证下一次启动看到完整状态。
    await created.workflows.flushSnapshot();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(port, token, method, path, body, authorized = true) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: text ? JSON.parse(text) : undefined,
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForMessage(ws, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for websocket message'));
    }, timeoutMs);

    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    };

    ws.on('message', onMessage);
  });
}

function tokenSubprotocol(token) {
  return [`codepanion.token.${token}`];
}

function openWs(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { protocols, ...rest } = options;
    const ws = new WebSocket(url, protocols, rest);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// 同 openWs，但在 'open' 触发前就挂上 'message' 缓冲，
// 避免 server 在连接握手完成后立刻广播的消息（如 workflow-snapshot、hello）被遗漏。
function openWsBuffered(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { protocols, ...rest } = options;
    const ws = new WebSocket(url, protocols, rest);
    const buffered = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      buffered.push(msg);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].predicate(msg)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
    ws.once('open', () => {
      resolve({
        ws,
        wait(predicate, timeoutMs = 1500) {
          for (const m of buffered) {
            if (predicate(m)) return Promise.resolve(m);
          }
          return new Promise((res, rej) => {
            const w = { predicate, resolve: res };
            w.timer = setTimeout(() => {
              const idx = waiters.indexOf(w);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('timed out waiting for buffered websocket message'));
            }, timeoutMs);
            waiters.push(w);
          });
        },
      });
    });
    ws.once('error', reject);
  });
}

function attemptWs(url, options = {}) {
  return new Promise((resolve) => {
    const { protocols, ...rest } = options;
    const ws = new WebSocket(url, protocols, rest);
    let settled = false;
    const settle = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    ws.on('error', (err) => {
      settle({ ok: false, error: String(err?.message ?? err) });
    });
    ws.once('unexpected-response', (_req, res) => {
      settle({ ok: false, status: res.statusCode });
    });
    ws.once('open', () => {
      settle({ ok: true });
      ws.close();
    });
  });
}

function wsCloseResult(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { protocols, ...rest } = options;
    const ws = new WebSocket(url, protocols, rest);
    ws.once('error', reject);
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function closeWs(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    ws.once('close', resolve);
    ws.close();
  });
}

test('HTTP API requires auth and covers session lifecycle', async () => {
  await withServer(async ({ port, token }) => {
    const health = await request(port, token, 'GET', '/health', undefined, false);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const unauthorized = await request(port, token, 'GET', '/sessions', undefined, false);
    assert.equal(unauthorized.status, 401);

    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cwd: 'D:\\CodePanion',
      cliPid: 12345,
    });
    assert.equal(registered.status, 200);

    const sessionId = registered.body.id;
    assert.ok(sessionId);

    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'hello\n' })).status, 200);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'Continue? (y/n)', options: ['yes', 'no'] })).status, 200);

    const output = await request(port, token, 'GET', `/sessions/${sessionId}/output`);
    assert.equal(output.status, 200);
    assert.equal(output.body.fullOutput, 'hello\n');
    assert.equal(output.body.chunks.at(-1).type, 'prompt');

    const sessions = await request(port, token, 'GET', '/sessions');
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body[0].status, 'waiting');

    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 0 })).status, 200);
  });
});

test('workflow merges high-frequency CLI output chunks into a single item', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cliPid: 12345,
    });
    assert.equal(registered.status, 200);
    const sessionId = registered.body.id;

    // P2-D：50ms 内的多块 chunk 应合并为一条 workflow item，避免 spinner / 心跳输出
    // 把 workflow items 与 id 计数器撑爆。
    const realDateNow = Date.now;
    try {
      Date.now = () => 1_700_000_000_000;
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'same-a\n' })).status, 200);
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'same-b\n' })).status, 200);
    } finally {
      Date.now = realDateNow;
    }

    // 等待合并窗口落盘 (50ms + 余量)。
    await new Promise((resolve) => setTimeout(resolve, 120));

    const snapshot = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(`session:${sessionId}`)}`);
    assert.equal(snapshot.status, 200);
    const outputItems = snapshot.body.items.filter((item) => item.kind === 'command' && item.title === '终端输出');
    assert.equal(outputItems.length, 1);
    assert.equal(outputItems[0].content, 'same-a\nsame-b\n');
  });
});

test('workflow flushes pending CLI output before recording the next prompt', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cliPid: 12347,
    });
    assert.equal(registered.status, 200);
    const sessionId = registered.body.id;

    // 在 50ms 合并窗口内追加 chunk，然后立刻发 prompt，应触发立即 flush
    // 保证 prompt item 出现在 merged output 之后。
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'tick-a\n' })).status, 200);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'tick-b\n' })).status, 200);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, {
      lastLines: '请选择：',
      options: ['1) 是', '2) 否'],
    })).status, 200);

    const snapshot = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(`session:${sessionId}`)}`);
    assert.equal(snapshot.status, 200);
    const outputItems = snapshot.body.items.filter((item) => item.kind === 'command' && item.title === '终端输出');
    const promptItems = snapshot.body.items.filter((item) => item.kind === 'prompt');
    assert.equal(outputItems.length, 1);
    assert.equal(outputItems[0].content, 'tick-a\ntick-b\n');
    assert.equal(promptItems.length, 1);
    assert.ok(promptItems[0].timestamp >= outputItems[0].timestamp);
  });
});

test('/sessions/:id/prompt rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: [],
      cliPid: 12346,
    });
    const sessionId = registered.body.id;

    const nonString = await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 12345 });
    assert.equal(nonString.status, 400);

    const tooLong = await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'x'.repeat(16385) });
    assert.equal(tooLong.status, 400);

    const badOptions = await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'ok', options: [1, 2] });
    assert.equal(badOptions.status, 400);

    const tooManyOptions = await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'ok', options: Array.from({ length: 33 }, (_, i) => `o${i}`) });
    assert.equal(tooManyOptions.status, 400);

    const valid = await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'continue?', options: ['yes', 'no'] });
    assert.equal(valid.status, 200);
  });
});

test('/notify rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    assert.equal((await request(port, token, 'POST', '/notify', {})).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: '' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 123 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 'ok', level: 'critical' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 'ok' })).status, 200);
  });
});

test('/sources/register rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    assert.equal((await request(port, token, 'POST', '/sources/register', {})).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'nonexistent', name: 'x' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli', name: '' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli', name: 'x'.repeat(121) })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli', name: 'ok', capabilities: 'not-array' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli', name: 'ok', pid: -1 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sources/register', { kind: 'cli', name: 'ok' })).status, 200);
  });
});

test('/sources/:id/disconnect marks a source offline and broadcasts it', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const registered = await request(port, token, 'POST', '/sources/register', {
        kind: 'vscode',
        name: 'VS Code',
      });
      assert.equal(registered.status, 200);
      const sourceId = registered.body.id;

      const disconnectedPromise = waitForMessage(observer, (m) => m.type === 'source-disconnected' && m.sourceId === sourceId);
      const disconnected = await request(port, token, 'POST', `/sources/${sourceId}/disconnect`);
      assert.equal(disconnected.status, 200);
      assert.deepEqual(disconnected.body, { ok: true });
      await disconnectedPromise;

      const sources = await request(port, token, 'GET', '/sources');
      const source = sources.body.find((s) => s.id === sourceId);
      assert.ok(source, 'source should still be listed after disconnect');
      assert.equal(source.status, 'offline');

      const missing = await request(port, token, 'POST', '/sources/not-found/disconnect');
      assert.equal(missing.status, 404);
    } finally {
      await closeWs(observer);
    }
  });
});

test('/events rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    assert.equal((await request(port, token, 'POST', '/events', {})).status, 400);
    assert.equal((await request(port, token, 'POST', '/events', { type: 'unknown' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/events', { type: 'prompt', title: 'x'.repeat(241) })).status, 400);
    assert.equal((await request(port, token, 'POST', '/events', { type: 'prompt', workspace: 'x'.repeat(501) })).status, 400);
    assert.equal((await request(port, token, 'POST', '/events', { type: 'prompt' })).status, 200);
  });
});

test('/events/:id/reply rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    const eventCreated = await request(port, token, 'POST', '/events', { type: 'prompt' });
    const eventId = eventCreated.body.event.id;

    assert.equal((await request(port, token, 'POST', `/events/${eventId}/reply`, {})).status, 400);
    assert.equal((await request(port, token, 'POST', `/events/${eventId}/reply`, { text: 12345 })).status, 400);
    assert.equal((await request(port, token, 'POST', `/events/${eventId}/reply`, { text: 'ok' })).status, 200);
  });
});

test('/sessions rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    assert.equal((await request(port, token, 'POST', '/sessions', {})).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: '', cliPid: 1 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: 'codex' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 0 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 1.5 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 1, args: 'not-array' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 1 })).status, 200);
  });
});

test('/sessions/:id/output rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 22001 });
    const sessionId = registered.body.id;

    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, {})).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 12345 })).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'ok' })).status, 200);
  });
});

test('/sessions/:id/reply rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 22002 });
    const sessionId = registered.body.id;

    // The reply endpoint validates body before checking whether the CLI socket is attached.
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, {})).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 12345 })).status, 400);
    // With a valid body but no CLI socket attached, the route should answer 404 (session not connected) — not 400.
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'ok' })).status, 404);
  });
});

test('/sessions/:id/reply rejects text that is not a current prompt option', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cliPid: 12345,
    });
    const sessionId = registered.body.id;
    const cli = await openWs(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=${sessionId}`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'Continue?', options: ['yes', 'no'] });
      const reply = await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'rm -rf .' });
      assert.equal(reply.status, 400);
    } finally {
      await closeWs(cli);
    }
  });
});

test('/sessions/:id/reply cannot reuse a stale prompt option after a reply or new output', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cliPid: 12345,
    });
    const sessionId = registered.body.id;
    const cli = await openWs(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=${sessionId}`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'Continue?', options: ['yes', 'no'] });
      const injectPromise = waitForMessage(cli, (message) => message.type === 'inject-input' && message.sessionId === sessionId);
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'yes' })).status, 200);
      await injectPromise;
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'yes' })).status, 400);

      await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'Continue again?', options: ['go', 'stop'] });
      await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: 'continued\n' });
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'go' })).status, 400);
    } finally {
      await closeWs(cli);
    }
  });
});

test('observer ws handshake delivers sessions/sources/workflow snapshots so reconnected GUI restores lists', async () => {
  // 回归 P0-E：observer 重连后，左侧任务/来源列表必须能从 snapshot 恢复，
  // 否则只有增量事件抵达的客户端会显示空白。
  await withServer(async ({ port, token }) => {
    const session = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['run'],
      cliPid: 31001,
    });
    assert.equal(session.status, 200);
    const sessionId = session.body.id;

    const source = await request(port, token, 'POST', '/sources/register', {
      kind: 'cli',
      name: 'observer-snapshot-test',
    });
    assert.equal(source.status, 200);
    const sourceId = source.body.id;

    const { ws, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const sessionsSnap = await wait((m) => m.type === 'sessions-snapshot');
      const sourcesSnap = await wait((m) => m.type === 'sources-snapshot');
      const workflowSnap = await wait((m) => m.type === 'workflow-snapshot');

      assert.ok(Array.isArray(sessionsSnap.sessions));
      assert.ok(sessionsSnap.sessions.some((s) => s.id === sessionId));
      assert.ok(Array.isArray(sourcesSnap.sources));
      assert.ok(sourcesSnap.sources.some((s) => s.id === sourceId));
      assert.ok(workflowSnap.snapshot);
    } finally {
      await closeWs(ws);
    }
  });
});

test('/sessions/:id/exit rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    const registered = await request(port, token, 'POST', '/sessions', { command: 'codex', cliPid: 22003 });
    const sessionId = registered.body.id;

    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, {})).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 'bad' })).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 1.5 })).status, 400);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 0 })).status, 200);
  });
});

test('WebSocket observer receives workflow events and CLI socket receives injected input', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const sessionRegisteredPromise = waitForMessage(observer, (message) => message.type === 'session-registered');
      const registered = await request(port, token, 'POST', '/sessions', {
        command: 'codex',
        args: ['run'],
        cliPid: 12345,
      });
      const sessionId = registered.body.id;
      const registeredEvent = await sessionRegisteredPromise;
      assert.equal(registeredEvent.session.id, sessionId);

      const cli = await openWs(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=${sessionId}`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: 'Continue? (y/n)', options: ['yes', 'no'] });
        const injectPromise = waitForMessage(cli, (message) => message.type === 'inject-input' && message.sessionId === sessionId);
        const reply = await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'yes\n' });
        assert.equal(reply.status, 200);
        const injected = await injectPromise;
        assert.equal(injected.optionIndex, 0);
        assert.equal('text' in injected, false);
      } finally {
        await closeWs(cli);
      }
    } finally {
      await closeWs(observer);
    }
  });
});

test('multiple CLI sessions run in parallel without cross-talk', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const a = (await request(port, token, 'POST', '/sessions', { command: 'codex', args: ['a'], cliPid: 30001 })).body;
      const b = (await request(port, token, 'POST', '/sessions', { command: 'codex', args: ['b'], cliPid: 30002 })).body;
      assert.ok(a.id && b.id);
      assert.notEqual(a.id, b.id);

      const cliA = await openWs(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=${a.id}`, {
        protocols: tokenSubprotocol(token),
      });
      const cliB = await openWs(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=${b.id}`, {
        protocols: tokenSubprotocol(token),
      });

      try {
        // Reply 互不串扰：先在两端各注册一次 waiter，再交叉发 reply。
        const aInject = waitForMessage(cliA, (message) => message.type === 'inject-input');
        const bInject = waitForMessage(cliB, (message) => message.type === 'inject-input');
        await request(port, token, 'POST', `/sessions/${a.id}/prompt`, { lastLines: 'Pick one', options: ['from-A', 'other-A'] });
        await request(port, token, 'POST', `/sessions/${b.id}/prompt`, { lastLines: 'Pick one', options: ['other-B', 'from-B'] });
        assert.equal((await request(port, token, 'POST', `/sessions/${a.id}/reply`, { text: 'from-A\n' })).status, 200);
        assert.equal((await request(port, token, 'POST', `/sessions/${b.id}/reply`, { text: 'from-B\n' })).status, 200);
        const aGot = await aInject;
        const bGot = await bInject;
        assert.equal(aGot.sessionId, a.id);
        assert.equal(aGot.optionIndex, 0);
        assert.equal(bGot.sessionId, b.id);
        assert.equal(bGot.optionIndex, 1);

        // Output 不污染对方会话历史。
        await request(port, token, 'POST', `/sessions/${a.id}/output`, { chunk: 'output-A\n' });
        await request(port, token, 'POST', `/sessions/${b.id}/output`, { chunk: 'output-B\n' });
        const outA = (await request(port, token, 'GET', `/sessions/${a.id}/output`)).body;
        const outB = (await request(port, token, 'GET', `/sessions/${b.id}/output`)).body;
        assert.match(outA.fullOutput, /output-A/);
        assert.equal(outA.fullOutput.includes('output-B'), false, `session A leaked B output: ${outA.fullOutput}`);
        assert.match(outB.fullOutput, /output-B/);
        assert.equal(outB.fullOutput.includes('output-A'), false, `session B leaked A output: ${outB.fullOutput}`);

        // Exit 只影响目标会话。
        assert.equal((await request(port, token, 'POST', `/sessions/${a.id}/exit`, { exitCode: 0 })).status, 200);
        const list = (await request(port, token, 'GET', '/sessions')).body;
        const aInfo = list.find((s) => s.id === a.id);
        const bInfo = list.find((s) => s.id === b.id);
        assert.equal(aInfo.status, 'exited');
        assert.equal(aInfo.exitCode, 0);
        assert.notEqual(bInfo.status, 'exited');
      } finally {
        await closeWs(cliA);
        await closeWs(cliB);
      }
    } finally {
      await closeWs(observer);
    }
  });
});

test('WebSocket rejects connections without the token subprotocol', async () => {
  await withServer(async ({ port }) => {
    const result = await attemptWs(`ws://127.0.0.1:${port}/ws?role=observer`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

test('WebSocket rejects connections with an invalid token subprotocol', async () => {
  await withServer(async ({ port }) => {
    const result = await attemptWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol('not-the-real-token'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

test('WebSocket rejects legacy query-token auth without the token subprotocol', async () => {
  await withServer(async ({ port, token }) => {
    const result = await attemptWs(`ws://127.0.0.1:${port}/ws?role=observer&token=${encodeURIComponent(token)}`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

test('WebSocket rejects connections from a disallowed Origin', async () => {
  await withServer(async ({ port, token }) => {
    const result = await attemptWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
      origin: 'https://evil.example.com',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

test('CLI WebSocket closes when sessionId is missing or unknown', async () => {
  await withServer(async ({ port, token }) => {
    const missing = await wsCloseResult(`ws://127.0.0.1:${port}/ws?role=cli`, {
      protocols: tokenSubprotocol(token),
    });
    assert.equal(missing.code, 4400);
    assert.equal(missing.reason, 'missing sessionId');

    const unknown = await wsCloseResult(`ws://127.0.0.1:${port}/ws?role=cli&sessionId=missing-session`, {
      protocols: tokenSubprotocol(token),
    });
    assert.equal(unknown.code, 4404);
    assert.equal(unknown.reason, 'no such session');
  });
});

test('WebSocket accepts connections from the WebView2 virtual host Origin', async () => {
  await withServer(async ({ port, token }) => {
    const result = await attemptWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
      origin: 'https://codepanion.local',
    });
    assert.equal(result.ok, true);
  });
});

// ---------- P0.3 验收场景 ----------

test('VS Code 来源注册后事件链路完整可追溯', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const sourceRegisteredPromise = waitForMessage(observer, (m) => m.type === 'source-registered');
      const registered = await request(port, token, 'POST', '/sources/register', {
        kind: 'vscode',
        name: 'VS Code',
        windowTitle: 'workspace - VS Code',
        workspace: 'D:\\Projects\\sample',
        capabilities: ['events'],
        pid: 4242,
      });
      assert.equal(registered.status, 200);
      assert.equal(registered.body.kind, 'vscode');
      assert.equal(registered.body.status, 'online');
      assert.deepEqual(registered.body.capabilities, ['events']);

      const wsRegistered = await sourceRegisteredPromise;
      assert.equal(wsRegistered.source.id, registered.body.id);
      assert.equal(wsRegistered.source.kind, 'vscode');

      const sources = await request(port, token, 'GET', '/sources');
      assert.equal(sources.status, 200);
      const vscode = sources.body.find((s) => s.id === registered.body.id);
      assert.ok(vscode, '/sources should list the registered VS Code source');
      assert.equal(vscode.name, 'VS Code');
      assert.equal(vscode.workspace, 'D:\\Projects\\sample');

      const monitorEventPromise = waitForMessage(observer, (m) => m.type === 'monitor-event');
      const workflowEventPromise = waitForMessage(observer, (m) => m.type === 'workflow-event' && m.event.action === 'item-append');
      const eventResp = await request(port, token, 'POST', '/events', {
        type: 'activity',
        source: 'vscode',
        sourceId: registered.body.id,
        content: 'editor focused: src/index.ts',
        workspace: 'D:\\Projects\\sample',
      });
      assert.equal(eventResp.status, 200);
      const monitorEvent = await monitorEventPromise;
      assert.equal(monitorEvent.event.source, 'vscode');
      assert.equal(monitorEvent.event.content, 'editor focused: src/index.ts');

      const workflowEvent = await workflowEventPromise;
      assert.equal(workflowEvent.event.item.source, 'vscode');
      assert.equal(workflowEvent.event.item.kind, 'message');

      const threads = await request(port, token, 'GET', '/workflow/threads');
      assert.equal(threads.status, 200);
      const sourceThread = threads.body.find((t) => t.source === 'vscode');
      assert.ok(sourceThread, 'workflow should include a vscode source thread');
      assert.equal(sourceThread.workspace, 'D:\\Projects\\sample');
    } finally {
      await closeWs(observer);
    }
  });
});

test('VS Code 来源的 done / error 事件映射为 workflow status item', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const registered = await request(port, token, 'POST', '/sources/register', {
        kind: 'vscode',
        name: 'VS Code',
        windowTitle: 'sample - VS Code',
        workspace: 'sample',
        capabilities: ['window', 'tasks', 'terminals', 'debug'],
        pid: 4243,
      });
      assert.equal(registered.status, 200);
      const sourceId = registered.body.id;

      // 任务成功完成：type=done → workflow status item with status='done'.
      const donePromise = waitForMessage(
        observer,
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.source === 'vscode' &&
          m.event?.item?.kind === 'status' &&
          m.event?.item?.status === 'done',
      );
      const doneResp = await request(port, token, 'POST', '/events', {
        type: 'done',
        source: 'vscode',
        sourceId,
        title: '任务完成：build',
        content: '退出码：0',
        level: 'done',
        workspace: 'sample',
      });
      assert.equal(doneResp.status, 200);
      const doneEvt = await donePromise;
      assert.match(doneEvt.event.item.title, /任务完成/);

      // 任务失败：type=error → workflow status item with status='error'.
      const errorPromise = waitForMessage(
        observer,
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.source === 'vscode' &&
          m.event?.item?.kind === 'status' &&
          m.event?.item?.status === 'error',
      );
      const errorResp = await request(port, token, 'POST', '/events', {
        type: 'error',
        source: 'vscode',
        sourceId,
        title: '任务失败：test',
        content: '退出码：1',
        level: 'error',
        workspace: 'sample',
      });
      assert.equal(errorResp.status, 200);
      const errorEvt = await errorPromise;
      assert.match(errorEvt.event.item.title, /任务失败/);
    } finally {
      await closeWs(observer);
    }
  });
});

// P2.1：CLI/PTTY 非零退出必须映射成 workflow item status='error'，
// GUI 才能把这条任务挂到失败队列；之前所有用例都走 exitCode=0，error 分支零覆盖。
test('CLI 会话以非零退出码结束时 workflow 写入 status=error 的退出 item', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const registered = await request(port, token, 'POST', '/sessions', {
        command: 'npm',
        args: ['test'],
        cliPid: 50001,
      });
      assert.equal(registered.status, 200);
      const sessionId = registered.body.id;

      const errorExitPromise = waitForMessage(
        observer,
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.threadId === `session:${sessionId}` &&
          m.event?.item?.status === 'error',
      );

      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 1 })).status, 200);

      const exitEvt = await errorExitPromise;
      assert.equal(exitEvt.event.item.status, 'error');
      assert.match(exitEvt.event.item.content || '', /退出码：1/);

      const sessions = await request(port, token, 'GET', '/sessions');
      const info = sessions.body.find((s) => s.id === sessionId);
      assert.equal(info.status, 'exited');
      assert.equal(info.exitCode, 1);

      // 再确认 snapshot 里能找到 error 退出 item，GUI 重连重建时也能命中失败。
      const snapshot = await request(
        port,
        token,
        'GET',
        `/workflow/threads/${encodeURIComponent(`session:${sessionId}`)}`,
      );
      assert.equal(snapshot.status, 200);
      const errorItem = snapshot.body.items.find((it) => it.status === 'error');
      assert.ok(errorItem, 'snapshot 应保留非零退出的 error item');
      assert.match(errorItem.content || '', /退出码：1/);
    } finally {
      await closeWs(observer);
    }
  });
});

// P2.1：VS Code 来源在真实使用中会成对发"terminal 打开/关闭"和"调试开始/结束"事件，
// 这条用例覆盖了 extension.js 第 170-199 行的事件 → daemon 的端到端链路。
test('VS Code 来源的 terminal / debug 生命周期事件能被 daemon 接收并广播', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const registered = await request(port, token, 'POST', '/sources/register', {
        kind: 'vscode',
        name: 'VS Code',
        windowTitle: 'sample - VS Code',
        workspace: 'sample',
        capabilities: ['window', 'tasks', 'terminals', 'debug'],
        pid: 5101,
      });
      assert.equal(registered.status, 200);
      const sourceId = registered.body.id;

      // 终端打开 → activity。
      const termOpenPromise = waitForMessage(
        observer,
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          /^终端打开/.test(m.event?.item?.title || ''),
      );
      assert.equal((await request(port, token, 'POST', '/events', {
        type: 'activity',
        source: 'vscode',
        sourceId,
        title: '终端打开：pwsh',
        content: 'shellPath=pwsh',
        workspace: 'sample',
      })).status, 200);
      const termOpenEvt = await termOpenPromise;
      assert.equal(termOpenEvt.event.item.source, 'vscode');

      // 终端关闭 → activity。
      const termCloseResp = await request(port, token, 'POST', '/events', {
        type: 'activity',
        source: 'vscode',
        sourceId,
        title: '终端关闭：pwsh',
        content: 'shellPath=pwsh',
        workspace: 'sample',
      });
      assert.equal(termCloseResp.status, 200);

      // 调试开始 → activity；调试结束 → done。
      const debugDonePromise = waitForMessage(
        observer,
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.kind === 'status' &&
          m.event?.item?.status === 'done' &&
          /调试结束/.test(m.event?.item?.title || ''),
      );
      assert.equal((await request(port, token, 'POST', '/events', {
        type: 'activity',
        source: 'vscode',
        sourceId,
        title: '调试开始：jest',
        content: 'sessionId=dbg-1',
        workspace: 'sample',
      })).status, 200);
      assert.equal((await request(port, token, 'POST', '/events', {
        type: 'done',
        source: 'vscode',
        sourceId,
        title: '调试结束：jest',
        content: 'sessionId=dbg-1',
        level: 'done',
        workspace: 'sample',
      })).status, 200);
      const debugDoneEvt = await debugDonePromise;
      assert.equal(debugDoneEvt.event.item.status, 'done');

      const threads = await request(port, token, 'GET', '/workflow/threads');
      const vscodeThread = threads.body.find((t) => t.source === 'vscode');
      assert.ok(vscodeThread, 'workflow 应有一个 vscode thread 承载所有生命周期事件');
      assert.ok((vscodeThread.itemCount || 0) >= 4, '终端开/关 + 调试开/关共 4 条事件至少都要落到 vscode thread');
    } finally {
      await closeWs(observer);
    }
  });
});

test('中文文本在 HTTP 与 WebSocket 链路上全程不乱码', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const promptHeadline = '请确认是否继续？(是 / 否)';
      const outputChunk = '已读取文件：src/服务/账户.ts\n';
      const eventTitle = '中文事件标题🚀';
      const eventContent = '检测到中文混合 emoji：项目「示例工程」需要审阅 — 第①步';

      const registered = await request(port, token, 'POST', '/sessions', {
        command: 'codex',
        args: ['运行'],
        cwd: 'D:\\项目\\示例工程',
        cliPid: 40001,
      });
      assert.equal(registered.status, 200);
      const sessionId = registered.body.id;
      assert.equal(registered.body.args[0], '运行');
      assert.equal(registered.body.cwd, 'D:\\项目\\示例工程');

      const outputBroadcast = waitForMessage(observer, (m) => m.type === 'session-output' && m.sessionId === sessionId);
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/output`, { chunk: outputChunk })).status, 200);
      const broadcastedOutput = await outputBroadcast;
      assert.equal(broadcastedOutput.chunk, outputChunk);

      const promptBroadcast = waitForMessage(observer, (m) => m.type === 'session-prompt' && m.sessionId === sessionId);
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: promptHeadline, options: ['是', '否'] })).status, 200);
      const broadcastedPrompt = await promptBroadcast;
      assert.equal(broadcastedPrompt.lastLines, promptHeadline);
      assert.deepEqual(broadcastedPrompt.options, ['是', '否']);

      const output = await request(port, token, 'GET', `/sessions/${sessionId}/output`);
      assert.equal(output.status, 200);
      assert.equal(output.body.fullOutput, outputChunk);
      const lastChunk = output.body.chunks.at(-1);
      assert.equal(lastChunk.type, 'prompt');
      assert.equal(lastChunk.content, promptHeadline);

      const listed = await request(port, token, 'GET', '/sessions');
      const info = listed.body.find((s) => s.id === sessionId);
      assert.equal(info.lastPrompt, promptHeadline);
      assert.equal(info.cwd, 'D:\\项目\\示例工程');

      const eventBroadcast = waitForMessage(observer, (m) => m.type === 'monitor-event');
      const eventResp = await request(port, token, 'POST', '/events', {
        type: 'activity',
        title: eventTitle,
        content: eventContent,
      });
      assert.equal(eventResp.status, 200);
      assert.equal(eventResp.body.event.title, eventTitle);
      assert.equal(eventResp.body.event.content, eventContent);
      const broadcastedEvent = await eventBroadcast;
      assert.equal(broadcastedEvent.event.title, eventTitle);
      assert.equal(broadcastedEvent.event.content, eventContent);
    } finally {
      await closeWs(observer);
    }
  });
});

test('多个会话同时等待输入时各自保留 lastPrompt 且互不污染', async () => {
  await withServer(async ({ port, token }) => {
    const cases = [
      { args: ['flow-a'], pid: 50001, prompt: 'Apply patch to src/a.ts? (y/n)', options: ['y', 'n'] },
      { args: ['flow-b'], pid: 50002, prompt: '运行测试套件？(是 / 否)', options: ['是', '否'] },
      { args: ['flow-c'], pid: 50003, prompt: 'Select target environment:\n[1] dev  [2] staging  [3] prod', options: ['1', '2', '3'] },
    ];

    const sessionIds = [];
    for (const c of cases) {
      const r = await request(port, token, 'POST', '/sessions', { command: 'codex', args: c.args, cliPid: c.pid });
      assert.equal(r.status, 200);
      sessionIds.push(r.body.id);
    }

    for (let i = 0; i < cases.length; i += 1) {
      const r = await request(port, token, 'POST', `/sessions/${sessionIds[i]}/prompt`, {
        lastLines: cases[i].prompt,
        options: cases[i].options,
      });
      assert.equal(r.status, 200);
    }

    const listed = await request(port, token, 'GET', '/sessions');
    assert.equal(listed.status, 200);
    const byId = new Map(listed.body.map((s) => [s.id, s]));
    assert.equal(byId.size >= cases.length, true, `expected at least ${cases.length} sessions, got ${byId.size}`);

    for (let i = 0; i < cases.length; i += 1) {
      const info = byId.get(sessionIds[i]);
      assert.ok(info, `session ${i} missing from /sessions list`);
      assert.equal(info.status, 'waiting', `session ${i} should be waiting`);
      assert.equal(info.lastPrompt, cases[i].prompt, `session ${i} lastPrompt mismatch`);
    }

    // 任一会话的 prompt 不应泄露到其他会话的 output 历史。
    for (let i = 0; i < cases.length; i += 1) {
      const output = await request(port, token, 'GET', `/sessions/${sessionIds[i]}/output`);
      assert.equal(output.status, 200);
      const lastPromptChunk = output.body.chunks.findLast((c) => c.type === 'prompt');
      assert.ok(lastPromptChunk, `session ${i} should record its prompt`);
      assert.equal(lastPromptChunk.content, cases[i].prompt);
      for (let j = 0; j < cases.length; j += 1) {
        if (j === i) continue;
        assert.equal(
          output.body.chunks.some((c) => c.content === cases[j].prompt),
          false,
          `session ${i} leaked session ${j}'s prompt`,
        );
      }
    }
  });
});

test('observer 短暂中断后重连可从 workflow-snapshot 拿到断线期间的事件', async () => {
  // P1.3：覆盖客户端短暂中断后的恢复路径。daemon 不重启，
  // observer 断开 → 期间继续产生事件 → 重连后 hello+workflow-snapshot 必须包含全部最新状态。
  await withServer(async ({ port, token }) => {
    const sessionA = (await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['watch-a'],
      cliPid: 70001,
    })).body.id;

    // 第一次连接：拿到初始 snapshot，再观察一次实时事件，确认链路通。
    const first = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const initialSnapshot = await first.wait((m) => m.type === 'workflow-snapshot');
      assert.ok(
        initialSnapshot.snapshot.threads.find((t) => t.id === `session:${sessionA}`),
        '初始 snapshot 应包含已注册的 sessionA',
      );

      assert.equal(
        (await request(port, token, 'POST', `/sessions/${sessionA}/prompt`, { lastLines: '中断前的提示？' })).status,
        200,
      );
      await first.wait(
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.threadId === `session:${sessionA}` &&
          m.event?.item?.kind === 'prompt',
      );
    } finally {
      await closeWs(first.ws);
    }

    // 中断期间继续产生事件：新会话、原会话再发 prompt、原会话退出。
    const sessionB = (await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['offline-b'],
      cliPid: 70002,
    })).body.id;
    assert.equal(
      (await request(port, token, 'POST', `/sessions/${sessionA}/prompt`, { lastLines: '中断期间的提示？', options: ['是', '否'] })).status,
      200,
    );
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionA}/output`, { chunk: '断线期间的输出\n' })).status, 200);
    assert.equal((await request(port, token, 'POST', `/sessions/${sessionA}/exit`, { exitCode: 0 })).status, 200);

    // 重连：daemon 应当在握手后立即推 hello + workflow-snapshot，包含断线期间累积的所有事件。
    const second = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    try {
      const hello = await second.wait((m) => m.type === 'hello');
      assert.equal(typeof hello.version, 'string');

      const recovered = await second.wait((m) => m.type === 'workflow-snapshot');
      const threadIds = recovered.snapshot.threads.map((t) => t.id);
      assert.ok(threadIds.includes(`session:${sessionA}`), '重连 snapshot 应包含 sessionA');
      assert.ok(threadIds.includes(`session:${sessionB}`), '重连 snapshot 应包含断线期间新增的 sessionB');

      const aItems = recovered.snapshot.items.filter((it) => it.threadId === `session:${sessionA}`);
      assert.ok(
        aItems.some((it) => it.kind === 'prompt' && it.content.includes('中断前的提示')),
        '重连 snapshot 应保留断线前的 prompt',
      );
      assert.ok(
        aItems.some((it) => it.kind === 'prompt' && it.content.includes('中断期间的提示')),
        '重连 snapshot 应包含断线期间的 prompt',
      );
      assert.ok(
        aItems.some((it) => it.kind === 'command' && it.content === '断线期间的输出\n'),
        '重连 snapshot 应包含断线期间的输出 chunk',
      );
      assert.ok(
        aItems.some((it) => it.kind === 'status' && it.status === 'done'),
        '重连 snapshot 应反映断线期间发生的 exit',
      );

      // 重连后实时链路仍然正常：再发一个事件应立即收到。
      assert.equal(
        (await request(port, token, 'POST', `/sessions/${sessionB}/prompt`, { lastLines: '重连后的提示？' })).status,
        200,
      );
      await second.wait(
        (m) =>
          m.type === 'workflow-event' &&
          m.event?.action === 'item-append' &&
          m.event?.item?.threadId === `session:${sessionB}` &&
          m.event?.item?.kind === 'prompt',
      );
    } finally {
      await closeWs(second.ws);
    }
  });
});

test('daemon 重启后 workflow snapshot 恢复并通过 WS 推送给重连的 GUI', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'codepanion-snapshot-'));
  const snapshotPath = join(tmp, 'workflow-snapshot.json');
  try {
    let sessionThreadId;
    let sessionId;

    await withServerSnapshot(snapshotPath, async ({ port, token }) => {
      const registered = await request(port, token, 'POST', '/sessions', {
        command: 'codex',
        args: ['restart-test'],
        cliPid: 60001,
        cwd: 'D:\\项目\\restart',
      });
      assert.equal(registered.status, 200);
      sessionId = registered.body.id;
      sessionThreadId = `session:${sessionId}`;
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/prompt`, { lastLines: '确认继续？', options: ['是', '否'] })).status, 200);
      assert.equal((await request(port, token, 'POST', `/sessions/${sessionId}/exit`, { exitCode: 0 })).status, 200);

      const threads = await request(port, token, 'GET', '/workflow/threads');
      assert.equal(threads.status, 200);
      const restartThread = threads.body.find((t) => t.id === sessionThreadId);
      assert.ok(restartThread, 'workflow thread should exist before restart');
    });

    // 重启 daemon：用同一个 snapshot 路径打开新 server，确认状态恢复。
    await withServerSnapshot(snapshotPath, async ({ port, token }) => {
      const { ws: observer, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        const snapshotMessage = await wait((m) => m.type === 'workflow-snapshot');
        const restored = snapshotMessage.snapshot.threads.find((t) => t.id === sessionThreadId);
        assert.ok(restored, 'restored snapshot should include the session thread');
        // 恢复后未结束的线程会被标记为 paused；当前用例已 exit，应保持 done。
        assert.equal(restored.status, 'done');
        const restoredItems = snapshotMessage.snapshot.items.filter((it) => it.threadId === sessionThreadId);
        assert.ok(
          restoredItems.some((it) => it.kind === 'prompt' && it.content.includes('确认继续？')),
          'restored items should include the prompt content',
        );
        assert.ok(
          restoredItems.some((it) => it.kind === 'status' && it.status === 'done'),
          'restored items should include the exit status',
        );

        const threads = await request(port, token, 'GET', '/workflow/threads');
        assert.equal(threads.status, 200);
        assert.ok(threads.body.find((t) => t.id === sessionThreadId), 'GET /workflow/threads should also expose the restored thread');
      } finally {
        await closeWs(observer);
      }
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('workflow thread task-state updates persist and broadcast thread-upsert events', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    const sessionCreated = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['review'],
      cliPid: 65432,
      source: 'cli',
    });
    assert.equal(sessionCreated.status, 200);
    const sessionId = sessionCreated.body.id;
    const threadId = `session:${sessionId}`;

    try {
      const threadUpdated = observer.wait((m) =>
        m.type === 'workflow-event' &&
        m.event?.action === 'thread-upsert' &&
        m.event?.thread?.id === threadId &&
        m.event?.thread?.taskState?.pinned === true,
      );

      const updated = await request(
        port,
        token,
        'POST',
        `/workflow/threads/${encodeURIComponent(threadId)}/task-state`,
        { pinned: true, archived: true, snoozedUntil: 123456789, priority: 'high', sortOrder: 120, handoffStatus: 'pending', handoffTarget: 'codex', handoffSessionId: 'session-42' },
      );

      assert.equal(updated.status, 200);
      assert.equal(updated.body.taskState.pinned, true);
      assert.equal(updated.body.taskState.archived, true);
      assert.equal(updated.body.taskState.snoozedUntil, 123456789);
      assert.equal(updated.body.taskState.priority, 'high');
      assert.equal(updated.body.taskState.sortOrder, 120);
      assert.equal(updated.body.taskState.handoffStatus, 'pending');
      assert.equal(updated.body.taskState.handoffTarget, 'codex');
      assert.equal(updated.body.taskState.handoffSessionId, 'session-42');
      assert.ok(updated.body.taskState.updatedAt > 0);

      const wsEvent = await threadUpdated;
      assert.equal(wsEvent.event.thread.taskState.archived, true);
      assert.equal(wsEvent.event.thread.taskState.snoozedUntil, 123456789);
      assert.equal(wsEvent.event.thread.taskState.priority, 'high');
      assert.equal(wsEvent.event.thread.taskState.sortOrder, 120);
      assert.equal(wsEvent.event.thread.taskState.handoffStatus, 'pending');
      assert.equal(wsEvent.event.thread.taskState.handoffTarget, 'codex');
      assert.equal(wsEvent.event.thread.taskState.handoffSessionId, 'session-42');

      const thread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(threadId)}`);
      assert.equal(thread.status, 200);
      assert.equal(thread.body.threads[0].taskState.pinned, true);
      assert.equal(thread.body.threads[0].taskState.archived, true);
      assert.equal(thread.body.threads[0].taskState.snoozedUntil, 123456789);
      assert.equal(thread.body.threads[0].taskState.priority, 'high');
      assert.equal(thread.body.threads[0].taskState.sortOrder, 120);
      assert.equal(thread.body.threads[0].taskState.handoffStatus, 'pending');
      assert.equal(thread.body.threads[0].taskState.handoffTarget, 'codex');
      assert.equal(thread.body.threads[0].taskState.handoffSessionId, 'session-42');
    } finally {
      await closeWs(observer.ws);
    }
  });
});

test('workflow handoff launch endpoint updates the origin thread and returns launch metadata', async () => {
  const launchCalls = [];
  await withServer(async ({ port, token }) => {
    const sessionCreated = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['review'],
      cliPid: 65434,
      source: 'cli',
      workspace: 'D:\\repo-a',
    });
    assert.equal(sessionCreated.status, 200);
    const threadId = `session:${sessionCreated.body.id}`;

    const launched = await request(
      port,
      token,
      'POST',
      `/workflow/threads/${encodeURIComponent(threadId)}/handoff`,
      {
        target: 'codex',
        prompt: '请继续处理这个任务。',
        preview: 'handoff preview',
      },
    );

    assert.equal(launched.status, 200);
    assert.equal(launched.body.ok, true);
    assert.equal(launched.body.threadId, threadId);
    assert.equal(launched.body.sessionId, 'handoff-session-1');
    assert.equal(launched.body.target, 'codex');
    assert.equal(launched.body.launchMode, 'tool');
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].originThread.id, threadId);
    assert.equal(launchCalls[0].target, 'codex');
    assert.equal(launchCalls[0].prompt, '请继续处理这个任务。');

    const thread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(threadId)}`);
    assert.equal(thread.status, 200);
    assert.equal(thread.body.threads[0].taskState.handoffStatus, 'active');
    assert.equal(thread.body.threads[0].taskState.handoffTarget, 'codex');
    assert.equal(thread.body.threads[0].taskState.handoffSessionId, 'handoff-session-1');
    assert.ok(thread.body.items.some((item) => item.title === '任务已转交'));
  }, {
    launchHandoffSession: async (request) => {
      launchCalls.push(request);
      return {
        ok: true,
        threadId: request.originThread.id,
        sessionId: 'handoff-session-1',
        target: request.target,
        launchMode: 'tool',
        command: 'codex',
        args: [],
      };
    },
  });
});

test('handoff child session exit returns responsibility to the parent thread', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    const parentCreated = await request(port, token, 'POST', '/sessions', {
      command: 'claude',
      args: ['fix'],
      cliPid: 65435,
      source: 'cli',
    });
    assert.equal(parentCreated.status, 200);
    const parentThreadId = `session:${parentCreated.body.id}`;
    await request(port, token, 'POST', `/workflow/threads/${encodeURIComponent(parentThreadId)}/task-state`, {
      handoffStatus: 'active',
      handoffTarget: 'claude-code',
      handoffSessionId: 'handoff-child-1',
    });

    try {
      const returnedEvent = observer.wait((m) =>
        m.type === 'workflow-event' &&
        m.event?.action === 'thread-upsert' &&
        m.event?.thread?.id === parentThreadId &&
        m.event?.thread?.taskState?.handoffStatus === 'returned',
      2000);

      const registeredChild = await request(port, token, 'POST', '/sessions', {
        id: 'handoff-child-1',
        command: 'codex',
        args: [],
        cliPid: 65436,
        source: 'codex',
        windowTitle: 'Codex · parent',
        parentThreadId,
      });
      assert.equal(registeredChild.status, 200);

      const exited = await request(port, token, 'POST', '/sessions/handoff-child-1/exit', { exitCode: 0 });
      assert.equal(exited.status, 200);

      await returnedEvent;

      const parentThread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(parentThreadId)}`);
      assert.equal(parentThread.status, 200);
      assert.equal(parentThread.body.threads[0].status, 'waiting');
      assert.equal(parentThread.body.threads[0].taskState.handoffStatus, 'returned');
      assert.equal(parentThread.body.threads[0].taskState.handoffSessionId, 'handoff-child-1');
      assert.ok(parentThread.body.items.some((item) => item.title === '接力结果待审阅'));
    } finally {
      await closeWs(observer.ws);
    }
  });
});

test('failed handoff child session returns the parent thread to error state', async () => {
  await withServer(async ({ port, token }) => {
    const parentCreated = await request(port, token, 'POST', '/sessions', {
      command: 'claude',
      args: ['fix'],
      cliPid: 65439,
      source: 'cli',
    });
    assert.equal(parentCreated.status, 200);
    const parentThreadId = `session:${parentCreated.body.id}`;
    await request(port, token, 'POST', `/workflow/threads/${encodeURIComponent(parentThreadId)}/task-state`, {
      handoffStatus: 'active',
      handoffTarget: 'codex',
      handoffSessionId: 'handoff-child-failed',
    });

    const childCreated = await request(port, token, 'POST', '/sessions', {
      id: 'handoff-child-failed',
      command: 'codex',
      args: ['--continue'],
      cliPid: 65442,
      source: 'codex',
      windowTitle: 'Codex · failed child',
      parentThreadId,
    });
    assert.equal(childCreated.status, 200);

    await request(port, token, 'POST', '/sessions/handoff-child-failed/output', {
      chunk: 'Build failed: missing APPDATA configuration.\n',
    });
    const exited = await request(port, token, 'POST', '/sessions/handoff-child-failed/exit', { exitCode: 17 });
    assert.equal(exited.status, 200);

    const parentThread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(parentThreadId)}`);
    assert.equal(parentThread.status, 200);
    assert.equal(parentThread.body.threads[0].status, 'error');
    assert.equal(parentThread.body.threads[0].taskState.handoffStatus, 'returned');
    assert.ok(parentThread.body.items.some((item) => item.title === '转交会话异常回流'));
    const summaryItem = parentThread.body.items.find((item) =>
      item.threadId === parentThreadId
      && item.kind === 'message'
      && item.source === 'codepanion'
      && /接力结果摘要/.test(item.content || ''),
    );
    assert.ok(summaryItem);
    assert.match(summaryItem.content, /- 回流结论：失败待处理/);
    assert.match(summaryItem.content, /- 结果：失败/);
    assert.match(summaryItem.content, /- 人工处理：需要/);
    assert.match(summaryItem.content, /- 问题类型：配置问题/);
    assert.match(summaryItem.content, /- 建议重试：是/);
    assert.match(summaryItem.content, /- 处理建议：检查 APPDATA 或相关环境变量配置后再重试/);
    assert.match(summaryItem.content, /- 后续动作：查看失败摘要并决定是否重试/);
  });
});

test('handoff child session exit appends a visible summary message back to the parent thread', async () => {
  await withServer(async ({ port, token }) => {
    const parentCreated = await request(port, token, 'POST', '/sessions', {
      command: 'claude',
      args: ['fix'],
      cliPid: 65440,
      source: 'cli',
    });
    assert.equal(parentCreated.status, 200);
    const parentThreadId = `session:${parentCreated.body.id}`;
    await request(port, token, 'POST', `/workflow/threads/${encodeURIComponent(parentThreadId)}/task-state`, {
      handoffStatus: 'active',
      handoffTarget: 'codex',
      handoffSessionId: 'handoff-child-summary',
    });

    const childCreated = await request(port, token, 'POST', '/sessions', {
      id: 'handoff-child-summary',
      command: 'codex',
      args: ['--continue'],
      cliPid: 65441,
      source: 'codex',
      windowTitle: 'Codex · summary child',
      parentThreadId,
    });
    assert.equal(childCreated.status, 200);

    await request(port, token, 'POST', '/sessions/handoff-child-summary/output', {
      chunk: 'Running tests...\n',
    });
    await request(port, token, 'POST', '/sessions/handoff-child-summary/output', {
      chunk: 'Updated packages/gui/wwwroot/chat.js and scripts/package-windows.ps1.\n',
    });
    const exited = await request(port, token, 'POST', '/sessions/handoff-child-summary/exit', { exitCode: 0 });
    assert.equal(exited.status, 200);

    const parentThread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(parentThreadId)}`);
    assert.equal(parentThread.status, 200);

    const summaryItem = parentThread.body.items.find((item) =>
      item.threadId === parentThreadId
      && item.kind === 'message'
      && item.source === 'codepanion'
      && /接力结果摘要/.test(item.content || ''),
    );

    assert.ok(summaryItem, 'parent thread should receive a visible handoff summary message');
    assert.match(summaryItem.content, /- 工具：Codex/);
    assert.match(summaryItem.content, /- 会话：Codex · summary child/);
    assert.match(summaryItem.content, /- 回流结论：待审阅/);
    assert.match(summaryItem.content, /- 结果：成功/);
    assert.match(summaryItem.content, /- 人工处理：建议/);
    assert.match(summaryItem.content, /- 退出码：0/);
    assert.match(summaryItem.content, /- 建议重试：否/);
    assert.match(summaryItem.content, /- 处理建议：先审阅涉及文件与最近进展，再决定是否继续处理/);
    assert.match(summaryItem.content, /- 后续动作：审阅接力结果并决定下一步/);
    assert.match(summaryItem.content, /## 涉及文件/);
    assert.match(summaryItem.content, /packages\/gui\/wwwroot\/chat\.js/);
    assert.match(summaryItem.content, /scripts\/package-windows\.ps1/);
    assert.match(summaryItem.content, /## 最近进展/);
    assert.match(summaryItem.content, /Updated packages\/gui\/wwwroot\/chat\.js and scripts\/package-windows\.ps1/);
  });
});

test('snoozed workflow task returns to the active queue and broadcasts a reminder when due', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
      protocols: tokenSubprotocol(token),
    });
    const sessionCreated = await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['review'],
      cliPid: 65433,
      source: 'cli',
    });
    assert.equal(sessionCreated.status, 200);
    const threadId = `session:${sessionCreated.body.id}`;
    const dueAt = Date.now() + 80;

    try {
      const reminderEvent = observer.wait((m) =>
        m.type === 'notification' &&
        m.data?.source === 'codepanion' &&
        m.data?.threadId === threadId &&
        /稍后任务/.test(m.data?.title || ''),
      2000);
      const unsnoozedThread = observer.wait((m) =>
        m.type === 'workflow-event' &&
        m.event?.action === 'thread-upsert' &&
        m.event?.thread?.id === threadId &&
        (m.event?.thread?.taskState?.snoozedUntil ?? null) === null,
      2000);

      const updated = await request(
        port,
        token,
        'POST',
        `/workflow/threads/${encodeURIComponent(threadId)}/task-state`,
        { snoozedUntil: dueAt },
      );
      assert.equal(updated.status, 200);
      assert.equal(updated.body.taskState.snoozedUntil, dueAt);

      const reminder = await reminderEvent;
      assert.match(reminder.data.title, /稍后任务/);
      assert.equal(reminder.data.threadId, threadId);

      const wsEvent = await unsnoozedThread;
      assert.equal(wsEvent.event.thread.taskState.snoozedUntil, null);

      const thread = await request(port, token, 'GET', `/workflow/threads/${encodeURIComponent(threadId)}`);
      assert.equal(thread.status, 200);
      assert.equal(thread.body.threads[0].taskState.snoozedUntil, null);
    } finally {
      await closeWs(observer.ws);
    }
  });
});

test('W-32 retry 后 gate 仍保留并附 lastDecision，approve/reject 才会清掉', async () => {
  const {
    WorkflowRunHistory,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-retry-gate-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    const runId = 'run-retry-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'retryable',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [{
        id: 'plan',
        tool: 'local',
        role: 'planner',
        artifacts: ['human-decision'],
        status: 'checkpoint',
        command: 'noop',
        args: [],
        message: 'manual',
      }],
    });

    await withServer(async ({ port, token }) => {
      const retried = await request(port, token, 'POST', `/workflow/gates/${runId}/plan/resolve`, {
        decision: 'retry',
        message: '再补一份风险评估',
      });
      assert.equal(retried.status, 200);
      assert.equal(retried.body.resumed, undefined);

      // retry 后 gate 必须仍在，并带 lastDecision = retry。
      const afterRetry = await request(port, token, 'GET', '/workflow/gates');
      const gate = afterRetry.body.gates.find((g) => g.runId === runId);
      assert.ok(gate, 'retry 后 gate 必须仍可见');
      assert.equal(gate.lastDecision?.decision, 'retry');
      assert.match(gate.lastDecision.content, /再补一份风险评估/);

      // 第二轮 approve 应清掉 gate（不能因为之前有 retry 就一直挂着）。
      const approved = await request(port, token, 'POST', `/workflow/gates/${runId}/plan/resolve`, {
        decision: 'approve',
      });
      assert.equal(approved.status, 200);
      const afterApprove = await request(port, token, 'GET', '/workflow/gates');
      assert.equal(afterApprove.body.gates.some((g) => g.runId === runId), false);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32 reject 后 GET /workflow/gates 与 /workflow/board 都不再列出该 run', async () => {
  const {
    WorkflowRunHistory,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-reject-clean-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    const runId = 'run-reject-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'rejectable',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [{
        id: 'review',
        tool: 'local',
        role: 'reviewer',
        artifacts: ['human-decision'],
        status: 'checkpoint',
        command: 'noop',
        args: [],
        message: 'manual',
      }],
    });

    await withServer(async ({ port, token }) => {
      const before = await request(port, token, 'GET', '/workflow/gates');
      assert.equal(before.body.gates.some((g) => g.runId === runId), true);

      const rejected = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
        decision: 'reject',
        message: '方向不对',
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body.artifact.type, 'human-decision');
      assert.equal(rejected.body.resumed, undefined);

      const afterGates = await request(port, token, 'GET', '/workflow/gates');
      assert.equal(afterGates.body.gates.some((g) => g.runId === runId), false);

      const board = await request(port, token, 'GET', '/workflow/board');
      assert.equal(board.body.gates.some((g) => g.runId === runId), false);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace 隔离: 不同 workspace 的 board 互不可见，artifacts 各自落到 <workspace>/.codepanion/', async () => {
  const {
    WorkflowDefinitionManager,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const { existsSync } = await import('node:fs');
  // 全局 fallback 路径用一个隔离的 tmp，避免 workspace test 把数据落到真实 HOME_DIR。
  const fallbackDir = mkdtempSync(join(tmpdir(), 'codepanion-fallback-'));
  const wsA = mkdtempSync(join(tmpdir(), 'codepanion-ws-a-'));
  const wsB = mkdtempSync(join(tmpdir(), 'codepanion-ws-b-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(fallbackDir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(fallbackDir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(fallbackDir, 'artifacts.ndjson');
  try {
    // 两个 workspace 各自的 .codepanion/workflows.json 里加同名 workflow，但 steps 不同。
    const defsA = new WorkflowDefinitionManager(join(wsA, '.codepanion', 'workflows.json'));
    defsA.save({ name: 'demo', steps: parseWorkflowSteps(['id=plan;tool=node;command=node;args=--version']) });
    const defsB = new WorkflowDefinitionManager(join(wsB, '.codepanion', 'workflows.json'));
    defsB.save({ name: 'demo', steps: parseWorkflowSteps(['id=plan;tool=node;command=node;args=--version']) });

    await withServer(async ({ port, token }) => {
      // 启动 A workspace 的 demo run。
      const startedA = await request(port, token, 'POST', '/workflow/runs', {
        workflow: 'demo',
        workspace: wsA,
      });
      assert.equal(startedA.status, 200);
      // 等 A 落历史。
      const deadlineA = Date.now() + 5000;
      let boardA;
      while (Date.now() < deadlineA) {
        boardA = await request(port, token, 'GET', `/workflow/board?workspace=${encodeURIComponent(wsA)}`);
        if (boardA.body.runs.some((r) => r.status === 'success')) break;
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.ok(boardA.body.runs.some((r) => r.status === 'success'));

      // B workspace 的 board 不该看到 A 的 run。
      const boardB = await request(port, token, 'GET', `/workflow/board?workspace=${encodeURIComponent(wsB)}`);
      assert.equal(boardB.body.runs.length, 0, 'B workspace 不该看到 A 的 run');
      // B 的 definitions 应仍可见。
      assert.equal(boardB.body.workflows.some((w) => w.name === 'demo'), true);

      // fallback（不传 workspace）的 board 也不该看到 A / B 任何 run（因为各自走 workspace 路径）。
      const boardFallback = await request(port, token, 'GET', '/workflow/board');
      assert.equal(boardFallback.body.runs.length, 0);

      // artifact 应落在 A workspace 下，不该落在 B 或 fallback。
      assert.ok(existsSync(join(wsA, '.codepanion', 'workflow-artifacts.ndjson')));
      assert.equal(existsSync(join(wsB, '.codepanion', 'workflow-artifacts.ndjson')), false);
      assert.equal(existsSync(join(fallbackDir, 'artifacts.ndjson')), false);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(fallbackDir, { recursive: true, force: true });
    rmSync(wsA, { recursive: true, force: true });
    rmSync(wsB, { recursive: true, force: true });
  }
});

test('cancel: POST /workflow/runs/:runId/cancel 中止正在跑的 step，WS 收到 run-finish=failed', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-cancel-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    // 写一个跨平台 sleeper 脚本到 tmp dir：30s 死循环，给 cancel 充足窗口。
    const sleeperPath = join(dir, 'sleeper.cjs');
    writeFileSync(sleeperPath, 'setInterval(() => {}, 30000);', 'utf8');

    new WorkflowDefinitionManager().save({
      name: 'long-runner',
      steps: parseWorkflowSteps([
        // tool=node 让 splitList 看到单一 arg；sleeperPath 单一字符串无逗号。
        `id=sleep;role=builder;tool=node;command=node;args=${sleeperPath}`,
      ]),
    });

    await withServer(async ({ port, token }) => {
      const { ws, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        const started = await request(port, token, 'POST', '/workflow/runs', {
          workflow: 'long-runner',
        });
        assert.equal(started.status, 200);

        const runStart = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-start' && m.event?.workflowName === 'long-runner',
          5000,
        );
        const runId = runStart.event.runId;

        // 等 step-start 到达再 cancel，确保 child 已经 spawn。
        await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'step-start' && m.event?.runId === runId,
          5000,
        );

        const cancelled = await request(port, token, 'POST', `/workflow/runs/${runId}/cancel`, {});
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.cancelled, true);

        const runFinish = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-finish' && m.event?.runId === runId,
          10000,
        );
        assert.equal(runFinish.event.status, 'failed');

        // run-finish 触达 GUI 后 daemon 仍在跑 .then(append) → activeRuns.delete。
        // 轮询 history 看到 failed run 已落盘，且 cancel 再点会 404。
        const deadline = Date.now() + 5000;
        let stored;
        while (Date.now() < deadline) {
          stored = new WorkflowRunHistory().get(runId);
          if (stored && stored.status === 'failed') break;
          await new Promise((r) => setTimeout(r, 60));
        }
        assert.ok(stored, 'cancelled run 必须落入历史');
        assert.equal(stored.status, 'failed');
        const cancelStep = stored.steps.find((step) => step.id === 'sleep');
        assert.ok(cancelStep);
        assert.match(cancelStep.message ?? '', /cancelled/);

        const reCancel = await request(port, token, 'POST', `/workflow/runs/${runId}/cancel`, {});
        assert.equal(reCancel.status, 404);
      } finally {
        await closeWs(ws);
      }
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-23: board 在 run 进行中暴露 running 状态，完成后切到 success 不重复', async () => {
  const {
    WorkflowDefinitionManager,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-board-running-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    new WorkflowDefinitionManager().save({
      name: 'board-running',
      steps: parseWorkflowSteps([
        'id=plan;role=planner;tool=node;command=node;args=--version',
      ]),
    });

    await withServer(async ({ port, token }) => {
      const { ws, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        const started = await request(port, token, 'POST', '/workflow/runs', {
          workflow: 'board-running',
        });
        assert.equal(started.status, 200);

        // 等 run-start 事件——此时 activeRuns 已入表但 history 还没写。
        const runStart = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-start' && m.event?.workflowName === 'board-running',
          5000,
        );
        const runId = runStart.event.runId;

        // 进行中：board 必须暴露 running 状态条目。
        const boardRunning = await request(port, token, 'GET', '/workflow/board');
        const runningEntry = boardRunning.body.runs.find((r) => r.id === runId);
        assert.ok(runningEntry, 'board 应包含 running run 条目');
        assert.equal(runningEntry.status, 'running');

        // 等 run-finish，再轮询 board 直到 active 已清除、history 已含 success。
        await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-finish' && m.event?.runId === runId,
          5000,
        );
        const deadline = Date.now() + 5000;
        let finalBoard;
        while (Date.now() < deadline) {
          finalBoard = await request(port, token, 'GET', '/workflow/board');
          const entries = finalBoard.body.runs.filter((r) => r.id === runId);
          if (entries.length === 1 && entries[0].status === 'success') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const finalEntries = finalBoard.body.runs.filter((r) => r.id === runId);
        assert.equal(finalEntries.length, 1, '同一 runId 不应在 board 里重复');
        assert.equal(finalEntries[0].status, 'success');
      } finally {
        await closeWs(ws);
      }
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-22: POST /workflow/runs 启动 workflow，WS observer 收到 run-start/run-finish', async () => {
  const {
    WorkflowDefinitionManager,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-runs-start-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    new WorkflowDefinitionManager().save({
      name: 'start-from-zero',
      steps: parseWorkflowSteps([
        'id=plan;role=planner;tool=node;command=node;args=--version',
      ]),
    });

    await withServer(async ({ port, token }) => {
      const { ws, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        const started = await request(port, token, 'POST', '/workflow/runs', {
          workflow: 'start-from-zero',
        });
        assert.equal(started.status, 200);
        assert.equal(started.body.accepted, true);
        assert.equal(started.body.workflowName, 'start-from-zero');

        const runStart = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-start' && m.event?.workflowName === 'start-from-zero',
          5000,
        );
        const newRunId = runStart.event.runId;
        const runFinish = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-finish' && m.event?.runId === newRunId,
          5000,
        );
        assert.equal(runFinish.event.status, 'success');

        // 不存在的 workflow 应 404，非法 schema 应 400。
        const missing = await request(port, token, 'POST', '/workflow/runs', { workflow: 'nope' });
        assert.equal(missing.status, 404);
        const bad = await request(port, token, 'POST', '/workflow/runs', { workflow: '' });
        assert.equal(bad.status, 400);
      } finally {
        await closeWs(ws);
      }
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32 approve 触发 daemon 续跑，观察者通过 WS 收到 workflow-run-event 流', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-resume-ws-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    new WorkflowDefinitionManager().save({
      name: 'resume-ws',
      steps: parseWorkflowSteps([
        'id=review;role=reviewer;tool=node;command=node;args=--version;checkpoint=true',
        'id=publish;role=builder;tool=node;command=node;args=--version;artifacts=delivery-note;after=review',
      ]),
    });
    const runId = 'run-ws-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'resume-ws',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      steps: [{
        id: 'review',
        tool: 'node',
        role: 'reviewer',
        artifacts: [],
        status: 'checkpoint',
        command: 'node',
        args: ['--version'],
        message: 'manual checkpoint required',
      }],
    });

    await withServer(async ({ port, token }) => {
      const { ws, wait } = await openWsBuffered(`ws://127.0.0.1:${port}/ws?role=observer`, {
        protocols: tokenSubprotocol(token),
      });
      try {
        const resolved = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
          decision: 'approve',
        });
        assert.equal(resolved.status, 200);
        assert.equal(resolved.body.resumed, true);

        // Codex P1 修复后续跑复用原 runId，不再创建新 run。run-start 事件带的就是原 runId。
        const runStart = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-start' && m.event?.workflowName === 'resume-ws',
          5000,
        );
        assert.equal(runStart.event.runId, runId);

        const stepFinish = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'step-finish' && m.event?.runId === runId && m.event?.stepId === 'publish',
          5000,
        );
        assert.equal(stepFinish.event.status, 'success');

        const runFinish = await wait(
          (m) => m.type === 'workflow-run-event' && m.event?.action === 'run-finish' && m.event?.runId === runId,
          5000,
        );
        assert.equal(runFinish.event.status, 'success');
        assert.equal(runFinish.event.stepCount >= 1, true);
      } finally {
        await closeWs(ws);
      }
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-31 daemon executor 落 stdout/stderr 到 stepRun.output，delivery-note 带 preview', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    WorkflowArtifactStore,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-stepout-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    // 用 `node -e` 在 stdout / stderr 都写一段确定字符串，方便断言 stepRun.output 是否真的捕获到。
    // 同时验证 delivery-note 里把 stdout/stderr 都摘进 ## Step output preview 区。
    // parseWorkflowSteps 用 ; 分字段，inline node JS 会撞分隔符；改成直接构造 step 描述更直接。
    new WorkflowDefinitionManager().save({
      name: 'stepout-target',
      steps: [{
        id: 'probe',
        role: 'builder',
        tool: 'node',
        provider: 'local',
        permissions: [],
        contextPolicy: {},
        artifacts: ['patch-summary'],
        command: 'node',
        args: ['-e', "process.stdout.write('CP_OUT_OK\\n');process.stderr.write('CP_ERR_OK\\n');"],
        values: {},
        dependsOn: [],
        checkpoint: false,
      }],
    });

    await withServer(async ({ port, token }) => {
      const start = await request(port, token, 'POST', '/workflow/runs', { workflow: 'stepout-target' });
      assert.equal(start.status, 200);
      const deadline = Date.now() + 5000;
      let finished;
      while (Date.now() < deadline) {
        const runs = new WorkflowRunHistory().list();
        finished = runs.find((entry) => entry.workflowName === 'stepout-target' && entry.status !== 'paused');
        if (finished && finished.status === 'success') break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.ok(finished, 'daemon executor 应当跑完 stepout-target');
      assert.equal(finished.status, 'success');
      const probeStep = finished.steps.find((s) => s.id === 'probe');
      assert.ok(probeStep, '应当能在 finished.steps 找到 probe');
      assert.ok(probeStep.output, 'stepRun.output 应当被 daemon executor 落进 run 历史');
      assert.match(probeStep.output.stdout, /CP_OUT_OK/, 'stepRun.output.stdout 应当包含 stdout 真实输出');
      assert.match(probeStep.output.stderr, /CP_ERR_OK/, 'stepRun.output.stderr 应当包含 stderr 真实输出');
      assert.equal(probeStep.output.truncated, false);

      // delivery-note 必须把 step 输出摘要带上，方便复制给外部 AI 时一眼看到上一轮 provider 返回了什么。
      const note = new WorkflowArtifactStore().list(finished.id).find((a) => a.type === 'delivery-note');
      assert.ok(note, '应当有 delivery-note artifact');
      assert.match(note.content, /## Step output preview/);
      assert.match(note.content, /CP_OUT_OK/);
      assert.match(note.content, /CP_ERR_OK/);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32 approve 在原 runId 上从 checkpoint 续跑同 workflow，落 delivery-note', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    WorkflowArtifactStore,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-resume-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    // 准备一份 workflow definition：续跑时 daemon 会用 yes:true 走 checkpoint 之后的步骤。
    // 用 node --version 做真实 PTY 命令，跨平台稳定退出。
    const definitions = new WorkflowDefinitionManager();
    definitions.save({
      name: 'resume-target',
      steps: parseWorkflowSteps([
        'id=review;role=reviewer;tool=node;command=node;args=--version;artifacts=human-decision;checkpoint=true',
        'id=publish;role=builder;tool=node;command=node;args=--version;artifacts=delivery-note;after=review',
      ]),
    });
    // 准备一条停在 review 的 paused 历史 run。
    const runId = 'run-resume-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'resume-target',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      steps: [
        {
          id: 'review',
          tool: 'node',
          role: 'reviewer',
          artifacts: ['human-decision'],
          status: 'checkpoint',
          command: 'node',
          args: ['--version'],
          message: 'manual checkpoint required',
        },
      ],
    });

    await withServer(async ({ port, token }) => {
      const resolved = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
        decision: 'approve',
      });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.body.resumed, true);
      assert.equal(resolved.body.artifact.type, 'human-decision');

      // 续跑复用原 runId（Codex P1 修复）：从 checkpoint 之后开始跑，前面的 success step 不重跑。
      // history 写入时 WorkflowRunHistory.append 会用同 id 覆盖原 paused 条目。
      const deadline = Date.now() + 5000;
      let resumed;
      while (Date.now() < deadline) {
        const runs = new WorkflowRunHistory().list();
        resumed = runs.find((entry) => entry.id === runId);
        if (resumed && resumed.status !== 'paused') break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.ok(resumed, '续跑应当覆盖原 paused 历史条目');
      assert.equal(resumed.status, 'success', `续跑应当成功，实际 status=${resumed?.status}`);
      // delivery-note 由 runWorkflow 自动落到同一 runId 上。
      const store = new WorkflowArtifactStore();
      const allArtifacts = store.list(runId);
      assert.ok(allArtifacts.some((entry) => entry.type === 'delivery-note'));
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32 retry 回到 checkpoint 前最近一个真正执行过的 step 重跑', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-retry-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    // 三步 workflow：build 真正执行，review 是 checkpoint，publish 续跑后再跑。
    // 历史里 build 已经成功，停在 review checkpoint，用户决定 retry → build 应当被重跑一次。
    new WorkflowDefinitionManager().save({
      name: 'retry-target',
      steps: parseWorkflowSteps([
        'id=build;role=builder;tool=node;command=node;args=--version',
        'id=review;role=reviewer;tool=node;command=node;args=--version;artifacts=human-decision;checkpoint=true;after=build',
        'id=publish;role=builder;tool=node;command=node;args=--version;artifacts=delivery-note;after=review',
      ]),
    });
    const runId = 'run-retry-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'retry-target',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      steps: [
        {
          id: 'build',
          tool: 'node',
          role: 'builder',
          artifacts: [],
          status: 'success',
          command: 'node',
          args: ['--version'],
          exitCode: 0,
        },
        {
          id: 'review',
          tool: 'node',
          role: 'reviewer',
          artifacts: ['human-decision'],
          status: 'checkpoint',
          command: 'node',
          args: ['--version'],
          message: 'manual checkpoint required',
        },
      ],
    });

    await withServer(async ({ port, token }) => {
      const resolved = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
        decision: 'retry',
      });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.body.resumed, true);
      // 关键断言：retry 把 resume 目标指向 checkpoint 前最近一个 success step（build），不是 checkpoint 本身。
      assert.equal(resolved.body.resumeStepId, 'build');

      // 等续跑完成（覆盖原 runId 历史条目）。
      const deadline = Date.now() + 5000;
      let resumed;
      while (Date.now() < deadline) {
        const runs = new WorkflowRunHistory().list();
        resumed = runs.find((entry) => entry.id === runId);
        if (resumed && resumed.status !== 'paused') break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.ok(resumed, '续跑应当覆盖原 paused 历史条目');
      assert.equal(resumed.status, 'success', `retry 续跑应当成功，实际 status=${resumed?.status}`);
      const buildEntries = resumed.steps.filter((s) => s.id === 'build');
      assert.equal(buildEntries.length, 1, 'build 在 retry 续跑中应当且只重跑一次');
      assert.equal(buildEntries[0].status, 'success');
      const publishEntries = resumed.steps.filter((s) => s.id === 'publish');
      assert.equal(publishEntries.length, 1, 'publish 应当在 retry 续跑里跑过');
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32 constraints 经 gate 决策注入 resumed run 的 values', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-gate-constraints-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    new WorkflowDefinitionManager().save({
      name: 'constraints-target',
      steps: parseWorkflowSteps([
        'id=review;role=reviewer;tool=node;command=node;args=--version;artifacts=human-decision;checkpoint=true',
        'id=publish;role=builder;tool=node;command=node;args=--version;artifacts=delivery-note;after=review',
      ]),
    });
    const runId = 'run-constraints-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'constraints-target',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      steps: [{
        id: 'review',
        tool: 'node',
        role: 'reviewer',
        artifacts: ['human-decision'],
        status: 'checkpoint',
        command: 'node',
        args: ['--version'],
        message: 'manual checkpoint required',
      }],
    });

    await withServer(async ({ port, token }) => {
      const resolved = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
        decision: 'approve',
        constraints: ['use TypeScript', 'no external deps'],
      });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.body.resumed, true);

      const deadline = Date.now() + 5000;
      let resumed;
      while (Date.now() < deadline) {
        const runs = new WorkflowRunHistory().list();
        resumed = runs.find((entry) => entry.id === runId);
        if (resumed && resumed.status !== 'paused') break;
        await new Promise((r) => setTimeout(r, 80));
      }
      assert.ok(resumed, '续跑应当覆盖原 paused 历史条目');
      // constraints 必须并入 values：续跑后的 run 状态里能查到，后续 step 可通过 {constraints} 模板引用。
      assert.equal(resumed.values.constraints, 'use TypeScript | no external deps');
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-33 delivery endpoint 返回 markdown 与 handoff 两种格式，找不到 delivery-note 时 404', async () => {
  const {
    WorkflowRunHistory,
    WorkflowArtifactStore,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-delivery-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    const runId = 'run-delivery-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'delivery-demo',
      status: 'success',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [
        { id: 'build', tool: 'node', role: 'builder', artifacts: [], status: 'success', command: 'node', args: ['--version'], exitCode: 0 },
        { id: 'publish', tool: 'node', role: 'builder', artifacts: ['delivery-note'], status: 'success', command: 'node', args: ['--version'], exitCode: 0 },
      ],
    });
    const store = new WorkflowArtifactStore();
    store.append({
      runId,
      workflowName: 'delivery-demo',
      stepId: 'publish',
      role: 'builder',
      type: 'delivery-note',
      title: 'delivery-demo success',
      content: 'workflow=delivery-demo\nrunId=run-delivery-1\nstatus=success\nsteps=2\n\n## Steps\n- build [node role=builder] success\n- publish [node role=builder] success',
      files: ['README.md'],
    });

    await withServer(async ({ port, token }) => {
      // 默认 markdown 格式：返回 delivery-note 原文 + header。
      const md = await request(port, token, 'GET', `/workflow/runs/${runId}/delivery`);
      assert.equal(md.status, 200);
      assert.equal(md.body.runId, runId);
      assert.equal(md.body.workflowName, 'delivery-demo');
      assert.equal(md.body.status, 'success');
      assert.equal(md.body.format, 'markdown');
      assert.ok(md.body.content.startsWith('# CodePanion delivery note: delivery-demo'), 'markdown 应当带 header');
      assert.ok(md.body.content.includes('## Steps'), 'markdown 应当包含原 delivery-note 正文');
      assert.deepEqual(md.body.files, ['README.md']);

      // handoff 格式：把 markdown 包进 continuation prompt，可直接喂给 Codex / Claude Code / OpenCode。
      const ho = await request(port, token, 'GET', `/workflow/runs/${runId}/delivery?format=handoff`);
      assert.equal(ho.status, 200);
      assert.equal(ho.body.format, 'handoff');
      assert.ok(ho.body.content.includes('continuing a CodePanion workflow'), 'handoff 必须带 continuation 引子');
      assert.ok(ho.body.content.includes('## Steps'), 'handoff 仍要包含 delivery-note 正文');
      assert.ok(ho.body.content.includes('Please continue this workflow'), 'handoff 必须带行动指令尾部');

      // 没有 delivery-note 的 run → 404。
      new WorkflowRunHistory().append({
        id: 'run-no-delivery',
        workflowName: 'delivery-demo',
        status: 'paused',
        values: {},
        startedAt: Date.now() - 500,
        endedAt: Date.now(),
        steps: [],
      });
      const missing = await request(port, token, 'GET', `/workflow/runs/run-no-delivery/delivery`);
      assert.equal(missing.status, 404);

      // 不存在的 runId → 404。
      const unknown = await request(port, token, 'GET', `/workflow/runs/run-does-not-exist/delivery`);
      assert.equal(unknown.status, 404);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-20 run 详情端点返回完整 run（含 step output），找不到 → 404', async () => {
  const { WorkflowRunHistory } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-rundetail-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    const runId = 'run-detail-1';
    new WorkflowRunHistory().append({
      id: runId,
      workflowName: 'detail-demo',
      status: 'success',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [{
        id: 'probe',
        tool: 'node',
        role: 'builder',
        artifacts: [],
        status: 'success',
        command: 'node',
        args: ['--version'],
        exitCode: 0,
        // W-31 持久化的 step output，run 详情端点必须原样带回。
        output: { stdout: 'PROBE_STDOUT', stderr: '', truncated: false },
      }],
    });

    await withServer(async ({ port, token }) => {
      const detail = await request(port, token, 'GET', `/workflow/runs/${runId}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.run.id, runId);
      assert.equal(detail.body.run.workflowName, 'detail-demo');
      const probe = detail.body.run.steps.find((s) => s.id === 'probe');
      assert.ok(probe, 'run 详情应当含 probe step');
      assert.ok(probe.output, 'step output 应当随 run 详情返回');
      assert.equal(probe.output.stdout, 'PROBE_STDOUT');

      // 同 run 的 sub-route 不被 :runId 误吞（4 段路径走 artifacts 端点而非详情端点）。
      const artifacts = await request(port, token, 'GET', `/workflow/runs/${runId}/artifacts`);
      assert.equal(artifacts.status, 200);
      assert.ok(Array.isArray(artifacts.body.artifacts));

      const missing = await request(port, token, 'GET', '/workflow/runs/run-nope');
      assert.equal(missing.status, 404);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-20 board endpoint 聚合 workflow definitions、recent runs、pending gates', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
    parseWorkflowSteps,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-board-'));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    new WorkflowDefinitionManager().save({
      name: 'feature',
      description: 'demo',
      steps: parseWorkflowSteps(['id=plan;command=noop']),
    });
    const history = new WorkflowRunHistory();
    history.append({
      id: 'run-board-pending',
      workflowName: 'feature',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [{
        id: 'plan',
        tool: 'local',
        role: 'planner',
        artifacts: [],
        status: 'checkpoint',
        command: 'noop',
        args: [],
        message: 'manual',
      }],
    });
    history.append({
      id: 'run-board-done',
      workflowName: 'feature',
      status: 'success',
      values: {},
      startedAt: Date.now() - 500,
      endedAt: Date.now(),
      steps: [{ id: 'plan', tool: 'local', artifacts: [], status: 'success', command: 'noop', args: [] }],
    });

    await withServer(async ({ port, token }) => {
      const board = await request(port, token, 'GET', '/workflow/board');
      assert.equal(board.status, 200);
      assert.equal(board.body.workflows.length, 1);
      assert.equal(board.body.workflows[0].name, 'feature');
      assert.equal(board.body.workflows[0].stepCount, 1);
      assert.equal(board.body.runs.length, 2);
      // recent runs 按 startedAt 降序：done 比 pending 晚开始，应排在前。
      assert.equal(board.body.runs[0].id, 'run-board-done');
      assert.equal(board.body.gates.length, 1);
      assert.equal(board.body.gates[0].runId, 'run-board-pending');
      assert.equal(board.body.gates[0].role, 'planner');
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W-32/W-33: gate resolve 落 human-decision artifact，artifact list 返回 run 全部产物', async () => {
  const { WorkflowRunHistory, WorkflowArtifactStore } = await import('../dist/workflows/workflowDefinitionManager.js');
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-gate-resolve-'));
  const prevHistoryEnv = process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
  const prevArtifactEnv = process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(dir, 'artifacts.ndjson');
  try {
    // 直接写一条 paused run + checkpoint step 进历史。
    const history = new WorkflowRunHistory();
    const runId = 'run-gate-1';
    history.append({
      id: runId,
      workflowName: 'release-gate',
      status: 'paused',
      values: {},
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      steps: [
        {
          id: 'review',
          tool: 'codex',
          role: 'reviewer',
          model: undefined,
          artifacts: ['human-decision'],
          status: 'checkpoint',
          command: 'codex',
          args: ['review'],
          message: 'manual checkpoint required',
        },
      ],
    });

    await withServer(async ({ port, token }) => {
      const resolved = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, {
        decision: 'approve',
        message: '看完计划，可以继续。',
        constraints: ['只动 packages/daemon'],
      });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.body.artifact.type, 'human-decision');
      assert.equal(resolved.body.artifact.runId, runId);
      assert.match(resolved.body.artifact.content, /decision=approve/);
      assert.match(resolved.body.artifact.content, /constraints=只动 packages\/daemon/);

      const artifacts = await request(port, token, 'GET', `/workflow/runs/${runId}/artifacts`);
      assert.equal(artifacts.status, 200);
      assert.equal(artifacts.body.artifacts.length, 1);
      assert.equal(artifacts.body.artifacts[0].role, 'reviewer');

      // 不存在的 run 或非 paused run 应 404。
      const missing = await request(port, token, 'POST', `/workflow/gates/run-not-exist/review/resolve`, { decision: 'reject' });
      assert.equal(missing.status, 404);

      // 非法 decision 应 400。
      const bad = await request(port, token, 'POST', `/workflow/gates/${runId}/review/resolve`, { decision: 'maybe' });
      assert.equal(bad.status, 400);
    });

    // server 用单例 WorkflowArtifactStore，验证 artifact 真实落盘。
    const store = new WorkflowArtifactStore();
    assert.equal(store.list(runId).length, 1);
  } finally {
    if (prevHistoryEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prevHistoryEnv;
    if (prevArtifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prevArtifactEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
