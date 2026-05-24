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
      <button class="rail-button" data-view="active"></button>
      <button class="rail-button" data-view="waiting"></button>
      <button class="rail-button" data-view="running"></button>
      <button class="rail-button" data-view="error"></button>
      <button class="rail-button" data-view="done"></button>
      <button class="rail-button" data-view="later"></button>
      <button class="rail-button" data-view="code"></button>
      <button class="tool-button" data-view="active"></button>
      <button class="tool-button" data-view="waiting"></button>
      <button class="tool-button" data-view="running"></button>
      <button class="tool-button" data-view="error"></button>
      <button class="tool-button" data-view="done"></button>
      <button class="tool-button" data-view="later"></button>
      <button class="tool-button" data-view="code"></button>
      <button class="group-button" data-group-mode="workspace"></button>
      <button class="group-button" data-group-mode="source"></button>
      <button class="group-button" data-group-mode="none"></button>
      <span class="status-dot"></span>
      <span class="status-text"></span>
      <section id="source-status-panel">
        <div class="source-status-row" data-source-kind="vscode">
          <span class="source-status-dot" data-state="offline"></span>
          <p id="vscode-source-status"></p>
        </div>
      </section>
      <div id="conversation-list"></div>
      <div id="batch-toolbar"></div>
      <button id="batch-toggle"></button>
      <span id="batch-selection-count"></span>
      <button id="batch-restore"></button>
      <button id="batch-archive"></button>
      <button id="batch-snooze"></button>
      <button id="batch-pin"></button>
      <button id="batch-priority-high"></button>
      <button id="batch-priority-normal"></button>
      <button id="batch-priority-low"></button>
      <button id="batch-clear"></button>
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
      <button id="stage-suggested-action"></button>
      <button id="stage-suggested-secondary"></button>
      <button id="stage-pin-task"></button>
      <button id="stage-snooze-task"></button>
      <button id="stage-archive-task"></button>
      <button id="stage-copy-context"></button>
      <button id="stage-priority-high"></button>
      <button id="stage-priority-normal"></button>
      <button id="stage-priority-low"></button>
      <button id="stage-move-up"></button>
      <button id="stage-move-down"></button>
      <div id="stage-snooze-menu"></div>
      <strong id="spotlight-next-action"></strong>
      <p id="spotlight-subaction"></p>
      <strong id="spotlight-project"></strong>
      <p id="spotlight-workspace"></p>
      <strong id="spotlight-management"></strong>
      <p id="spotlight-updated"></p>
      <strong id="spotlight-summary"></strong>
      <p id="spotlight-breakdown"></p>
      <strong id="drawer-source-name"></strong>
      <p id="drawer-source-detail"></p>
      <strong id="drawer-capability"></strong>
      <strong id="drawer-privacy"></strong>
      <p id="drawer-action-note"></p>
      <button id="drawer-focus-reply"></button>
      <button id="drawer-suggested-action"></button>
      <button id="drawer-suggested-secondary"></button>
      <button id="drawer-pin-task"></button>
      <button id="drawer-snooze-task"></button>
      <button id="drawer-archive-task"></button>
      <button id="drawer-copy-workspace"></button>
      <select id="drawer-handoff-target">
        <option value="generic">通用</option>
        <option value="codex">Codex</option>
        <option value="claude-code">Claude Code</option>
        <option value="opencode">OpenCode</option>
      </select>
      <button id="drawer-copy-handoff"></button>
      <button id="drawer-copy-handoff-prompt"></button>
      <button id="drawer-start-handoff"></button>
      <button id="drawer-mark-handoff-active"></button>
      <button id="drawer-return-handoff"></button>
      <button id="drawer-clear-handoff"></button>
      <pre id="drawer-handoff-preview"></pre>
      <button id="drawer-priority-high"></button>
      <button id="drawer-priority-normal"></button>
      <button id="drawer-priority-low"></button>
      <button id="drawer-move-up"></button>
      <button id="drawer-move-down"></button>
      <div id="drawer-snooze-menu"></div>
      <div id="drawer-linked-session-panel"></div>
      <strong id="drawer-linked-session-title"></strong>
      <p id="drawer-linked-session-note"></p>
      <button id="drawer-jump-linked-session"></button>
      <div id="drawer-parent-task-panel"></div>
      <strong id="drawer-parent-task-title"></strong>
      <p id="drawer-parent-task-note"></p>
      <button id="drawer-jump-parent-task"></button>
      <div id="drawer-subtitle"></div>
      <div id="code-count"></div>
      <footer id="omnibar"></footer>
      <input id="omnibar-input">
      <button id="omnibar-submit"></button>
    </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const hostMessages = [];
  dom.window.chrome = {
    webview: {
      postMessage(message) {
        hostMessages.push(message);
      },
      addEventListener() {},
    },
  };
  dom.window.CSS = dom.window.CSS || { escape: (value) => String(value) };
  dom.window.CODEPANION_TEST = true;
  dom.window.eval(vendorSource);
  dom.window.eval(chatSource);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  dom.window.__hostMessages = hostMessages;
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
  assert.match(win.document.getElementById('conversation-list').textContent, /当前没有正在同步的任务/);
});

test('omnibar stays visible but disabled when the selected task has no reply target', async () => {
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

  assert.equal(win.document.getElementById('omnibar').hidden, false);
  assert.equal(win.document.getElementById('omnibar-input').disabled, true);
});

