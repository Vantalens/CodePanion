import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelWorkflowRun,
  getWorkflowBoard,
  getWorkflowGates,
  listWorkflowArtifacts,
  resolveWorkflowGate,
  startWorkflowRun,
  wsProtocols,
  wsUrl,
} from '../dist/shared/client.js';

// 这些 client helper 是 CLI workflow board/start/cancel/gates 命令的桥；
// daemon-side endpoint 自身的 happy path 已经在 server.integration.test.mjs 覆盖了，
// 这里只做静态契约检查 —— 防止以后误删 export / 改签名导致 CLI 失联。

test('shared/client.ts 导出 workflow 远端调用 + WS 辅助（CLI start/board/cancel/gates/resolve/watch/artifacts 桥）', () => {
  for (const fn of [
    getWorkflowBoard,
    getWorkflowGates,
    startWorkflowRun,
    cancelWorkflowRun,
    resolveWorkflowGate,
    listWorkflowArtifacts,
    wsUrl,
    wsProtocols,
  ]) {
    assert.equal(typeof fn, 'function');
  }
  // start/cancel/resolve 第一个参数承接 payload / runId；arity 不应被未来重构悄悄改没。
  assert.equal(startWorkflowRun.length, 1);
  assert.equal(cancelWorkflowRun.length, 1);
  assert.equal(resolveWorkflowGate.length, 1);
  // listWorkflowArtifacts(runId, workspace?) -- JS length 计入未 default 的参数，所以是 2。
  assert.equal(listWorkflowArtifacts.length, 2);
  // wsUrl 至少接 role，第二个 sessionId 可选；arity 是 1（第二个 optional 不计入）。
  assert.ok(wsUrl.length >= 1);
});
