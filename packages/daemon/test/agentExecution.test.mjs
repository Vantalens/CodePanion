import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWorkflowStep,
  resolveStepArchitecture,
  buildAgentPrompt,
  runWorkflow,
} from '../dist/workflows/workflowDefinitionManager.js';

// 执行模型两轴重构：architecture（shell | agent）× model（API 后端）。
// 这里用注入的 fake agentExecutor 覆盖 runWorkflow 的 agent 分支，不打真实网络；
// shell 分支用 fake executor 验证混跑顺序与零回归。

test('resolveStepArchitecture：显式 architecture 优先，否则从 provider 派生', () => {
  assert.equal(resolveStepArchitecture({ provider: 'local' }), 'shell');
  assert.equal(resolveStepArchitecture({ provider: 'codex' }), 'agent');
  assert.equal(resolveStepArchitecture({ provider: 'claude-code' }), 'agent');
  assert.equal(resolveStepArchitecture({ architecture: 'shell', provider: 'codex' }), 'shell');
  assert.equal(resolveStepArchitecture({ architecture: 'agent', provider: 'local' }), 'agent');
});

test('parseWorkflowStep 解析 architecture= 字段', () => {
  const step = parseWorkflowStep('id=ask;architecture=agent;command=帮我写个函数');
  assert.equal(step.architecture, 'agent');
  assert.equal(resolveStepArchitecture(step), 'agent');
  const shellStep = parseWorkflowStep('id=test;command=node;args=--version');
  assert.equal(shellStep.architecture, undefined);
  assert.equal(resolveStepArchitecture(shellStep), 'shell');
});

test('buildAgentPrompt 渲染 command + 模板变量为 prompt 文本', () => {
  const step = parseWorkflowStep('id=ask;architecture=agent;command=分析 {target}');
  const prompt = buildAgentPrompt(step, { target: 'src/index.ts' });
  assert.equal(prompt, '分析 src/index.ts');
});

test('agent step 走 agentExecutor，返回文本落到 stepRun.output.stdout', async () => {
  const calls = [];
  const run = await runWorkflow({
    workflow: {
      name: 'agent-demo',
      params: {},
      steps: [parseWorkflowStep('id=ask;architecture=agent;role=planner;model=demo;command=做个计划;artifacts=plan')],
    },
    yes: true,
    agentExecutor: async (req) => {
      calls.push(req);
      return { exitCode: 0, stdout: 'PLAN_TEXT_FROM_MODEL', stderr: '', truncated: false };
    },
  });
  assert.equal(run.status, 'success');
  const step = run.steps.find((s) => s.id === 'ask');
  assert.equal(step.status, 'success');
  assert.equal(step.architecture, 'agent');
  assert.equal(step.output.stdout, 'PLAN_TEXT_FROM_MODEL');
  // agentExecutor 收到的请求带 runId/stepId/role/model/prompt。
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stepId, 'ask');
  assert.equal(calls[0].role, 'planner');
  assert.equal(calls[0].model, 'demo');
  assert.equal(calls[0].prompt, '做个计划');
  assert.equal(calls[0].runId, run.id);
});

test('agent step 但未注入 agentExecutor → 归一成 failed（带提示），不抛崩', async () => {
  const run = await runWorkflow({
    workflow: {
      name: 'agent-noexec',
      params: {},
      steps: [parseWorkflowStep('id=ask;architecture=agent;command=hi')],
    },
    yes: true,
    // 不传 agentExecutor
  });
  assert.equal(run.status, 'failed');
  const step = run.steps.find((s) => s.id === 'ask');
  assert.equal(step.status, 'failed');
  assert.match(step.output.stderr, /architecture=agent 需要模型后端/);
});

test('shell + agent 混跑：顺序、依赖、各自 executor 分派正确', async () => {
  const shellCalls = [];
  const agentCalls = [];
  const run = await runWorkflow({
    workflow: {
      name: 'mixed',
      params: {},
      steps: [
        parseWorkflowStep('id=build;command=node;args=--version'),                       // shell
        parseWorkflowStep('id=review;architecture=agent;model=demo;command=审查;after=build'), // agent
      ],
    },
    yes: true,
    executor: async (command, args) => {
      shellCalls.push({ command, args });
      return { exitCode: 0, stdout: 'v1.0.0', stderr: '', truncated: false };
    },
    agentExecutor: async (req) => {
      agentCalls.push(req);
      return { exitCode: 0, stdout: 'REVIEW_OK', stderr: '', truncated: false };
    },
  });
  assert.equal(run.status, 'success');
  assert.equal(shellCalls.length, 1);
  assert.equal(shellCalls[0].command, 'node');
  assert.deepEqual(Array.from(shellCalls[0].args), ['--version']);
  assert.equal(agentCalls.length, 1);
  assert.equal(agentCalls[0].stepId, 'review');
  const build = run.steps.find((s) => s.id === 'build');
  const review = run.steps.find((s) => s.id === 'review');
  assert.equal(build.architecture, 'shell');
  assert.equal(build.output.stdout, 'v1.0.0');
  assert.equal(review.architecture, 'agent');
  assert.equal(review.output.stdout, 'REVIEW_OK');
});

test('agent executor 抛错 → step failed，run failed', async () => {
  const run = await runWorkflow({
    workflow: {
      name: 'agent-err',
      params: {},
      steps: [parseWorkflowStep('id=ask;architecture=agent;model=demo;command=hi')],
    },
    yes: true,
    agentExecutor: async () => { throw new Error('boom'); },
  });
  assert.equal(run.status, 'failed');
  const step = run.steps.find((s) => s.id === 'ask');
  assert.equal(step.status, 'failed');
  assert.match(step.message, /executor threw: boom/);
});
