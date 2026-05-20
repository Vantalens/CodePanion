import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CodexDesktopAdapter,
  toTimestamp,
  shouldHideCodexContent,
  textFrom,
  statusFromEvent,
  titleFromPath,
  isDegradedTitle,
  summarizeUserMessage,
} from '../dist/adapters/codexDesktopAdapter.js';
import { WorkflowManager } from '../dist/daemon/workflowManager.js';

// ---------- pure helpers ----------

test('toTimestamp accepts ms epoch numbers as-is', () => {
  assert.equal(toTimestamp(1700000000000), 1700000000000);
  assert.equal(toTimestamp(1700000000123.7), 1700000000123); // truncated
});

test('toTimestamp converts seconds-epoch numbers to ms', () => {
  assert.equal(toTimestamp(1700000000), 1700000000000);
  assert.equal(toTimestamp(1700000000.5), 1700000000500);
});

test('toTimestamp parses ISO 8601 strings', () => {
  assert.equal(toTimestamp('2026-01-15T12:00:00.000Z'), Date.parse('2026-01-15T12:00:00.000Z'));
});

test('toTimestamp returns undefined for invalid input', () => {
  assert.equal(toTimestamp('not a date'), undefined);
  assert.equal(toTimestamp(undefined), undefined);
  assert.equal(toTimestamp(null), undefined);
  assert.equal(toTimestamp({}), undefined);
});

test('shouldHideCodexContent filters internal Codex noise but keeps real text', () => {
  assert.equal(shouldHideCodexContent('<environment_context>cwd=/x</environment_context>'), true);
  assert.equal(shouldHideCodexContent('<turn_aborted>reason</turn_aborted>'), true);
  assert.equal(shouldHideCodexContent('<permissions instructions>...</permissions instructions>'), true);
  assert.equal(shouldHideCodexContent('# Context from my IDE setup:\nfoo'), true);
  assert.equal(shouldHideCodexContent('{"risk_level":"low","user_authorization":"high","outcome":"allow","rationale":"routine test"}'), true);
  assert.equal(shouldHideCodexContent('  <environment_context>leading whitespace</environment_context>'), true); // .trim() applied — leading whitespace cannot bypass the filter
  assert.equal(shouldHideCodexContent('please fix the bug'), false);
  assert.equal(shouldHideCodexContent(''), false);
});

test('textFrom flattens nested message structures', () => {
  assert.equal(textFrom('plain'), 'plain');
  assert.equal(textFrom(null), '');
  assert.equal(textFrom(undefined), '');
  assert.equal(textFrom(['a', 'b']), 'a\n\nb');
  assert.equal(textFrom({ text: 'hello' }), 'hello');
  assert.equal(textFrom({ content: 'inline' }), 'inline');
  assert.equal(textFrom({ content: [{ text: 'piece1' }, { text: 'piece2' }] }), 'piece1\n\npiece2');
  assert.equal(textFrom({ message: 'wrapped' }), 'wrapped');
  // Unknown shape falls back to pretty JSON
  assert.match(textFrom({ unknown: 'shape' }), /"unknown": "shape"/);
});

test('statusFromEvent maps event types to workflow status', () => {
  assert.equal(statusFromEvent('task_failed'), 'error');
  assert.equal(statusFromEvent('apply_error'), 'error');
  assert.equal(statusFromEvent('task_complete'), 'done');
  assert.equal(statusFromEvent('thread_end'), 'done');
  assert.equal(statusFromEvent('waiting_for_input'), 'waiting');
  assert.equal(statusFromEvent('user_prompt'), 'waiting');
  assert.equal(statusFromEvent('task_started'), undefined);
  assert.equal(statusFromEvent('random_event'), undefined);
});

// ---------- class-level integration over a temp sessions dir ----------

