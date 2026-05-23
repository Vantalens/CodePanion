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

  for (let index = 0; index < 170; index += 1) {
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
  assert.equal(snapshot.items.length, 120);
  assert.equal(snapshot.items[0].id, 'item:50');
  assert.equal(snapshot.threads[0].itemCount, 120);
});

test('WorkflowManager caps total retained threads', () => {
  const manager = new WorkflowManager();

  for (let index = 0; index < 40; index += 1) {
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
  assert.equal(snapshot.threads.length, 30);
  assert.equal(snapshot.threads[0].id, 'thread:39');
  assert.equal(snapshot.threads.at(-1).id, 'thread:10');
  assert.equal(manager.threadSnapshot('thread:0'), undefined);
});

test('WorkflowManager.getThread returns the live thread record or undefined', () => {
  const manager = new WorkflowManager();
  assert.equal(manager.getThread('absent'), undefined);

  manager.upsertThread({
    id: 'thread:get',
    source: 'codex-desktop',
    title: 'initial',
    status: 'running',
    updatedAt: 1,
    itemCount: 0,
  });

  const live = manager.getThread('thread:get');
  assert.ok(live, 'expected the thread to be retrievable');
  assert.equal(live.title, 'initial');
  assert.equal(live.status, 'running');

  // After an item with status=done arrives, getThread reflects the new status.
  manager.appendItem({
    id: 'item:done',
    threadId: 'thread:get',
    source: 'codex-desktop',
    kind: 'status',
    status: 'done',
    timestamp: 2,
  });
  assert.equal(manager.getThread('thread:get').status, 'done');
});

test('WorkflowManager truncates oversized workflow item content before snapshotting', () => {
  const manager = new WorkflowManager();
  manager.upsertThread({
    id: 'thread:large',
    source: 'codex-desktop',
    title: 'large',
    status: 'running',
    updatedAt: 1,
    itemCount: 0,
  });

  manager.appendItem({
    id: 'item:large',
    threadId: 'thread:large',
    source: 'codex-desktop',
    kind: 'message',
    content: 'x'.repeat(20000),
    timestamp: 2,
  });

  const snapshot = manager.threadSnapshot('thread:large');
  assert.ok(snapshot);
  assert.ok(snapshot.items[0].content.length < 13000);
  assert.match(snapshot.items[0].content, /content truncated/);
});

test('WorkflowManager.appendItem returns false on duplicate id without mutating thread state', () => {
  const manager = new WorkflowManager();
  manager.upsertThread({
    id: 'thread:dedup',
    source: 'cli',
    title: 'dedup',
    status: 'running',
    updatedAt: 1,
    itemCount: 0,
  });

  const first = manager.appendItem({
    id: 'item:dedup',
    threadId: 'thread:dedup',
    source: 'cli',
    kind: 'command',
    content: 'hello',
    timestamp: 2,
  });
  const second = manager.appendItem({
    id: 'item:dedup',
    threadId: 'thread:dedup',
    source: 'cli',
    kind: 'command',
    content: 'duplicate',
    timestamp: 3,
  });

  assert.equal(first, true);
  assert.equal(second, false);

  const snapshot = manager.threadSnapshot('thread:dedup');
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].content, 'hello');
});

