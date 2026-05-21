import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptDetector } from '../dist/pty/promptDetector.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('PromptDetector detects yes/no prompts after idle', async () => {
  const prompts = [];
  const detector = new PromptDetector({
    idleMs: 10,
    onPrompt: (lastLines, options) => prompts.push({ lastLines, options }),
  });

  detector.feed('Build finished.\nContinue? (y/n)');
  await wait(30);
  detector.stop();

  assert.equal(prompts.length, 1);
  assert.match(prompts[0].lastLines, /Continue\? \(y\/n\)/);
  assert.deepEqual(prompts[0].options, ['y', 'n']);
});

test('PromptDetector extracts numbered options', async () => {
  const prompts = [];
  const detector = new PromptDetector({
    idleMs: 10,
    onPrompt: (lastLines, options) => prompts.push({ lastLines, options }),
  });

  detector.feed('请选择：\n1. 接受\n2. 拒绝\n');
  await wait(30);
  detector.stop();

  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].options, ['1. 接受', '2. 拒绝']);
});
