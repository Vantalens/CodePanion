import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  workspaceInitCommand,
  workspaceStatusCommand,
} from '../dist/cli/workspace.js';

// 在某个临时 cwd 下跑 callback，并收集 console.log / console.error / process.exit。
async function withCapture(cwd, callback) {
  const cwdBefore = process.cwd();
  const stdout = [];
  const stderr = [];
  const exits = [];
  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exit;
  console.log = (...parts) => stdout.push(parts.join(' '));
  console.error = (...parts) => stderr.push(parts.join(' '));
  process.exit = ((code) => {
    exits.push(code);
    // 抛错中断 caller，模拟 process.exit 的「立刻终止」语义。
    throw new Error(`__process_exit_called__ ${code}`);
  });
  if (cwd) process.chdir(cwd);
  try {
    await callback();
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('__process_exit_called__')) throw err;
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
    process.chdir(cwdBefore);
  }
  return { stdout, stderr, exits };
}

test('workspaceInitCommand 在 root 下落 .codepanion/workflow.json，schema 合法', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-ws-init-'));
  try {
    const { stdout } = await withCapture(undefined, () => workspaceInitCommand({ root: dir }));
    assert.ok(existsSync(join(dir, '.codepanion', 'workflow.json')));
    assert.ok(existsSync(join(dir, '.codepanion', 'roles')));
    assert.ok(existsSync(join(dir, '.codepanion', 'artifacts')));
    const cfg = JSON.parse(readFileSync(join(dir, '.codepanion', 'workflow.json'), 'utf8'));
    assert.equal(cfg.version, 1);
    assert.equal(cfg.workspaceRoot, dir);
    // 关键提示行：用户能看到 workspace 路径与各 layout 路径，并被引导回 workflow 命令。
    assert.ok(stdout.some((line) => line.includes('workspace initialized at')));
    assert.ok(stdout.some((line) => line.includes('codepanion workflow commands run from this project')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workspaceInitCommand 重复调用同一 root 是 idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-ws-init-idem-'));
  try {
    await withCapture(undefined, () => workspaceInitCommand({ root: dir }));
    const first = readFileSync(join(dir, '.codepanion', 'workflow.json'), 'utf8');
    await withCapture(undefined, () => workspaceInitCommand({ root: dir }));
    const second = readFileSync(join(dir, '.codepanion', 'workflow.json'), 'utf8');
    assert.equal(first, second, '重复 init 不应覆盖现有 workflow.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workspaceStatusCommand 在 workspace 内时 exit 0 并打印 layout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-ws-status-ok-'));
  try {
    await withCapture(undefined, () => workspaceInitCommand({ root: dir }));
    const { stdout, exits } = await withCapture(dir, () => workspaceStatusCommand({}));
    assert.deepEqual(exits, [], 'status 在 workspace 内不应 exit 非零');
    assert.ok(stdout.some((line) => line.includes('workspace root')));
    assert.ok(stdout.some((line) => line.includes('config:')));
    assert.ok(stdout.some((line) => line.includes('roles:')));
    assert.ok(stdout.some((line) => line.includes('artifacts:')));
    assert.ok(stdout.some((line) => line.includes('version:')));
    assert.ok(stdout.some((line) => line.includes('workflow:')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workspaceStatusCommand 找不到 workspace 时 exit 1 并提示 init', async () => {
  // 用 tmpdir 下一个不带 marker 的随机目录。要避免 findUpworkspace 向上找到任何祖先目录的 workspace。
  // 把 cwd 切到 tmpdir 自身（系统 tmp 一般不在 workspace 内），然后传一个不存在的子路径作 root。
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-ws-status-miss-'));
  try {
    const { stderr, exits } = await withCapture(undefined, () => workspaceStatusCommand({ root: dir }));
    assert.deepEqual(exits, [1]);
    assert.ok(stderr.some((line) => line.includes('no .codepanion workspace')));
    assert.ok(stderr.some((line) => line.includes('codepanion workspace init')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
