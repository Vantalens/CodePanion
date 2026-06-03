import { describe, expect, it } from 'vitest';
import { applyRunEvent, buildThreads } from './workspace';

describe('workspace state', () => {
  it('orders gates before runs and workflows for the thread rail', () => {
    const threads = buildThreads({
      workflows: [{ name: 'release', stepCount: 3 }],
      runs: [{ id: 'run-1', workflowName: 'build', status: 'running' }],
      gates: [{ runId: 'run-2', stepId: 'review', workflowName: 'audit' }],
    });
    expect(threads.map((thread) => thread.kind)).toEqual(['gate', 'run', 'workflow']);
  });

  it('appends stream output to the active run step', () => {
    const run = applyRunEvent(null, { runId: 'run-1', stepId: 'build', output: 'hello' });
    const next = applyRunEvent(run, { runId: 'run-1', stepId: 'build', stream: ' world' });
    expect(next?.steps[0].output).toBe('hello world');
  });
});
