import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

// W-20 重建：工作流控制台前端的 jsdom 覆盖。替代已删除的 chatWorkflowSnapshot.test.mjs
// （那测的是监听式 workflow-snapshot 渲染，已随旧 UI 移除）。
// 因为 WebView2 无法在 CI / 本地无头环境真跑，这里用 jsdom 加载 chat.js 并通过
// window.CODEPANION.__test 暴露的内部函数断言控制台的核心渲染与消息处理逻辑。

const here = dirname(fileURLToPath(import.meta.url));
const chatSource = readFileSync(resolve(here, '../../gui/wwwroot/chat.js'), 'utf8');

// 构造一份和重建后 chat.html 对齐的最小 DOM；缺任何 id 都会让对应 render 静默跳过。
const SHELL = `<!doctype html><html><body>
  <div id="app-shell">
    <span class="status-dot"></span><span class="status-text"></span>
    <input id="workspace-input"><datalist id="workspace-recents"></datalist>
    <button id="workspace-apply"></button><button id="workspace-clear"></button>
    <div id="def-list"></div><div id="runs-list"></div><div id="gates-list"></div>
    <h2 id="center-title"></h2><span id="center-status"></span><button id="run-cancel"></button>
    <div id="timeline-empty"></div><div id="timeline-steps"></div>
    <section id="gate-panel"><p id="gate-target"></p>
      <textarea id="gate-constraints"></textarea><input id="gate-message">
      <button id="gate-approve"></button><button id="gate-retry"></button><button id="gate-reject"></button>
    </section>
    <span id="artifact-count"></span><div id="artifact-list"></div>
    <button id="delivery-markdown"></button><button id="delivery-handoff"></button>
    <pre id="delivery-output"></pre><pre id="step-output-detail"></pre>
    <span id="board-status"></span>
  </div>
</body></html>`;

function loadConsole() {
  const dom = new JSDOM(SHELL, { runScripts: 'outside-only', url: 'https://codepanion.local/' });
  const sent = [];
  // 桩掉 WebView2 bridge：捕获 sendToHost 发出的消息，并提供 addEventListener no-op。
  dom.window.chrome = { webview: { postMessage: (m) => sent.push(m), addEventListener: () => {} } };
  dom.window.CODEPANION_TEST = true;
  dom.window.eval(chatSource);
  // jsdom 在 eval 时 readyState 常为 'loading'，chat.js 会挂 DOMContentLoaded 监听而非立即 initApp；
  // 主动派发一次确保 initApp 跑过（若已跑过则无监听，此派发为 no-op）。
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const api = dom.window.CODEPANION;
  return { dom, window: dom.window, document: dom.window.document, t: api.__test, sent, handleMessage: api.handleMessage };
}

test('initApp 起手发 ready + 拉 board，连接状态默认未连接', () => {
  const { sent, document } = loadConsole();
  assert.ok(sent.some((m) => m.type === 'ready'), '应当发 ready');
  assert.ok(sent.some((m) => m.type === 'request-workflow-board'), '应当请求 board');
  assert.equal(document.querySelector('.status-text').textContent, '未连接');
});

test('applyWorkflowBoard 渲染 workflow / runs / gates 三列', () => {
  const { t, document } = loadConsole();
  t.applyWorkflowBoard({
    workflows: [{ name: 'demo', description: 'd', stepCount: 2 }],
    runs: [{ id: 'run-1', workflowName: 'demo', status: 'success', stepCount: 2 }],
    gates: [{ runId: 'run-9', workflowName: 'demo', stepId: 'review', role: 'reviewer' }],
  });
  assert.equal(document.querySelectorAll('#def-list .board-card').length, 1);
  assert.equal(document.querySelectorAll('#runs-list .board-card').length, 1);
  assert.equal(document.querySelectorAll('#gates-list .board-card').length, 1);
  // run 卡片按状态染色（data-status 用于 CSS left-border）。
  assert.equal(document.querySelector('#runs-list .board-card').dataset.status, 'success');
});

test('点 workflow 启动卡片发 request-workflow-launch', () => {
  const { t, document, sent } = loadConsole();
  t.applyWorkflowBoard({ workflows: [{ name: 'demo', stepCount: 1 }], runs: [], gates: [] });
  document.querySelector('#def-list .board-card .board-action').click();
  const launch = sent.find((m) => m.type === 'request-workflow-launch');
  assert.ok(launch, '应当发 launch');
  assert.equal(launch.workflow, 'demo');
});

test('selectRun 拉详情 + delivery，applyRunDetail 渲染时间线步骤', () => {
  const { t, document, sent } = loadConsole();
  t.selectRun('run-1');
  assert.ok(sent.some((m) => m.type === 'request-workflow-run' && m.runId === 'run-1'));
  assert.ok(sent.some((m) => m.type === 'request-delivery' && m.runId === 'run-1'));
  t.applyRunDetail('run-1', {
    id: 'run-1', workflowName: 'demo', status: 'success',
    steps: [
      { id: 'build', status: 'success', exitCode: 0, output: { stdout: 'OK', stderr: '', truncated: false } },
      { id: 'publish', status: 'success', exitCode: 0 },
    ],
  });
  assert.equal(document.getElementById('timeline-empty').hidden, true);
  assert.equal(document.querySelectorAll('#timeline-steps .step-row').length, 2);
  assert.equal(document.getElementById('center-status').dataset.status, 'success');
});

