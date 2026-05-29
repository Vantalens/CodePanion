import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_WORKFLOW_ROLES,
  CodePanionWorkspaceManager,
} from '../dist/workflows/workspaceManager.js';

test('CodePanionWorkspaceManager initializes workspace config, roles, and artifact directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workspace-'));
  try {
    const manager = new CodePanionWorkspaceManager(dir);
    const workspace = manager.initialize();

    assert.equal(workspace.root, dir);
    assert.equal(workspace.configDir, join(dir, '.codepanion'));
    assert.ok(existsSync(join(dir, '.codepanion', 'workflow.json')));
    assert.ok(existsSync(join(dir, '.codepanion', 'roles')));
    assert.ok(existsSync(join(dir, '.codepanion', 'artifacts')));

    const config = JSON.parse(readFileSync(join(dir, '.codepanion', 'workflow.json'), 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.workspaceRoot, dir);
    assert.deepEqual(config.defaultWorkflow, [
      'intake',
      'decompose',
      'plan-review',
      'build',
      'test',
      'code-review',
      'human-acceptance',
      'archive',
    ]);
    assert.deepEqual(config.roles, BUILTIN_WORKFLOW_ROLES.map((role) => role.name));
    assert.deepEqual(Object.keys(config.roleBindings).sort(), BUILTIN_WORKFLOW_ROLES.map((role) => role.name).sort());
    assert.equal(config.roleBindings.builder.model, 'coding');
    assert.equal(config.roleBindings.tester.model, 'coding');
    assert.equal(config.roleBindings.builder.promptPath, '.codepanion/roles/builder.md');
    assert.equal(config.roleBindings.tester.promptPath, '.codepanion/roles/tester.md');
    assert.deepEqual(config.roleBindings.builder.permissions, ['read', 'write', 'command']);
    // W-31：各 role 默认 provider 已写入 binding，让 init 出来即开箱多模型协作。
    assert.equal(config.roleBindings.builder.provider, 'codex');
    assert.equal(config.roleBindings.tester.provider, 'codex');
    assert.equal(config.roleBindings.reviewer.provider, 'claude-code');
    assert.equal(config.roleBindings.planner.provider, 'claude-code');
    assert.equal(config.roleBindings['docs-writer'].provider, 'opencode');
    assert.deepEqual(config.roleBindings.builder.contextPolicy.include, []);
    assert.deepEqual(config.roleBindings.builder.contextPolicy.exclude, []);
    assert.equal(config.roleBindings.builder.contextPolicy.maxTokens, 16000);

    const roleFiles = readdirSync(join(dir, '.codepanion', 'roles')).sort();
    assert.deepEqual(roleFiles, BUILTIN_WORKFLOW_ROLES.map((role) => `${role.name}.md`).sort());
    const reviewer = readFileSync(join(dir, '.codepanion', 'roles', 'reviewer.md'), 'utf8');
    assert.match(reviewer, /Role: reviewer/);
    assert.match(reviewer, /Permissions:/);

    const restored = manager.readConfig();
    assert.ok(restored);
    assert.equal(restored.version, 1);
    assert.equal(restored.roleBindings.builder.model, 'coding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CodePanionWorkspaceManager.readConfig quarantines a corrupted workflow.json instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workspace-broken-'));
  try {
    const manager = new CodePanionWorkspaceManager(dir);
    const layout = manager.layout();
    mkdirSync(layout.configDir, { recursive: true });
    writeFileSync(layout.workflowPath, '{ not valid json', 'utf8');

    const result = manager.readConfig();
    assert.equal(result, undefined);

    // 损坏文件应被改名隔离，原路径不再存在。
    assert.equal(existsSync(layout.workflowPath), false);
    const quarantined = readdirSync(layout.configDir).filter((name) => name.startsWith('workflow.json.broken-'));
    assert.equal(quarantined.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CodePanionWorkspaceManager.readConfig rejects a schema-invalid config (missing roleBindings)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workspace-schema-'));
  try {
    const manager = new CodePanionWorkspaceManager(dir);
    const layout = manager.layout();
    mkdirSync(layout.configDir, { recursive: true });
    // version 字段类型错误：schema 应拒绝并隔离。
    writeFileSync(layout.workflowPath, JSON.stringify({ version: 2, workspaceRoot: dir }), 'utf8');

    const result = manager.readConfig();
    assert.equal(result, undefined);
    assert.equal(existsSync(layout.workflowPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