test('WorkflowManager persists and restores a minimal paused snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflow-'));
  const snapshotPath = join(dir, 'workflow-snapshot.json');
  try {
    const manager = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 0 });
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

    const restored = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 0 });
    const snapshot = restored.threadSnapshot('thread:restore');

    assert.ok(snapshot);
    assert.equal(snapshot.threads[0].status, 'paused');
    assert.equal(snapshot.items[0].content, 'saved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowManager respects custom retention caps from constructor', () => {
  const manager = new WorkflowManager({
    retention: { threads: 3, itemsPerThread: 4, seenItems: 16 },
  });

  for (let i = 0; i < 6; i += 1) {
    const threadId = `thread:${i}`;
    manager.upsertThread({
      id: threadId,
      source: 'cli',
      title: threadId,
      status: 'running',
      updatedAt: i + 1,
      itemCount: 0,
    });
    for (let j = 0; j < 6; j += 1) {
      manager.appendItem({
        id: `item:${i}:${j}`,
        threadId,
        source: 'cli',
        kind: 'command',
        content: `${i}-${j}`,
        timestamp: (i + 1) * 10 + j,
      });
    }
  }

  const snapshot = manager.snapshot();
  assert.equal(snapshot.threads.length, 3, 'maxThreads honored');
  for (const thread of snapshot.threads) {
    const items = snapshot.items.filter((it) => it.threadId === thread.id);
    assert.equal(items.length, 4, 'maxItemsPerThread honored');
  }
});

test('WorkflowManager debounces async snapshot writes and flushes on demand', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflow-'));
  const snapshotPath = join(dir, 'workflow-snapshot.json');
  try {
    const manager = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 50 });
    for (let i = 0; i < 20; i += 1) {
      manager.upsertThread({
        id: `thread:debounce`,
        source: 'cli',
        title: 'debounce',
        status: 'running',
        updatedAt: i + 1,
        itemCount: 0,
      });
      manager.appendItem({
        id: `item:debounce:${i}`,
        threadId: 'thread:debounce',
        source: 'cli',
        kind: 'command',
        content: `chunk-${i}`,
        timestamp: i + 1,
      });
    }

    await manager.flushSnapshot();

    const restored = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 0 });
    const snapshot = restored.threadSnapshot('thread:debounce');
    assert.ok(snapshot);
    assert.equal(snapshot.items.length, 20);
    assert.equal(snapshot.items.at(-1).content, 'chunk-19');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowManager updates and persists task-state metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflow-'));
  const snapshotPath = join(dir, 'workflow-snapshot.json');
  try {
    const manager = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 0 });
    manager.upsertThread({
      id: 'thread:task-state',
      source: 'cli',
      title: 'task-state',
      status: 'running',
      updatedAt: 1,
      itemCount: 0,
    });

    const updated = manager.updateTaskState('thread:task-state', {
      pinned: true,
      archived: true,
      snoozedUntil: 123456789,
      priority: 'high',
      sortOrder: 120,
      handoffStatus: 'pending',
      handoffTarget: 'codex',
      handoffSessionId: 'session-42',
    });
    assert.ok(updated);
    assert.equal(updated.taskState.pinned, true);
    assert.equal(updated.taskState.archived, true);
    assert.equal(updated.taskState.snoozedUntil, 123456789);
    assert.equal(updated.taskState.priority, 'high');
    assert.equal(updated.taskState.sortOrder, 120);
    assert.equal(updated.taskState.handoffStatus, 'pending');
    assert.equal(updated.taskState.handoffTarget, 'codex');
    assert.equal(updated.taskState.handoffSessionId, 'session-42');
    assert.ok(updated.taskState.updatedAt > 0);

    await manager.flushSnapshot();
    const restored = new WorkflowManager({ snapshotPath, snapshotDebounceMs: 0 });
    const snapshot = restored.threadSnapshot('thread:task-state');
    assert.ok(snapshot);
    assert.equal(snapshot.threads[0].taskState.pinned, true);
    assert.equal(snapshot.threads[0].taskState.archived, true);
    assert.equal(snapshot.threads[0].taskState.snoozedUntil, 123456789);
    assert.equal(snapshot.threads[0].taskState.priority, 'high');
    assert.equal(snapshot.threads[0].taskState.sortOrder, 120);
    assert.equal(snapshot.threads[0].taskState.handoffStatus, 'pending');
    assert.equal(snapshot.threads[0].taskState.handoffTarget, 'codex');
    assert.equal(snapshot.threads[0].taskState.handoffSessionId, 'session-42');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
