import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_PROFILES, matchToolProfile, sanitizeReportField, sourceKeyForProcess } from '../dist/adapters/aiToolProcessAdapter.js';

test('AI tool scanner detects CC Switch by process name', () => {
  const profile = matchToolProfile({
    processId: 1001,
    name: 'cc-switch.exe',
    path: 'C:\\Tools\\cc-switch.exe',
  });

  assert.equal(profile?.kind, 'cc-switch');
  assert.equal(profile?.name, 'CC Switch');
  assert.ok(profile?.capabilities.includes('account-switcher'));
  assert.ok(profile?.capabilities.includes('provider-switcher'));
});

test('AI tool scanner detects Claude Code Switch npm commands', () => {
  const profile = matchToolProfile({
    processId: 1002,
    name: 'node.exe',
    commandLine: 'node C:\\Users\\Owen\\AppData\\Roaming\\npm\\node_modules\\@dingpx\\claude-code-switch\\bin\\ccs.js current',
  });

  assert.equal(profile?.kind, 'cc-switch');
});

test('AI tool scanner detects ccs command aliases before generic AI tool profiles', () => {
  const profile = matchToolProfile({
    processId: 1003,
    name: 'node.exe',
    commandLine: 'npx ccs switch work',
    windowTitle: 'CC Switch',
  });

  assert.equal(profile?.kind, 'cc-switch');
});

test('AI tool scanner deduplicates CC Switch helper processes by executable path', () => {
  const profile = matchToolProfile({
    processId: 1004,
    name: 'cc-switch.exe',
    path: 'C:\\Tools\\cc-switch.exe',
  });

  assert.equal(profile?.kind, 'cc-switch');
  assert.equal(
    sourceKeyForProcess(profile, { processId: 1004, name: 'cc-switch.exe', path: 'C:\\Tools\\cc-switch.exe' }),
    sourceKeyForProcess(profile, { processId: 1005, name: 'cc-switch.exe', path: 'C:/Tools/cc-switch.exe' }),
  );
});

test('TOOL_PROFILES tier 收敛与 MONITORING_SOURCES.md 一致', () => {
  const byTier = TOOL_PROFILES.reduce((acc, profile) => {
    (acc[profile.tier] ??= []).push(profile.kind);
    return acc;
  }, /** @type {Record<string,string[]>} */ ({}));

  // 2026-05-24：新增 claude-code / codex / external（OpenCode）三个 first-tier CLI profile，
  // 用于解决用户反馈"VS Code 里用 Claude Code 但 GUI 显示不出"的盲区。
  assert.deepEqual(
    byTier.first?.sort(),
    ['claude-code', 'codebuddy', 'codegeex', 'codex', 'comate', 'external', 'lingma', 'qoder', 'trae'],
  );
  assert.deepEqual(byTier.second?.sort(), ['marscode', 'qwen-code']);
  assert.deepEqual(byTier.switcher, ['cc-switch']);

  for (const profile of TOOL_PROFILES) {
    assert.ok(['first', 'second', 'switcher'].includes(profile.tier), `${profile.kind} 需要显式 tier`);
  }
});

test('Claude Code CLI 通过 @anthropic-ai/claude-code 包路径被识别（严格匹配）', () => {
  // VS Code 插件场景：claude-code 以 node.exe 子进程运行，命令行里有 npm 包路径。
  const viaNpmPackage = matchToolProfile({
    processId: 8001,
    name: 'node.exe',
    commandLine: 'node C:\\Users\\Owen\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
  });
  assert.equal(viaNpmPackage?.kind, 'claude-code');
});

test('Claude Code 严格匹配：进程名叫 claude.exe 但没有 npm 包路径时不命中（防止误识别）', () => {
  // 2026-05-24：用户反馈"任务列表里出现一堆假来源"——根因之一就是宽 processPattern
  // 把所有叫 claude.exe / codex.exe 的同名程序全吞进来。必须见到 @anthropic-ai/claude-code
  // 包路径才算命中。
  const unrelatedClaude = matchToolProfile({
    processId: 8002,
    name: 'claude.exe',
    path: 'C:\\Some\\Other\\Tool\\claude.exe',
  });
  assert.equal(unrelatedClaude, undefined, 'claude.exe without npm package path must NOT be identified as Claude Code');
});