test('session prompts expose the omnibar for typed replies', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'session:prompt-thread', source: 'cli', title: 'codex', status: 'waiting', updatedAt: now, itemCount: 1 }],
      items: [{
        id: 'prompt-without-options',
        threadId: 'session:prompt-thread',
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: 'Password:',
        status: 'waiting',
        timestamp: now,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(win.document.getElementById('omnibar').hidden, false);
  assert.equal(win.document.getElementById('omnibar-input').disabled, false);
  assert.equal(win.document.getElementById('stage-focus-reply').hidden, false);
  // 自由文本 session prompt 同时渲染 inline custom-input（freeform 注入）+ 启用 omnibar，详见 H4。
  assert.ok(win.document.querySelector('.custom-input'), 'inline freeform 输入框应存在');

  handleMessage({
    type: 'workflow-event',
    data: {
      action: 'item-append',
      item: {
        id: 'prompt-with-options',
        threadId: 'session:prompt-thread',
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: 'Continue?',
        status: 'waiting',
        timestamp: now + 1,
        options: ['yes', 'no'],
      },
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(win.document.getElementById('omnibar').hidden, false);
  assert.equal(win.document.getElementById('omnibar-input').disabled, false);
  assert.equal(win.document.getElementById('stage-focus-reply').hidden, false);
  assert.equal(win.document.querySelectorAll('.option-button').length, 2);

  win.document.querySelector('.option-button').click();
  assert.doesNotMatch(win.document.getElementById('chat-container').textContent, /您的回复/);
});

test('session prompts without options render a freeform input box', async () => {
  // H4：自由文本 session prompt（密码、文件名）在 PTY 接管会话下，GUI 直接给出输入框，
  // 用户可在 GUI 内回写到 PTY（mode=freeform），不再要求回到 CLI 终端。
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'session:freeform', source: 'cli', title: 'codex', status: 'waiting', updatedAt: now, itemCount: 1 }],
      items: [{
        id: 'freeform-prompt',
        threadId: 'session:freeform',
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: 'Password:',
        status: 'waiting',
        timestamp: now,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const input = win.document.querySelector('.custom-input');
  assert.ok(input, '应渲染 .custom-input 让用户在 GUI 内回写到 PTY');
  assert.equal(input.type, 'text');
  assert.match(input.placeholder, /自由文本|PTY/);
  assert.equal(win.document.querySelector('.option-button'), null);
});

test('sources-snapshot replaces stale sources after observer reconnect', async () => {
  // H1：sources-snapshot 是权威列表，未出现的来源必须被清掉，
  // 否则 disconnect 事件丢失时会留下永久"online"的死来源。
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;

  handleMessage({ type: 'source-registered', source: { id: 'stale-source', kind: 'cli', name: 'stale', status: 'online' } });
  handleMessage({ type: 'source-registered', source: { id: 'kept-source', kind: 'cli', name: 'kept', status: 'online' } });
  assert.equal(state.sources.size, 2);

  handleMessage({
    type: 'sources-snapshot',
    sources: [
      { id: 'kept-source', kind: 'cli', name: 'kept', status: 'online' },
      { id: 'fresh-source', kind: 'cli', name: 'fresh', status: 'online' },
    ],
  });

  assert.equal(state.sources.has('stale-source'), false);
  assert.equal(state.sources.has('kept-source'), true);
  assert.equal(state.sources.has('fresh-source'), true);
});

test('sidebar shows VS Code extension connection state from sources snapshot', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;

  handleMessage({ type: 'connection-status', connected: true });
  assert.match(win.document.getElementById('vscode-source-status').textContent, /未连接/);
  assert.equal(win.document.querySelector('[data-source-kind="vscode"] .source-status-dot').dataset.state, 'offline');

  handleMessage({
    type: 'sources-snapshot',
    sources: [
      { id: 'vscode-source', kind: 'vscode', name: 'VS Code', status: 'online', workspace: 'D:\\CodePanion' },
    ],
  });

  assert.match(win.document.getElementById('vscode-source-status').textContent, /在线/);
  assert.equal(win.document.querySelector('[data-source-kind="vscode"] .source-status-dot').dataset.state, 'online');
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

test('new workflow events do not steal the selected task', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'task-a', source: 'codex-desktop', title: 'Task A', status: 'running', updatedAt: now - 2000, itemCount: 1 },
        { id: 'task-b', source: 'codex-desktop', title: 'Task B', status: 'running', updatedAt: now - 1000, itemCount: 1 },
      ],
      items: [
        { id: 'a-msg', threadId: 'task-a', source: 'codex-desktop', kind: 'message', title: 'assistant', content: 'Task A content', timestamp: now - 2000 },
        { id: 'b-msg', threadId: 'task-b', source: 'codex-desktop', kind: 'message', title: 'assistant', content: 'Task B content', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  state.activeConversation = 'workflow:task-a';
  win.CodePanion.__test.renderAll();

  handleMessage({
    type: 'workflow-event',
    data: {
      action: 'item-append',
      item: {
        id: 'b-msg-2',
        threadId: 'task-b',
        source: 'codex-desktop',
        kind: 'message',
        title: 'assistant',
        content: 'Task B newer content',
        timestamp: now,
      },
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.activeConversation, 'workflow:task-a');
  assert.match(win.document.getElementById('conversation-title').textContent, /Task A/);
  assert.match(state.conversations.get('workflow:task-b').lastContent, /Task B newer content/);
});

test('command workflow items are folded into execution details instead of primary messages', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'mixed-thread', source: 'codex-desktop', title: 'Mixed task', status: 'running', updatedAt: now, itemCount: 3 }],
      items: [
        { id: 'goal', threadId: 'mixed-thread', source: 'codex-desktop', kind: 'message', title: 'user', content: 'Fix the GUI', timestamp: now - 2000 },
        { id: 'cmd', threadId: 'mixed-thread', source: 'codex-desktop', kind: 'command', title: 'cmd.exe', content: 'dotnet build packages/gui/CodePanion.Gui.csproj -c Release\nBuild FAILED.', status: 'error', timestamp: now - 1000 },
        { id: 'assistant', threadId: 'mixed-thread', source: 'codex-desktop', kind: 'message', title: 'assistant', content: 'The GUI build fails because daemon.cjs is missing.', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const chatText = win.document.getElementById('chat-container').textContent;
  assert.match(chatText, /The GUI build fails/);
  assert.match(chatText, /执行记录/);
  assert.doesNotMatch(chatText, /\*\*命令\/输出：cmd\.exe\*\*/);

  const rawDetails = win.document.querySelector('.workflow-details');
  assert.ok(rawDetails);
  assert.equal(rawDetails.open, false);
  assert.match(rawDetails.textContent, /cmd\.exe/);
});

test('active conversation does not force autoscroll while user is reading older content', async () => {
  const win = loadChat();
  const { state } = win.CodePanion.__test;
  const container = win.document.getElementById('chat-container');
  let scrollCalls = 0;

  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1200 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(container, 'scrollTop', { configurable: true, writable: true, value: 0 });
  container.scrollTo = () => {
    scrollCalls += 1;
  };

  win.CodePanion.addMessage({
    id: 'session-first',
    type: 'activity',
    source: 'cli',
    sessionId: 'stable-session',
    timestamp: Date.now() - 1000,
    content: 'first output',
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));
  scrollCalls = 0;
  state.activeConversation = 'session:stable-session';
  container.scrollTop = 0;

  win.CodePanion.addMessage({
    id: 'session-second',
    type: 'activity',
    source: 'cli',
    sessionId: 'stable-session',
    timestamp: Date.now(),
    content: 'new output while reading older content',
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.activeConversation, 'session:stable-session');
  assert.equal(scrollCalls, 0);
});

test('rendering the same task preserves existing message DOM state', async () => {
  const win = loadChat();

  win.CodePanion.addMessage({
    id: 'stable-message',
    type: 'activity',
    source: 'cli',
    sessionId: 'stable-session',
    timestamp: Date.now(),
    content: 'Execution record',
    rawItems: [
      { id: 'cmd', title: 'cmd.exe', content: 'dotnet build', status: 'running' },
    ],
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const messageBefore = win.document.querySelector('[data-message-id]');
  const detailsBefore = win.document.querySelector('.workflow-details');
  assert.ok(messageBefore);
  assert.ok(detailsBefore);
  detailsBefore.open = true;

  win.CodePanion.__test.renderAll();

  assert.equal(win.document.querySelector('[data-message-id]'), messageBefore);
  assert.equal(win.document.querySelector('.workflow-details').open, true);
});

// P0.3：左侧任务列表必须用固定 6 档状态文案 + 下一步动作，不再直接吐原始消息内容。
test('conversation list shows fixed 6-state status labels with next-step action text', () => {
  const win = loadChat();
  const { deriveConversationDisplay } = win.CodePanion.__test;

  const waiting = deriveConversationDisplay({ id: 't1', status: 'prompt', source: 'cli' });
  assert.equal(waiting.kind, 'waiting-me');
  assert.equal(waiting.label, '等待我');
  assert.match(waiting.action, /选择|回复/);

  const error = deriveConversationDisplay({ id: 't2', status: 'error', source: 'cli' });
  assert.equal(error.kind, 'error');
  assert.equal(error.label, '失败');
  assert.match(error.action, /错误|诊断/);

  const review = deriveConversationDisplay({ id: 't3', status: 'done', source: 'cli', codeCount: 2, fileChangeCount: 1 });
  assert.equal(review.kind, 'review');
  assert.equal(review.label, '需审阅');
  assert.match(review.action, /产物|查看/);

  const returnedSuccess = deriveConversationDisplay({
    id: 't3b',
    status: 'prompt',
    source: 'cli',
    taskState: { handoffStatus: 'returned', handoffTarget: 'codex' },
  });
  assert.equal(returnedSuccess.kind, 'waiting-me');
  assert.equal(returnedSuccess.label, '等待我');
  assert.match(returnedSuccess.action, /审阅接力结果并决定下一步/);

  const done = deriveConversationDisplay({ id: 't4', status: 'done', source: 'cli' });
  assert.equal(done.kind, 'done');
  assert.equal(done.label, '完成');

  const returnedFailure = deriveConversationDisplay({
    id: 't4b',
    status: 'error',
    source: 'cli',
    taskState: { handoffStatus: 'returned', handoffTarget: 'codex' },
  });
  assert.equal(returnedFailure.kind, 'error');
  assert.equal(returnedFailure.label, '失败');
  assert.match(returnedFailure.action, /查看接力失败摘要并决定是否重试/);

  const sourceOnline = deriveConversationDisplay({ id: 't5', status: 'activity', source: 'cc-switch' });
  assert.equal(sourceOnline.kind, 'source-online');
  assert.equal(sourceOnline.label, '来源在线');

  // 2026-05-24：来源已离线时把运行中类状态降级为 "来源已离线"，
  // 防止"Codex 已关掉但 GUI 还显示运行中"这种与现实脱节的展示。
  const sourceOffline = deriveConversationDisplay({
    id: 't5b', status: 'activity', source: 'codex', sourceOnline: false,
  });
  assert.equal(sourceOffline.kind, 'source-offline');
  assert.equal(sourceOffline.label, '来源已离线');
  assert.match(sourceOffline.action, /确认|工具|运行/);

  // 等待我 / 失败 / 需审阅 是用户必须处理的高优先级状态，
  // 即使来源已离线也不能降级——否则会盖掉真正需要回复的任务。
  const offlineButWaiting = deriveConversationDisplay({
    id: 't5c', status: 'prompt', source: 'codex', sourceOnline: false,
  });
  assert.equal(offlineButWaiting.kind, 'waiting-me');

  const offlineButError = deriveConversationDisplay({
    id: 't5d', status: 'error', source: 'codex', sourceOnline: false,
  });
  assert.equal(offlineButError.kind, 'error');

  const running = deriveConversationDisplay({ id: 't6', status: 'activity', source: 'cli', commandCount: 3 });
  assert.equal(running.kind, 'running');
  assert.equal(running.label, '运行中');
  assert.match(running.action, /命令|输出/);
});

test('conversation list preview is the derived action, not the raw last message content', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'cli-prompt', source: 'cli', title: 'codex run', status: 'waiting', updatedAt: now, itemCount: 2 }],
      items: [
        { id: 'cli-prompt-out', threadId: 'cli-prompt', source: 'cli', kind: 'command', title: '终端输出', content: 'npm install\nadded 142 packages', status: 'running', timestamp: now - 10 },
        { id: 'cli-prompt-q', threadId: 'cli-prompt', source: 'cli', kind: 'prompt', title: '等待输入', content: '是否继续？', options: ['1) 是', '2) 否'], status: 'waiting', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const item = win.document.querySelector('.conversation-item');
  assert.ok(item, '应渲染出一条任务');
  assert.equal(item.dataset.displayStatus, 'waiting-me');
  const preview = item.querySelector('.conversation-preview').textContent;
  // 不应包含命令原始片段
  assert.equal(preview.includes('npm install'), false);
  assert.equal(preview.includes('added 142 packages'), false);
  assert.match(preview, /选择|回复/);
  const statusChip = item.querySelector('.status-chip').textContent;
  assert.equal(statusChip, '等待我');
});

// P1.1：等待我必须固定在队列最前，普通输出再多再新都不能盖掉它。
test('waiting-me tasks are pinned to the top of the conversation list', async () => {
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        // running 任务时间最新；prompt 任务时间稍旧；按 lastAt 倒序时 prompt 会被压到后面，
        // 这条测试用来防止这种回退。
        { id: 'busy', source: 'cli', title: 'busy task', status: 'running', updatedAt: now, itemCount: 1 },
        { id: 'ask', source: 'cli', title: 'ask user', status: 'waiting', updatedAt: now - 5000, itemCount: 1 },
        { id: 'dead', source: 'cli', title: 'finished task', status: 'done', updatedAt: now - 2000, itemCount: 1 },
      ],
      items: [
        { id: 'busy-out', threadId: 'busy', source: 'cli', kind: 'message', title: 'assistant', content: 'still working', timestamp: now },
        { id: 'ask-q', threadId: 'ask', source: 'cli', kind: 'prompt', title: '等待输入', content: 'Continue?', options: ['yes', 'no'], status: 'waiting', timestamp: now - 5000 },
        { id: 'dead-out', threadId: 'dead', source: 'cli', kind: 'message', title: 'assistant', content: 'all done', timestamp: now - 2000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const items = Array.from(win.document.querySelectorAll('.conversation-item'));
  assert.ok(items.length >= 2, '应渲染出多条任务');
  // 第一条必须是等待我，不管它 lastAt 是否更旧。
  assert.equal(items[0].dataset.displayStatus, 'waiting-me');
  assert.match(items[0].querySelector('.conversation-title-text').textContent, /ask user/);
});

test('prompts without a real reply target do not render any reply entry', async () => {
  // P1.1：threadId 不是 session: 开头且 item.id 不是 monitor: 开头时，
  // 既没法回 CLI 也没法回事件适配器，必须只展示提示文本 + 引导，不渲染按钮/输入。
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'codex-thread', source: 'codex-desktop', title: 'Codex review', status: 'waiting', updatedAt: now, itemCount: 1 }],
      items: [{
        id: 'codex-prompt',
        threadId: 'codex-thread',
        source: 'codex-desktop',
        kind: 'prompt',
        title: '等待输入',
        content: '是否继续？',
        options: ['是', '否'],
        status: 'waiting',
        timestamp: now,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(win.document.querySelector('.option-button'), null, '不应渲染选项按钮');
  assert.equal(win.document.querySelector('.custom-input'), null, '不应渲染自定义输入框');
  const hint = win.document.querySelector('.prompt-hint');
  assert.ok(hint, '应给出"该提示无可回写目标"提示');
  assert.match(hint.textContent, /回到来源工具/);
  assert.equal(win.document.getElementById('omnibar').hidden, false, 'omnibar 保持可见');
  assert.equal(win.document.getElementById('omnibar-input').disabled, true, '无回写目标时输入框禁用');
});

test('session prompt detail surfaces a reply-target line above the options', async () => {
  // P1.1：选项上方明确写"回复将写回 CLI/PTTY 会话"，
  // 用户不必猜回复会去哪。
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'session:codex-shell', source: 'cli', title: 'codex', status: 'waiting', updatedAt: now, itemCount: 1 }],
      items: [{
        id: 'shell-q',
        threadId: 'session:codex-shell',
        source: 'cli',
        kind: 'prompt',
        title: '等待输入',
        content: 'Continue?',
        options: ['yes', 'no'],
        status: 'waiting',
        timestamp: now,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const target = win.document.querySelector('.prompt-target');
  assert.ok(target, '应渲染 .prompt-target 标识回复去向');
  assert.match(target.textContent, /CLI|PTTY|会话/);
  assert.equal(win.document.querySelectorAll('.option-button').length, 2);
});

test('passive source workflow with a real prompt enters the main queue as 等待我', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'qwen-thread', source: 'qwen-code', title: 'Qwen Code', status: 'waiting', updatedAt: now, itemCount: 1 }],
      items: [{
        id: 'qwen-prompt',
        threadId: 'qwen-thread',
        source: 'qwen-code',
        kind: 'prompt',
        title: '等待输入',
        content: '继续？',
        options: ['是', '否'],
        status: 'waiting',
        timestamp: now,
      }],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:qwen-thread'), true);
  const items = win.document.querySelectorAll('.conversation-item');
  assert.equal(items.length, 1);
  assert.equal(items[0].dataset.displayStatus, 'waiting-me');
});

test('VS Code / Claude Code activity is visible in the active task list', async () => {
  // VS Code 端现在承载 Claude Code / Codex 终端输出，activity 必须进入主运行列表；
  // 否则用户看不到 VS Code 里正在发生什么。
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'vscode-thread', source: 'claude-code', title: 'sample - VS Code', status: 'done', updatedAt: now, itemCount: 2, sourceOnline: true }],
      items: [
        { id: 'claude-start', threadId: 'vscode-thread', source: 'claude-code', kind: 'message', title: 'Claude Code 开始执行', content: 'claude', timestamp: now - 1000 },
        { id: 'claude-output', threadId: 'vscode-thread', source: 'claude-code', kind: 'message', title: 'Claude Code 输出', content: '正在修改 src/index.ts', status: 'done', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:vscode-thread'), true, 'Claude Code activity 应入主运行列表');
  const items = win.document.querySelectorAll('.conversation-item');
  assert.equal(items.length, 1);
  const text = win.document.getElementById('conversation-list').textContent;
  assert.match(text, /Claude Code|正在修改 src\/index\.ts/);
});

test('VS Code 来源出现真实失败时才会抬升为主队列任务', async () => {
  // P2.1：但 VS Code 端发出 type=error / level=error 的任务结束事件，
  // 例如 onDidEndTaskProcess 退出码非 0，必须抬升到主队列，让用户能处理失败。
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'vscode-fail-thread', source: 'vscode', title: 'sample - VS Code', status: 'error', updatedAt: now, itemCount: 1 }],
      items: [
        { id: 'task-fail', threadId: 'vscode-fail-thread', source: 'vscode', kind: 'status', title: '任务失败：jest', content: '退出码：1', status: 'error', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:vscode-fail-thread'), true, 'VS Code 失败事件应抬升入主队列');
  const items = win.document.querySelectorAll('.conversation-item');
  assert.equal(items.length, 1);
  assert.equal(items[0].dataset.displayStatus, 'error');
});

test('failure tasks expose an inline error summary and a diagnostics copy action', async () => {
  // P1.2：失败消息必须先在主视图里"具体报了什么"，不必展开 details；
  // 同时给出可一键复制的结构化诊断文本，给 Codex/Claude 接力排查用。
  const win = loadChat();
  const { handleMessage, buildFailureDiagnostics } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'fail-thread', source: 'cli', title: 'Failing task', status: 'error', updatedAt: now, itemCount: 3 }],
      items: [
        { id: 'goal', threadId: 'fail-thread', source: 'cli', kind: 'message', title: 'user', content: 'run tests', timestamp: now - 3000 },
        { id: 'cmd', threadId: 'fail-thread', source: 'cli', kind: 'command', title: 'npm test', content: 'Error: jest exited with code 1', status: 'error', timestamp: now - 2000 },
        { id: 'assistant', threadId: 'fail-thread', source: 'cli', kind: 'message', title: 'assistant', content: '测试失败：jest 退出码 1。', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const summary = win.document.querySelector('.error-summary');
  assert.ok(summary, '失败消息必须在主视图渲染 .error-summary');
  assert.match(summary.textContent, /npm test|jest/);

  const buttons = Array.from(win.document.querySelectorAll('.diagnostics-action .action-button'));
  assert.ok(buttons.some(btn => /复制.*失败.*诊断/.test(btn.textContent)), '应渲染诊断复制按钮');

  // buildFailureDiagnostics 是核心复制内容生成器，单独验证其结构。
  const diagnostics = buildFailureDiagnostics({
    id: 'workflow-group:fail-thread',
    type: 'error',
    source: 'cli',
    conversationId: 'workflow:fail-thread',
    timestamp: now,
    content: '本次任务以失败结束',
    rawItems: [
      { kind: 'command', title: 'npm test', content: 'Error: jest exited with code 1', status: 'error' },
    ],
  });
  assert.match(diagnostics, /# CodePanion 失败诊断/);
  assert.match(diagnostics, /来源：/);
  assert.match(diagnostics, /失败摘要/);
  assert.match(diagnostics, /报错原始事件|最近命令/);
  assert.match(diagnostics, /jest/);
});

test('capability chip exposes Chinese level label and a per-level CSS class', async () => {
  // P1.3：CLI/PTTY 是 L3 可回写会话，弱接入来源（cc-switch 等）必须有不同的视觉色；
  // 文案要直接告诉用户"是只读还是可写、是 L1 进程识别还是 L4 编排"。
  const win = loadChat();
  const { handleMessage, capabilityLevelLabel, capabilityChipClass } = win.CodePanion.__test;
  const now = Date.now();

  assert.match(capabilityLevelLabel('L1'), /L1.*进程识别/);
  assert.match(capabilityLevelLabel('L1-L2'), /L1.*L2.*弱接入/);
  assert.match(capabilityLevelLabel('L2'), /L2.*只读/);
  assert.match(capabilityLevelLabel('L2-L3'), /L2.*L3.*事件可回/);
  assert.match(capabilityLevelLabel('L3'), /L3.*可回写/);
  assert.match(capabilityLevelLabel('L4'), /L4.*工作流编排/);

  assert.equal(capabilityChipClass('L1'), 'capability-l1');
  assert.equal(capabilityChipClass('L1-L2'), 'capability-l1l2');
  assert.equal(capabilityChipClass('L2'), 'capability-l2');
  assert.equal(capabilityChipClass('L2-L3'), 'capability-l2l3');
  assert.equal(capabilityChipClass('L3'), 'capability-l3');
  assert.equal(capabilityChipClass('L4'), 'capability-l4');

  win.CodePanion.addMessage({
    id: 'cli-activity',
    type: 'activity',
    source: 'cli',
    sessionId: 'cli-session',
    timestamp: now,
    content: 'running',
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const conversationChip = win.document.querySelector('.conversation-item .capability-chip');
  assert.ok(conversationChip, '任务列表应展示能力 chip');
  assert.ok(
    Array.from(conversationChip.classList).some(cls => cls.startsWith('capability-l')),
    'CLI 会话的 chip 必须带 capability-lX class，确保色块和能力层级一致'
  );
});

test('weakly-coupled sources surface a lower capability level than CLI sessions', async () => {
  // P1.3：cc-switch 这类只读弱接入来源不能和 CLI / VS Code 一样标 L3，
  // 用户要能从能力色一眼区分"只读 vs 可写"。
  // cc-switch 默认 passive 不入队，给它加 prompt 强行抬升让它真实渲染出来对比。
  const win = loadChat();
  const { handleMessage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'session:cli-shell', source: 'cli', title: 'cli task', status: 'running', updatedAt: now, itemCount: 1 },
        { id: 'switch-thread', source: 'cc-switch', title: 'config switch', status: 'waiting', updatedAt: now, itemCount: 1 },
      ],
      items: [
        { id: 'cli-msg', threadId: 'session:cli-shell', source: 'cli', kind: 'message', title: 'assistant', content: 'cli is running', timestamp: now },
        { id: 'switch-prompt', threadId: 'switch-thread', source: 'cc-switch', kind: 'prompt', title: '需要确认', content: '切换 provider？', options: ['是', '否'], status: 'waiting', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  const chips = Array.from(win.document.querySelectorAll('.conversation-item'))
    .map(item => ({
      source: item.dataset.source,
      capability: item.querySelector('.capability-chip')?.dataset.capabilityLevel,
    }));

  const cli = chips.find(c => c.source === 'cli');
  const switcher = chips.find(c => c.source === 'cc-switch');
  assert.ok(cli, 'CLI 任务应渲染');
  assert.ok(switcher, 'cc-switch 任务（带 prompt）应渲染');
  assert.equal(cli.capability, 'L3', 'CLI 必须是 L3 可回写');
  assert.notEqual(cli.capability, switcher.capability, 'CLI 与 cc-switch 的能力层级必须不同');
});

test('三个及以上并行任务同屏渲染时优先级排序稳定且不抢焦点', async () => {
  // P2.2：真机验收要求"至少 3 个并行任务同时存在时，界面仍稳定可读"。
  // 验证：四档优先级（等待我 / 失败 / 运行中 / 完成）的任务同时存在时，
  // 排序遵循 conversationPriority；用户选中其中一个后，其他任务收到新事件不会抢焦点。
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'run-thread', source: 'cli', title: '后台编译任务', status: 'running', updatedAt: now - 4000, itemCount: 1 },
        { id: 'wait-thread', source: 'codex-desktop', title: '等待确认任务', status: 'waiting', updatedAt: now - 3000, itemCount: 1 },
        { id: 'fail-thread', source: 'cli', title: '失败任务', status: 'error', updatedAt: now - 2000, itemCount: 1 },
        { id: 'done-thread', source: 'codex-desktop', title: '完成任务', status: 'done', updatedAt: now - 1000, itemCount: 1 },
      ],
      items: [
        { id: 'run-msg', threadId: 'run-thread', source: 'cli', kind: 'message', title: 'assistant', content: '正在编译 daemon 子项目', timestamp: now - 4000 },
        { id: 'wait-prompt', threadId: 'wait-thread', source: 'codex-desktop', kind: 'prompt', title: '需要确认', content: '是否继续？', options: ['是', '否'], status: 'waiting', timestamp: now - 3000 },
        { id: 'fail-status', threadId: 'fail-thread', source: 'cli', kind: 'status', title: '失败', content: '退出码 1', status: 'error', timestamp: now - 2000 },
        { id: 'done-msg', threadId: 'done-thread', source: 'codex-desktop', kind: 'message', title: 'assistant', content: '任务执行完成', status: 'done', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  // 至少 3 个并行任务全部进入主任务队列。
  const items = Array.from(win.document.querySelectorAll('.conversation-item'));
  assert.ok(items.length >= 3, `至少应渲染 3 个并行任务，实际：${items.length}`);

  // 优先级排序：等待我必须置顶（P1.1 已固化），按 displayStatus 验证。
  const order = items.map(node => node.dataset.displayStatus || '');
  assert.equal(order[0], 'waiting-me', `等待我任务必须置顶，实际顺序：${order.join(', ')}`);
  const errorIdx = order.indexOf('error');
  const runningIdx = order.indexOf('running');
  assert.ok(errorIdx > 0 && runningIdx > errorIdx, `失败应在 running 之前，运行中应在等待我之后，实际：${order.join(', ')}`);

  // 队列计数：1 等待 / 1 运行 / 1 失败。
  assert.equal(win.document.getElementById('queue-waiting').textContent, '1');
  assert.equal(win.document.getElementById('queue-error').textContent, '1');
  assert.equal(win.document.getElementById('queue-running').textContent, '1');

  // 选中"运行中任务"，再给其他任务发新事件，焦点不能漂移。
  state.activeConversation = 'workflow:run-thread';
  win.CodePanion.__test.renderAll();
  assert.equal(state.activeConversation, 'workflow:run-thread');

  handleMessage({
    type: 'workflow-event',
    data: {
      action: 'item-append',
      item: { id: 'fail-extra', threadId: 'fail-thread', source: 'cli', kind: 'status', title: '失败附加', content: '更多失败上下文', status: 'error', timestamp: now },
    },
  });
  handleMessage({
    type: 'workflow-event',
    data: {
      action: 'item-append',
      item: { id: 'wait-extra', threadId: 'wait-thread', source: 'codex-desktop', kind: 'prompt', title: '再次询问', content: '继续？', options: ['是', '否'], status: 'waiting', timestamp: now },
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.activeConversation, 'workflow:run-thread', '其他任务的新事件不能抢走用户当前选中的任务');
});

test('snoozed and archived tasks are removed from the active queue and available in the later view', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        {
          id: 'later-thread',
          source: 'cli',
          title: '稍后任务',
          status: 'waiting',
          updatedAt: now,
          itemCount: 1,
          taskState: { snoozedUntil: now + 60 * 60 * 1000 },
        },
        {
          id: 'archive-thread',
          source: 'cli',
          title: '归档任务',
          status: 'done',
          updatedAt: now - 1000,
          itemCount: 1,
          taskState: { archived: true },
        },
      ],
      items: [
        { id: 'later-item', threadId: 'later-thread', source: 'cli', kind: 'prompt', title: '等待输入', content: '继续？', options: ['是', '否'], status: 'waiting', timestamp: now },
        { id: 'archive-item', threadId: 'archive-thread', source: 'cli', kind: 'message', title: 'assistant', content: '已完成', status: 'done', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  state.activeView = 'active';
  win.CodePanion.__test.renderAll();
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 0, 'active 视图不应展示稍后/归档任务');

  state.activeView = 'later';
  win.CodePanion.__test.renderAll();
  const laterItems = Array.from(win.document.querySelectorAll('.conversation-item'));
  assert.equal(laterItems.length, 2, 'later 视图应展示稍后与归档任务');
  assert.ok(laterItems.some(item => /稍后处理/.test(item.textContent) && /稍后至/.test(item.textContent)));
  assert.ok(laterItems.some(item => /已归档/.test(item.textContent)));
});

test('offline non-actionable workflow threads are removed from the active queue', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'offline-old', source: 'codex-desktop', title: '旧任务', status: 'running', updatedAt: now, itemCount: 1, sourceOnline: false },
        { id: 'online-current', source: 'codex-desktop', title: '当前任务', status: 'running', updatedAt: now - 1000, itemCount: 1, sourceOnline: true },
      ],
      items: [
        { id: 'offline-item', threadId: 'offline-old', source: 'codex-desktop', kind: 'message', title: 'assistant', content: '旧任务输出', timestamp: now },
        { id: 'online-item', threadId: 'online-current', source: 'codex-desktop', kind: 'message', title: 'assistant', content: '当前任务输出', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  state.activeView = 'active';
  win.CodePanion.__test.renderAll();
  const text = win.document.getElementById('conversation-list').textContent;
  assert.match(text, /当前任务|当前任务输出/);
  assert.doesNotMatch(text, /旧任务|旧任务输出/);
});

test('active view keeps recently synced completed tasks until the user reviews them', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'pending-thread', source: 'cli', title: '进行中任务', status: 'running', updatedAt: now, itemCount: 1 },
        { id: 'done-thread', source: 'cli', title: '完成任务', status: 'done', updatedAt: now - 1000, itemCount: 1 },
      ],
      items: [
        { id: 'pending-item', threadId: 'pending-thread', source: 'cli', kind: 'message', title: 'assistant', content: '仍在处理', status: 'running', timestamp: now },
        { id: 'done-item', threadId: 'done-thread', source: 'cli', kind: 'message', title: 'assistant', content: '执行完成', status: 'done', timestamp: now - 1000 },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  state.activeView = 'active';
  win.CodePanion.__test.renderAll();
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 2, '当前列表不应仅凭 done 状态隐藏任务');
  assert.match(win.document.getElementById('conversation-list').textContent, /仍在处理/);
  assert.match(win.document.getElementById('conversation-list').textContent, /执行完成/);

  state.activeView = 'done';
  win.CodePanion.__test.renderAll();
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 1, '已完成看板只应展示完成任务');
  assert.match(win.document.getElementById('conversation-list').textContent, /执行完成/);
  assert.doesNotMatch(win.document.getElementById('conversation-list').textContent, /仍在处理/);
});

test('task action buttons post daemon task-state updates for workflow conversations', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'managed-thread', source: 'cli', title: '可管理任务', status: 'running', updatedAt: now, itemCount: 1 }],
      items: [{ id: 'managed-item', threadId: 'managed-thread', source: 'cli', kind: 'message', title: 'assistant', content: '执行中', timestamp: now }],
    },
  });

  state.activeConversation = 'workflow:managed-thread';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  win.document.getElementById('stage-pin-task').click();
  win.document.getElementById('stage-priority-high').click();
  win.document.getElementById('stage-snooze-task').click();
  win.document.querySelector('#stage-snooze-menu [data-snooze-preset="30m"]').click();
  win.document.getElementById('stage-archive-task').click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(actionMessages.length, 4, '应发送四个任务动作');
  const [pin, priority, snooze, archive] = actionMessages;
  assert.deepEqual({ ...pin }, { type: 'task-action', threadId: 'managed-thread', pinned: true });
  assert.deepEqual({ ...priority }, { type: 'task-action', threadId: 'managed-thread', priority: 'high' });
  assert.equal(snooze.type, 'task-action');
  assert.equal(snooze.threadId, 'managed-thread');
  assert.ok(typeof snooze.snoozedUntil === 'number' && snooze.snoozedUntil > now);
  assert.deepEqual({ ...archive }, { type: 'task-action', threadId: 'managed-thread', archived: true });
});

