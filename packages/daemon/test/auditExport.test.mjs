import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../dist/daemon/server.js';
import { redactSnapshot } from '../dist/cli/audit.js';

function testConfig() {
  return {
    port: 0,
    token: 'audit-export-test-token-123',
    promptIdleMs: 100,
    toast: { enabled: false, soundOnPrompt: false, soundOnDone: false },
    monitors: { cli: false, vscode: false, codexDesktop: false, aiTools: false },
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
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

test('GET /audit/snapshot 需要 Bearer Token', async () => {
  await withServer(async ({ port, token }) => {
    const unauthorized = await request(port, token, 'GET', '/audit/snapshot', undefined, false);
    assert.equal(unauthorized.status, 401);
    const authorized = await request(port, token, 'GET', '/audit/snapshot');
    assert.equal(authorized.status, 200);
  });
});

test('GET /audit/snapshot 返回 schemaVersion=1 与已注册的来源、事件、会话', async () => {
  await withServer(async ({ port, token }) => {
    const source = (await request(port, token, 'POST', '/sources/register', {
      kind: 'vscode',
      name: '审计来源',
      workspace: 'D:\\项目\\审计',
    })).body;

    const eventResp = await request(port, token, 'POST', '/events', {
      type: 'prompt',
      source: 'vscode',
      sourceId: source.id,
      title: '是否继续？',
      content: '内容明文',
      options: ['是', '否'],
    });
    assert.equal(eventResp.status, 200);
    const eventId = eventResp.body.event.id;

    assert.equal(
      (await request(port, token, 'POST', `/events/${eventId}/reply`, { text: '是' })).status,
      200,
    );

    const session = (await request(port, token, 'POST', '/sessions', {
      command: 'codex',
      args: ['audit'],
      cliPid: 90001,
    })).body;
    assert.equal(
      (await request(port, token, 'POST', `/sessions/${session.id}/output`, { chunk: '审计输出\n' })).status,
      200,
    );

    const snap = await request(port, token, 'GET', '/audit/snapshot');
    assert.equal(snap.status, 200);
    assert.equal(snap.body.schemaVersion, 1);
    assert.equal(snap.body.since, null);
    assert.equal(typeof snap.body.daemonVersion, 'string');
    assert.equal(typeof snap.body.generatedAt, 'number');

    assert.ok(snap.body.sources.some((s) => s.id === source.id), 'snapshot 应包含已注册来源');
    const stored = snap.body.events.find((e) => e.id === eventId);
    assert.ok(stored, 'snapshot 应包含 prompt 事件');
    assert.equal(stored.content, '内容明文');
    assert.ok(snap.body.eventReplies.some((r) => r.eventId === eventId && r.text === '是'));
    assert.ok(snap.body.sessions.some((s) => s.id === session.id));
    assert.ok(Array.isArray(snap.body.workflowThreads));
    assert.ok(Array.isArray(snap.body.workflowItems));
  });
});

test('GET /audit/snapshot?since 过滤掉时间戳早于阈值的事件、回复和会话', async () => {
  await withServer(async ({ port, token }) => {
    const oldEvent = (await request(port, token, 'POST', '/events', {
      type: 'activity',
      title: '旧事件',
      content: '旧内容',
    })).body.event;

    // 间隔足够大，避免时间戳相同。
    await new Promise((resolve) => setTimeout(resolve, 25));
    const cutoff = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const newEvent = (await request(port, token, 'POST', '/events', {
      type: 'activity',
      title: '新事件',
      content: '新内容',
    })).body.event;

    const snap = await request(port, token, 'GET', `/audit/snapshot?since=${cutoff}`);
    assert.equal(snap.status, 200);
    assert.equal(snap.body.since, cutoff);
    const ids = snap.body.events.map((e) => e.id);
    assert.ok(ids.includes(newEvent.id), 'since 之后的事件必须保留');
    assert.equal(ids.includes(oldEvent.id), false, 'since 之前的事件必须被过滤');
  });
});

test('GET /audit/snapshot 对非法 since 返回 400', async () => {
  await withServer(async ({ port, token }) => {
    const bad = await request(port, token, 'GET', '/audit/snapshot?since=not-a-number');
    assert.equal(bad.status, 400);
    const negative = await request(port, token, 'GET', '/audit/snapshot?since=-1');
    assert.equal(negative.status, 400);
  });
});

test('redactSnapshot 保留结构但对文本与路径做最小脱敏', async () => {
  const snapshot = {
    schemaVersion: 1,
    generatedAt: 0,
    since: null,
    daemonVersion: '0.0.0-test',
    sources: [
      {
        id: 's-1',
        kind: 'vscode',
        name: 'VS Code',
        windowTitle: '某个长长的窗口标题',
        workspace: 'C:\\Users\\alice\\projects\\demo',
        capabilities: [],
        registeredAt: 1,
        lastSeenAt: 2,
        status: 'online',
      },
    ],
    events: [
      {
        id: 'e-1',
        sourceId: 's-1',
        type: 'prompt',
        title: '请确认是否继续？',
        content: '这是一段较长的内容，足以触发首尾保留',
        options: ['是的好的', '不要继续'],
        windowTitle: '示例窗口标题',
        workspace: '/Users/alice/work',
        timestamp: 10,
      },
    ],
    eventReplies: [{ eventId: 'e-1', sourceId: 's-1', text: '同意继续执行', timestamp: 11 }],
    sessions: [
      {
        id: 'sess-1',
        command: 'codex',
        args: ['run'],
        workspace: '/home/bob/code/app',
        windowTitle: '终端会话标题',
        startedAt: 0,
        status: 'exited',
      },
    ],
    workflowThreads: [{ id: 't-1' }],
    workflowItems: [
      { id: 'w-1', threadId: 't-1', kind: 'prompt', title: '工作流标题样例', content: '工作流内容样例长一些', preview: '简短', rawText: '原始文本同样有长度', extra: 42 },
    ],
  };

  const redacted = redactSnapshot(snapshot);
  // 来源：长窗口标题首尾保留，工作区路径打码。
  assert.equal(redacted.sources[0].windowTitle.startsWith('某个'), true);
  assert.match(redacted.sources[0].workspace, /Users\\\*\*\*/);
  // 事件：内容、标题、选项、窗口标题、路径都被脱敏。
  assert.notEqual(redacted.events[0].title, snapshot.events[0].title);
  assert.match(redacted.events[0].content, /chars/);
  assert.equal(redacted.events[0].options.length, 2);
  assert.notEqual(redacted.events[0].options[0], '是的好的');
  assert.match(redacted.events[0].workspace, /\/Users\/\*\*\*/);
  // 回复文本脱敏，但 eventId 等元数据保留。
  assert.equal(redacted.eventReplies[0].eventId, 'e-1');
  assert.notEqual(redacted.eventReplies[0].text, '同意继续执行');
  // 会话：路径打码，命令保留（命令不属于脱敏字段）。
  assert.equal(redacted.sessions[0].command, 'codex');
  assert.match(redacted.sessions[0].workspace, /\/home\/\*\*\*/);
  // 工作流 item：四个常见文本字段脱敏，其他字段（如 extra）保留。
  const item = redacted.workflowItems[0];
  assert.equal(item.extra, 42);
  assert.notEqual(item.title, '工作流标题样例');
  assert.notEqual(item.content, '工作流内容样例长一些');
  assert.equal(item.preview, '**'); // 长度 2，全部打码
  assert.notEqual(item.rawText, '原始文本同样有长度');
  // schemaVersion/generatedAt/since 等顶层元数据原样透传。
  assert.equal(redacted.schemaVersion, 1);
  assert.equal(redacted.daemonVersion, '0.0.0-test');
});
