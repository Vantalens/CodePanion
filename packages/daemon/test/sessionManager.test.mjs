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

test('SessionManager respects custom retention caps', () => {
  const manager = new SessionManager({
    retention: { fullOutputChars: 1024, outputChunks: 5 },
  });
  const session = registerSession(manager);

  for (let index = 0; index < 20; index += 1) {
    manager.appendOutput(session.id, `${index}:` + 'y'.repeat(200));
  }

  const fullOutput = manager.getFullOutput(session.id);
  const chunks = manager.getOutputChunks(session.id);
  assert.ok(fullOutput.length <= 1024);
  assert.ok(fullOutput.includes('19:'));
  assert.equal(chunks.length, 5);
  assert.ok(chunks[0].content.startsWith('15:'));
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

test('SessionManager keeps prompt options through spinner output', () => {
  // 回归：spinner / 心跳输出曾会清掉 lastPromptOptions，导致随后 injectReply 被判 invalid-reply。
  const manager = new SessionManager();
  const session = registerSession(manager);
  manager.attachCliSocket(session.id, {
    readyState: 1,
    OPEN: 1,
    send: () => {},
  });

  manager.markPrompt(session.id, 'Continue? (y/n)', ['yes', 'no']);
  manager.appendOutput(session.id, '\r⠋ thinking\r');
  manager.appendOutput(session.id, '\r⠙ thinking\r');

  const result = manager.injectReply(session.id, 'yes');
  assert.equal(result, 'ok');
});

test('SessionManager resets waiting → running when real output crosses the prompt', () => {
  // 回归：用户在 CLI 终端直接回车（不走 daemon inject）后，含 \n 的真实输出抵达 daemon，
  // 旧实现只清 lastPromptOptions 但保留 status='waiting'，GUI 会卡在「等待但无选项」死锁态。
  const manager = new SessionManager();
  const session = registerSession(manager);

  manager.markPrompt(session.id, 'Continue? (y/n)', ['yes', 'no']);
  assert.equal(manager.list().find((s) => s.id === session.id).status, 'waiting');

  manager.appendOutput(session.id, 'continued\n');

  const info = manager.list().find((s) => s.id === session.id);
  assert.equal(info.status, 'running');
  assert.equal(info.lastPromptOptions, undefined);
});