test('Codex CLI 严格匹配：进程名叫 codex.exe 但没有 npm 包路径时不命中（防止 Desktop 子进程被误识别）', () => {
  // Codex Desktop 是 Electron 应用，主进程 + N 个 renderer / GPU / utility 都叫 codex.exe。
  // 旧的 processPattern `/^codex(\.exe)?$/i` 会把它们全部识别成 Codex CLI 多份，导致
  // GUI 列表显示一排重复的 "Codex"。Desktop 必须由 codexDesktopAdapter 单独处理。
  const electronMain = matchToolProfile({
    processId: 8101,
    name: 'codex.exe',
    path: 'C:\\Program Files\\Codex\\codex.exe',
  });
  assert.equal(electronMain, undefined, 'codex.exe Electron main process must NOT be identified as Codex CLI');

  const electronRenderer = matchToolProfile({
    processId: 8102,
    name: 'codex.exe',
    commandLine: '"C:\\Program Files\\Codex\\codex.exe" --type=renderer --user-data-dir=...',
  });
  assert.equal(electronRenderer, undefined, 'codex.exe Electron renderer must NOT be identified as Codex CLI');

  // 真正的 Codex CLI：node.exe + @openai/codex 包路径。
  const cli = matchToolProfile({
    processId: 8103,
    name: 'node.exe',
    commandLine: 'node C:\\Users\\Owen\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\cli.js',
  });
  assert.equal(cli?.kind, 'codex');
});

test('OpenCode CLI 通过 @sst/opencode 包路径识别为 external kind', () => {
  const cli = matchToolProfile({
    processId: 8201,
    name: 'node.exe',
    commandLine: 'node C:\\Users\\Owen\\AppData\\Roaming\\npm\\node_modules\\@sst\\opencode\\bin\\opencode.js',
  });
  assert.equal(cli?.kind, 'external');
  assert.equal(cli?.name, 'OpenCode');

  const unrelatedOpencode = matchToolProfile({
    processId: 8202,
    name: 'opencode.exe',
    path: 'C:\\Some\\Other\\Tool\\opencode.exe',
  });
  assert.equal(unrelatedOpencode, undefined);
});

test('Claude Code / Codex / OpenCode 多个子进程合并到同一 source（path-based dedup）', () => {
  // 用户场景：node.exe 跑同一个 @anthropic-ai/claude-code 的多个子进程（主 + worker + watcher）
  // 应该聚合成一个 source，而不是 3 个独立 source。
  const profile = matchToolProfile({
    processId: 9001,
    name: 'node.exe',
    commandLine: 'node ...\\@anthropic-ai\\claude-code\\cli.js',
  });
  assert.ok(profile);
  const keyA = sourceKeyForProcess(profile, { processId: 9001, name: 'node.exe', path: 'C:\\Program Files\\nodejs\\node.exe' });
  const keyB = sourceKeyForProcess(profile, { processId: 9002, name: 'node.exe', path: 'C:\\Program Files\\nodejs\\node.exe' });
  const keyC = sourceKeyForProcess(profile, { processId: 9003, name: 'node.exe', path: 'C:/Program Files/nodejs/node.exe' });
  assert.equal(keyA, keyB, '同路径不同 PID 必须合并');
  assert.equal(keyA, keyC, '正反斜杠归一化');
});

test('sanitizeReportField 把 HOME 替换为 ~ 并截断到 80 字符（N-6）', () => {
  // 这里不能直接断言 HOME 替换（运行环境不一定有 HOME 命中），但能验证截断与空值处理。
  assert.equal(sanitizeReportField(''), undefined);
  assert.equal(sanitizeReportField(undefined), undefined);
  const long = 'workspace - ' + '中'.repeat(200);
  const clipped = sanitizeReportField(long);
  assert.ok(clipped && clipped.length <= 80, `should be clipped to <= 80 chars, got ${clipped?.length}`);
  assert.ok(clipped?.endsWith('…'), 'should end with ellipsis when clipped');
});

test('Qoder 独立 IDE 进程被识别为 qoder kind 而不是被吞进 lingma profile', () => {
  // Qoder 是阿里独立 IDE（VS Code 系），与 lingma 插件应分开计入来源。
  const byName = matchToolProfile({ processId: 7001, name: 'Qoder.exe', path: 'C:\\Program Files\\Qoder\\Qoder.exe' });
  assert.equal(byName?.kind, 'qoder');

  const byPath = matchToolProfile({
    processId: 7002,
    name: 'Qoder Helper (Renderer).exe',
    path: 'C:\\Program Files\\Qoder\\Qoder Helper.exe',
    commandLine: '"C:\\Program Files\\Qoder\\Qoder Helper.exe" --type=renderer',
    windowTitle: 'workspace - Qoder',
  });
  assert.equal(byPath?.kind, 'qoder');

  // 真的纯 lingma 路径仍然回退到 lingma profile，不会被 qoder 抢走。
  const lingmaPlugin = matchToolProfile({
    processId: 7003,
    name: 'node.exe',
    commandLine: 'node C:\\Users\\me\\.vscode\\extensions\\alibaba.lingma\\lingma-server.js',
  });
  assert.equal(lingmaPlugin?.kind, 'lingma');
});
