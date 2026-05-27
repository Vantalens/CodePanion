import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir, platform, userInfo } from 'node:os';
import { loadConfigFromPath, writeOwnerOnly } from '../dist/config.js';

const POSIX = platform() !== 'win32';
const WINDOWS = platform() === 'win32';

test('writeOwnerOnly writes file with 0o600 permissions on POSIX', { skip: !POSIX && 'POSIX-only permission semantics' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-perm-'));
  try {
    const target = join(dir, 'config.json');
    writeOwnerOnly(target, '{"token":"abcdef0123456789"}');
    assert.ok(existsSync(target), 'expected file to be written');
    const stat = statSync(target);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `expected mode 0o600, got 0o${mode.toString(8)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeOwnerOnly overwrite preserves 0o600 permissions on POSIX', { skip: !POSIX && 'POSIX-only permission semantics' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-perm-'));
  try {
    const target = join(dir, 'config.json');
    writeOwnerOnly(target, '{"token":"initial0123456789"}');
    writeOwnerOnly(target, '{"token":"rotated0123456789"}');
    const mode = statSync(target).mode & 0o777;
    assert.equal(mode, 0o600, `expected mode 0o600 after overwrite, got 0o${mode.toString(8)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeOwnerOnly strips BUILTIN\\Users and inherited ACEs on Windows', { skip: !WINDOWS && 'Windows-only ACL semantics' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-acl-'));
  try {
    const target = join(dir, 'config.json');
    writeOwnerOnly(target, '{"token":"windowsacl0123456"}');
    const acl = execFileSync('icacls', [target], { encoding: 'utf8', windowsHide: true });
    // After /inheritance:r the ACL must NOT contain BUILTIN\Users or the
    // generic Users group — those are the inherited entries we want gone.
    assert.equal(/BUILTIN\\Users/i.test(acl), false, `expected BUILTIN\\Users stripped, got:\n${acl}`);
    assert.equal(/Authenticated Users/i.test(acl), false, `expected Authenticated Users stripped, got:\n${acl}`);
    // The current user must still own the file with Full control.
    const username = userInfo().username;
    assert.ok(
      new RegExp(`${username}\\b.*\\(F\\)`, 'i').test(acl),
      `expected ${username}:(F) in ACL, got:\n${acl}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeOwnerOnly creates a readable file on every platform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-perm-'));
  try {
    const target = join(dir, 'config.json');
    const payload = '{"token":"crossplatform0123"}';
    writeOwnerOnly(target, payload);
    assert.ok(existsSync(target), 'expected file to be written on this platform');
    const stat = statSync(target);
    assert.ok(stat.isFile(), 'expected a regular file');
    assert.ok(stat.size > 0, 'expected non-empty file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFromPath quarantines malformed JSON and recreates usable config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-config-broken-json-'));
  try {
    const target = join(dir, 'config.json');
    writeFileSync(target, '{"token":', 'utf8');

    const config = loadConfigFromPath(target);
    const entries = readdirSync(dir);

    assert.equal(config.token.length, 32);
    assert.ok(entries.some((name) => name.startsWith('config.json.broken-')));
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).token, config.token);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfigFromPath quarantines schema-invalid JSON and restores defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-config-broken-schema-'));
  try {
    const target = join(dir, 'config.json');
    writeFileSync(target, JSON.stringify({ token: 'short', port: 80 }), 'utf8');

    const config = loadConfigFromPath(target);
    const entries = readdirSync(dir);

    assert.equal(config.port, 7777);
    assert.equal(config.token.length, 32);
    assert.ok(entries.some((name) => name.startsWith('config.json.broken-')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
