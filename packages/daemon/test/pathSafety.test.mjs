import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePathInside } from '../dist/workflows/pathSafety.js';

test('ensurePathInside 接受 anchor 内的普通路径，拒绝词法越界（.. / 绝对路径外部）', () => {
  const root = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-'));
  try {
    mkdirSync(join(root, 'roles'), { recursive: true });
    writeFileSync(join(root, 'roles', 'planner.md'), '# planner', 'utf8');
    const ok = ensurePathInside(join(root, 'roles', 'planner.md'), root, 'p');
    assert.ok(ok.endsWith(join('roles', 'planner.md')), `应返回 anchor 内的路径，实际 ${ok}`);
    assert.throws(() => ensurePathInside(join(root, '..', 'secret'), root, 'p'), /must resolve inside/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensurePathInside 对不存在的 anchor 内路径不抛（纯词法，不触碰文件系统）', () => {
  const root = mkdtempSync(join(tmpdir(), 'codepanion-pathsafety-missing-'));
  try {
    const p = ensurePathInside(join(root, 'roles', 'nope.md'), root, 'p');
    assert.ok(p.includes('nope.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