test('conversation list groups tasks by workspace and can switch to source grouping', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'alpha-1', source: 'cli', title: 'Alpha A', workspace: 'D:\\alpha', status: 'running', updatedAt: now, itemCount: 1, taskState: { priority: 'high' } },
        { id: 'alpha-2', source: 'codex-desktop', title: 'Alpha B', workspace: 'D:\\alpha', status: 'waiting', updatedAt: now - 1000, itemCount: 1 },
        { id: 'beta-1', source: 'cli', title: 'Beta A', workspace: 'D:\\beta', status: 'error', updatedAt: now - 2000, itemCount: 1, taskState: { priority: 'low' } },
      ],
      items: [
        { id: 'alpha-1-item', threadId: 'alpha-1', source: 'cli', kind: 'message', title: 'assistant', content: 'alpha run', timestamp: now },
        { id: 'alpha-2-item', threadId: 'alpha-2', source: 'codex-desktop', kind: 'prompt', title: '等待输入', content: 'continue?', options: ['yes', 'no'], status: 'waiting', timestamp: now - 1000 },
        { id: 'beta-1-item', threadId: 'beta-1', source: 'cli', kind: 'status', title: '失败', content: 'exit 1', status: 'error', timestamp: now - 2000 },
      ],
    },
  });

  state.activeView = 'active';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const workspaceHeaders = Array.from(win.document.querySelectorAll('.conversation-group-title')).map(node => node.textContent.trim());
  assert.ok(workspaceHeaders.includes('alpha'));
  assert.ok(workspaceHeaders.includes('beta'));
  assert.ok(Array.from(win.document.querySelectorAll('.priority-chip')).some(node => /高优先级/.test(node.textContent)));
  assert.ok(Array.from(win.document.querySelectorAll('.priority-chip')).some(node => /低优先级/.test(node.textContent)));

  win.document.querySelector('[data-group-mode="source"]').click();
  const sourceHeaders = Array.from(win.document.querySelectorAll('.conversation-group-title')).map(node => node.textContent.trim());
  assert.ok(sourceHeaders.includes('终端'));
  assert.ok(sourceHeaders.includes('Codex'));
});

