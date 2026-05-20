import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { HOME_DIR } from '../config.js';

export const WORKFLOW_TEMPLATES_PATH = `${HOME_DIR}/workflow-templates.json`;
const templatePath = () => process.env.CODEPANION_TEMPLATE_PATH || WORKFLOW_TEMPLATES_PATH;
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const TemplateParamSchema = z.object({
  name: z.string().min(1).max(80).regex(PARAM_NAME_RE),
  defaultValue: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

const WorkflowTemplateSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  description: z.string().optional().default(''),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  params: z.array(TemplateParamSchema).default([]),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

const StoreSchema = z.object({
  version: z.literal(1).default(1),
  templates: z.array(WorkflowTemplateSchema).default([]),
});

export type TemplateParam = z.infer<typeof TemplateParamSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
type TemplateStore = z.infer<typeof StoreSchema>;

export class WorkflowTemplateManager {
  constructor(private readonly path = templatePath()) {}

  list(): WorkflowTemplate[] {
    return this.load().templates.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): WorkflowTemplate | undefined {
    return this.load().templates.find((template) => template.name === name);
  }

  save(input: {
    name: string;
    description?: string;
    command: string;
    args?: string[];
    params?: TemplateParam[];
  }): WorkflowTemplate {
    const store = this.load();
    const now = Date.now();
    const existing = store.templates.find((template) => template.name === input.name);
    const template = WorkflowTemplateSchema.parse({
      ...existing,
      name: input.name,
      description: input.description ?? existing?.description ?? '',
      command: input.command,
      args: input.args ?? [],
      params: input.params ?? existing?.params ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    store.templates = store.templates.filter((item) => item.name !== template.name);
    store.templates.push(template);
    this.write(store);
    return template;
  }

  remove(name: string): boolean {
    const store = this.load();
    const next = store.templates.filter((template) => template.name !== name);
    if (next.length === store.templates.length) return false;
    store.templates = next;
    this.write(store);
    return true;
  }

  resolve(name: string, values: Record<string, string> = {}): { template: WorkflowTemplate; command: string; args: string[] } {
    const template = this.get(name);
    if (!template) throw new Error(`workflow template not found: ${name}`);
    const paramValues = Object.fromEntries(template.params.map((param) => [param.name, param.defaultValue ?? '']));
    Object.assign(paramValues, values);
    const render = (value: string) => value.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (match, key) => paramValues[key] ?? match);
    return {
      template,
      command: render(template.command),
      args: template.args.map(render),
    };
  }

  private load(): TemplateStore {
    if (!existsSync(this.path)) return { version: 1, templates: [] };
    const raw = JSON.parse(readFileSync(this.path, 'utf8'));
    return StoreSchema.parse(raw);
  }

  private write(store: TemplateStore): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload = JSON.stringify(StoreSchema.parse(store), null, 2);
    writeFileSync(this.path, payload, 'utf8');
  }
}

export function parseTemplateParams(values: string[] = []): TemplateParam[] {
  return values.map((entry) => {
    const [name, ...rest] = entry.split('=');
    return TemplateParamSchema.parse({ name, defaultValue: rest.join('=') });
  });
}

export function parseTemplateValues(values: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of values) {
    const [name, ...rest] = entry.split('=');
    if (!name || !PARAM_NAME_RE.test(name)) throw new Error(`invalid parameter assignment: ${entry}`);
    out[name] = rest.join('=');
  }
  return out;
}
