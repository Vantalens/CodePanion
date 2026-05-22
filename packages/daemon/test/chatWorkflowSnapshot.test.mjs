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
      <button class="rail-button" data-view="later"></button>
      <button class="rail-button" data-view="code"></button>
      <button class="tool-button" data-view="active"></button>
      <button class="tool-button" data-view="waiting"></button>
      <button class="tool-button" data-view="running"></button>
      <button class="tool-button" data-view="error"></button>
      <button class="tool-button" data-view="later"></button>
      <button class="tool-button" data-view="code"></button>
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
      <button id="stage-pin-task"></button>
      <button id="stage-snooze-task"></button>
      <button id="stage-archive-task"></button>
      <button id="stage-copy-context"></button>
      <strong id="drawer-source-name"></strong>
      <p id="drawer-source-detail"></p>
      <strong id="drawer-capability"></strong>
      <strong id="drawer-privacy"></strong>
      <p id="drawer-action-note"></p>
      <button id="drawer-focus-reply"></button>
      <button id="drawer-pin-task"></button>
      <button id="drawer-snooze-task"></button>
      <button id="drawer-archive-task"></button>
      <button id="drawer-copy-workspace"></button>
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

test('session prompts require explicit options and do not expose custom text entry', async () => {
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

  assert.equal(win.document.getElementById('omnibar').hidden, true);
  assert.equal(win.document.getElementById('stage-focus-reply').hidden, true);
  assert.equal(win.document.querySelector('.custom-input'), null);

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

  assert.equal(win.document.getElementById('omnibar').hidden, true);
  assert.equal(win.document.getElementById('stage-focus-reply').hidden, false);
  assert.equal(win.document.querySelectorAll('.option-button').length, 2);
  assert.equal(win.document.querySelector('.custom-input'), null);

  win.document.querySelector('.option-button').click();
  assert.doesNotMatch(win.document.getElementById('chat-container').textContent, /您的回复/);
});

test('session prompts without options surface a CLI-direct-input hint', async () => {
  // H4：自由文本 session prompt（密码、文件名）在 GUI 不可点选/不可输入时，
  // 必须给用户明确引导回到 CLI 终端输入，否则会看上去"卡住"。
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

  const hint = win.document.querySelector('.prompt-hint');
  assert.ok(hint, '应渲染 .prompt-hint 引导用户');
  assert.match(hint.textContent, /CLI 终端/);
  assert.equal(win.document.querySelector('.option-button'), null);
  assert.equal(win.document.querySelector('.custom-input'), null);
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

  const done = deriveConversationDisplay({ id: 't4', status: 'done', source: 'cli' });
  assert.equal(done.kind, 'done');
  assert.equal(done.label, '完成');

  const sourceOnline = deriveConversationDisplay({ id: 't5', status: 'activity', source: 'cc-switch' });
  assert.equal(sourceOnline.kind, 'source-online');
  assert.equal(sourceOnline.label, '来源在线');

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
  assert.equal(win.document.getElementById('omnibar').hidden, true, 'omnibar 也必须隐藏');
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

test('VS Code 来源仅 activity 事件不会在主任务队列中制造假任务', async () => {
  // P2.1：VS Code 扩展会把终端开/关、调试开始、激活心跳之类的事件发成 activity；
  // 这些仅是"来源视图"信息，不能在主队列里冒出一个假的 VS Code 任务来抢用户注意力。
  const win = loadChat();
  const { handleMessage, state } = win.CodePanion.__test;
  const now = Date.now();

  handleMessage({
    type: 'workflow-snapshot',
    snapshot: {
      threads: [{ id: 'vscode-thread', source: 'vscode', title: 'sample - VS Code', status: 'running', updatedAt: now, itemCount: 2 }],
      items: [
        { id: 'term-open', threadId: 'vscode-thread', source: 'vscode', kind: 'message', title: '终端打开：pwsh', content: 'shellPath=pwsh', timestamp: now - 1000 },
        { id: 'debug-start', threadId: 'vscode-thread', source: 'vscode', kind: 'message', title: '调试开始：jest', content: 'sessionId=dbg-1', timestamp: now },
      ],
    },
  });

  await new Promise(resolve => win.requestAnimationFrame(resolve));

  assert.equal(state.conversations.has('workflow:vscode-thread'), false, 'VS Code 纯 activity 事件不应入主队列');
  assert.equal(win.document.querySelectorAll('.conversation-item').length, 0, '主任务列表应为空');
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
  win.document.getElementById('stage-snooze-task').click();
  win.document.getElementById('stage-archive-task').click();

  const actionMessages = win.__hostMessages.filter(message => message?.type === 'task-action');
  assert.equal(actionMessages.length, 3, '应发送三个任务动作');
  const [pin, snooze, archive] = actionMessages;
  assert.deepEqual({ ...pin }, { type: 'task-action', threadId: 'managed-thread', pinned: true });
  assert.equal(snooze.type, 'task-action');
  assert.equal(snooze.threadId, 'managed-thread');
  assert.ok(typeof snooze.snoozedUntil === 'number' && snooze.snoozedUntil > now);
  assert.deepEqual({ ...archive }, { type: 'task-action', threadId: 'managed-thread', archived: true });
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