test('manual sort order is respected for conversations in the same task band', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'sort-a', source: 'cli', title: '排序 A', workspace: 'D:\\alpha', status: 'running', updatedAt: now, itemCount: 1, taskState: { sortOrder: 200 } },
        { id: 'sort-b', source: 'cli', title: '排序 B', workspace: 'D:\\alpha', status: 'running', updatedAt: now - 1000, itemCount: 1, taskState: { sortOrder: 100 } },
      ],
      items: [
        { id: 'sort-a-item', threadId: 'sort-a', source: 'cli', kind: 'message', title: 'assistant', content: '排序 A 说明', timestamp: now },
        { id: 'sort-b-item', threadId: 'sort-b', source: 'cli', kind: 'message', title: 'assistant', content: '排序 B 说明', timestamp: now - 1000 },
      ],
    },
  });

  state.activeView = 'active';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const titles = Array.from(win.document.querySelectorAll('.conversation-title-text')).map(node => node.textContent.trim());
  assert.equal(titles[0], '排序 B 说明');
  assert.equal(titles[1], '排序 A 说明');
});

test('snooze menu sends preset and custom task-state updates', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'snooze-thread', source: 'cli', title: '稍后测试', status: 'running', updatedAt: now, itemCount: 1 }],
      items: [{ id: 'snooze-item', threadId: 'snooze-thread', source: 'cli', kind: 'message', title: 'assistant', content: '等待处理', timestamp: now }],
    },
  });

  state.activeConversation = 'workflow:snooze-thread';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  win.document.getElementById('stage-snooze-task').click();
  const halfHour = win.document.querySelector('[data-snooze-preset="30m"]');
  assert.ok(halfHour, '稍后菜单应提供 30 分钟预设');
  halfHour.click();

  win.document.getElementById('stage-snooze-task').click();
  const customInput = win.document.querySelector('#stage-snooze-menu input[type="datetime-local"]');
  const customApply = win.document.querySelector('#stage-snooze-menu [data-snooze-action="apply-custom"]');
  assert.ok(customInput, '稍后菜单应提供自定义时间输入');
  assert.ok(customApply, '稍后菜单应提供自定义时间确认按钮');
  const customDueAt = now + (3 * 60 * 60 * 1000);
  const customDue = new Date(customDueAt);
  const pad = (value) => String(value).padStart(2, '0');
  customInput.value = `${customDue.getFullYear()}-${pad(customDue.getMonth() + 1)}-${pad(customDue.getDate())}T${pad(customDue.getHours())}:${pad(customDue.getMinutes())}`;
  customInput.dispatchEvent(new win.Event('input', { bubbles: true }));
  customApply.click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(actionMessages.length, 2, '应发送两次稍后任务动作');
  assert.equal(actionMessages[0].threadId, 'snooze-thread');
  assert.ok(actionMessages[0].snoozedUntil >= now + (30 * 60 * 1000) - 1000, '30 分钟预设应写入正确的稍后时间');
  assert.equal(actionMessages[1].threadId, 'snooze-thread');
  assert.equal(actionMessages[1].snoozedUntil, new Date(customInput.value).getTime());
});

