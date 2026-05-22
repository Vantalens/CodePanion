import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 通过设置 CODEPANION_WORKFLOW_PATH 让 WorkflowDefinitionManager 写入临时文件，
// stub process.exit / console 以捕获 CLI 行为，避免污染测试进程。
async function withCli(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codepanion-workflow-import-'));
  const previousPath = process.env.CODEPANION_WORKFLOW_PATH;
  const previousHistoryPath = process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
  process.env.CODEPANION_WORKFLOW_PATH = join(dir, 'workflows.json');
  process.env.CODEPANION_WORKFLOW_HISTORY_PATH = join(dir, 'workflow-runs.json');

  const exitCalls = [];
  const logs = [];
  const errs = [];
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  // CLI 在 imported == 0 时 process.exit(1)；测试用抛错替代退出，便于断言。
  process.exit = (code) => {
    exitCalls.push(code);
    throw new Error(`__exit_${code}__`);
  };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errs.push(args.join(' '));
  try {
    return await run({ dir, exitCalls, logs, errs });
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    if (previousPath === undefined) delete process.env.CODEPANION_WORKFLOW_PATH;
    else process.env.CODEPANION_WORKFLOW_PATH = previousPath;
    if (previousHistoryPath === undefined) delete process.env.CODEPANION_WORKFLOW_HISTORY_PATH;
    else process.env.CODEPANION_WORKFLOW_HISTORY_PATH = previousHistoryPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

const { workflowImportCommand } = await import('../dist/cli/workflows.js');
const { WorkflowDefinitionManager } = await import('../dist/workflows/workflowDefinitionManager.js');

test('workflowImportCommand 部分校验失败时不中止剩余项，并产出 imported/failed 汇总', async () => {
  await withCli(async ({ dir, exitCalls, logs, errs }) => {
    const file = join(dir, 'workflows-input.json');
    writeFileSync(
      file,
      JSON.stringify([
        {
          name: 'good-one',
          steps: [{ id: 'build', tool: 'npm', command: 'npm', args: ['run', 'build'] }],
        },
        {
          // 缺 steps，应被跳过但不影响下一条
          name: 'broken-no-steps',
        },
        {
          // 名字含空格，应被 schema 拒绝
          name: 'bad name with space',
          steps: [{ id: 'x', tool: 'npm', command: 'npm', args: ['test'] }],
        },
        {
          name: 'good-two',
          steps: [{ id: 'test', tool: 'npm', command: 'npm', args: ['test'] }],
        },
      ]),
      'utf8',
    );

    let thrown;
    try {
      await workflowImportCommand({ file });
    } catch (err) {
      thrown = err;
    }
    // imported > 0 && failed > 0 → exit(2)
    assert.equal(thrown?.message, '__exit_2__');
    assert.deepEqual(exitCalls, [2]);

    const summary = logs.find((line) => line.startsWith('[codepanion] import summary'));
    assert.ok(summary, '应输出 import summary');
    assert.match(summary, /imported=2/);
    assert.match(summary, /failed=2/);

    // 两条坏数据都被打到 stderr
    assert.ok(errs.some((line) => line.includes('broken-no-steps')));
    assert.ok(errs.some((line) => line.includes('bad name with space')));

    // 实际磁盘里两条好的 workflow 都已落库
    const manager = new WorkflowDefinitionManager();
    const names = manager.list().map((w) => w.name).sort();
    assert.deepEqual(names, ['good-one', 'good-two']);
  });
});

test('workflowImportCommand 全部失败时 imported=0 → exit(1)', async () => {
  await withCli(async ({ dir, exitCalls }) => {
    const file = join(dir, 'all-bad.json');
    writeFileSync(file, JSON.stringify([{ name: 'lonely-no-steps' }]), 'utf8');

    let thrown;
    try {
      await workflowImportCommand({ file });
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown?.message, '__exit_1__');
    assert.deepEqual(exitCalls, [1]);
  });
});

test('workflowImportCommand 支持顶层 { workflows: [...] } 包装格式', async () => {
  await withCli(async ({ dir, exitCalls, logs }) => {
    const file = join(dir, 'wrapped.json');
    writeFileSync(
      file,
      JSON.stringify({
        workflows: [
          { name: 'wrapped-one', steps: [{ id: 'lint', tool: 'npm', command: 'npm', args: ['run', 'lint'] }] },
        ],
      }),
      'utf8',
    );

    // 全部成功不会 exit
    await workflowImportCommand({ file });
    assert.deepEqual(exitCalls, []);

    const summary = logs.find((line) => line.startsWith('[codepanion] import summary'));
    assert.ok(summary);
    assert.match(summary, /imported=1/);
    assert.match(summary, /failed=0/);
  });
});

test('workflowImportCommand JSON 不可解析时 exit(2) 且不写入任何 workflow', async () => {
  await withCli(async ({ dir, exitCalls, errs }) => {
    const file = join(dir, 'invalid.json');
    writeFileSync(file, '{not json', 'utf8');

    let thrown;
    try {
      await workflowImportCommand({ file });
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown?.message, '__exit_2__');
    assert.ok(errs.some((line) => line.includes('failed to read workflow file')));

    const manager = new WorkflowDefinitionManager();
    assert.deepEqual(manager.list(), []);
  });
});
