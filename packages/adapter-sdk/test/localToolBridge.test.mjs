import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, parseArgs, KNOWN_KINDS } from '../examples/local-tool-bridge.mjs';

test('local-tool-bridge: classify 把错误/失败行升级为 error', () => {
  assert.equal(classify('FAIL: build broken').type, 'error');
  assert.equal(classify('TASK 失败：retry').type, 'error');
  assert.equal(classify('Error compiling lingma plugin').type, 'error');
  assert.equal(classify('Traceback (most recent call last):').type, 'error');
});

test('local-tool-bridge: classify 把疑问/确认行升级为 prompt', () => {
  assert.equal(classify('Continue?').type, 'prompt');
  assert.equal(classify('是否覆盖文件？').type, 'prompt');
  assert.equal(classify('Apply patch (y/n)').type, 'prompt');
  assert.equal(classify('请选择要执行的工具').type, 'prompt');
});

test('local-tool-bridge: classify 把成功行升级为 done', () => {
  assert.equal(classify('Build done in 4s').type, 'done');
  assert.equal(classify('生成完成').type, 'done');
  assert.equal(classify('Success: lingma agent finished').type, 'done');
});

test('local-tool-bridge: classify 其它行回落到 activity', () => {
  assert.equal(classify('Loaded 12 files').type, 'activity');
  assert.equal(classify('正在分析项目结构').type, 'activity');
});

test('local-tool-bridge: parseArgs 读取 --kind / --name / --watch / --workspace', () => {
  const parsed = parseArgs([
    '--kind', 'lingma',
    '--name', '通义灵码',
    '--watch', 'C:\\tmp\\lingma.log',
    '--workspace', 'D:\\repo',
  ]);
  assert.deepEqual(parsed, {
    kind: 'lingma',
    name: '通义灵码',
    watch: 'C:\\tmp\\lingma.log',
    workspace: 'D:\\repo',
  });
});

test('local-tool-bridge: KNOWN_KINDS 必须包含所有 first 梯队国产工具与 external 兜底', () => {
  for (const expected of ['lingma', 'qoder', 'codebuddy', 'trae', 'comate', 'codegeex', 'external']) {
    assert.ok(KNOWN_KINDS.has(expected), `${expected} 应在 bridge 已知 kind 列表内`);
  }
});
