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
