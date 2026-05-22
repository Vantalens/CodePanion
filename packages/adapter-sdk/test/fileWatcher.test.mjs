import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldIgnore, DEFAULT_IGNORE, DEBOUNCE_MS } from '../examples/file-watcher.mjs';

test('file-watcher: shouldIgnore 忽略 node_modules / .git / dist 等噪声目录', () => {
  assert.equal(shouldIgnore('node_modules/foo/bar.js'), true);
  assert.equal(shouldIgnore('.git/HEAD'), true);
  assert.equal(shouldIgnore('dist/main.js'), true);
  assert.equal(shouldIgnore('build/out.txt'), true);
  assert.equal(shouldIgnore('.next/cache/x.js'), true);
  assert.equal(shouldIgnore('coverage/lcov.info'), true);
});

test('file-watcher: shouldIgnore 支持 Windows 反斜杠路径', () => {
  assert.equal(shouldIgnore('node_modules\\foo\\bar.js'), true);
  assert.equal(shouldIgnore('src\\.git\\config'), true);
});

test('file-watcher: shouldIgnore 不误伤普通源码路径', () => {
  assert.equal(shouldIgnore('src/index.ts'), false);
  assert.equal(shouldIgnore('packages/daemon/src/server.ts'), false);
  assert.equal(shouldIgnore('README.md'), false);
});

test('file-watcher: shouldIgnore 把空路径视为忽略', () => {
  assert.equal(shouldIgnore(''), true);
});

test('file-watcher: DEFAULT_IGNORE 至少覆盖 node_modules / .git / dist / build', () => {
  for (const segment of ['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.cache']) {
    assert.ok(DEFAULT_IGNORE.has(segment), `${segment} 必须默认被忽略`);
  }
});

test('file-watcher: DEBOUNCE_MS 维持在 50~1000ms 之间，避免回归成无去抖或过慢', () => {
  assert.ok(DEBOUNCE_MS >= 50 && DEBOUNCE_MS <= 1000, `DEBOUNCE_MS=${DEBOUNCE_MS} 越界`);
});
