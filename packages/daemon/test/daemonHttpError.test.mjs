import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { DaemonHttpError } from '../dist/shared/client.js';
import { createLogger, maskValue } from '../dist/logger.js';

// P1.3「适配器与客户端失败日志足以定位问题」的回归基线：
// HTTP 失败抛出的 Error 必须能透过 pino + maskValue 序列化出
// method / path / status / body，便于运行时排错。

test('DaemonHttpError carries structured fields and remains an Error subclass', () => {
  const err = new DaemonHttpError('POST', '/sessions/abc/prompt', 400, 'invalid payload');
  assert.ok(err instanceof Error, 'DaemonHttpError 必须继承 Error');
  assert.equal(err.name, 'DaemonHttpError');
  assert.equal(err.method, 'POST');
  assert.equal(err.path, '/sessions/abc/prompt');
  assert.equal(err.status, 400);
  assert.equal(err.body, 'invalid payload');
  // N-10：message 只含路由信息，不拼 body，避免被 pino / gui.log 二次落盘。
  assert.equal(err.message, 'POST /sessions/abc/prompt failed: 400');
  assert.ok(!err.message.includes('invalid payload'), 'message 不应直接暴露 body');
});

test('DaemonHttpError body is truncated to 4096 chars to avoid bloating logs', () => {
  const huge = 'x'.repeat(10_000);
  const err = new DaemonHttpError('POST', '/sessions/abc/output', 500, huge);
  assert.equal(err.body.length, 4096);
});

test('DaemonHttpError message 不随 body 增长（N-10）', () => {
  const huge = 'y'.repeat(1000);
  const err = new DaemonHttpError('GET', '/foo', 500, huge);
  // message 是定长模板，与 body 大小无关。
  assert.equal(err.message, 'GET /foo failed: 500');
});

test('maskValue preserves DaemonHttpError fields so pino can serialize them', () => {
  const err = new DaemonHttpError('POST', '/sessions/abc/prompt', 401, 'unauthorized');
  const serialized = maskValue(err);
  assert.equal(typeof serialized, 'object');
  assert.equal(serialized.type, 'DaemonHttpError');
  assert.equal(serialized.method, 'POST');
  assert.equal(serialized.path, '/sessions/abc/prompt');
  assert.equal(serialized.status, 401);
  assert.equal(serialized.body, 'unauthorized');
  assert.ok(typeof serialized.stack === 'string' && serialized.stack.length > 0, 'stack 必须保留');
});

test('logger writes DaemonHttpError context to its output stream', () => {
  const chunks = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger({ level: 'trace', destination });
  const err = new DaemonHttpError('POST', '/sessions/abc/output', 500, 'oops');
  logger.warn({ err }, 'client call failed');

  const out = chunks.join('');
  assert.ok(out.includes('client call failed'), '应包含日志消息');
  assert.ok(out.includes('DaemonHttpError'), '应包含错误类型');
  assert.ok(out.includes('/sessions/abc/output'), '应包含失败的 path');
  // status 字段是 enumerable 自有属性，pino 的 err serializer 会保留它。
  assert.ok(/"status":\s*500/.test(out), `应包含 status=500，原始输出：${out}`);
});

test('DaemonHttpError discriminates via instanceof so callers can branch on it', () => {
  const isDaemonError = (e) => e instanceof DaemonHttpError;
  assert.equal(isDaemonError(new DaemonHttpError('GET', '/x', 404, '')), true);
  assert.equal(isDaemonError(new Error('boom')), false);
});
