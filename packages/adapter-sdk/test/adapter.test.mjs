import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../../daemon/dist/daemon/server.js';
import { CodePanionAdapter, CodePanionAdapterError, createAdapter, readDaemonConfig } from '../src/index.js';

function testDaemonConfig() {
  return {
    port: 0,
    token: 'adapter-sdk-test-token-0001',
    promptIdleMs: 100,
    toast: { enabled: false, soundOnPrompt: false, soundOnDone: false },
    monitors: { cli: false, vscode: false, codexDesktop: false, aiTools: false },
    retention: {
      session: { fullOutputChars: 64 * 1024, outputChunks: 100 },
      source: { events: 100, repliesPerEvent: 10, offlineSources: 10 },
      workflow: { threads: 10, itemsPerThread: 50, seenItems: 200 },
    },
    templates: [],
  };
}

async function withDaemon(run) {
  const created = createServer(testDaemonConfig(), { workflowSnapshotPath: null });
  const server = await created.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run({ port, token: testDaemonConfig().token });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('readDaemonConfig 读取真实文件 + 文件不存在 fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-adapter-sdk-'));
  try {
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ port: 8123, token: 'tok-abc' }));
    const parsed = readDaemonConfig({ configPath });
    assert.equal(parsed.port, 8123);
    assert.equal(parsed.token, 'tok-abc');

    const missing = readDaemonConfig({ configPath: join(dir, 'nope.json') });
    assert.equal(missing.port, 7777);
    assert.equal(missing.token, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 监听路线已下线（feat/retire-monitoring）：/sources/register、/events 端点从 daemon 移除，
// Adapter SDK 暂作历史兼容、已移出主回归门（npm test）。待 SDK 迁到 workflow API 后重写本用例。
test('SDK 注册来源后能够上报 activity 事件并被 daemon 返回 ok', { skip: '监听路线已下线：/sources/register、/events 端点已移除（feat/retire-monitoring）' }, async () => {
  await withDaemon(async ({ port, token }) => {
    const adapter = createAdapter({ hostname: '127.0.0.1', port, token, sourceKind: 'external', sourceName: 'sdk-test-adapter' });
    const source = await adapter.registerSource({
      capabilities: ['adapter', 'sdk-test'],
      capabilityLevel: 'L2',
      workspace: '/tmp/sdk-test',
    });
    assert.ok(source.id, '注册返回 source.id');
    assert.equal(source.kind, 'external');
    assert.equal(source.integrationKind, 'adapter');
    assert.equal(source.privacyBoundary, 'explicit-adapter');
    assert.equal(adapter.sourceId, source.id);

    const result = await adapter.emitEvent({
      type: 'activity',
      title: '中文活动事件',
      content: '从 SDK 发出的 activity，包含特殊字符 ✨ 与 emoji 🚀',
    });
    assert.equal(result.ok, true);
    assert.ok(result.event && typeof result.event === 'object');

    const reply = await adapter.disconnect();
    assert.equal(reply.ok, true);
    assert.equal(adapter.sourceId, '', 'disconnect 后 sourceId 应清空');
  });
});

// 同上：监听路线下线后 registerSource/emitEvent/replyToEvent 走的端点均已移除，暂作历史兼容。
test('SDK emit prompt 事件并通过 replyToEvent + listReplies 闭环', { skip: '监听路线已下线：/sources/register、/events、/events/:id/reply 端点已移除（feat/retire-monitoring）' }, async () => {
  await withDaemon(async ({ port, token }) => {
    const adapter = createAdapter({ hostname: '127.0.0.1', port, token, sourceName: 'sdk-prompt-test' });
    const source = await adapter.registerSource();

    const promptResult = await adapter.emitEvent({
      type: 'prompt',
      title: '需要确认',
      content: '继续执行？',
      options: ['继续', '取消'],
    });
    assert.equal(promptResult.ok, true);
    const eventId = promptResult.event?.id;
    assert.ok(eventId, 'prompt 事件应返回 id');

    const replyAck = await adapter.replyToEvent(eventId, '继续');
    assert.equal(replyAck.ok, true);

    const replies = await adapter.listReplies(eventId);
    assert.equal(replies.eventId, eventId);
    assert.ok(Array.isArray(replies.replies));
    assert.equal(replies.replies.length, 1);
    assert.equal(replies.replies[0].text, '继续');

    await adapter.disconnect(source.id);
  });
});

test('SDK 在 token 错误时抛 CodePanionAdapterError 而非 unhandled rejection', async () => {
  await withDaemon(async ({ port }) => {
    const adapter = new CodePanionAdapter({ hostname: '127.0.0.1', port, token: 'wrong-token' });
    await assert.rejects(
      adapter.registerSource({ kind: 'external', name: 'sdk-auth-test' }),
      (err) => {
        assert.ok(err instanceof CodePanionAdapterError, '错误类型应为 CodePanionAdapterError');
        assert.equal(err.status, 401);
        assert.match(err.route, /\/sources\/register$/);
        return true;
      },
    );
  });
});

test('replyToEvent 参数无效时 reject CodePanionAdapterError（不上行到 daemon）', async () => {
  const adapter = new CodePanionAdapter({ hostname: '127.0.0.1', port: 1, token: '' });
  await assert.rejects(adapter.replyToEvent('', 'x'), /eventId/);
  await assert.rejects(adapter.replyToEvent('id', 123), /must be a string/);
});

test('registerSource 缺 name 抛同步错误', async () => {
  const adapter = new CodePanionAdapter({ hostname: '127.0.0.1', port: 1, token: '' });
  await assert.rejects(adapter.registerSource({ kind: 'external' }), /source name/);
});

test('disconnect 在未注册时返回 no-source-id 而不抛错', async () => {
  const adapter = new CodePanionAdapter({ hostname: '127.0.0.1', port: 1, token: '' });
  const result = await adapter.disconnect();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-source-id');
});
