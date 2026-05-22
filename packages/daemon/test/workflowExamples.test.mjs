import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkflowDefinitionManager,
  parseWorkflowSteps,
} from '../dist/workflows/workflowDefinitionManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(__dirname, '..', 'examples', 'workflows');

test('packages/daemon/examples/workflows 下的预置 JSON 都能被 WorkflowDefinitionManager 加载', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-examples-'));
  try {
    const manager = new WorkflowDefinitionManager(join(dir, 'workflows.json'));
    const files = readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith('.json'));
    assert.ok(files.length >= 2, `期望至少 2 个示例模板，当前 ${files.length}`);

    for (const file of files) {
      const payload = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8'));
      const saved = manager.save({
        name: payload.name,
        description: payload.description,
        params: payload.params,
        steps: payload.steps,
      });
      assert.equal(saved.name, payload.name, `${file} 名称应保留`);
      assert.ok(saved.steps.length >= 1, `${file} 至少一个步骤`);
      const reloaded = manager.get(payload.name);
      assert.ok(reloaded, `${file} 保存后应能被 get 取回`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('示例 codex-then-claude-review 含人工检查点，依赖关系正确', () => {
  const payload = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'codex-then-claude-review.json'), 'utf8'));
  const stepIds = payload.steps.map((s) => s.id);
  assert.ok(stepIds.includes('human-gate'), '应有人工检查点步骤');
  const checkpoint = payload.steps.find((s) => s.checkpoint === true);
  assert.ok(checkpoint, '应至少一个 checkpoint=true 的步骤');
  const review = payload.steps.find((s) => s.id === 'review');
  assert.ok(review.dependsOn?.includes('human-gate'), 'review 应依赖人工检查点');
});

test('示例 build-test-audit 串起 npm + codepanion audit', () => {
  const payload = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'build-test-audit.json'), 'utf8'));
  const ids = payload.steps.map((s) => s.id);
  assert.deepEqual(ids, ['build', 'test', 'audit']);
  const audit = payload.steps.find((s) => s.id === 'audit');
  assert.equal(audit.command, 'codepanion');
  assert.ok(audit.args.includes('export'));
  assert.ok(audit.dependsOn.includes('test'));
});

test('示例模板的 step JSON 形态等价于 parseWorkflowSteps 字符串解析的结果', () => {
  // 防止 import 路径与 CLI add 路径漂移：两者落到 WorkflowDefinitionManager 时结构应一致。
  const stringSteps = parseWorkflowSteps([
    'id=build;tool=npm;command=npm;args=run,build',
    'id=test;tool=npm;command=npm;args=test;after=build',
  ]);
  const jsonSteps = [
    { id: 'build', tool: 'npm', command: 'npm', args: ['run', 'build'] },
    { id: 'test', tool: 'npm', command: 'npm', args: ['test'], dependsOn: ['build'] },
  ];

  const dir = mkdtempSync(join(tmpdir(), 'codepanion-import-parity-'));
  try {
    const a = new WorkflowDefinitionManager(join(dir, 'a.json'));
    const b = new WorkflowDefinitionManager(join(dir, 'b.json'));
    const saved1 = a.save({ name: 'parity', steps: stringSteps });
    const saved2 = b.save({ name: 'parity', steps: jsonSteps });
    assert.equal(saved1.steps.length, saved2.steps.length);
    for (let i = 0; i < saved1.steps.length; i += 1) {
      const left = saved1.steps[i];
      const right = saved2.steps[i];
      assert.equal(left.id, right.id);
      assert.equal(left.command, right.command);
      assert.deepEqual(left.args, right.args);
      assert.deepEqual(left.dependsOn, right.dependsOn);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
