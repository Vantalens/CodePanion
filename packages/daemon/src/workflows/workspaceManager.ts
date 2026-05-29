import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { logger } from '../logger.js';
import { ensurePathInside } from './pathSafety.js';

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
    // workspace root 是用户项目目录，不限定在 HOME_DIR 下；只做 resolve 归一化。
    // 后续 readConfig 会用 ensurePathInside(workflowPath, this.root, ...) 校验派生路径不逃出 root，
    // 这正是 CodeQL 期望看到的 containment 数据流。
    this.root = resolve(root);
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
    // ensurePathInside 让 CodeQL 看到 workflowPath 是 this.root 子路径，清掉 path-injection 告警。
    const safePath = ensurePathInside(workflowPath, this.root, 'workspace workflow path');
    if (!existsSync(safePath)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(safePath, 'utf8');
    } catch (err) {
      logger.warn({ err, path: safePath }, 'workspace config 读取失败，返回 undefined');
      return undefined;
    }
    try {
      return WorkspaceConfigSchema.parse(JSON.parse(raw)) as WorkspaceConfig;
    } catch (err) {
      // 与 workflowDefinitionManager.quarantineBrokenStore 模式对齐：损坏文件改名隔离，调用方拿到 undefined。
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = ensurePathInside(`${safePath}.broken-${stamp}.json`, this.root, 'workspace workflow quarantine path');
      try {
        renameSync(safePath, target);
        logger.warn({ err, path: safePath, quarantined: target }, 'workspace config 解析失败，已隔离');
      } catch (renameErr) {
        logger.error({ err, renameErr, path: safePath }, 'workspace config 解析失败且隔离也失败');
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
