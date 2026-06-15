import { describe, it, expect } from 'vitest';
import { buildBottomLine } from '../status-helpers';

describe('buildBottomLine', () => {
  it('reports healthy when there are no issues', () => {
    expect(buildBottomLine([])).toEqual([
      '✅ Bottom line: everything looks healthy — no action needed.',
    ]);
  });

  it('summarizes a single issue', () => {
    const lines = buildBottomLine(['one issue']);
    expect(lines[0]).toBe('⚠️  Bottom line: 1 thing could use attention:');
    expect(lines[1]).toBe('');
    expect(lines).toContain('• one issue');
  });

  it('summarizes multiple issues in order', () => {
    const lines = buildBottomLine(['a', 'b']);
    expect(lines[0]).toBe('⚠️  Bottom line: 2 things could use attention:');
    expect(lines.slice(2)).toEqual(['• a', '• b']);
  });
});
