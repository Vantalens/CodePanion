import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from '../dist/daemon/pidfile.js';

// N-17：旧实现 readPid → alive 检查 → clearPid → writePid 非原子，CLI start 与 GUI 双击
// 并发时两个 daemon child 都会拿到 dead pid → 都 writePid 顺序覆盖，最终同时起两个 daemon。
// 改为 openSync('wx') 原子独占；这里覆盖三条关键路径：首获、活持有者让位、死残留可恢复。

test('acquireLock 首次拿到空闲 pidfile 时写入当前 pid 并返回 true（N-17）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-pid-fresh-'));
  try {
    const path = join(dir, 'daemon.pid');
    assert.equal(acquireLock(path), true);
    assert.equal(readFileSync(path, 'utf8').trim(), String(process.pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireLock 在持有者仍活着时立刻返回 false，绝不覆盖（N-17）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-pid-alive-'));
  try {
    const path = join(dir, 'daemon.pid');
    // 用当前测试进程的 pid 模拟"另一个 daemon 还活着"——alive 检查必然为 true。
    writeFileSync(path, String(process.pid), 'utf8');
    assert.equal(acquireLock(path), false, '活持有者不应被覆盖');
    // 文件未被改写（仍是原来的 pid，没有 wx 写入第二份）。
    assert.equal(readFileSync(path, 'utf8').trim(), String(process.pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireLock 在 pidfile 残留死 pid 时清理并重试，最终返回 true（N-17）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-pid-stale-'));
  try {
    const path = join(dir, 'daemon.pid');
    // 写一个几乎不可能存在的 pid：触发 EEXIST → isProcessAlive=false → unlink → 重试 wx → 成功。
    writeFileSync(path, '2147483646', 'utf8');
    assert.equal(acquireLock(path), true, '死 pid 残留应被清理后由本进程接管');
    assert.equal(readFileSync(path, 'utf8').trim(), String(process.pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireLock 并发模拟：两次连续调用同一路径，第二次必返回 false（N-17）', () => {
  // 串行调用足以验证关键不变量：第一次 wx 创建后，第二次必须看到 EEXIST → alive 持有者 → 返回 false。
  // 真正的多进程并发由 OS open(O_EXCL) 原子性保证，这里覆盖"两个 child 都通过 alive 检查"的回归。
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-pid-concurrent-'));
  try {
    const path = join(dir, 'daemon.pid');
    assert.equal(acquireLock(path), true, '首获应成功');
    assert.equal(acquireLock(path), false, '同进程已持锁，第二次必须让位');
    assert.ok(existsSync(path), 'pidfile 仍存在');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
