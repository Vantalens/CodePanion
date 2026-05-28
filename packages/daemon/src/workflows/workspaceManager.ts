import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { HOME_DIR, pathSep } from '../config.js';
import { logger } from '../logger.js';

export const WORKSPACE_CONFIG_DIR = '.codepanion';

const WorkflowRolePermissionSchema = z.enum(['read', 'write', 'command', 'network', 'delegate', 'approve']);

const WorkspaceRoleBindingSchema = z.object({
  model: z.string().min(1),
  provider: z.enum(['local', 'codex', 'claude-code', 'opencode']).default('local'),
  promptPath: z.string().min(1),
  permissions: z.array(WorkflowRolePermissionSchema).default([]),
  contextPolicy: z.object({
    maxTokens: z.number().int().positive(),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  }),
});

const WorkspaceConfigSchema = z.object({
  version: z.literal(1),
  workspaceRoot: z.string().min(1),
  defaultWorkflow: z.array(z.string().min(1)).default([]),
  roles: z.array(z.string().min(1)).default([]),
  roleBindings: z.record(z.string().min(1), WorkspaceRoleBindingSchema).default({}),
});

export const DEFAULT_WORKFLOW_STAGES = [
  'intake',
  'decompose',
  'plan-review',
  'build',
  'test',
  'code-review',
  'human-acceptance',
  'archive',
] as const;

export type WorkflowRolePermission = 'read' | 'write' | 'command' | 'network' | 'delegate' | 'approve';

// W-31：每个内置 role 都绑一个默认 provider，这样 init 出来的 .codepanion/workflow.json
// 开箱即用就是 builder→codex / reviewer→claude-code 这样的多模型协作，不用用户手填。
// 仍然是 hint：用户可以在 workflow.json 里改任意 binding 而不破坏 schema。
export type BuiltinWorkflowProvider = 'local' | 'codex' | 'claude-code' | 'opencode';

export type BuiltinWorkflowRole = {
  name: string;
  description: string;
  permissions: WorkflowRolePermission[];
  modelHint: string;
  contextMaxTokens: number;
  defaultProvider: BuiltinWorkflowProvider;
};

export const BUILTIN_WORKFLOW_ROLES: BuiltinWorkflowRole[] = [
  {
    name: 'orchestrator',
    description: 'Breaks user goals into workflow nodes, assigns roles, and summarizes progress.',
    permissions: ['read', 'delegate', 'approve'],
    modelHint: 'high-reasoning',
    contextMaxTokens: 20000,
    defaultProvider: 'claude-code',
  },
  {
    name: 'planner',
    description: 'Inspects requirements and repository context, then writes an implementation plan.',
    permissions: ['read'],
    modelHint: 'high-reasoning',
    contextMaxTokens: 20000,
    defaultProvider: 'claude-code',
  },
  {
    name: 'builder',
    description: 'Implements approved changes inside the allowed workspace.',
    permissions: ['read', 'write', 'command'],
    modelHint: 'coding',
    contextMaxTokens: 16000,
    defaultProvider: 'codex',
  },
  {
    name: 'tester',
    description: 'Runs verification, explains failures, and records test evidence.',
    permissions: ['read', 'command'],
    modelHint: 'coding',
    contextMaxTokens: 16000,
    defaultProvider: 'codex',
  },
  {
    name: 'reviewer',
    description: 'Reviews changes for correctness, risk, missing tests, and delivery readiness.',
    permissions: ['read'],
    modelHint: 'review',
    contextMaxTokens: 16000,
    defaultProvider: 'claude-code',
  },
  {
    name: 'docs-writer',
    description: 'Updates user-facing docs, developer notes, changelogs, and delivery summaries.',
    permissions: ['read', 'write'],
    modelHint: 'writing',
    contextMaxTokens: 12000,
    defaultProvider: 'opencode',
  },
];

export type WorkspaceRoleBinding = {
  model: string;
  provider: BuiltinWorkflowProvider;
  promptPath: string;
  permissions: WorkflowRolePermission[];
  contextPolicy: {
    maxTokens: number;
    include: string[];
    exclude: string[];
  };
};

