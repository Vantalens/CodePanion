import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDaemonIdentity } from '../dist/daemon/pidfile.js';

// N-18：stop 命令在 pid 文件指向无关进程（OS 复用 pid 后）时绝不能 SIGTERM。
// 该函数 mismatch 时 stop.ts 仅清理 pidfile；unknown 时不阻塞默认行为；
// match 时才发送信号。这里至少覆盖 mismatch / unknown 两种主要路径。

test('verifyDaemonIdentity 对当前测试进程返回 mismatch（命令行不含 daemon-entry/codepanion）', () => {
  // 跑 npm test 时本进程命令行是 `node --test ...` —— 命令行里没有 daemon 指纹，
  // 必须被识别为 mismatch，从而触发 stop.ts 的"只清 pidfile 不杀进程"分支。
  const result = verifyDaemonIdentity(process.pid);
  assert.ok(
    result === 'mismatch' || result === 'unknown',
    `测试进程 pid 应被识别为 mismatch 或 unknown（取决于 OS 命令是否可用），got ${result}`,
  );
  assert.notEqual(result, 'match', '测试进程绝不应被误认作 daemon');
});

test('verifyDaemonIdentity 对不存在的极大 pid 返回 unknown', () => {
  // 用一个几乎肯定不存在的 pid 触发 OS 调用失败路径；不应抛错。
  const result = verifyDaemonIdentity(2147483646);
  assert.equal(result, 'unknown');
});
