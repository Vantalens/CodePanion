import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const vendorSource = readFileSync(resolve(here, '../../gui/wwwroot/vendor/codepanion-markdown.js'), 'utf8');
const chatSource = readFileSync(resolve(here, '../../gui/wwwroot/chat.js'), 'utf8');

function loadChat() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="app-shell"></div>
      <span class="status-dot"></span>
      <span class="status-text"></span>
      <div id="conversation-list"></div>
      <strong id="queue-total"></strong>
      <strong id="queue-waiting"></strong>
      <strong id="queue-running"></strong>
      <strong id="queue-error"></strong>
      <section id="chat-container"></section>
      <div id="code-list"></div>
      <article id="code-preview"></article>
      <h2 id="conversation-title"></h2>
      <span id="stage-source"></span>
      <span id="stage-capability"></span>
      <span id="stage-status"></span>
      <button id="stage-focus-reply"></button>
      <button id="stage-copy-context"></button>
      <strong id="drawer-source-name"></strong>
      <p id="drawer-source-detail"></p>
      <strong id="drawer-capability"></strong>
      <strong id="drawer-privacy"></strong>
      <p id="drawer-action-note"></p>
      <button id="drawer-focus-reply"></button>
      <button id="drawer-copy-workspace"></button>
      <div id="drawer-subtitle"></div>
      <div id="code-count"></div>
      <footer id="omnibar"></footer>
      <input id="omnibar-input">
      <button id="omnibar-submit"></button>
    </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  dom.window.CODEPANION_TEST = true;
  dom.window.eval(vendorSource);
  dom.window.eval(chatSource);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom.window;
}

test('workflow snapshot replaces stale WebView workflow state after reconnect', () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'old-thread', source: 'codex-desktop', title: 'Old', status: 'waiting', updatedAt: 100, itemCount: 1 }],
      items: [{
        id: 'old-item',
        threadId: 'old-thread',
        source: 'codex-desktop',
        kind: 'artifact',
        title: 'old artifact',
        content: '```js\nconsole.log("old")\n```',
        status: 'waiting',
        timestamp: 100,
      }],
    },
  });

  assert.equal(state.workflowThreads.has('old-thread'), true);
  assert.equal(state.conversations.has('workflow:old-thread'), true);
  assert.equal(state.codeBlocks.some((block) => block.conversationId === 'workflow:old-thread'), true);

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'new-thread', source: 'cli', title: 'New', status: 'running', updatedAt: 200, itemCount: 1 }],
      items: [{
        id: 'new-item',
        threadId: 'new-thread',
        source: 'cli',
        kind: 'message',
        title: 'assistant',
        content: 'current state',
        timestamp: 200,
      }],
    },
  });

  assert.equal(state.workflowThreads.has('old-thread'), false);
  assert.equal(state.workflowItemsByThread.has('old-thread'), false);
  assert.equal(state.workflowItemIds.has('old-item'), false);
  assert.equal(state.conversations.has('workflow:old-thread'), false);
  assert.equal(state.codeBlocks.some((block) => block.conversationId === 'workflow:old-thread'), false);
  assert.equal(state.workflowThreads.has('new-thread'), true);
  assert.equal(state.conversations.has('workflow:new-thread'), true);
});

test('passive config switcher workflow activity is not shown as a task', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'cc-thread', source: 'cc-switch', title: 'com.ccswitch.desktop-siw', status: 'running', updatedAt: 200, itemCount: 1 }],
      items: [{
        id: 'cc-item',
        threadId: 'cc-thread',
        source: 'cc-switch',
        kind: 'status',
        title: 'CC Switch 已识别',
        content: 'CC Switch 正在运行，CodePanion 已将其纳入本地 AI 工具来源监控。',
        status: 'running',
        timestamp: 200,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:cc-thread'), false);
  assert.equal(state.activeConversation, '');
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 0);
  assert.match(win.document.getElementById('conversation-list').textContent, /当前没有可显示的任务/);
});

test('omnibar is hidden when the selected task has no actionable reply target', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'cli-thread', source: 'cli', title: 'cmd.exe', status: 'running', updatedAt: 200, itemCount: 1 }],
      items: [{
        id: 'cli-item',
        threadId: 'cli-thread',
        source: 'cli',
        kind: 'command',
        title: '终端输出',
        content: 'running',
        status: 'running',
        timestamp: 200,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(win.document.getElementById('omnibar').hidden, true);
  assert.equal(win.document.getElementById('omnibar-input').disabled, true);
});

test('internal approval transcripts are not shown as user tasks', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'approval-thread', source: 'codex-desktop', title: 'The following is the Codex agent h', status: 'running', updatedAt: 300, itemCount: 2 }],
      items: [
        {
          id: 'approval-transcript',
          threadId: 'approval-thread',
          source: 'codex-desktop',
          kind: 'message',
          title: 'user',
          content: 'The following is the Codex agent history added since your last approval assessment. Continue the same review conversation.',
          timestamp: 300,
        },
        {
          id: 'approval-outcome',
          threadId: 'approval-thread',
          source: 'codex-desktop',
          kind: 'message',
          title: 'assistant',
          content: '{"outcome":"allow"}',
          timestamp: 301,
        },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:approval-thread'), false);
  assert.equal(state.activeConversation, '');
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 0);
});

test('status-only shell sessions are not shown as actionable tasks', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'shell-thread', source: 'cli', title: 'cmd.exe', status: 'running', updatedAt: 400, itemCount: 2 }],
      items: [
        {
          id: 'shell-start',
          threadId: 'shell-thread',
          source: 'cli',
          kind: 'status',
          title: '会话开始',
          content: 'cmd.exe /c exit 0',
          status: 'running',
          timestamp: 400,
        },
        {
          id: 'shell-end',
          threadId: 'shell-thread',
          source: 'cli',
          kind: 'status',
          title: '会话结束',
          content: '退出码：0',
          status: 'done',
          timestamp: 401,
        },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:shell-thread'), false);
  assert.equal(state.activeConversation, '');
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 0);
});
