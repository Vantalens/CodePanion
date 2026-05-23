import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('runWorkflow executor 抛错（如 pty.spawn 失败）时归一化为 failed step，不向上抛 promise reject（N-14）', async () => {
  await withStores(async ({ definitions }) => {
    const workflow = definitions.save({
      name: 'spawn-fail',
      steps: parseWorkflowSteps([
        'id=launch;tool=codex;command=codex;args=review',
        'id=followup;tool=npm;command=npm;args=test;after=launch',
      ]),
    });
    const finishCalls = [];
    let finalRun;
    const run = await runWorkflow({
      workflow,
      executor: async () => {
        throw new Error('spawn ENOENT codex');
      },
      hooks: {
        onStepStart: (s) => { finishCalls.push(['start', s.id]); },
        onStepFinish: (s) => { finishCalls.push(['finish', s.id, s.status, s.exitCode, s.message]); },
        onWorkflowFinish: (r) => { finalRun = r; },
      },
    });
    assert.equal(run.status, 'failed');
    assert.equal(run.steps.length, 1, '后续依赖步骤不应执行');
    assert.equal(run.steps[0].status, 'failed');
    assert.equal(run.steps[0].exitCode, -1);
    assert.match(run.steps[0].message ?? '', /spawn ENOENT codex/);
    assert.deepEqual(finishCalls, [
      ['start', 'launch'],
      ['finish', 'launch', 'failed', -1, run.steps[0].message],
    ]);
    assert.equal(finalRun.status, 'failed');
  });
});

