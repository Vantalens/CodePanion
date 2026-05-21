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
