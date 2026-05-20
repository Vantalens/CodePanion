import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_PROFILES, matchToolProfile, sourceKeyForProcess } from '../dist/adapters/aiToolProcessAdapter.js';

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

  assert.deepEqual(byTier.first?.sort(), ['codebuddy', 'codegeex', 'comate', 'lingma', 'trae']);
  assert.deepEqual(byTier.second?.sort(), ['marscode', 'qwen-code']);
  assert.deepEqual(byTier.switcher, ['cc-switch']);

  for (const profile of TOOL_PROFILES) {
    assert.ok(['first', 'second', 'switcher'].includes(profile.tier), `${profile.kind} 需要显式 tier`);
  }
});
