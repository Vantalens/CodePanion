import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowManager } from '../dist/daemon/workflowManager.js';

test('WorkflowManager caps items per thread', () => {
  const manager = new WorkflowManager();
  manager.upsertThread({
    id: 'thread:1',
    source: 'cli',
    title: 'Long session',
    status: 'running',
    updatedAt: 1,
    itemCount: 0,
  });

  for (let index = 0; index < 550; index += 1) {
    manager.appendItem({
      id: `item:${index}`,
      threadId: 'thread:1',
      source: 'cli',
      kind: 'command',
      title: 'output',
      content: String(index),
      timestamp: index + 1,
    });
  }

  const snapshot = manager.threadSnapshot('thread:1');
  assert.ok(snapshot);
  assert.equal(snapshot.items.length, 500);
  assert.equal(snapshot.items[0].id, 'item:50');
  assert.equal(snapshot.threads[0].itemCount, 500);
});

test('WorkflowManager caps total retained threads', () => {
  const manager = new WorkflowManager();

  for (let index = 0; index < 90; index += 1) {
    const threadId = `thread:${index}`;
    manager.upsertThread({
      id: threadId,
      source: 'codex-desktop',
      title: threadId,
      status: 'running',
      updatedAt: index + 1,
      itemCount: 0,
    });
    manager.appendItem({
      id: `item:${index}`,
      threadId,
      source: 'codex-desktop',
      kind: 'status',
      content: threadId,
      timestamp: index + 1,
    });
  }

  const snapshot = manager.snapshot();
  assert.equal(snapshot.threads.length, 80);
  assert.equal(snapshot.threads[0].id, 'thread:89');
  assert.equal(snapshot.threads.at(-1).id, 'thread:10');
  assert.equal(manager.threadSnapshot('thread:0'), undefined);
});

test('WorkflowManager persists and restores a minimal paused snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflow-'));
  const snapshotPath = join(dir, 'workflow-snapshot.json');
  try {
    const manager = new WorkflowManager({ snapshotPath });
    manager.upsertThread({
      id: 'thread:restore',
      source: 'cli',
      title: 'Restore me',
      status: 'running',
      updatedAt: 10,
      itemCount: 0,
    });
    manager.appendItem({
      id: 'item:restore',
      threadId: 'thread:restore',
      source: 'cli',
      kind: 'status',
      content: 'saved',
      timestamp: 10,
    });

    const restored = new WorkflowManager({ snapshotPath });
    const snapshot = restored.threadSnapshot('thread:restore');

    assert.ok(snapshot);
    assert.equal(snapshot.threads[0].status, 'paused');
    assert.equal(snapshot.items[0].content, 'saved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
