import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P8：默认桌面壳已切到 Tauri + React，便携版必须打包 Rust daemon，
// 旧 WPF/Node daemon bundle 只能作为 legacy fallback 存在，不能回到默认入口。
const here = dirname(fileURLToPath(import.meta.url));
const distEntryPath = resolve(here, '../dist/daemon-entry.js');
const packageScriptPath = resolve(here, '../../../scripts/package-windows.ps1');
const validateScriptPath = resolve(here, '../../../scripts/validate-portable-package.ps1');

test('Windows 打包默认使用 Tauri shell 和 Rust daemon', () => {
  const content = readFileSync(packageScriptPath, 'utf8');
  assert.match(content, /npm run tauri:build/, 'package:windows 必须构建 Tauri GUI');
  assert.match(content, /CodePanion\.exe/, '便携版默认入口必须是 Tauri 产物 CodePanion.exe');
  assert.match(content, /codepanion-daemon\.exe/, '便携版必须包含 Rust daemon');
  assert.doesNotMatch(content, /daemon\.cjs/, '默认 Windows 打包不能依赖旧 Node daemon bundle');
  assert.doesNotMatch(content, /CodePanion\.Gui\.exe/, '默认 Windows 打包不能回退 WPF 入口');
});

test('便携版校验脚本检查新默认入口并拒绝旧运行时', () => {
  const content = readFileSync(validateScriptPath, 'utf8');
  assert.match(content, /CodePanion\.exe/, '校验脚本必须检查 Tauri GUI 入口');
  assert.match(content, /daemon\\codepanion-daemon\.exe/, '校验脚本必须检查 Rust daemon');
  assert.match(content, /daemon\\daemon\.cjs/, '校验脚本必须拒绝旧 Node daemon bundle');
  assert.match(content, /CodePanion\.Gui\.exe/, '校验脚本必须拒绝旧 WPF 入口');
});

test('dist daemon-entry.js 存在以满足 DaemonProcessManager 的回退路径', () => {
  assert.equal(existsSync(distEntryPath), true, 'DaemonProcessManager 回退路径 packages/daemon/dist/daemon-entry.js 必须存在');
  const content = readFileSync(distEntryPath, 'utf8');
  assert.match(content, /bootDaemon/, 'daemon-entry.js 必须 import bootDaemon');
});
