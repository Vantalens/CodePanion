import { runLocalCommand } from '../workflows/localExec.js';
import { WorkflowTemplateManager, parseTemplateParams, parseTemplateValues } from '../workflows/templateManager.js';

export async function templateAddCommand(args: {
  name: string;
  command: string;
  arg?: string[];
  description?: string;
  param?: string[];
}) {
  const manager = new WorkflowTemplateManager();
  const template = manager.save({
    name: args.name,
    description: args.description,
    command: args.command,
    args: args.arg ?? [],
    params: parseTemplateParams(args.param ?? []),
  });
  console.log(`[codepanion] saved workflow template: ${template.name}`);
}

export async function templateListCommand() {
  const manager = new WorkflowTemplateManager();
  const templates = manager.list();
  if (templates.length === 0) {
    console.log('No workflow templates saved.');
    return;
  }
  for (const template of templates) {
    const params = template.params.map((param) => param.name).join(', ');
    console.log(`${template.name}\t${template.command} ${template.args.join(' ')}${params ? `\tparams: ${params}` : ''}`);
  }
}

export async function templateShowCommand(args: { name: string }) {
  const manager = new WorkflowTemplateManager();
  const template = manager.get(args.name);
  if (!template) {
    console.error(`[codepanion] workflow template not found: ${args.name}`);
    process.exit(1);
  }
  console.log(JSON.stringify(template, null, 2));
}

export async function templateRemoveCommand(args: { name: string }) {
  const manager = new WorkflowTemplateManager();
  if (!manager.remove(args.name)) {
    console.error(`[codepanion] workflow template not found: ${args.name}`);
    process.exit(1);
  }
  console.log(`[codepanion] removed workflow template: ${args.name}`);
}

export async function templateRunCommand(args: { name: string; set?: string[]; dryRun?: boolean }) {
  const manager = new WorkflowTemplateManager();
  const resolved = manager.resolve(args.name, parseTemplateValues(args.set ?? []));
  if (args.dryRun) {
    console.log([resolved.command, ...resolved.args].join(' '));
    return;
  }
  const exitCode = await runLocalCommand(resolved.command, resolved.args);
  process.exit(exitCode);
}
