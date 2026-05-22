import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowDefinitionManager,
  WorkflowRunHistory,
  parseWorkflowParams,
  parseWorkflowStep,
  parseWorkflowSteps,
  runWorkflow,
} from '../dist/workflows/workflowDefinitionManager.js';
import { WorkflowTemplateManager } from '../dist/workflows/templateManager.js';

async function withStores(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflows-'));
  try {
    return await run({
      definitions: new WorkflowDefinitionManager(join(dir, 'workflows.json')),
      history: new WorkflowRunHistory(join(dir, 'runs.json')),
      templates: new WorkflowTemplateManager(join(dir, 'templates.json')),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseWorkflowStep supports command steps, dependencies, checkpoint, and tool metadata', () => {
  const step = parseWorkflowStep('id=test;tool=npm;command=npm;args=test,--,--watch=false;after=install;checkpoint=true');
  assert.equal(step.id, 'test');
  assert.equal(step.tool, 'npm');
  assert.equal(step.command, 'npm');
  assert.deepEqual(step.args, ['test', '--', '--watch=false']);
  assert.deepEqual(step.dependsOn, ['install']);
  assert.equal(step.checkpoint, true);
});

test('WorkflowDefinitionManager saves and validates workflows', () => {
  withStores(({ definitions }) => {
    const workflow = definitions.save({
      name: 'quality',
      params: parseWorkflowParams(['target=packages/daemon']),
      steps: parseWorkflowSteps([
        'id=build;tool=npm;command=npm;args=run,build',
        'id=test;tool=npm;command=npm;args=test;after=build',
      ]),
    });
    assert.equal(workflow.steps.length, 2);
    assert.equal(definitions.get('quality')?.params.target, 'packages/daemon');
    assert.throws(() => definitions.save({
      name: 'bad',
      steps: parseWorkflowSteps(['id=test;command=npm;after=missing']),
    }), /unknown step/);
  });
});

test('runWorkflow executes steps in dependency order and records tool output metadata', async () => {
  await withStores(async ({ definitions, history }) => {
    const workflow = definitions.save({
      name: 'quality',
      steps: parseWorkflowSteps([
        'id=build;tool=npm;command=npm;args=run,build',
        'id=test;tool=npm;command=npm;args=test;after=build',
      ]),
    });
    const executed = [];
    const run = await runWorkflow({
      workflow,
      executor: async (command, args) => {
        executed.push([command, args]);
        return 0;
      },
    });
    history.append(run);
    assert.equal(run.status, 'success');
    assert.deepEqual(executed, [
      ['npm', ['run', 'build']],
      ['npm', ['test']],
    ]);
    assert.equal(history.list('quality')[0].id, run.id);
  });
});

test('runWorkflow pauses at manual checkpoints unless --yes is supplied', async () => {
  await withStores(async ({ definitions }) => {
    const workflow = definitions.save({
      name: 'release',
      steps: parseWorkflowSteps([
        'id=review;tool=codex;command=codex;args=review,{target};checkpoint=true',
      ]),
      params: parseWorkflowParams(['target=.']),
    });
    const paused = await runWorkflow({ workflow, values: { target: 'src' }, executor: async () => 0 });
    assert.equal(paused.status, 'paused');
    assert.equal(paused.steps[0].status, 'checkpoint');

    const continued = await runWorkflow({ workflow, values: { target: 'src' }, yes: true, executor: async () => 0 });
    assert.equal(continued.status, 'success');
    assert.deepEqual(continued.steps[0].args, ['review', 'src']);
  });
});

test('runWorkflow 在每个步骤启动/完成/失败时调用 hooks，按顺序串出可观察事件流', async () => {
  await withStores(async ({ definitions }) => {
    const workflow = definitions.save({
      name: 'observable',
      steps: parseWorkflowSteps([
        'id=build;tool=npm;command=npm;args=run,build',
        'id=test;tool=npm;command=npm;args=test;after=build',
      ]),
    });
    const calls = [];
    const run = await runWorkflow({
      workflow,
      executor: async () => 0,
      hooks: {
        onWorkflowStart: (r) => { calls.push(['start', r.workflowName]); },
        onStepStart: (s) => { calls.push(['step-start', s.id, s.status]); },
        onStepFinish: (s) => { calls.push(['step-finish', s.id, s.status]); },
        onWorkflowFinish: (r) => { calls.push(['finish', r.workflowName, r.status]); },
      },
    });
    assert.equal(run.status, 'success');
    assert.deepEqual(calls, [
      ['start', 'observable'],
      ['step-start', 'build', 'running'],
      ['step-finish', 'build', 'success'],
      ['step-start', 'test', 'running'],
      ['step-finish', 'test', 'success'],
      ['finish', 'observable', 'success'],
    ]);
  });
});

test('runWorkflow hooks 失败不会阻断真实执行，事件总线问题被吞掉', async () => {
  await withStores(async ({ definitions }) => {
    const workflow = definitions.save({
      name: 'resilient',
      steps: parseWorkflowSteps(['id=only;tool=npm;command=npm;args=run,build']),
    });
    const run = await runWorkflow({
      workflow,
      executor: async () => 0,
      hooks: {
        onStepStart: () => { throw new Error('event bus down'); },
        onStepFinish: () => { throw new Error('event bus down'); },
      },
    });
    assert.equal(run.status, 'success');
    assert.equal(run.steps[0].status, 'success');
  });
});

test('runWorkflow 步骤失败时 onStepFinish 收到 failed 状态、onWorkflowFinish 收到 failed run', async () => {
  await withStores(async ({ definitions }) => {
    const workflow = definitions.save({
      name: 'failing',
      steps: parseWorkflowSteps([
        'id=build;tool=npm;command=npm;args=run,build',
        'id=test;tool=npm;command=npm;args=test;after=build',
      ]),
    });
    const finishCalls = [];
    let finalRun;
    const run = await runWorkflow({
      workflow,
      executor: async (_command, args) => (args.includes('test') ? 1 : 0),
      hooks: {
        onStepFinish: (s) => { finishCalls.push([s.id, s.status, s.exitCode]); },
        onWorkflowFinish: (r) => { finalRun = r; },
      },
    });
    assert.equal(run.status, 'failed');
    assert.deepEqual(finishCalls, [['build', 'success', 0], ['test', 'failed', 1]]);
    assert.equal(finalRun.status, 'failed');
  });
});

test('runWorkflow can execute template-backed steps and replay previous values', async () => {
  await withStores(async ({ definitions, history, templates }) => {
    templates.save({
      name: 'review',
      command: 'codex',
      args: ['review', '{target}'],
      params: [{ name: 'target', defaultValue: '.', description: '' }],
    });
    const workflow = definitions.save({
      name: 'ai-review',
      params: parseWorkflowParams(['target=.']),
      steps: parseWorkflowSteps(['id=review;tool=codex;template=review;set=target={target}']),
    });
    const first = await runWorkflow({
      workflow,
      values: { target: 'packages/gui' },
      templateManager: templates,
      executor: async () => 0,
    });
    history.append(first);
    const previous = history.get(first.id);
    const replay = await runWorkflow({
      workflow,
      values: previous.values,
      templateManager: templates,
      dryRun: true,
    });
    assert.equal(replay.status, 'dry-run');
    assert.deepEqual(replay.steps[0].args, ['review', 'packages/gui']);
  });
});
