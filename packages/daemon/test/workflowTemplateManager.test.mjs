import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowTemplateManager,
  parseTemplateParams,
  parseTemplateValues,
} from '../dist/workflows/templateManager.js';

function withManager(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-templates-'));
  const path = join(dir, 'workflow-templates.json');
  try {
    return run(new WorkflowTemplateManager(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('WorkflowTemplateManager saves, lists, and overwrites templates', () => {
  withManager((manager) => {
    const first = manager.save({
      name: 'review',
      command: 'codex',
      args: ['review', '{target}'],
      params: parseTemplateParams(['target=.']),
    });
    assert.equal(first.name, 'review');
    assert.equal(first.params[0].name, 'target');

    const second = manager.save({
      name: 'review',
      description: 'review a target path',
      command: 'codex',
      args: ['review', '--deep', '{target}'],
      params: parseTemplateParams(['target=packages/daemon']),
    });
    assert.equal(second.createdAt, first.createdAt);
    assert.ok(second.updatedAt >= first.updatedAt);

    const all = manager.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].description, 'review a target path');
    assert.deepEqual(all[0].args, ['review', '--deep', '{target}']);
  });
});

test('WorkflowTemplateManager resolves placeholders with defaults and runtime values', () => {
  withManager((manager) => {
    manager.save({
      name: 'fix',
      command: 'codex',
      args: ['run', '--cwd', '{workspace}', '{task}'],
      params: parseTemplateParams(['workspace=.', 'task=继续']),
    });

    const defaults = manager.resolve('fix');
    assert.equal(defaults.command, 'codex');
    assert.deepEqual(defaults.args, ['run', '--cwd', '.', '继续']);

    const custom = manager.resolve('fix', parseTemplateValues(['workspace=packages/gui', 'task=修复截图']));
    assert.deepEqual(custom.args, ['run', '--cwd', 'packages/gui', '修复截图']);
  });
});

test('WorkflowTemplateManager preserves unknown placeholders for later inspection', () => {
  withManager((manager) => {
    manager.save({
      name: 'handoff',
      command: 'echo',
      args: ['{known}', '{unknown}'],
      params: parseTemplateParams(['known=yes']),
    });

    assert.deepEqual(manager.resolve('handoff').args, ['yes', '{unknown}']);
  });
});

test('WorkflowTemplateManager removes templates', () => {
  withManager((manager) => {
    manager.save({ name: 'one', command: 'echo', args: ['1'] });
    assert.equal(manager.remove('missing'), false);
    assert.equal(manager.remove('one'), true);
    assert.equal(manager.get('one'), undefined);
  });
});

test('template parameter parsers reject invalid names', () => {
  assert.throws(() => parseTemplateParams(['bad name=x']), /Invalid/);
  assert.throws(() => parseTemplateValues(['bad name=x']), /invalid parameter assignment/);
  assert.deepEqual(parseTemplateValues(['target=a=b']), { target: 'a=b' });
});
