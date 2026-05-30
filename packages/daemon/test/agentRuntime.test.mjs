import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentLoop } from '../dist/models/agentRuntime.js';

// agent tool-use 循环单测：注入 fake callModel / runTool，不打网络、不碰 fs。

const backend = { kind: 'openai-compatible', baseURL: 'http://x', apiKey: '', model: 'm' };
const tool = { type: 'function', function: { name: 'read_file', description: 'r', parameters: { type: 'object' } } };

test('无 tool_calls → single-call，直接返回 finalText', async () => {
  let calls = 0;
  const res = await runAgentLoop({
    backend,
    userPrompt: 'hi',
    callModel: async () => { calls += 1; return { text: 'FINAL', raw: {} }; },
  });
  assert.equal(res.finalText, 'FINAL');
  assert.equal(res.turns, 1);
  assert.equal(res.hitMaxTurns, false);
  assert.equal(calls, 1);
});

test('模型先发 tool_call → 执行工具 → 回填 → 再调得 final', async () => {
  const events = [];
  let turn = 0;
  const seenMessages = [];
  const res = await runAgentLoop({
    backend,
    system: 'sys',
    userPrompt: '看看 a.txt',
    tools: [tool],
    callModel: async ({ messages }) => {
      seenMessages.push(JSON.parse(JSON.stringify(messages)));
      turn += 1;
      if (turn === 1) {
        return { text: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }], raw: {} };
      }
      return { text: 'A 的内容是 hello', raw: {} };
    },
    runTool: async (name, args) => {
      assert.equal(name, 'read_file');
      assert.equal(args, '{"path":"a.txt"}');
      return 'hello';
    },
    onEvent: (ev) => events.push(ev),
  });
  assert.equal(res.finalText, 'A 的内容是 hello');
  assert.equal(res.turns, 2);
  // 第一轮上下文：system + user；第二轮还应包含 assistant(tool_calls) + tool 结果。
  assert.equal(seenMessages[0].length, 2);
  assert.equal(seenMessages[1].some((m) => m.role === 'tool' && m.content === 'hello'), true);
  assert.equal(seenMessages[1].some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)), true);
  // 事件序列含 tool-call 与 tool-result。
  assert.equal(events.some((e) => e.kind === 'tool-call' && e.name === 'read_file'), true);
  assert.equal(events.some((e) => e.kind === 'tool-result' && e.result === 'hello'), true);
});

test('工具抛错被收成 tool 消息回填，不崩循环', async () => {
  let turn = 0;
  let toolMsg = null;
  const res = await runAgentLoop({
    backend,
    userPrompt: 'go',
    tools: [tool],
    callModel: async ({ messages }) => {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }], raw: {} };
      toolMsg = messages.find((m) => m.role === 'tool');
      return { text: '已处理错误', raw: {} };
    },
    runTool: async () => { throw new Error('disk gone'); },
  });
  assert.equal(res.finalText, '已处理错误');
  assert.match(toolMsg.content, /tool error: disk gone/);
});

test('maxTurns 触顶：模型一直发 tool_calls 时按上限收尾', async () => {
  let calls = 0;
  const events = [];
  const res = await runAgentLoop({
    backend,
    userPrompt: 'loop',
    tools: [tool],
    maxTurns: 3,
    callModel: async () => {
      calls += 1;
      return { text: `t${calls}`, toolCalls: [{ id: `c${calls}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }], raw: {} };
    },
    runTool: async () => 'ok',
    onEvent: (ev) => events.push(ev),
  });
  assert.equal(calls, 3);
  assert.equal(res.turns, 3);
  assert.equal(res.hitMaxTurns, true);
  assert.equal(events.some((e) => e.kind === 'max-turns' && e.turns === 3), true);
});

test('声明 tools 但没 runTool → 不执行，返回现有文本收尾', async () => {
  const res = await runAgentLoop({
    backend,
    userPrompt: 'go',
    tools: [tool],
    callModel: async () => ({ text: 'partial', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }], raw: {} }),
    // 无 runTool
  });
  assert.equal(res.finalText, 'partial');
  assert.equal(res.turns, 1);
});