test('WorkflowDefinitionManager 遇到损坏 JSON 时隔离文件并返回空 store，不阻塞 daemon 启动（N-9）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflows-broken-'));
  try {
    const target = join(dir, 'workflows.json');
    writeFileSync(target, '{ "version": 1, "workflows": [ trailing-comma, ] }', 'utf8');
    const manager = new WorkflowDefinitionManager(target);
    const list = manager.list();
    assert.deepEqual(list, [], '损坏文件应被替换为空列表');
    const entries = readdirSync(dir);
    const quarantined = entries.find((name) => name.startsWith('workflows.json.broken-'));
    assert.ok(quarantined, `应生成隔离副本，目录内容：${entries.join(',')}`);
    assert.ok(!entries.includes('workflows.json'), '原 workflows.json 应被改名为 broken-*');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowRunHistory 遇到 schema 不过的旧版 JSON 容器时隔离文件并返回空 store（N-9 / N-16）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-history-broken-'));
  try {
    const target = join(dir, 'runs.json');
    // N-16 后：只有「JSON.parse 成功 + 形状是 { version, runs }」的旧版容器才走 quarantine；
    // 这里 runs 类型不对（数字而不是数组），HistoryStoreSchema 失败 → 隔离。
    // 完全坏掉的 JSON（trailing comma 之类）现在交给 NDJSON 跳过坏行，不再 quarantine（更安全）。
    writeFileSync(target, JSON.stringify({ version: 1, runs: 42 }), 'utf8');
    const history = new WorkflowRunHistory(target);
    assert.deepEqual(history.list(), [], '损坏 history 应返回空数组');
    const entries = readdirSync(dir);
    assert.ok(
      entries.some((name) => name.startsWith('runs.json.broken-')),
      `应生成隔离副本，目录内容：${entries.join(',')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowRunHistory NDJSON 模式下单行坏数据不会 truncate 全历史（N-16）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-history-ndjson-bad-'));
  try {
    const target = join(dir, 'runs.json');
    const now = Date.now();
    const good = (id, started) => JSON.stringify({
      id,
      workflowName: 'wf',
      status: 'success',
      values: {},
      startedAt: started,
      endedAt: started + 10,
      steps: [],
    });
    // 混入坏行：JSON 解析失败、schema 不匹配；夹在两条合法 run 之间。
    const body = [
      good('run-1', now - 3000),
      '{ this is not json',
      good('run-2', now - 2000),
      JSON.stringify({ id: 'run-3', not_a_workflow_run: true }),
      good('run-4', now - 1000),
      '',
    ].join('\n');
    writeFileSync(target, body, 'utf8');

    const history = new WorkflowRunHistory(target);
    const list = history.list();
    const ids = list.map((run) => run.id).sort();
    assert.deepEqual(ids, ['run-1', 'run-2', 'run-4'], '坏行应被跳过，其余 3 条合法 run 全部保留');

    // 文件没有被 quarantine 改名 —— 这是与旧实现的关键差异。
    const entries = readdirSync(dir);
    assert.ok(entries.includes('runs.json'), '原文件应保留，不应被改成 broken-*');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowRunHistory 首次遇到旧版 { version, runs } 容器时自动迁移为 NDJSON（N-16）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-history-migrate-'));
  try {
    const target = join(dir, 'runs.json');
    const now = Date.now();
    const legacy = {
      version: 1,
      runs: [
        { id: 'old-1', workflowName: 'wf', status: 'success', values: {}, startedAt: now - 2000, endedAt: now - 1500, steps: [] },
        { id: 'old-2', workflowName: 'wf', status: 'failed', values: {}, startedAt: now - 1000, endedAt: now - 500, steps: [] },
      ],
    };
    writeFileSync(target, JSON.stringify(legacy), 'utf8');

    const history = new WorkflowRunHistory(target);
    const ids = history.list().map((r) => r.id).sort();
    assert.deepEqual(ids, ['old-1', 'old-2'], '旧 runs 应全部保留');

    // 文件已被原地改写为 NDJSON：每行一条 JSON，不再是单个对象。
    const after = readFileSync(target, 'utf8').trim().split(/\r?\n/);
    assert.equal(after.length, 2, '迁移后应为 2 行 NDJSON');
    for (const line of after) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.id?.startsWith('old-'), `每行都是独立 run JSON，got ${line.slice(0, 40)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowRunHistory append 不读旧文件，坏行存在时新 run 仍能成功落盘（N-16）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-history-append-'));
  try {
    const target = join(dir, 'runs.json');
    const now = Date.now();
    // 预置一行损坏的 NDJSON：旧实现这种情况会把整个文件 quarantine，append 写入新文件，老历史丢失。
    writeFileSync(target, '{ broken line not parseable\n', 'utf8');

    const history = new WorkflowRunHistory(target);
    const appended = history.append({
      id: 'run-new',
      workflowName: 'wf',
      status: 'success',
      values: {},
      startedAt: now,
      endedAt: now + 10,
      steps: [],
    });
    assert.equal(appended.id, 'run-new');

    // 文件仍是原路径，且新行已追加。
    const raw = readFileSync(target, 'utf8');
    assert.ok(raw.includes('run-new'), 'append 后文件应包含新 run');
    assert.ok(raw.startsWith('{ broken line'), '旧坏行未被清理，append 是纯追加');

    // 读取时坏行被跳过，新 run 可见。
    assert.deepEqual(history.list().map((r) => r.id), ['run-new']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkflowRunHistory 超过 maxRuns × 1.5 后触发 compaction，长跑稳定在 maxRuns（N-16）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-history-compact-'));
  try {
    const target = join(dir, 'runs.json');
    const history = new WorkflowRunHistory(target, 4); // maxRuns=4 → compact 阈值 6
    const base = Date.now();
    for (let i = 0; i < 10; i++) {
      history.append({
        id: `r-${i}`,
        workflowName: 'wf',
        status: 'success',
        values: {},
        startedAt: base + i * 10,
        endedAt: base + i * 10 + 1,
        steps: [],
      });
    }
    // 单次 append 之间最多堆 maxRuns × 1.5 = 6 行；最近一次 compaction（在 r-9 处触发，lineCount=7>6）
    // 后应回落到 maxRuns=4 行，且全部是最新 4 条。
    const lines = readFileSync(target, 'utf8').trim().split(/\r?\n/);
    assert.ok(
      lines.length >= 1 && lines.length <= 6,
      `行数应在 1..maxRuns*1.5 之间，实际 ${lines.length}`,
    );
    const ids = history.list().map((r) => r.id).sort();
    assert.deepEqual(ids, ['r-6', 'r-7', 'r-8', 'r-9'], '最近一次 compaction 后应保留最新 4 条');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
