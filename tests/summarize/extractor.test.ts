import { describe, it, expect } from 'vitest';
import { SessionExtractor, type ExtractedSession } from '../../src/summarize/extractor.js';

function makeTranscript(parts: { role: 'human' | 'assistant'; text: string }[]): string {
  return parts
    .map((p) => (p.role === 'human' ? `Human: ${p.text}` : `Assistant: ${p.text}`))
    .join('\n\n');
}

describe('SessionExtractor', () => {
  const extractor = new SessionExtractor();

  describe('title extraction', () => {
    it('extracts the first user message as title', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Add authentication to the API' },
        { role: 'assistant', text: 'Sure, I will add JWT auth.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.title).toBe('Add authentication to the API');
    });

    it('truncates title to 80 characters', () => {
      const longMsg = 'A'.repeat(100);
      const raw = makeTranscript([
        { role: 'human', text: longMsg },
        { role: 'assistant', text: 'Ok.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.title).toBe('A'.repeat(80) + '...');
      expect(result.title.length).toBe(83);
    });

    it('returns "Untitled session" when no human messages exist', () => {
      const raw = 'Assistant: Some text without a human message.';
      const result = extractor.extract(raw);
      expect(result.title).toBe('Untitled session');
    });

    it('uses only the first line for title', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'First line\nSecond line\nThird line' },
      ]);
      const result = extractor.extract(raw);
      expect(result.title).toBe('First line');
    });
  });

  describe('objective extraction', () => {
    it('returns full first user message as objective', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Build a REST API with CRUD endpoints for users' },
      ]);
      const result = extractor.extract(raw);
      expect(result.objective).toBe('Build a REST API with CRUD endpoints for users');
    });

    it('returns empty string when no human messages', () => {
      const result = extractor.extract('');
      expect(result.objective).toBe('');
    });
  });

  describe('approach extraction', () => {
    it('extracts "I\'ll" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Fix the bug' },
        { role: 'assistant', text: "I'll start by examining the error logs and then trace the issue." },
      ]);
      const result = extractor.extract(raw);
      expect(result.approach).toContain('start by examining the error logs');
    });

    it('extracts "Let me" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Add tests' },
        { role: 'assistant', text: 'Let me create unit tests for the auth module.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.approach).toContain('create unit tests for the auth module.');
    });

    it('returns empty string when no approach patterns found', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Hello' },
        { role: 'assistant', text: 'Hello! How can I help?' },
      ]);
      const result = extractor.extract(raw);
      expect(result.approach).toBe('');
    });
  });

  describe('files created extraction', () => {
    it('extracts files from "Created" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Add a new module' },
        { role: 'assistant', text: 'Created src/auth/login.ts with the login handler.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesCreated).toContain('src/auth/login.ts');
    });

    it('extracts files from "Creating" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Scaffold tests' },
        { role: 'assistant', text: 'Creating tests/auth.test.ts for auth module.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesCreated).toContain('tests/auth.test.ts');
    });

    it('returns empty array when no files created', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Hi' },
        { role: 'assistant', text: 'Hello!' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesCreated).toEqual([]);
    });
  });

  describe('files modified extraction', () => {
    it('extracts file paths matching src/ pattern', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Update the config' },
        { role: 'assistant', text: 'I updated src/config.ts to add the new field.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesModified).toContain('src/config.ts');
    });

    it('extracts file paths matching ./ pattern', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Fix it' },
        { role: 'assistant', text: 'Changed ./package.json to update deps.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesModified).toContain('./package.json');
    });

    it('extracts file paths from tests/ prefix', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Add test' },
        { role: 'assistant', text: 'Modified tests/unit/auth.test.ts accordingly.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.filesModified).toContain('tests/unit/auth.test.ts');
    });

    it('deduplicates file paths', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Fix' },
        {
          role: 'assistant',
          text: 'Updated src/index.ts here.\nThen changed src/index.ts again.',
        },
      ]);
      const result = extractor.extract(raw);
      const count = result.filesModified.filter((f) => f === 'src/index.ts').length;
      expect(count).toBe(1);
    });
  });

  describe('decisions extraction', () => {
    it('extracts "decided to" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Set up auth' },
        { role: 'assistant', text: 'I decided to use JWT tokens for session management.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0]).toContain('use JWT tokens');
    });

    it('extracts "going with" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Choose a DB' },
        { role: 'assistant', text: 'Going with PostgreSQL for the relational data.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.decisions.length).toBeGreaterThan(0);
      expect(result.decisions[0]).toContain('PostgreSQL');
    });

    it('extracts "opted for" patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Pick framework' },
        { role: 'assistant', text: 'I opted for Express over Fastify for simplicity.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.decisions.length).toBeGreaterThan(0);
      expect(result.decisions[0]).toContain('Express');
    });

    it('returns empty array when no decisions found', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Hello' },
        { role: 'assistant', text: 'Hi there!' },
      ]);
      const result = extractor.extract(raw);
      expect(result.decisions).toEqual([]);
    });
  });

  describe('errors extraction', () => {
    it('extracts lines containing "error"', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Fix the build' },
        { role: 'assistant', text: 'Found a TypeScript error in auth.ts:\nTS2345: Argument type mismatch.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.errors.some((e) => e.toLowerCase().includes('error'))).toBe(true);
    });

    it('extracts lines containing "failed"', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Run tests' },
        { role: 'assistant', text: 'Test suite failed: 3 tests did not pass.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns empty array when no errors', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Hi' },
        { role: 'assistant', text: 'Everything looks good.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.errors).toEqual([]);
    });
  });

  describe('outcome extraction', () => {
    it('returns "success" when last message contains "done"', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Add feature' },
        { role: 'assistant', text: 'The implementation is done.' },
      ]);
      expect(extractor.extract(raw).outcome).toBe('success');
    });

    it('returns "success" when last message contains "complete"', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Finish it' },
        { role: 'assistant', text: 'All tasks are now complete.' },
      ]);
      expect(extractor.extract(raw).outcome).toBe('success');
    });

    it('returns "failure" when last message contains "failed"', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Deploy' },
        { role: 'assistant', text: 'The deployment failed due to missing env vars.' },
      ]);
      expect(extractor.extract(raw).outcome).toBe('failure');
    });

    it('returns "partial" when last message has no clear indicator', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Work on it' },
        { role: 'assistant', text: 'I made some progress on the feature.' },
      ]);
      expect(extractor.extract(raw).outcome).toBe('partial');
    });

    it('returns "unknown" when no assistant messages', () => {
      const raw = 'Human: Just a question';
      expect(extractor.extract(raw).outcome).toBe('unknown');
    });
  });

  describe('next steps extraction', () => {
    it('extracts bullet points after "Next steps" header', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Status?' },
        {
          role: 'assistant',
          text: 'Progress is good.\nNext steps:\n- Add unit tests\n- Update docs\n- Deploy to staging',
        },
      ]);
      const result = extractor.extract(raw);
      expect(result.nextSteps).toContain('Add unit tests');
      expect(result.nextSteps).toContain('Update docs');
      expect(result.nextSteps).toContain('Deploy to staging');
    });

    it('extracts "still need to" inline patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'What is left?' },
        { role: 'assistant', text: 'We still need to add error handling for the edge cases.' },
      ]);
      const result = extractor.extract(raw);
      expect(result.nextSteps.length).toBeGreaterThan(0);
      expect(result.nextSteps[0]).toContain('add error handling');
    });

    it('extracts TODO patterns', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Progress?' },
        { role: 'assistant', text: 'Done with main logic.\nTODO:\n- Write tests\n- Fix linting' },
      ]);
      const result = extractor.extract(raw);
      expect(result.nextSteps).toContain('Write tests');
    });

    it('returns empty array when no next steps found', () => {
      const raw = makeTranscript([
        { role: 'human', text: 'Done?' },
        { role: 'assistant', text: 'Yes, everything is complete.' },
      ]);
      expect(extractor.extract(raw).nextSteps).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = extractor.extract('');
      expect(result.title).toBe('Untitled session');
      expect(result.objective).toBe('');
      expect(result.approach).toBe('');
      expect(result.filesCreated).toEqual([]);
      expect(result.filesModified).toEqual([]);
      expect(result.decisions).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.outcome).toBe('unknown');
      expect(result.nextSteps).toEqual([]);
    });

    it('handles transcript with only human messages', () => {
      const raw = 'Human: Just a question\n\nHuman: Another question';
      const result = extractor.extract(raw);
      expect(result.title).toBe('Just a question');
      expect(result.outcome).toBe('unknown');
    });

    it('handles a realistic multi-turn session', () => {
      const raw = [
        'Human: Build an auto-summarization module for session transcripts.',
        '',
        "Assistant: I'll create the module in three steps. Let me start with the extractor.",
        "I decided to use regex-based heuristics for extraction.",
        'Creating src/summarize/extractor.ts with the SessionExtractor class.',
        '',
        'Human: Looks good. Also add tests.',
        '',
        'Assistant: Let me add comprehensive tests.',
        'Created tests/summarize/extractor.test.ts with 20 test cases.',
        'Modified src/index.ts to export the new module.',
        'All tests pass. The implementation is done.',
        '',
        'Next steps:',
        '- Add formatter integration',
        '- Update documentation',
      ].join('\n');

      const result = extractor.extract(raw);

      expect(result.title).toBe('Build an auto-summarization module for session transcripts.');
      expect(result.objective).toBe(
        'Build an auto-summarization module for session transcripts.',
      );
      expect(result.approach).toContain('create the module in three steps');
      expect(result.decisions.length).toBeGreaterThan(0);
      expect(result.filesCreated.length).toBeGreaterThan(0);
      expect(result.outcome).toBe('success');
      expect(result.nextSteps).toContain('Add formatter integration');
      expect(result.nextSteps).toContain('Update documentation');
    });
  });
});
