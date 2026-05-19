import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionManager } from '../dist/daemon/sessionManager.js';

function registerSession(manager) {
  return manager.register({
    command: 'codex',
    args: ['run'],
    cwd: 'D:\\CodePanion',
    cliPid: 1234,
  });
}

test('SessionManager caps retained output and chunks', () => {
  const manager = new SessionManager();
  const session = registerSession(manager);

  for (let index = 0; index < 1200; index += 1) {
    manager.appendOutput(session.id, `${index}:` + 'x'.repeat(300));
  }

  const fullOutput = manager.getFullOutput(session.id);
  const chunks = manager.getOutputChunks(session.id);

  assert.equal(typeof fullOutput, 'string');
  assert.ok(fullOutput.length <= 256 * 1024);
  assert.ok(fullOutput.includes('1199:'));
  assert.ok(!fullOutput.startsWith('0:'));
  assert.equal(chunks.length, 1000);
  assert.equal(chunks[0].type, 'output');
  assert.ok(chunks[0].content.startsWith('200:'));
});

test('SessionManager includes retained output when prompt is raised', () => {
  const manager = new SessionManager();
  const session = registerSession(manager);
  const events = [];
  manager.onEvent((event) => events.push(event));

  manager.appendOutput(session.id, 'step 1\n');
  manager.markPrompt(session.id, 'Continue? (y/n)', ['yes', 'no']);

  const prompt = events.find((event) => event.type === 'session-prompt');
  assert.ok(prompt);
  assert.equal(prompt.sessionId, session.id);
  assert.equal(prompt.lastLines, 'Continue? (y/n)');
  assert.deepEqual(prompt.options, ['yes', 'no']);
  assert.equal(prompt.fullOutput, 'step 1\n');
});
