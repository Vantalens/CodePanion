import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
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

async function withServer(run) {
  const created = createServer(testConfig(), { workflowSnapshotPath: null });
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
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : undefined,
  };
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
