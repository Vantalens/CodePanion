import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceManager } from '../dist/daemon/sourceManager.js';

test('SourceManager prunes old events and their replies', () => {
  const manager = new SourceManager();
  const source = manager.register({
    kind: 'external',
    name: 'Adapter',
    capabilities: ['events'],
  });

  const first = manager.emitEvent({
    type: 'prompt',
    source: 'external',
    sourceId: source.id,
    title: 'First',
    content: 'first',
    timestamp: 1,
  });
  assert.equal(manager.reply(first.id, 'ok'), true);

  for (let index = 0; index < 1000; index += 1) {
    manager.emitEvent({
      type: 'activity',
      source: 'external',
      sourceId: source.id,
      content: String(index),
      timestamp: index + 2,
    });
  }

  assert.equal(manager.listReplies(first.id), undefined);
});

test('SourceManager caps replies per event', () => {
  const manager = new SourceManager();
  const event = manager.emitEvent({
    type: 'prompt',
    source: 'external',
    content: 'prompt',
  });

  for (let index = 0; index < 60; index += 1) {
    assert.equal(manager.reply(event.id, `reply ${index}`), true);
  }

  const replies = manager.listReplies(event.id);
  assert.equal(replies.length, 50);
  assert.equal(replies[0].text, 'reply 10');
  assert.equal(replies.at(-1).text, 'reply 59');
});

test('SourceManager respects custom retention caps', () => {
  const manager = new SourceManager({ retention: { events: 3, repliesPerEvent: 2 } });
  const source = manager.register({ kind: 'external', name: 'Adapter' });

  const keepers = [];
  for (let i = 0; i < 5; i += 1) {
    keepers.push(
      manager.emitEvent({
        type: 'activity',
        source: 'external',
        sourceId: source.id,
        content: `evt-${i}`,
        timestamp: i + 1,
      }),
    );
  }
  assert.equal(manager.listReplies(keepers[0].id), undefined, 'oldest event pruned');
  assert.ok(manager.listReplies(keepers[4].id), 'latest event retained');

  for (let i = 0; i < 4; i += 1) {
    assert.equal(manager.reply(keepers[4].id, `r-${i}`), true);
  }
  const replies = manager.listReplies(keepers[4].id);
  assert.equal(replies.length, 2);
  assert.equal(replies[0].text, 'r-2');
  assert.equal(replies.at(-1).text, 'r-3');
});

test('SourceManager derives canonical metadata for first-party source kinds', () => {
  const manager = new SourceManager();

  const cli = manager.register({ kind: 'claude-code', name: 'Claude Code', capabilities: ['cli-detected'] });
  assert.equal(cli.capabilityLevel, 'L3');
  assert.equal(cli.integrationKind, 'cli-pty');
  assert.equal(cli.privacyBoundary, 'explicit-session');

  const codexDesktop = manager.register({ kind: 'codex-desktop', name: 'Codex Desktop' });
  assert.equal(codexDesktop.capabilityLevel, 'L2');
  assert.equal(codexDesktop.integrationKind, 'local-file-sync');
  assert.equal(codexDesktop.privacyBoundary, 'local-history');

  const ccSwitch = manager.register({ kind: 'cc-switch', name: 'CC Switch' });
  assert.equal(ccSwitch.capabilityLevel, 'L1-L2');
  assert.equal(ccSwitch.integrationKind, 'config-switcher');
  assert.equal(ccSwitch.privacyBoundary, 'config-switcher');
});

test('SourceManager evicts oldest offline sources beyond cap', () => {
  const manager = new SourceManager({ retention: { offlineSources: 2 } });
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const source = manager.register({
      kind: 'external',
      name: `Adapter ${i}`,
      capabilities: ['events'],
    });
    ids.push(source.id);
    assert.equal(manager.disconnect(source.id), true);
  }

  const remaining = manager.list().map((source) => source.id);
  assert.equal(remaining.length, 2, 'only most recent offline survivors retained');
  assert.ok(remaining.includes(ids[3]));
  assert.ok(remaining.includes(ids[4]));
  assert.equal(manager.get(ids[0]), undefined, 'oldest offline source evicted');

  const online = manager.register({ kind: 'external', name: 'Online' });
  assert.equal(manager.get(online.id)?.status, 'online');
  manager.disconnect(online.id);
  const after = manager.list().map((source) => source.id);
  assert.ok(after.includes(online.id));
  assert.equal(after.length, 2);
});

test('SourceManager keeps online sources regardless of offline cap', () => {
  const manager = new SourceManager({ retention: { offlineSources: 1 } });
  const stayingOnline = manager.register({ kind: 'external', name: 'Online' });

  for (let i = 0; i < 4; i += 1) {
    const source = manager.register({ kind: 'external', name: `Offline ${i}` });
    manager.disconnect(source.id);
  }

  assert.ok(manager.get(stayingOnline.id), 'online source not affected by offline cap');
  const offlineSurvivors = manager.list().filter((source) => source.status === 'offline');
  assert.equal(offlineSurvivors.length, 1);
});

test('SourceManager allows explicit adapter metadata overrides', () => {
  const manager = new SourceManager();
  const source = manager.register({
    kind: 'external',
    name: 'Custom Adapter',
    capabilities: ['events', 'reply'],
    capabilityLevel: 'L3',
    integrationKind: 'adapter',
    privacyBoundary: 'explicit-adapter',
  });

  assert.equal(source.capabilityLevel, 'L3');
  assert.equal(source.integrationKind, 'adapter');
  assert.equal(source.privacyBoundary, 'explicit-adapter');
});
