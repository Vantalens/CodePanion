import assert from 'node:assert/strict';
import test from 'node:test';
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
    templates: [],
  };
}

async function withServer(run) {
  const created = createServer(testConfig(), { workflowSnapshotPath: null });
  const server = await created.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run({ port, token: testConfig().token });
  } finally {
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

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
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

test('WebSocket observer receives workflow events and CLI socket receives injected input', async () => {
  await withServer(async ({ port, token }) => {
    const observer = await openWs(`ws://127.0.0.1:${port}/ws?token=${token}&role=observer`);
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

      const cli = await openWs(`ws://127.0.0.1:${port}/ws?token=${token}&role=cli&sessionId=${sessionId}`);
      try {
        const injectPromise = waitForMessage(cli, (message) => message.type === 'inject-input' && message.sessionId === sessionId);
        const reply = await request(port, token, 'POST', `/sessions/${sessionId}/reply`, { text: 'yes\n' });
        assert.equal(reply.status, 200);
        const injected = await injectPromise;
        assert.equal(injected.text, 'yes\n');
      } finally {
        await closeWs(cli);
      }
    } finally {
      await closeWs(observer);
    }
  });
});
