import { describe, expect, it } from 'vitest';
import { artifactPreview, splitConstraints } from './artifacts';

describe('artifact helpers', () => {
  it('pretty prints JSON test artifacts', () => {
    expect(artifactPreview({ type: 'test-results', content: '{"passed":1}' })).toContain('\n  "passed"');
  });

  it('normalizes gate constraints', () => {
    expect(splitConstraints('keep TS\n\nno new deps ')).toEqual(['keep TS', 'no new deps']);
  });
});
