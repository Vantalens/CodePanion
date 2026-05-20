import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// 生成器是真相来源同步的关键路径，验证 --check 退出码可有效拦截漂移，
// 防止 CI 在 .g.cs 与 protocol.ts 不一致时仍然放行。
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const generatorPath = resolve(repoRoot, 'scripts/generate-csharp-dtos.mjs');
const generatedPath = resolve(repoRoot, 'packages/gui/Models/Generated/ProtocolDtos.g.cs');

function runGenerator(args = [], env = {}) {
  return spawnSync(process.execPath, [generatorPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('generator --check exits 0 when generated file matches', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr=${result.stderr}`);
  assert.match(result.stdout, /一致/);
});

test('generator --check exits 1 when generated file drifts', () => {
  const original = readFileSync(generatedPath, 'utf8');
  try {
    // 注入显式漂移：追加一行注释，模拟手改 .g.cs 后忘记重新生成的情况。
    writeFileSync(generatedPath, original + '// drift\n', 'utf8');
    const result = runGenerator(['--check']);
    assert.equal(result.status, 1, `expected exit 1 on drift, got ${result.status}`);
    assert.match(result.stderr, /漂移/);
  } finally {
    writeFileSync(generatedPath, original, 'utf8');
  }
});

test('generator --check tolerates CRLF in committed file', () => {
  const original = readFileSync(generatedPath, 'utf8');
  try {
    // 模拟 Windows 工作树 autocrlf=true 时 checkout 出来的 CRLF 版本。
    // 生成器内部把 existing 也归一到 LF 再比较，所以 CRLF 应当被视为一致。
    writeFileSync(generatedPath, original.replace(/\n/g, '\r\n'), 'utf8');
    const result = runGenerator(['--check']);
    assert.equal(result.status, 0, `expected exit 0 with CRLF, got ${result.status}. stderr=${result.stderr}`);
  } finally {
    writeFileSync(generatedPath, original, 'utf8');
  }
});

test('generator write mode produces LF-only output', () => {
  // gen:dtos 调用路径不会写 CRLF，否则 .gitattributes 之外的环境会反复 churn。
  const tmpDir = mkdtempSync(join(tmpdir(), 'codepanion-gen-'));
  const backupPath = join(tmpDir, 'ProtocolDtos.g.cs.bak');
  copyFileSync(generatedPath, backupPath);
  try {
    // 先污染为 CRLF。
    const original = readFileSync(generatedPath, 'utf8');
    writeFileSync(generatedPath, original.replace(/\n/g, '\r\n'), 'utf8');
    const result = runGenerator([]);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr=${result.stderr}`);
    const written = readFileSync(generatedPath, 'utf8');
    assert.ok(!written.includes('\r\n'), '生成的 .g.cs 不应包含 CRLF');
  } finally {
    copyFileSync(backupPath, generatedPath);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
