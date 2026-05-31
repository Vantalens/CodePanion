import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowManager } from '../dist/daemon/workflowManager.js';

// 监听路线下线后 WorkflowManager 只是 run-event 事件总线。
// emitRunEvent → broadcast 到所有 onEvent 订阅者；workflow-run-event 是唯一事件类型。

test('emitRunEvent 广播 workflow-run-event 给订阅者', () => {
  const wm = new WorkflowManager();
  const received = [];
  wm.onEvent((ev) => received.push(ev));
  wm.emitRunEvent({ action: 'run-start', runId: 'r1', workflowName: 'demo', startedAt: 1 });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'workflow-run-event');
  assert.equal(received[0].event.action, 'run-start');
  assert.equal(received[0].event.runId, 'r1');
});

test('多订阅者都收到；取消订阅后不再收', () => {
  const wm = new WorkflowManager();
  const a = [];
  const b = [];
  const unsubA = wm.onEvent((ev) => a.push(ev));
  wm.onEvent((ev) => b.push(ev));
  wm.emitRunEvent({ action: 'step-start', runId: 'r1', workflowName: 'demo', stepId: 's1' });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  unsubA();
  wm.emitRunEvent({ action: 'step-finish', runId: 'r1', workflowName: 'demo', stepId: 's1', status: 'success' });
  assert.equal(a.length, 1, '取消订阅后 a 不再收');
  assert.equal(b.length, 2);
});

test('单个订阅者抛错不影响其它订阅者', () => {
  const wm = new WorkflowManager();
  const ok = [];
  wm.onEvent(() => { throw new Error('boom'); });
  wm.onEvent((ev) => ok.push(ev));
  wm.emitRunEvent({ action: 'run-finish', runId: 'r1', workflowName: 'demo', status: 'success', stepCount: 1, endedAt: 2 });
  assert.equal(ok.length, 1);
});
