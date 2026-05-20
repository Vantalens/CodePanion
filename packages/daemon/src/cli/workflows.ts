import {
  WorkflowDefinitionManager,
  WorkflowRunHistory,
  parseWorkflowParams,
  parseWorkflowSteps,
  runWorkflow,
} from '../workflows/workflowDefinitionManager.js';

export async function workflowAddCommand(args: {
  name: string;
  description?: string;
  param?: string[];
  step?: string[];
}) {
  const steps = parseWorkflowSteps(args.step ?? []);
  if (steps.length === 0) {
    console.error('usage: codepanion workflow add <name> --step "id=test;tool=npm;command=npm;args=test"');
    process.exit(2);
  }
  const manager = new WorkflowDefinitionManager();
  const workflow = manager.save({
    name: args.name,
    description: args.description,
    params: parseWorkflowParams(args.param ?? []),
    steps,
  });
  console.log(`[codepanion] saved workflow: ${workflow.name} (${workflow.steps.length} steps)`);
}

export async function workflowListCommand() {
  const workflows = new WorkflowDefinitionManager().list();
  if (workflows.length === 0) {
    console.log('No workflows saved.');
    return;
  }
  for (const workflow of workflows) {
    console.log(`${workflow.name}\t${workflow.steps.length} steps${workflow.description ? `\t${workflow.description}` : ''}`);
  }
}

export async function workflowShowCommand(args: { name: string }) {
  const workflow = new WorkflowDefinitionManager().get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(JSON.stringify(workflow, null, 2));
}

export async function workflowRemoveCommand(args: { name: string }) {
  if (!new WorkflowDefinitionManager().remove(args.name)) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  console.log(`[codepanion] removed workflow: ${args.name}`);
}

export async function workflowRunCommand(args: { name: string; set?: string[]; dryRun?: boolean; yes?: boolean }) {
  const workflow = new WorkflowDefinitionManager().get(args.name);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${args.name}`);
    process.exit(1);
  }
  const history = new WorkflowRunHistory();
  const run = await runWorkflow({
    workflow,
    values: parseWorkflowParams(args.set ?? []),
    dryRun: args.dryRun,
    yes: args.yes,
  });
  history.append(run);
  printRun(run);
  if (run.status === 'failed') process.exit(1);
  if (run.status === 'paused') process.exit(3);
  process.exit(0);
}

export async function workflowHistoryCommand(args: { query?: string }) {
  const runs = new WorkflowRunHistory().list(args.query);
  if (runs.length === 0) {
    console.log('No workflow runs found.');
    return;
  }
  for (const run of runs.slice(0, 30)) {
    const when = new Date(run.startedAt).toISOString();
    console.log(`${run.id}\t${run.workflowName}\t${run.status}\t${when}\t${run.steps.length} steps`);
  }
}

export async function workflowReplayCommand(args: { id: string; set?: string[]; dryRun?: boolean; yes?: boolean }) {
  const previous = new WorkflowRunHistory().get(args.id);
  if (!previous) {
    console.error(`[codepanion] workflow run not found: ${args.id}`);
    process.exit(1);
  }
  const workflow = new WorkflowDefinitionManager().get(previous.workflowName);
  if (!workflow) {
    console.error(`[codepanion] workflow not found: ${previous.workflowName}`);
    process.exit(1);
  }
  const history = new WorkflowRunHistory();
  const run = await runWorkflow({
    workflow,
    values: { ...previous.values, ...parseWorkflowParams(args.set ?? []) },
    dryRun: args.dryRun,
    yes: args.yes,
  });
  history.append(run);
  printRun(run);
  if (run.status === 'failed') process.exit(1);
  if (run.status === 'paused') process.exit(3);
  process.exit(0);
}

function printRun(run: { id: string; status: string; steps: Array<{ id: string; tool: string; status: string; command?: string; args?: string[]; message?: string }> }) {
  console.log(`[codepanion] workflow run ${run.id}: ${run.status}`);
  for (const step of run.steps) {
    const command = step.command ? ` ${step.command} ${(step.args ?? []).join(' ')}`.trimEnd() : '';
    const message = step.message ? ` (${step.message})` : '';
    console.log(`- ${step.id} [${step.tool}] ${step.status}${command ? ` :: ${command}` : ''}${message}`);
  }
}