test('batch task actions send restore, archive, and snooze updates for selected conversations', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        {
          id: 'later-a',
          source: 'cli',
          title: '稍后任务 A',
          status: 'waiting',
          updatedAt: now,
          itemCount: 1,
          taskState: { snoozedUntil: now + (60 * 60 * 1000) },
        },
        {
          id: 'later-b',
          source: 'cli',
          title: '归档任务 B',
          status: 'done',
          updatedAt: now - 1000,
          itemCount: 1,
          taskState: { archived: true },
        },
      ],
      items: [
        { id: 'later-a-item', threadId: 'later-a', source: 'cli', kind: 'prompt', title: '等待输入', content: '继续？', status: 'waiting', timestamp: now },
        { id: 'later-b-item', threadId: 'later-b', source: 'cli', kind: 'message', title: 'assistant', content: '已完成', status: 'done', timestamp: now - 1000 },
      ],
    },
  });

  state.activeView = 'later';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const selectAllLaterTasks = () => {
    win.document.getElementById('batch-toggle').click();
    const boxes = Array.from(win.document.querySelectorAll('.conversation-select input[type="checkbox"]'));
    boxes.forEach(box => box.click());
    return boxes;
  };

  const checkboxes = selectAllLaterTasks();
  assert.equal(checkboxes.length, 2, '批量模式应为 later 视图中的任务提供选择框');
  win.document.getElementById('batch-restore').click();

  selectAllLaterTasks();
  win.document.getElementById('batch-archive').click();

  selectAllLaterTasks();
  win.document.getElementById('batch-snooze').click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(actionMessages.length, 6, '两项任务执行三种批量动作应产生 6 条 task-action');

  const restoreMessages = actionMessages.slice(0, 2);
  assert.ok(restoreMessages.every(message => message.archived === false && message.snoozedUntil === null));

  const archiveMessages = actionMessages.slice(2, 4);
  assert.ok(archiveMessages.every(message => message.archived === true));

  const snoozeMessages = actionMessages.slice(4, 6);
  assert.ok(snoozeMessages.every(message => typeof message.snoozedUntil === 'number' && message.snoozedUntil > now));
});

