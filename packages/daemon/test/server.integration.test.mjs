import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    // 强制销毁残留 socket（含被拒/半开的 WS 升级连接），否则 server.close 要等到内核超时才回调，
    // 多个 withServer 叠加会让进程排空慢上百秒，逼近测试超时。
    server.closeAllConnections?.();
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
      // agent:false 关闭全局 keep-alive 连接池：否则每次请求都会在池里留一个连向已关闭 server 的
      // socket，要等到 keepalive 超时才释放，多个 withServer 叠加让进程排空慢上百秒（近测试超时）。
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
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
      try { ws.terminate(); } catch { /* socket 可能已关 */ }
      settle({ ok: false, error: String(err?.message ?? err) });
    });
    ws.once('unexpected-response', (req, res) => {
      // 被 verifyClient 拒（401/403）时显式销毁底层 socket，避免 http server.close() 等待半开连接而挂起。
      try { res.destroy(); } catch { /* ignore */ }
      try { req.destroy?.(); } catch { /* ignore */ }
      try { ws.terminate(); } catch { /* ignore */ }
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

test('/notify rejects invalid payloads', async () => {
  await withServer(async ({ port, token }) => {
    assert.equal((await request(port, token, 'POST', '/notify', {})).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: '' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 123 })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 'ok', level: 'critical' })).status, 400);
    assert.equal((await request(port, token, 'POST', '/notify', { title: 'ok' })).status, 200);
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

// P2.1：CLI/PTTY 非零退出必须映射成 workflow item status='error'，
// GUI 才能把这条任务挂到失败队列；之前所有用例都走 exitCode=0，error 分支零覆盖。
// P2.1：VS Code 来源在真实使用中会成对发"terminal 打开/关闭"和"调试开始/结束"事件，
// 这条用例覆盖了 extension.js 第 170-199 行的事件 → daemon 的端到端链路。
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

test('workspace shell step 在所选 workspace 目录执行（cwd = workspace root，而非 daemon 进程目录）', async () => {
  const {
    WorkflowDefinitionManager,
    WorkflowRunHistory,
  } = await import('../dist/workflows/workflowDefinitionManager.js');
  // fallback 路径指到隔离 tmp，避免污染真实 HOME；workspace run 的 history 落在 <ws>/.codepanion/ 下。
  const fallbackDir = mkdtempSync(join(tmpdir(), 'codepanion-cwd-fallback-'));
  // realpath 归一：server 的 workspaceKey() 对 workspace 取 realpathSync.native，而 macOS 上
  // mkdtemp 的 /var/... 会被解析成 /private/var/...。这里先归一，确保 definition 写入路径、启动用的
  // workspace、以及读历史的路径都与 daemon 内部一致，否则 macOS 上会 404 / 读不到 history。
  const ws = realpathSync.native(mkdtempSync(join(tmpdir(), 'codepanion-cwd-ws-')));
  const prev = {
    workflowEnv: process.env.CODEPANION_WORKFLOW_PATH,
    historyEnv: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifactEnv: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  process.env.CODEPANION_WORKFLOW_PATH = join(fallbackDir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(fallbackDir, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(fallbackDir, 'artifacts.ndjson');
  try {
    // 让 step 把自己的 cwd 打到 stdout。inline node JS 含 . ( ) 会撞 parseWorkflowSteps 的分隔符，直接构造 step。
    new WorkflowDefinitionManager(join(ws, '.codepanion', 'workflows.json')).save({
      name: 'cwd-probe',
      steps: [{
        id: 'probe',
        role: 'builder',
        tool: 'node',
        provider: 'local',
        permissions: [],
        contextPolicy: {},
        artifacts: [],
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.cwd())'],
        values: {},
        dependsOn: [],
        checkpoint: false,
      }],
    });

    await withServer(async ({ port, token }) => {
      const started = await request(port, token, 'POST', '/workflow/runs', { workflow: 'cwd-probe', workspace: ws });
      assert.equal(started.status, 200);

      const history = new WorkflowRunHistory(join(ws, '.codepanion', 'workflow-runs.ndjson'));
      const deadline = Date.now() + 5000;
      let finished;
      while (Date.now() < deadline) {
        finished = history.list().find((entry) => entry.workflowName === 'cwd-probe' && entry.status !== 'paused');
        if (finished && finished.status === 'success') break;
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.ok(finished, 'cwd-probe 应当跑完');
      assert.equal(finished.status, 'success');
      const probe = finished.steps.find((s) => s.id === 'probe');
      assert.ok(probe?.output, 'probe step 应有 output');
      const out = probe.output.stdout.trim().toLowerCase();
      // 关键断言：step cwd 是 workspace 目录，不是 daemon 进程目录。用 basename（mkdtemp 唯一后缀）做大小写无关匹配，
      // 规避 Windows/macOS realpath 在父路径上的大小写归一差异。
      assert.notEqual(out, process.cwd().toLowerCase(), 'step 不应在 daemon 进程目录执行');
      assert.ok(out.includes(basename(ws).toLowerCase()), `step 应在 workspace 目录执行，实际 cwd=${probe.output.stdout}`);
    });
  } finally {
    if (prev.workflowEnv === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflowEnv;
    if (prev.historyEnv === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.historyEnv;
    if (prev.artifactEnv === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifactEnv;
    rmSync(fallbackDir, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  }
});
