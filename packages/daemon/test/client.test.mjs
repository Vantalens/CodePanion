import assert from 'node:assert/strict';
import test from 'node:test';
import { DaemonHttpError, DaemonClientTimeoutError } from '../dist/shared/client.js';

test('DaemonHttpError.message 不再拼接 response body（N-10）', () => {
  const err = new DaemonHttpError('POST', '/sessions', 500, 'sensitive prompt body and stack trace');
  assert.equal(err.message, 'POST /sessions failed: 500');
  assert.ok(!err.message.includes('sensitive'), 'message 不应直接暴露 body');
  assert.ok(err.body.includes('sensitive'), 'body 字段仍保留供调试');
  assert.equal(err.status, 500);
  assert.equal(err.method, 'POST');
  assert.equal(err.path, '/sessions');
});

test('DaemonHttpError.body 截断到 4KB 上限（N-10）', () => {
  const huge = 'A'.repeat(10_000);
  const err = new DaemonHttpError('GET', '/audit/snapshot', 502, huge);
  assert.ok(err.body.length <= 4096, `body 应被截到 ≤4096，实际 ${err.body.length}`);
  assert.equal(err.message, 'GET /audit/snapshot failed: 502');
});

test('DaemonClientTimeoutError 名称稳定 + 暴露 timeoutMs（N-11）', () => {
  const err = new DaemonClientTimeoutError('GET', '/sessions', 8000);
  assert.equal(err.name, 'DaemonClientTimeoutError');
  assert.equal(err.timeoutMs, 8000);
  assert.equal(err.method, 'GET');
  assert.equal(err.path, '/sessions');
  assert.ok(err.message.includes('8000'));
});
