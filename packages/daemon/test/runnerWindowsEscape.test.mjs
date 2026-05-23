import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeWindowsBatchArg, isWindowsBatchShell } from '../dist/pty/runner.js';

// N-15：CVE-2024-27980 — Windows 上 .cmd/.bat 的参数即使在 "..." 里也会被
// cmd.exe 解释。daemon 必须在 pty.spawn 之前对这些参数做硬性校验，
// 含 & | < > ^ " 或换行的参数直接拒绝；含空白的参数包裹引号。

test('isWindowsBatchShell 只在 Windows 平台对 .cmd/.bat 后缀返回 true', () => {
  // 该函数依赖 process.platform，本测试在非 Windows 上也要至少跑通函数本身。
  if (process.platform !== 'win32') {
    assert.equal(isWindowsBatchShell('C:\\tools\\foo.cmd'), false);
    assert.equal(isWindowsBatchShell('C:\\tools\\foo.bat'), false);
    return;
  }
  assert.equal(isWindowsBatchShell('C:\\tools\\foo.cmd'), true);
  assert.equal(isWindowsBatchShell('C:\\tools\\foo.bat'), true);
  assert.equal(isWindowsBatchShell('foo.CMD'), true);
  assert.equal(isWindowsBatchShell('C:\\tools\\foo.exe'), false);
  assert.equal(isWindowsBatchShell('foo'), false);
});

test('escapeWindowsBatchArg 拒绝 cmd.exe 元字符（CVE-2024-27980）', () => {
  for (const bad of [
    'a&b',
    'a|b',
    'a<b',
    'a>b',
    'a^b',
    'a"b',
    'a\nb',
    'a\rb',
    '"',
    '|| calc.exe',
    'arg & start malware.exe',
  ]) {
    assert.throws(
      () => escapeWindowsBatchArg(bad),
      /cmd\.exe 元字符|CVE-2024-27980/,
      `应拒绝危险参数：${JSON.stringify(bad)}`,
    );
  }
});

test('escapeWindowsBatchArg 把含空白的安全参数包裹为 "..."', () => {
  assert.equal(escapeWindowsBatchArg('hello world'), '"hello world"');
  assert.equal(escapeWindowsBatchArg('C:\\Program Files\\Tool'), '"C:\\Program Files\\Tool"');
  assert.equal(escapeWindowsBatchArg(''), '""');
});

test('escapeWindowsBatchArg 对无空白无元字符的参数保持原样', () => {
  assert.equal(escapeWindowsBatchArg('simple'), 'simple');
  assert.equal(escapeWindowsBatchArg('--flag=value'), '--flag=value');
  assert.equal(escapeWindowsBatchArg('C:\\path\\no-spaces'), 'C:\\path\\no-spaces');
});