test('batch task actions also support pin and priority updates', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'batch-a', source: 'cli', title: '批量 A', status: 'running', updatedAt: now, itemCount: 1 },
        { id: 'batch-b', source: 'codex-desktop', title: '批量 B', status: 'waiting', updatedAt: now - 1000, itemCount: 1 },
      ],
      items: [
        { id: 'batch-a-item', threadId: 'batch-a', source: 'cli', kind: 'message', title: 'assistant', content: '批量 A 内容', timestamp: now },
        { id: 'batch-b-item', threadId: 'batch-b', source: 'codex-desktop', kind: 'prompt', title: '等待输入', content: '继续？', options: ['yes', 'no'], status: 'waiting', timestamp: now - 1000 },
      ],
    },
  });

  state.activeView = 'active';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  win.document.getElementById('batch-toggle').click();
  const boxes = Array.from(win.document.querySelectorAll('.conversation-select input[type="checkbox"]'));
  boxes.forEach(box => box.click());

  win.document.getElementById('batch-pin').click();

  win.document.getElementById('batch-toggle').click();
  const boxes2 = Array.from(win.document.querySelectorAll('.conversation-select input[type="checkbox"]'));
  boxes2.forEach(box => box.click());
  win.document.getElementById('batch-priority-high').click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(actionMessages.length, 4, '两项任务执行置顶和高优先级应产生 4 条 task-action');
  const pinMessages = actionMessages.slice(0, 2);
  assert.ok(pinMessages.every(message => message.pinned === true));
  const priorityMessages = actionMessages.slice(2, 4);
  assert.ok(priorityMessages.every(message => message.priority === 'high'));
});

test('move up and move down issue sortOrder task actions for visible workflow tasks', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'move-a', source: 'cli', title: '移动 A', status: 'running', updatedAt: now, itemCount: 1 },
        { id: 'move-b', source: 'cli', title: '移动 B', status: 'running', updatedAt: now - 1000, itemCount: 1 },
        { id: 'move-c', source: 'cli', title: '移动 C', status: 'running', updatedAt: now - 2000, itemCount: 1 },
      ],
      items: [
        { id: 'move-a-item', threadId: 'move-a', source: 'cli', kind: 'message', title: 'assistant', content: '移动 A 内容', timestamp: now },
        { id: 'move-b-item', threadId: 'move-b', source: 'cli', kind: 'message', title: 'assistant', content: '移动 B 内容', timestamp: now - 1000 },
        { id: 'move-c-item', threadId: 'move-c', source: 'cli', kind: 'message', title: 'assistant', content: '移动 C 内容', timestamp: now - 2000 },
      ],
    },
  });

  state.activeConversation = 'workflow:move-b';
  state.activeView = 'active';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  win.document.getElementById('stage-move-up').click();
  win.document.getElementById('stage-move-down').click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action' && typeof message.sortOrder === 'number');
  assert.ok(actionMessages.length >= 4, '上下移动至少应产生多条 sortOrder 更新');
  assert.ok(actionMessages.some(message => message.threadId === 'move-b' && message.sortOrder === 100));
  assert.ok(actionMessages.some(message => message.threadId === 'move-a' && message.sortOrder === 200));
});

