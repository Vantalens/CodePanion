import { resolve } from 'node:path';
import { CodePanionWorkspaceManager } from '../workflows/workspaceManager.js';
import { findUpworkspace } from './workflows.js';

export async function workspaceInitCommand(args: { root?: string } = {}): Promise<void> {
  const root = args.root ? resolve(args.root) : process.cwd();
  const layout = new CodePanionWorkspaceManager(root).initialize();
  console.log(`[codepanion] workspace initialized at: ${layout.root}`);
  console.log(`  config:    ${layout.workflowPath}`);
  console.log(`  roles:     ${layout.rolesDir}`);
  console.log(`  artifacts: ${layout.artifactsDir}`);
  console.log('[codepanion] codepanion workflow commands run from this project will now use this workspace.');
}

export async function workspaceStatusCommand(args: { root?: string } = {}): Promise<void> {
  const start = args.root ? resolve(args.root) : process.cwd();
  const root = findUpworkspace(start);
  if (!root) {
    console.error(`[codepanion] no .codepanion workspace found from ${start}`);
    console.error('[codepanion] run `codepanion workspace init` to create one in the current project.');
    process.exit(1);
  }
  const manager = new CodePanionWorkspaceManager(root);
  const layout = manager.layout();
  console.log(`[codepanion] workspace root: ${layout.root}`);
  console.log(`  config:    ${layout.workflowPath}`);
  console.log(`  roles:     ${layout.rolesDir}`);
  console.log(`  artifacts: ${layout.artifactsDir}`);
  const config = manager.readConfig();
  if (!config) {
    // workflow.json marker 找到了 (findUpworkspace 必过)，但 schema 校验失败已被隔离。
    console.error('[codepanion] workspace config missing or corrupted (see warnings above).');
    process.exit(1);
  }
  console.log(`  version:   ${config.version}`);
  console.log(`  roles:     ${config.roles.join(', ')}`);
  console.log(`  workflow:  ${config.defaultWorkflow.join(' → ')}`);
}