test('applyRunEvent 实时更新：run-start/step-start/step-output/step-finish/run-finish', () => {
  const { t, document, sent } = loadConsole();
  t.selectRun('run-live');
  t.applyRunEvent({ action: 'run-start', runId: 'run-live', workflowName: 'live-wf' });
  t.applyRunEvent({ action: 'step-start', runId: 'run-live', stepId: 's1', status: 'running', role: 'builder' });
  t.applyRunEvent({ action: 'step-output', runId: 'run-live', stepId: 's1', stream: 'stdout', chunk: 'hello ' });
  t.applyRunEvent({ action: 'step-output', runId: 'run-live', stepId: 's1', stream: 'stdout', chunk: 'world' });
  t.applyRunEvent({ action: 'step-output', runId: 'run-live', stepId: 's1', stream: 'stderr', chunk: 'warn' });
  t.applyRunEvent({ action: 'step-finish', runId: 'run-live', stepId: 's1', status: 'success', exitCode: 0 });

  const run = t.state.runs.get('run-live');
  assert.equal(run.workflowName, 'live-wf');
  const step = run.steps.find((s) => s.id === 's1');
  assert.equal(step.status, 'success');
  assert.equal(step.output.stdout, 'hello world');
  assert.equal(step.output.stderr, 'warn');
  assert.equal(step.exitCode, 0);
  // 时间线已渲染该 step。
  assert.equal(document.querySelectorAll('#timeline-steps .step-row').length, 1);

  // run-finish 应触发一次 board 重拉。
  const before = sent.filter((m) => m.type === 'request-workflow-board').length;
  t.applyRunEvent({ action: 'run-finish', runId: 'run-live', status: 'success' });
  const after = sent.filter((m) => m.type === 'request-workflow-board').length;
  assert.equal(after, before + 1, 'run-finish 后应重拉 board');
  assert.equal(t.state.runs.get('run-live').status, 'success');
});

test('selectGate 显示决策面板，submitGateDecision 组装 constraints/message 并发请求', () => {
  const { t, document, sent } = loadConsole();
  t.selectGate({ runId: 'run-9', stepId: 'review', workflowName: 'demo', role: 'reviewer' });
  assert.equal(document.getElementById('gate-panel').hidden, false);
  assert.match(document.getElementById('gate-target').textContent, /run-9/);

  document.getElementById('gate-constraints').value = 'use-typescript\nno-new-deps\n';
  document.getElementById('gate-message').value = 'looks-good';
  t.submitGateDecision('approve');

  const resolve = sent.find((m) => m.type === 'request-gate-resolve');
  assert.ok(resolve, '应当发 gate resolve');
  assert.equal(resolve.runId, 'run-9');
  assert.equal(resolve.stepId, 'review');
  assert.equal(resolve.decision, 'approve');
  // constraints 数组来自 jsdom window realm，原型链与 node 不同，deepStrictEqual 会误判；
  // 用 Array.from 归一到当前 realm 再比。
  assert.deepEqual(Array.from(resolve.constraints), ['use-typescript', 'no-new-deps']);
  assert.equal(resolve.message, 'looks-good');
  // 提交后门焦点清空、面板隐藏。
  assert.equal(t.state.selectedGate, null);
  assert.equal(document.getElementById('gate-panel').hidden, true);
});

test('applyWorkspace 设置 workspace、发 set-workspace + 重拉 board、记最近列表', () => {
  const { t, sent } = loadConsole();
  const baseBoard = sent.filter((m) => m.type === 'request-workflow-board').length;
  t.applyWorkspace('D:\\proj\\alpha');
  assert.equal(t.state.workspace, 'D:\\proj\\alpha');
  assert.ok(sent.some((m) => m.type === 'set-workspace' && m.workspace === 'D:\\proj\\alpha'));
  const afterBoard = sent.filter((m) => m.type === 'request-workflow-board').length;
  assert.ok(afterBoard > baseBoard, '切 workspace 应重拉 board');
  assert.ok(t.state.recentWorkspaces.includes('D:\\proj\\alpha'));
});

test('applyDelivery 把交付摘要文本落到 #delivery-output', () => {
  const { t, document } = loadConsole();
  t.selectRun('run-1');
  t.applyDelivery('run-1', 'handoff', { content: 'CONTINUE THIS WORKFLOW', files: [] });
  assert.match(document.getElementById('delivery-output').textContent, /CONTINUE THIS WORKFLOW/);
});

test('handleMessage 路由 connection-status 与 workflow-board', () => {
  const { handleMessage, document } = loadConsole();
  handleMessage({ type: 'connection-status', connected: true });
  assert.equal(document.querySelector('.status-text').textContent, '已连接');
  handleMessage({ type: 'workflow-board', board: { workflows: [], runs: [], gates: [] } });
  assert.match(document.getElementById('board-status').textContent, /workflows=0/);
});
