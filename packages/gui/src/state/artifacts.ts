import type { WorkflowArtifact } from '../types';

export function artifactKind(artifact: WorkflowArtifact): string {
  return artifact.artifactType || artifact.type || 'artifact';
}

export function artifactPreview(artifact: WorkflowArtifact): string {
  const content = artifact.content || '';
  if (!content) return 'No preview content.';
  const kind = artifactKind(artifact).toLowerCase();
  if (kind.includes('test') && content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

export function splitConstraints(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