export type WorkspaceConfig = {
  version: 1;
  workspaceRoot: string;
  defaultWorkflow: string[];
  roles: string[];
  roleBindings: Record<string, WorkspaceRoleBinding>;
};

export type WorkspaceLayout = {
  root: string;
  configDir: string;
  workflowPath: string;
  rolesDir: string;
  artifactsDir: string;
};

export class CodePanionWorkspaceManager {
  private readonly root: string;

  constructor(root: string) {
    const resolvedRoot = resolve(root);
    const relToHome = relative(HOME_DIR, resolvedRoot);
    if (relToHome === '..' || relToHome.startsWith(`..${pathSep}`) || relToHome.startsWith('/') || relToHome.startsWith('\\')) {
      throw new Error('workspace root must be inside HOME_DIR');
    }
    this.root = resolvedRoot;
  }

  initialize(): WorkspaceLayout {
    const layout = this.layout();
    mkdirSync(layout.rolesDir, { recursive: true });
    mkdirSync(layout.artifactsDir, { recursive: true });
    this.writeWorkflowConfig(layout.workflowPath);
    for (const role of BUILTIN_WORKFLOW_ROLES) {
      const rolePath = join(layout.rolesDir, `${role.name}.md`);
      if (!existsSync(rolePath)) writeFileSync(rolePath, renderRoleTemplate(role), 'utf8');
    }
    return layout;
  }

  layout(): WorkspaceLayout {
    const configDir = join(this.root, WORKSPACE_CONFIG_DIR);
    return {
      root: this.root,
      configDir,
      workflowPath: join(configDir, 'workflow.json'),
      rolesDir: join(configDir, 'roles'),
      artifactsDir: join(configDir, 'artifacts'),
    };
  }

  readConfig(): WorkspaceConfig | undefined {
    const { workflowPath } = this.layout();
    if (!existsSync(workflowPath)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(workflowPath, 'utf8');
    } catch (err) {
      logger.warn({ err, path: workflowPath }, 'workspace config 读取失败，返回 undefined');
      return undefined;
    }
    try {
      return WorkspaceConfigSchema.parse(JSON.parse(raw)) as WorkspaceConfig;
    } catch (err) {
      // 与 workflowDefinitionManager.quarantineBrokenStore 模式对齐：损坏文件改名隔离，调用方拿到 undefined。
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = `${workflowPath}.broken-${stamp}.json`;
      try {
        renameSync(workflowPath, target);
        logger.warn({ err, path: workflowPath, quarantined: target }, 'workspace config 解析失败，已隔离');
      } catch (renameErr) {
        logger.error({ err, renameErr, path: workflowPath }, 'workspace config 解析失败且隔离也失败');
      }
      return undefined;
    }
  }

  private writeWorkflowConfig(workflowPath: string): void {
    if (existsSync(workflowPath)) return;
    const config: WorkspaceConfig = {
      version: 1,
      workspaceRoot: this.root,
      defaultWorkflow: [...DEFAULT_WORKFLOW_STAGES],
      roles: BUILTIN_WORKFLOW_ROLES.map((role) => role.name),
      roleBindings: Object.fromEntries(
        BUILTIN_WORKFLOW_ROLES.map((role) => [
          role.name,
          {
            model: role.modelHint,
            provider: role.defaultProvider,
            promptPath: `${WORKSPACE_CONFIG_DIR}/roles/${role.name}.md`,
            permissions: [...role.permissions],
            contextPolicy: {
              maxTokens: role.contextMaxTokens,
              include: [],
              exclude: [],
            },
          },
        ]),
      ),
    };
    writeFileSync(workflowPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

function renderRoleTemplate(role: BuiltinWorkflowRole): string {
  return [
    `# Role: ${role.name}`,
    '',
    role.description,
    '',
    `Model hint: ${role.modelHint}`,
    '',
    'Permissions:',
    ...role.permissions.map((permission) => `- ${permission}`),
    '',
    'Output contract:',
    '- State what changed or what decision is needed.',
    '- Include files, commands, test results, and remaining risks when applicable.',
    '- Stop at human gates instead of assuming approval.',
    '',
  ].join('\n');
}
