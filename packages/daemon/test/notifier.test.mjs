import assert from 'node:assert/strict';
import test from 'node:test';
import { clipNotifyText } from '../dist/daemon/notifier.js';

test('clipNotifyText 截断到 max 字符并以 … 收尾（N-7）', () => {
  const long = '这是用户的 prompt 片段 ' + '中'.repeat(200);
  const clipped = clipNotifyText(long, 80);
  assert.ok(clipped.length <= 80, `应被截断到 <= 80 字符，实际 ${clipped.length}`);
  assert.ok(clipped.endsWith('…'), '截断时应以 … 结尾');
});

test('clipNotifyText 对空 / undefined 返回空字符串（N-7）', () => {
  assert.equal(clipNotifyText('', 60), '');
  assert.equal(clipNotifyText(undefined, 60), '');
});

test('clipNotifyText 把 Bearer token 替换为 [Redacted]（N-7 / N-10 关联）', () => {
  const input = 'Bearer abcdef0123456789ABCDEF';
  const out = clipNotifyText(input, 200);
  assert.ok(!out.includes('abcdef0123456789'), '不应直接保留 token 明文');
  assert.ok(out.includes('[Redacted]'), '应替换为 [Redacted]');
});

test('clipNotifyText 把多空白合并为单空格（N-7）', () => {
  const input = '换行\n之后\n依然\t一行';
  assert.equal(clipNotifyText(input, 80), '换行 之后 依然 一行');
});
