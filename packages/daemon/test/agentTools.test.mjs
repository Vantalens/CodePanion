import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReadonlyTools } from '../dist/workflows/agentTools.js';

// agent 只读工具 + 沙箱单测：临时目录建文件，验证 read/list 命中、越界被拒、无 workspace 禁用。

async function withWorkspace(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-agenttools-'));
  try {
    writeFileSync(join(dir, 'hello.txt'), 'HELLO_CONTENT', 'utf8');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('read_file 读到 workspace 内文件内容', async () => {
  await withWorkspace(async (dir) => {
    const { runTool } = buildReadonlyTools(dir);
    const out = await runTool('read_file', JSON.stringify({ path: 'hello.txt' }));
    assert.equal(out, 'HELLO_CONTENT');
    const nested = await runTool('read_file', JSON.stringify({ path: 'src/index.ts' }));
    assert.match(nested, /export const x = 1/);
  });
});

test('list_dir 列出目录条目（含 file/dir 标注）', async () => {
  await withWorkspace(async (dir) => {
    const { runTool } = buildReadonlyTools(dir);
    const out = await runTool('list_dir', JSON.stringify({ path: '.' }));
    assert.match(out, /file hello\.txt/);
    assert.match(out, /dir {2}src/);
    const sub = await runTool('list_dir', JSON.stringify({ path: 'src' }));
    assert.match(sub, /file index\.ts/);
  });
});

test('路径越界（.. / 绝对路径）被拒', async () => {
  await withWorkspace(async (dir) => {
    const { runTool } = buildReadonlyTools(dir);
    const up = await runTool('read_file', JSON.stringify({ path: '../../etc/passwd' }));
    assert.match(up, /越界|拒绝/);
    const abs = await runTool('read_file', JSON.stringify({ path: 'C:/Windows/system32/drivers/etc/hosts' }));
    assert.match(abs, /越界|拒绝/);
  });
});

test('不存在 / 类型不符 返回错误字符串，不抛', async () => {
  await withWorkspace(async (dir) => {
    const { runTool } = buildReadonlyTools(dir);
    assert.match(await runTool('read_file', JSON.stringify({ path: 'nope.txt' })), /不存在/);
    assert.match(await runTool('read_file', JSON.stringify({ path: 'src' })), /是目录/);
    assert.match(await runTool('list_dir', JSON.stringify({ path: 'hello.txt' })), /不是目录/);
    assert.match(await runTool('unknown_tool', '{}'), /未知工具/);
  });
});

test('无 workspace（空根）→ 无工具，dispatcher 拒绝', async () => {
  const { tools, runTool } = buildReadonlyTools('');
  assert.equal(tools.length, 0);
  assert.match(await runTool('read_file', JSON.stringify({ path: 'x' })), /没有选定 workspace/);
});

test('有 workspace → 暴露 read_file 与 list_dir 两个工具', async () => {
  await withWorkspace(async (dir) => {
    const { tools } = buildReadonlyTools(dir);
    const names = tools.map((t) => t.function.name).sort();
    assert.deepEqual(names, ['list_dir', 'read_file']);
  });
});