function writeJsonl(path, records) {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function freshIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function staleIso() {
  // 10 days ago — outside ACTIVE_SESSION_WINDOW_MS (3 days).
  return new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
}

async function runAdapter(records) {
  const root = mkdtempSync(join(tmpdir(), 'codex-adapter-'));
  // The adapter walks subdirectories looking for .jsonl files; mirror Codex's layout.
  const subDir = join(root, '2026', '01');
  mkdirSync(subDir, { recursive: true });
  const sessionPath = join(subDir, 'rollout-2026-01-15T12-00-00-019abcd-1234.jsonl');
  writeJsonl(sessionPath, records);

  const workflows = new WorkflowManager();
  const adapter = new CodexDesktopAdapter(workflows, { root });
  await adapter.scanOnce();
  const snapshot = workflows.snapshot();
  return { snapshot, sessionPath, root, workflows, adapter };
}

test('session_meta creates a thread with workspace and fresh status', async () => {
  const { snapshot, root } = await runAdapter([
    {
      timestamp: freshIso(),
      type: 'session_meta',
      payload: { cwd: '/repo/example' },
    },
  ]);
  try {
    assert.equal(snapshot.threads.length, 1);
    const thread = snapshot.threads[0];
    assert.equal(thread.source, 'codex-desktop');
    assert.equal(thread.title, 'example');
    assert.equal(thread.workspace, '/repo/example');
    assert.equal(thread.status, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale session_meta yields thread with status=done (outside active window)', async () => {
  const { snapshot, root } = await runAdapter([
    {
      timestamp: staleIso(),
      type: 'session_meta',
      payload: { cwd: '/repo/stale' },
    },
  ]);
  try {
    assert.equal(snapshot.threads[0].status, 'done');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('event_msg.user_message becomes a message item with role=user', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'user_message', message: 'please fix the bug' } },
  ]);
  try {
    const userItem = snapshot.items.find((it) => it.kind === 'message' && it.role === 'user');
    assert.ok(userItem, 'expected a user message item');
    assert.equal(userItem.content, 'please fix the bug');
    assert.equal(userItem.title, 'User');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('event_msg.user_message with <environment_context> is filtered out', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>cwd=/x</environment_context>' } },
  ]);
  try {
    const noisy = snapshot.items.find((it) => it.kind === 'message');
    assert.equal(noisy, undefined, 'expected internal context message to be filtered');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('event_msg.task_started + task_complete map to status items', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: freshIso(20), type: 'event_msg', payload: { type: 'task_complete' } },
  ]);
  try {
    const started = snapshot.items.find((it) => it.title === '任务开始');
    const completed = snapshot.items.find((it) => it.title === '任务完成');
    assert.ok(started, 'expected 任务开始 item');
    assert.equal(started.kind, 'status');
    assert.equal(started.status, 'running');
    assert.ok(completed, 'expected 任务完成 item');
    assert.equal(completed.status, 'done');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('response_item with role=developer or system is filtered out', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'response_item', payload: { type: 'message', role: 'developer', content: 'internal' } },
    { timestamp: freshIso(20), type: 'response_item', payload: { type: 'message', role: 'system', content: 'system prompt' } },
    { timestamp: freshIso(30), type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'real reply' } },
  ]);
  try {
    const messages = snapshot.items.filter((it) => it.kind === 'message');
    assert.equal(messages.length, 1, `expected only assistant message kept, got: ${JSON.stringify(messages.map(m => m.role))}`);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].content, 'real reply');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('response_item.function_call becomes a tool_call item', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    {
      timestamp: freshIso(10),
      type: 'response_item',
      payload: { type: 'function_call', name: 'apply_patch', arguments: { path: 'a.txt' }, status: 'running' },
    },
  ]);
  try {
    const tool = snapshot.items.find((it) => it.kind === 'tool_call');
    assert.ok(tool, 'expected a tool_call item');
    assert.equal(tool.title, 'apply_patch');
    assert.match(tool.content, /"path": "a.txt"/);
    assert.equal(tool.status, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('turn_context records are ignored entirely', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'turn_context', payload: { foo: 'bar' } },
  ]);
  try {
    // Only the session_meta thread should exist; no items.
    assert.equal(snapshot.items.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compacted event becomes a status item with summary', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'compacted', payload: {} },
  ]);
  try {
    const item = snapshot.items.find((it) => it.title === '上下文压缩');
    assert.ok(item, 'expected 上下文压缩 status item');
    assert.equal(item.kind, 'status');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- title quality + status preservation (P1.1) ----------

test('titleFromPath extracts date only, dropping time and uuid segments', () => {
  assert.equal(
    titleFromPath('/x/rollout-2026-01-15T12-00-00-019abcd-1234.jsonl'),
    'Codex 2026-01-15',
  );
  // Unknown filename shape falls back to the basename without extension.
  assert.equal(titleFromPath('/x/weird-name.jsonl'), 'weird-name');
});

test('isDegradedTitle recognises path-derived placeholders and legacy forms', () => {
  assert.equal(isDegradedTitle(undefined), true);
  assert.equal(isDegradedTitle(''), true);
  assert.equal(isDegradedTitle('   '), true);
  assert.equal(isDegradedTitle('Codex 2026-01-15'), true);
  assert.equal(isDegradedTitle('Codex 12-00-00-019abcd-1234'), true);
  assert.equal(isDegradedTitle('rollout-2026-01-15T12-00-00.jsonl'), true);
  // Real titles (workspace basename, user-message summary) should NOT be flagged.
  assert.equal(isDegradedTitle('example'), false);
  assert.equal(isDegradedTitle('please fix the bug'), false);
});

test('summarizeUserMessage collapses whitespace and truncates with ellipsis', () => {
  assert.equal(summarizeUserMessage('hello   world\n\nfoo'), 'hello world foo');
  assert.equal(summarizeUserMessage(''), '');
  const long = 'a'.repeat(200);
  const short = summarizeUserMessage(long, 60);
  assert.equal(short.length, 60);
  assert.ok(short.endsWith('…'));
  // Code fences are stripped (and surrounding whitespace collapsed) so the summary is human-readable.
  assert.equal(
    summarizeUserMessage('write a function ```py\nprint("hi")\n``` thanks'),
    'write a function thanks',
  );
});

test('ensureThread preserves terminal status set by task_complete (no clobber on next item)', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: freshIso(20), type: 'event_msg', payload: { type: 'task_complete' } },
    // A later item with a fresh timestamp would have previously reset status back to 'running'.
    { timestamp: freshIso(30), type: 'event_msg', payload: { type: 'agent_message', message: 'closing thoughts' } },
  ]);
  try {
    assert.equal(snapshot.threads.length, 1);
    assert.equal(snapshot.threads[0].status, 'done', 'thread status must remain done after task_complete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('first user_message upgrades a degraded title; subsequent messages do not overwrite it', async () => {
  // No session_meta so the title comes from titleFromPath (degraded).
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'event_msg', payload: { type: 'user_message', message: 'please fix the login bug in auth.ts' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'user_message', message: 'also rename the helper' } },
  ]);
  try {
    assert.equal(snapshot.threads.length, 1);
    const thread = snapshot.threads[0];
    assert.equal(thread.title, 'please fix the login bug in auth.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('user_message does NOT overwrite a meaningful workspace-derived title from session_meta', async () => {
  const { snapshot, root } = await runAdapter([
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/repo/example' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'user_message', message: 'hello world' } },
  ]);
  try {
    assert.equal(snapshot.threads[0].title, 'example');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('second scan only consumes newly appended lines (offset tracking)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-adapter-offset-'));
  const sessionPath = join(root, 'rollout-2026-01-15T12-00-00-019offset-1234.jsonl');
  writeJsonl(sessionPath, [
    { timestamp: freshIso(), type: 'session_meta', payload: { cwd: '/r' } },
    { timestamp: freshIso(10), type: 'event_msg', payload: { type: 'user_message', message: 'first turn' } },
  ]);

  const workflows = new WorkflowManager();
  const adapter = new CodexDesktopAdapter(workflows, { root });
  try {
    await adapter.scanOnce();
    const afterFirst = workflows.snapshot().items.length;
    assert.equal(afterFirst, 1, 'expected one user message after first scan');

    // Append a new line — only this one should be consumed.
    appendFileSync(
      sessionPath,
      JSON.stringify({ timestamp: freshIso(20), type: 'event_msg', payload: { type: 'user_message', message: 'second turn' } }) + '\n',
      'utf8',
    );

    await adapter.scanOnce();
    const afterSecond = workflows.snapshot().items.length;
    assert.equal(afterSecond, 2, 'expected exactly one new item after second scan');

    const contents = workflows.snapshot().items.map((it) => it.content).sort();
    assert.deepEqual(contents, ['first turn', 'second turn']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
