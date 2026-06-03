export type RunStatus = 'queued' | 'pending' | 'running' | 'paused' | 'success' | 'completed' | 'failed' | 'cancelled' | string;

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt?: string | number;
  lastActiveAt?: string | number;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  stepCount?: number;
  projectId?: string;
}

export interface WorkflowRunSummary {
  id: string;
  workflowName?: string;
  status?: RunStatus;
  stepCount?: number;
  currentStepId?: string;
  currentStepStatus?: string;
  projectId?: string;
  workspace?: string;
  startedAt?: string | number;
  updatedAt?: string | number;
}

export interface WorkflowStep {
  id: string;
  name?: string;
  role?: string;
  model?: string;
  provider?: string;
  status?: RunStatus;
  output?: string;
  stdout?: string;
  stderr?: string;
  permissions?: string[];
  startedAt?: string | number;
  finishedAt?: string | number;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  workflowName: string;
  steps: WorkflowStep[];
}

export interface WorkflowGate {
  runId: string;
  stepId: string;
  workflowName?: string;
  role?: string;
  projectId?: string;
  message?: string;
  createdAt?: string | number;
}

export interface WorkflowArtifact {
  id?: string;
  runId?: string;
  stepId?: string;
  artifactType?: string;
  type?: string;
  title?: string;
  content?: string;
  files?: string[];
  createdAt?: string | number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type?: string;
  status?: string;
  apiBase?: string;
  apiKey?: string;
  config?: {
    apiKey?: string;
    api_key?: string;
    baseUrl?: string;
    base_url?: string;
    default_model?: string;
  };
  models?: ModelInfo[];
  lastUsedAt?: string | number;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
}

export type ModelBinding = Record<string, string>;

export interface WorkflowBoard {
  workflows: WorkflowDefinition[];
  runs: WorkflowRunSummary[];
  gates: WorkflowGate[];
}

export interface WorkflowThread {
  id: string;
  title: string;
  status: RunStatus;
  kind: 'run' | 'workflow' | 'gate';
  projectId?: string;
  run?: WorkflowRunSummary;
  workflow?: WorkflowDefinition;
  gate?: WorkflowGate;
}

export interface DaemonConfig {
  url: string;
  wsUrl: string;
  token: string;
  port: number;
}

export interface GateDecisionPayload {
  decision: 'approve' | 'reject' | 'retry';
  constraints?: string[];
  message?: string;
  workspace?: string;
}

export interface WorkflowRunEvent {
  type?: string;
  runId?: string;
  stepId?: string;
  status?: RunStatus;
  output?: string;
  stream?: string;
  text?: string;
  run?: WorkflowRunDetail;
  step?: WorkflowStep;
}
