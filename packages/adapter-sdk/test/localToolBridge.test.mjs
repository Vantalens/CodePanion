import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, parseArgs, KNOWN_KINDS, createDedupe, DEDUPE_WINDOW_MS } from '../examples/local-tool-bridge.mjs';

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

test('local-tool-bridge: createDedupe 在窗口内对同一行只放行一次', () => {
  let now = 1_000_000;
  const dedupe = createDedupe(() => now, 30_000, 100);
  assert.equal(dedupe('FAIL: build broken'), true);
  // 同一行 5s 内重复 → 抑制
  now += 5_000;
  assert.equal(dedupe('FAIL: build broken'), false);
  // 不同的行不受影响
  assert.equal(dedupe('Loaded 12 files'), true);
  // 跨过窗口后再次放行（实现使用 ts - last < windowMs，所以 = window 即不再视为重复）
  now += DEDUPE_WINDOW_MS;
  assert.equal(dedupe('FAIL: build broken'), true);
});

test('local-tool-bridge: createDedupe 超过 maxKeys 时淘汰最旧的 key', () => {
  let now = 0;
  const dedupe = createDedupe(() => now, 30_000, 3);
  assert.equal(dedupe('line-1'), true);
  now += 1;
  assert.equal(dedupe('line-2'), true);
  now += 1;
  assert.equal(dedupe('line-3'), true);
  now += 1;
  assert.equal(dedupe('line-4'), true); // 触发淘汰 line-1
  // line-1 已被淘汰，再来应被视为新行
  now += 1;
  assert.equal(dedupe('line-1'), true);
  // line-4 仍在窗口内 → 仍应被抑制
  assert.equal(dedupe('line-4'), false);
});
