import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePathInside } from '../dist/workflows/pathSafety.js';

test('ensurePathInside 接受 anchor 内的普通路径，拒绝词法越界（.. / 绝对路径外部）', () => {
  const root = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-'));
  try {
    mkdirSync(join(root, 'roles'), { recursive: true });
    writeFileSync(join(root, 'roles', 'planner.md'), '# planner', 'utf8');
    const ok = ensurePathInside(join(root, 'roles', 'planner.md'), root, 'p');
    assert.ok(ok.endsWith(join('roles', 'planner.md')), `应返回 anchor 内的真实路径，实际 ${ok}`);
    assert.throws(() => ensurePathInside(join(root, '..', 'secret'), root, 'p'), /must resolve inside/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensurePathInside 对不存在的 anchor 内路径不抛（不存在的路径无法被跟随，词法值即安全）', () => {
  const root = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-missing-'));
  try {
    const p = ensurePathInside(join(root, 'roles', 'nope.md'), root, 'p');
    assert.ok(p.includes('nope.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensurePathInside 跟随 symlink：workspace 内指向外部的软链被拒（创建 symlink 无权限时跳过）', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-out-'));
  try {
    const secret = join(outside, 'secret.md');
    writeFileSync(secret, 'TOP SECRET', 'utf8');
    const link = join(root, 'link.md');
    try {
      symlinkSync(secret, link);
    } catch {
      // Windows 默认无 symlink 创建权限（EPERM）/ 文件系统不支持 → 跳过。
      // 该向量在 Windows 上本就需要提权；词法越界用例已跨平台覆盖，POSIX CI 覆盖本断言。
      t.skip('symlink 创建不可用（无权限或不支持）');
      return;
    }
    // 软链叶子在 workspace 内、无 ".." 且非绝对路径，能骗过词法校验；realpath 后暴露真实外部目标 → 被拒。
    assert.throws(() => ensurePathInside(link, root, 'role prompt path'), /must resolve inside/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