test('handoff package exports target-specific transfer context for the selected task', async () => {
  const win = loadChat();
  const { handleMessage, state, buildHandoffPackage } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'handoff-task', source: 'codex-desktop', title: '接力任务', workspace: 'D:\\Projects\\handoff', status: 'waiting', updatedAt: now, itemCount: 3, taskState: { priority: 'high', pinned: true } },
      ],
      items: [
        { id: 'handoff-user', threadId: 'handoff-task', source: 'codex-desktop', kind: 'message', title: 'user', role: 'user', content: '修复构建失败并补测试。', timestamp: now - 1000 },
        { id: 'handoff-prompt', threadId: 'handoff-task', source: 'codex-desktop', kind: 'prompt', title: '等待输入', content: '是否继续执行迁移？', options: ['yes', 'no'], status: 'waiting', timestamp: now },
        { id: 'handoff-return', threadId: 'handoff-task', source: 'codepanion', kind: 'message', title: 'assistant', role: 'assistant', content: '**接力结果摘要**\n\n- 工具：Codex\n- 会话：Codex · previous handoff\n- 回流结论：待审阅\n- 结果：成功\n- 人工处理：建议\n- 退出码：0\n- 建议重试：否\n- 处理建议：先审阅涉及文件与最近进展，再决定是否继续处理\n- 后续动作：审阅接力结果并决定下一步\n\n## 涉及文件\n- packages/gui/wwwroot/chat.js\n- scripts/package-windows.ps1\n\n## 最近进展\nUpdated packages/gui/wwwroot/chat.js and scripts/package-windows.ps1.', timestamp: now + 1 },
      ],
    },
  });

  state.activeConversation = 'workflow:handoff-task';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const conversation = win.CodePanion.__test.state.conversations.get('workflow:handoff-task');
  const messages = Array.from(win.CodePanion.__test.state.workflowItemsByThread.get('handoff-task') || []).map(item => ({
    source: item.source,
    type: item.status === 'waiting' || item.kind === 'prompt' ? 'prompt' : 'activity',
    role: item.role,
    content: item.content,
    timestamp: item.timestamp,
    workspace: conversation.workspace,
    sourceId: '',
    privacyBoundary: 'explicit-session'
  }));

  const codexPackage = buildHandoffPackage(conversation, messages, 'codex');
  assert.match(codexPackage.preview, /目标工具：Codex/);
  assert.match(codexPackage.preview, /D:\\Projects\\handoff/);
  assert.match(codexPackage.preview, /修复构建失败并补测试/);
  assert.match(codexPackage.preview, /是否继续执行迁移/);
  assert.match(codexPackage.preview, /最近接力回流/);
  assert.match(codexPackage.preview, /回流结论：待审阅/);
  assert.match(codexPackage.preview, /人工处理：建议/);
  assert.match(codexPackage.preview, /建议重试：否/);
  assert.match(codexPackage.preview, /处理建议：先审阅涉及文件与最近进展，再决定是否继续处理/);
  assert.match(codexPackage.preview, /后续动作：审阅接力结果并决定下一步/);
  assert.match(codexPackage.preview, /packages\/gui\/wwwroot\/chat\.js/);
  assert.match(codexPackage.preview, /scripts\/package-windows\.ps1/);
  assert.match(codexPackage.preview, /Updated packages\/gui\/wwwroot\/chat\.js and scripts\/package-windows\.ps1/);
  assert.match(codexPackage.prompt, /请继续处理以下任务/);

  const opencodePackage = buildHandoffPackage(conversation, messages, 'opencode');
  assert.match(opencodePackage.preview, /目标工具：OpenCode/);
  assert.match(opencodePackage.prompt, /OpenCode/);
});

test('handoff launch and state actions surface handoff state in the detail note', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'handoff-actions', source: 'cli', title: '转交动作任务', workspace: 'D:\\handoff', status: 'running', updatedAt: now, itemCount: 1 },
      ],
      items: [
        { id: 'handoff-actions-item', threadId: 'handoff-actions', source: 'cli', kind: 'message', title: 'assistant', content: '需要转交给其他工具继续处理', timestamp: now },
      ],
    },
  });

  state.activeConversation = 'workflow:handoff-actions';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const target = win.document.getElementById('drawer-handoff-target');
  target.value = 'claude-code';
  target.dispatchEvent(new win.Event('change', { bubbles: true }));

  win.document.getElementById('drawer-start-handoff').click();
  win.document.getElementById('drawer-mark-handoff-active').click();
  win.document.getElementById('drawer-return-handoff').click();
  win.document.getElementById('drawer-clear-handoff').click();

  const launchMessages = win.__hostMessages.filter(message => message?.type === 'handoff-launch');
  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(launchMessages.length, 1);
  assert.equal(launchMessages[0].threadId, 'handoff-actions');
  assert.equal(launchMessages[0].target, 'claude-code');
  assert.match(launchMessages[0].prompt, /Claude Code/);
  assert.equal(actionMessages.length, 3);
  assert.deepEqual({ ...actionMessages[0] }, { type: 'task-action', threadId: 'handoff-actions', handoffStatus: 'active', handoffTarget: 'claude-code' });
  assert.deepEqual({ ...actionMessages[1] }, { type: 'task-action', threadId: 'handoff-actions', handoffStatus: 'returned', handoffTarget: 'claude-code' });
  assert.deepEqual({ ...actionMessages[2] }, { type: 'task-action', threadId: 'handoff-actions', handoffStatus: 'idle', handoffTarget: null, handoffSessionId: null });

  handleMessage({
    type: 'workflow-event',
    data: {
      action: 'thread-upsert',
      thread: {
        id: 'handoff-actions',
        source: 'cli',
        title: '转交动作任务',
        workspace: 'D:\\handoff',
        status: 'running',
        updatedAt: now + 1,
        itemCount: 1,
        taskState: { handoffStatus: 'active', handoffTarget: 'claude-code', handoffSessionId: 'session-123' }
      }
    }
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();
  assert.match(win.document.getElementById('drawer-action-note').textContent, /已转交给 Claude Code/);
  assert.match(win.document.getElementById('drawer-action-note').textContent, /session-123/);
  assert.match(win.document.getElementById('drawer-handoff-preview').textContent, /目标工具：Claude Code/);
  assert.match(win.document.getElementById('drawer-handoff-preview').textContent, /接力会话：session-123/);
});

test('handoff navigation links parent tasks and child workflow sessions in both directions', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        {
          id: 'parent-task',
          source: 'codex-desktop',
          title: '父任务',
          workspace: 'D:\\Projects\\parent',
          status: 'running',
          updatedAt: now,
          itemCount: 1,
          taskState: { handoffStatus: 'active', handoffTarget: 'codex', handoffSessionId: 'child-001' }
        },
        {
          id: 'session:child-001',
          source: 'codex-desktop',
          title: '接力会话',
          workspace: 'D:\\Projects\\parent',
          status: 'running',
          updatedAt: now + 1,
          itemCount: 1
        }
      ],
      items: [
        { id: 'parent-item', threadId: 'parent-task', source: 'codex-desktop', kind: 'message', title: 'assistant', content: '父任务内容', timestamp: now },
        { id: 'child-item', threadId: 'session:child-001', source: 'codex-desktop', kind: 'message', title: 'assistant', content: '接力会话内容', timestamp: now + 1 }
      ],
    },
  });

  state.activeConversation = 'workflow:parent-task';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  assert.equal(win.document.getElementById('drawer-linked-session-panel').hidden, false);
  assert.match(win.document.getElementById('drawer-linked-session-title').textContent, /接力会话内容/);
  assert.match(win.document.getElementById('drawer-linked-session-note').textContent, /child-001/);

  win.document.getElementById('drawer-jump-linked-session').click();
  assert.equal(state.activeConversation, 'workflow:session:child-001');
  assert.match(win.document.getElementById('conversation-title').textContent, /接力会话内容/);

  assert.equal(win.document.getElementById('drawer-parent-task-panel').hidden, false);
  assert.match(win.document.getElementById('drawer-parent-task-title').textContent, /父任务内容/);

  win.document.getElementById('drawer-jump-parent-task').click();
  assert.equal(state.activeConversation, 'workflow:parent-task');
  assert.match(win.document.getElementById('conversation-title').textContent, /父任务内容/);
});

