import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWorkflowSteps,
} from '../dist/workflows/workflowDefinitionManager.js';
import { resolveCliWorkspaceStores } from '../dist/cli/workflows.js';

function withTempEnv(callback) {
  const prev = {
    workflow: process.env.CODEPANION_WORKFLOW_PATH,
    history: process.env.CODEPANION_WORKFLOW_HISTORY_PATH,
    artifacts: process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH,
  };
  const fallback = mkdtempSync(join(tmpdir(), 'codepanion-cli-fallback-'));
  process.env.CODEPANION_WORKFLOW_PATH = join(fallback, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(fallback, 'runs.ndjson');
  process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = join(fallback, 'artifacts.ndjson');
  try {
    return callback({ fallback });
  } finally {
    if (prev.workflow === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = prev.workflow;
    if (prev.history === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = prev.history;
    if (prev.artifacts === undefined) delete process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH;
    else process.env.CODEPANION_WORKFLOW_ARTIFACTS_PATH = prev.artifacts;
    rmSync(fallback, { recursive: true, force: true });
  }
}

test('resolveCliWorkspaceStores: 显式 --workspace flag 落到 <root>/.codepanion/', () => {
  withTempEnv(() => {
    const ws = mkdtempSync(join(tmpdir(), 'codepanion-cli-explicit-'));
    try {
      const stores = resolveCliWorkspaceStores(ws);
      assert.equal(stores.resolvedRoot, ws);
      stores.definitions.save({
        name: 'demo',
        steps: parseWorkflowSteps(['id=plan;tool=node;command=node;args=--version']),
      });
      const persisted = stores.definitions.list();
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].name, 'demo');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

test('resolveCliWorkspaceStores: 没有 .codepanion 也没有 flag 时走 env / HOME_DIR fallback', () => {
  withTempEnv(({ fallback }) => {
    const tmp = mkdtempSync(join(tmpdir(), 'codepanion-cli-naked-'));
    const cwdBefore = process.cwd();
    process.chdir(tmp);
    try {
      const stores = resolveCliWorkspaceStores();
      // 没找到 workspace，resolvedRoot 应为 undefined
      assert.equal(stores.resolvedRoot, undefined);
      stores.definitions.save({
        name: 'fallback-demo',
        steps: parseWorkflowSteps(['id=plan;tool=node;command=node;args=--version']),
      });
      // 落点应是 env CODEPANION_WORKFLOW_PATH 指向的 fallback dir。
      const fallbackStore = resolveCliWorkspaceStores();
      assert.equal(fallbackStore.definitions.list()[0].name, 'fallback-demo');
      // 不应该污染随机的 tmp cwd。
      const wsBased = resolveCliWorkspaceStores(tmp);
      assert.equal(wsBased.definitions.list().length, 0);
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('resolveCliWorkspaceStores: cwd 内 .codepanion/workflow.json 存在时自动用 cwd 作 workspace', () => {
  withTempEnv(() => {
    const ws = mkdtempSync(join(tmpdir(), 'codepanion-cli-found-'));
    mkdirSync(join(ws, '.codepanion'), { recursive: true });
    // 必须有 workflow.json marker，避免和 Claude 自己用的 ~/.codepanion 冲突。
    writeFileSync(join(ws, '.codepanion', 'workflow.json'), '{"version":1}', 'utf8');
    const cwdBefore = process.cwd();
    process.chdir(ws);
    try {
      const stores = resolveCliWorkspaceStores();
      assert.equal(stores.resolvedRoot, ws);
      stores.definitions.save({
        name: 'auto-detected',
        steps: parseWorkflowSteps(['id=plan;tool=node;command=node;args=--version']),
      });
      // 落点确认在 cwd workspace 内，不进 fallback。
      const wsStores = resolveCliWorkspaceStores(ws);
      assert.equal(wsStores.definitions.list()[0].name, 'auto-detected');
      const fallback = resolveCliWorkspaceStores('/totally/nonexistent/path/' + Math.random().toString(36).slice(2));
      // 走显式但目录不存在仍 OK：manager 在 list 时返回空数组。
      assert.equal(fallback.definitions.list().length, 0);
    } finally {
      process.chdir(cwdBefore);
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
