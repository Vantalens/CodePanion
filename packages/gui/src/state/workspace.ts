import type {
  WorkflowBoard,
  WorkflowRunDetail,
  WorkflowRunEvent,
  WorkflowStep,
  WorkflowThread,
} from '../types';

export function buildThreads(board: WorkflowBoard | null): WorkflowThread[] {
  if (!board) return [];
  const gateThreads = (board.gates ?? []).map((gate) => ({
    id: `gate:${gate.runId}:${gate.stepId}`,
    title: gate.workflowName || gate.stepId || 'Pending gate',
    status: 'paused',
    kind: 'gate' as const,
    projectId: gate.projectId,
    gate,
  }));
  const runThreads = (board.runs ?? []).map((run) => ({
    id: `run:${run.id}`,
    title: run.workflowName || run.id,
    status: run.status || 'pending',
    kind: 'run' as const,
    projectId: run.projectId,
    run,
  }));
  const workflowThreads = (board.workflows ?? []).map((workflow) => ({
    id: `workflow:${workflow.name}`,
    title: workflow.name,
    status: 'ready',
    kind: 'workflow' as const,
    projectId: workflow.projectId,
    workflow,
  }));
  return [...gateThreads, ...runThreads, ...workflowThreads];
}

export function applyRunEvent(run: WorkflowRunDetail | null, event: WorkflowRunEvent): WorkflowRunDetail | null {
  if (!event?.runId) return run;
  const base: WorkflowRunDetail =
    run && run.id === event.runId
      ? { ...run, steps: [...(run.steps ?? [])] }
      : {
          id: event.runId,
          workflowName: event.run?.workflowName || event.runId,
          status: event.status || 'running',
          steps: [],
        };

  if (event.run) {
    return { ...base, ...event.run, steps: event.run.steps ?? base.steps };
  }

  if (event.status) {
    base.status = event.status;
  }

  if (event.step || event.stepId) {
    const stepId = event.step?.id || event.stepId || 'step';
    const index = base.steps.findIndex((step) => step.id === stepId);
    const existing: WorkflowStep = index >= 0 ? base.steps[index] : { id: stepId };
    // Accumulate output incrementally to avoid O(n²) string concatenation
    const newOutput = event.output || event.stream || event.text || '';
    const output = existing.output ? existing.output + newOutput : newOutput;
    const next = {
      ...existing,
      ...event.step,
      id: stepId,
      status: event.step?.status || event.status || existing.status,
      output,
    };
    if (index >= 0) {
      base.steps[index] = next;
    } else {
      base.steps.push(next);
    }
  }

  return base;
}