test('handoff return summary from CodePanion stays visible in the parent workflow thread', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();
  const copied = [];
  win.navigator.clipboard = {
    writeText(text) {
      copied.push(String(text));
      return Promise.resolve();
    },
  };

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'parent-summary', source: 'claude-code', title: '父任务摘要', status: 'waiting', updatedAt: now, itemCount: 2, taskState: { handoffStatus: 'returned', handoffTarget: 'codex', handoffSessionId: 'child-s1' } },
        { id: 'session:child-s1', source: 'codex', title: 'Codex child session', status: 'done', updatedAt: now + 1, itemCount: 1 },
      ],
      items: [
        { id: 'parent-summary-goal', threadId: 'parent-summary', source: 'user', kind: 'message', title: 'user', role: 'user', content: '请修复构建。', timestamp: now - 1000 },
        { id: 'parent-summary-return', threadId: 'parent-summary', source: 'codepanion', kind: 'message', title: 'assistant', role: 'assistant', content: '**接力结果摘要**\n\n- 工具：Codex\n- 会话：Codex · child\n- 回流结论：待审阅\n- 结果：成功\n- 人工处理：建议\n- 退出码：0\n- 建议重试：否\n- 处理建议：先审阅涉及文件与最近进展，再决定是否继续处理\n- 后续动作：审阅接力结果并决定下一步\n\n## 涉及文件\n- packages/gui/wwwroot/chat.js\n- scripts/package-windows.ps1\n\n## 最近进展\nUpdated packages/gui/wwwroot/chat.js and scripts/package-windows.ps1.', timestamp: now },
        { id: 'child-s1-item', threadId: 'session:child-s1', source: 'codex', kind: 'message', title: 'assistant', role: 'assistant', content: 'child session content', timestamp: now + 1 },
      ],
    },
  });

  state.activeConversation = 'workflow:parent-summary';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  const chatText = win.document.getElementById('chat-container').textContent;
  assert.match(chatText, /接力结果摘要/);
  assert.match(chatText, /packages\/gui\/wwwroot\/chat\.js/);
  assert.match(chatText, /scripts\/package-windows\.ps1/);
  assert.match(win.document.getElementById('drawer-action-note').textContent, /已从 Codex 回收到当前队列/);
  assert.match(win.document.getElementById('spotlight-next-action').textContent, /等待我/);
  assert.match(win.document.getElementById('spotlight-subaction').textContent, /先审阅涉及文件与最近进展，再决定是否继续处理/);
  assert.match(win.document.getElementById('spotlight-summary').textContent, /待审阅/);
  assert.match(win.document.getElementById('spotlight-breakdown').textContent, /Codex · child/);
  assert.match(win.document.getElementById('spotlight-breakdown').textContent, /人工处理：建议/);
  assert.match(win.document.getElementById('spotlight-breakdown').textContent, /packages\/gui\/wwwroot\/chat\.js/);
  assert.equal(win.document.getElementById('stage-suggested-action').hidden, false);
  assert.match(win.document.getElementById('stage-suggested-action').textContent, /打开接力会话/);
  assert.equal(win.document.getElementById('stage-suggested-secondary').hidden, false);
  assert.match(win.document.getElementById('stage-suggested-secondary').textContent, /复制交接包/);
  win.document.getElementById('stage-suggested-secondary').click();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /# CodePanion 任务转交包/);
  assert.match(copied[0], /处理建议：先审阅涉及文件与最近进展，再决定是否继续处理/);
  win.document.getElementById('stage-suggested-action').click();
  assert.equal(state.activeConversation, 'workflow:session:child-s1');
});

test('failed handoff return surfaces a suggested diagnostics action', async () => {
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();
  const copied = [];
  win.navigator.clipboard = {
    writeText(text) {
      copied.push(String(text));
      return Promise.resolve();
    },
  };

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [
        { id: 'parent-failed', source: 'claude-code', title: '失败父任务', status: 'error', updatedAt: now, itemCount: 2, taskState: { handoffStatus: 'returned', handoffTarget: 'codex', handoffSessionId: 'child-failed' } },
      ],
      items: [
        { id: 'parent-failed-goal', threadId: 'parent-failed', source: 'user', kind: 'message', title: 'user', role: 'user', content: '修复配置问题。', timestamp: now - 1000 },
        { id: 'parent-failed-return', threadId: 'parent-failed', source: 'codepanion', kind: 'message', title: 'assistant', role: 'assistant', content: '**接力结果摘要**\n\n- 工具：Codex\n- 会话：Codex · failed child\n- 回流结论：失败待处理\n- 结果：失败\n- 人工处理：需要\n- 问题类型：配置问题\n- 退出码：17\n- 建议重试：是\n- 处理建议：检查 APPDATA 或相关环境变量配置后再重试\n- 后续动作：查看失败摘要并决定是否重试\n\n## 最近进展\nBuild failed: missing APPDATA configuration.', timestamp: now },
      ],
    },
  });

  state.activeConversation = 'workflow:parent-failed';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  assert.equal(win.document.getElementById('drawer-suggested-action').hidden, false);
  assert.match(win.document.getElementById('drawer-suggested-action').textContent, /复制诊断/);
  assert.equal(win.document.getElementById('drawer-suggested-secondary').hidden, false);
  assert.match(win.document.getElementById('drawer-suggested-secondary').textContent, /复制交接包/);
  win.document.getElementById('drawer-suggested-action').click();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /问题类型：配置问题/);
  assert.match(copied[0], /检查 APPDATA 或相关环境变量配置后再重试/);
  win.document.getElementById('drawer-suggested-secondary').click();
  assert.equal(copied.length, 2);
  assert.match(copied[1], /# CodePanion 任务转交包/);
  assert.match(copied[1], /问题类型：配置问题/);
});

test('中文文本在主视图与复制上下文中完整保留不乱码', async () => {
  // P2.2：真机验收要求"中文文本在 daemon、WebView、日志和复制内容中不乱码"。
  // 验证：含中文 + emoji + 全角符号的内容能完整渲染到 DOM 主聊天区，
  // 复制上下文 buildStageContext 输出同样保留原始字符（不被 \uXXXX / HTML 实体转义）。
  const win = loadChat();
  const { handleMessage, buildStageContext, state } = win.CodePanion.__test;
  const now = Date.now();

  const assistantMessage = '已读取文件：src/服务/账户.ts，准备执行第①步重构🚀';

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'zh-thread', source: 'cli', title: '示例工程「账户重构」', status: 'running', updatedAt: now, itemCount: 1 }],
      items: [
        { id: 'zh-assistant', threadId: 'zh-thread', source: 'cli', kind: 'message', title: 'assistant', content: assistantMessage, timestamp: now },
      ],
    },
  });

  state.activeConversation = 'workflow:zh-thread';
  await new Promise(resolve => win.requestAnimationFrame(resolve));
  win.CodePanion.__test.renderAll();

  // 主聊天区必须保留中文消息内容（不能被 escape 成 &#x... 或 \uXXXX）。
  const chat = win.document.getElementById('chat-container').textContent;
  assert.ok(chat.includes('src/服务/账户.ts'), `主视图必须保留中文路径，实际：${chat}`);
  assert.ok(chat.includes('第①步'), '主视图必须保留全角圆圈数字');
  assert.ok(chat.includes('🚀'), '主视图必须保留 emoji');
  assert.doesNotMatch(chat, /\\u[0-9a-fA-F]{4}/, '主视图不能出现 \\uXXXX 形式的转义');
  assert.doesNotMatch(chat, /&#x?[0-9a-fA-F]+;/, '主视图不能出现 HTML 实体转义');

  // 复制上下文必须是原始 UTF-8 字符。
  const conversation = state.conversations.get('workflow:zh-thread');
  const messagesAsMessages = (state.workflowItemsByThread.get('zh-thread') || []).map(item => ({
    type: item.kind === 'prompt' ? 'prompt' : 'activity',
    source: item.source,
    timestamp: item.timestamp,
    content: item.content,
  }));
  const context = buildStageContext(conversation, messagesAsMessages);
  assert.match(context, /src\/服务\/账户\.ts/, '复制上下文必须包含中文路径');
  assert.match(context, /第①步/, '复制上下文必须保留全角圆圈数字');
  assert.match(context, /🚀/, '复制上下文必须保留 emoji');
  assert.doesNotMatch(context, /\\u[0-9a-fA-F]{4}/, '复制上下文不能出现 \\uXXXX 形式的转义');
  assert.doesNotMatch(context, /&#x?[0-9a-fA-F]+;/, '复制上下文不能出现 HTML 实体转义');
});
