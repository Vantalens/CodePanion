import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P2.2：daemon 自动启动路径的契约检查。
// DaemonProcessManager.FindDaemonEntry() 会优先查找 packages/daemon/bundle/daemon.cjs，
// 找不到再回退 packages/daemon/dist/daemon-entry.js。两份产物缺一不可，否则便携版双击
// 启动会直接失败到 "未找到随软件发布的 daemon 文件" 的诊断分支。
const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '../bundle/daemon.cjs');
const distEntryPath = resolve(here, '../dist/daemon-entry.js');

test('daemon bundle 产物存在且非空', () => {
  assert.equal(existsSync(bundlePath), true, '便携版打包要求 packages/daemon/bundle/daemon.cjs 存在');
  const stat = statSync(bundlePath);
  assert.ok(stat.size > 100_000, `daemon.cjs 看起来不是完整 bundle，大小=${stat.size}`);
});

test('daemon bundle 内含 /health 路由与 bootDaemon 入口符号', () => {
  const content = readFileSync(bundlePath, 'utf8');
  assert.match(content, /\/health/, 'bundle 必须包含 /health 路由，否则 DaemonProcessManager 健康检查永远失败');
  assert.match(content, /bootDaemon|acquireLock/, 'bundle 必须包含 daemon 启动入口符号');
});

test('dist daemon-entry.js 存在以满足 DaemonProcessManager 的回退路径', () => {
  assert.equal(existsSync(distEntryPath), true, 'DaemonProcessManager 回退路径 packages/daemon/dist/daemon-entry.js 必须存在');
  const content = readFileSync(distEntryPath, 'utf8');
  assert.match(content, /bootDaemon/, 'daemon-entry.js 必须 import bootDaemon');
});
