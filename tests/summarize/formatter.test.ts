import { describe, it, expect } from 'vitest';
import { formatHandoffSummary } from '../../src/summarize/formatter.js';
import type { ExtractedSession } from '../../src/summarize/extractor.js';

function makeExtracted(overrides: Partial<ExtractedSession> = {}): ExtractedSession {
  return {
    title: 'Add auth module',
    objective: 'Add JWT authentication to the REST API',
    approach: 'start by creating the auth middleware',
    filesCreated: ['src/auth/middleware.ts'],
    filesModified: ['src/index.ts', 'src/routes.ts'],
    decisions: ['use JWT over session cookies'],
    errors: ['TypeScript error in auth.ts: type mismatch'],
    outcome: 'success',
    nextSteps: ['Add refresh token support', 'Write integration tests'],
    ...overrides,
  };
}

describe('formatHandoffSummary', () => {
  it('includes session title', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('## Session: Add auth module');
  });

  it('includes agent and outcome', () => {
    const result = formatHandoffSummary(makeExtracted(), 'copilot');
    expect(result).toContain('**Agent**: copilot');
    expect(result).toContain('**Outcome**: success');
  });

  it('includes objective section', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('### Objective');
    expect(result).toContain('Add JWT authentication to the REST API');
  });

  it('includes approach section', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('### Approach');
    expect(result).toContain('start by creating the auth middleware');
  });

  it('includes created files in "What was done"', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('### What was done');
    expect(result).toContain('- Created: src/auth/middleware.ts');
  });

  it('includes modified files in "What was done"', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('- Modified: src/index.ts, src/routes.ts');
  });

  it('includes decisions in "What was done"', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('- Decisions: use JWT over session cookies');
  });

  it('includes errors section', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('### Issues encountered');
    expect(result).toContain('- TypeScript error in auth.ts: type mismatch');
  });

  it('includes next steps section', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).toContain('### Next steps');
    expect(result).toContain('- Add refresh token support');
    expect(result).toContain('- Write integration tests');
  });

  it('omits "What was done" when no files and no decisions', () => {
    const result = formatHandoffSummary(
      makeExtracted({ filesCreated: [], filesModified: [], decisions: [] }),
      'claude',
    );
    expect(result).not.toContain('### What was done');
  });

  it('omits "Issues encountered" when no errors', () => {
    const result = formatHandoffSummary(makeExtracted({ errors: [] }), 'claude');
    expect(result).not.toContain('### Issues encountered');
  });

  it('omits "Next steps" when no next steps', () => {
    const result = formatHandoffSummary(makeExtracted({ nextSteps: [] }), 'claude');
    expect(result).not.toContain('### Next steps');
  });

  it('omits objective section when empty', () => {
    const result = formatHandoffSummary(makeExtracted({ objective: '' }), 'claude');
    expect(result).not.toContain('### Objective');
  });

  it('omits approach section when empty', () => {
    const result = formatHandoffSummary(makeExtracted({ approach: '' }), 'claude');
    expect(result).not.toContain('### Approach');
  });

  it('produces valid output for minimal extracted data', () => {
    const minimal: ExtractedSession = {
      title: 'Quick chat',
      objective: '',
      approach: '',
      filesCreated: [],
      filesModified: [],
      decisions: [],
      errors: [],
      outcome: 'unknown',
      nextSteps: [],
    };
    const result = formatHandoffSummary(minimal, 'gemini');
    expect(result).toContain('## Session: Quick chat');
    expect(result).toContain('**Agent**: gemini');
    expect(result).toContain('**Outcome**: unknown');
    // Should not have any content sections
    expect(result).not.toContain('### Objective');
    expect(result).not.toContain('### What was done');
    expect(result).not.toContain('### Issues encountered');
    expect(result).not.toContain('### Next steps');
  });

  it('does not end with trailing newlines', () => {
    const result = formatHandoffSummary(makeExtracted(), 'claude');
    expect(result).not.toMatch(/\n$/);
  });
});
