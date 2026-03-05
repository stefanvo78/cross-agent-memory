import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiIngester, getProjectHash } from '../../src/ingest/gemini.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gemini-test-'));
}

function makeSampleSession(overrides?: Partial<{
  sessionId: string;
  summary: string;
  messages: object[];
}>): string {
  return JSON.stringify({
    sessionId: overrides?.sessionId ?? 'sess-gemini-001',
    summary: overrides?.summary,
    messages: overrides?.messages ?? [
      {
        id: '1',
        type: 'user',
        content: [{ text: 'Add authentication to the API' }],
      },
      {
        id: '2',
        type: 'assistant',
        content: [{ text: 'I will add JWT authentication. I decided to use bcrypt for hashing.' }],
      },
      {
        id: '3',
        type: 'tool_use',
        content: [{ text: 'Writing file src/auth.ts' }],
      },
      {
        id: '4',
        type: 'tool_result',
        content: [{ text: 'File src/auth.ts created successfully' }],
      },
      {
        id: '5',
        type: 'assistant',
        content: [{ text: 'Authentication has been added successfully.' }],
      },
    ],
  });
}

describe('getProjectHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = getProjectHash('/Users/test/project');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('returns the same hash for the same path', () => {
    const hash1 = getProjectHash('/Users/test/project');
    const hash2 = getProjectHash('/Users/test/project');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different paths', () => {
    const hash1 = getProjectHash('/Users/test/project-a');
    const hash2 = getProjectHash('/Users/test/project-b');
    expect(hash1).not.toBe(hash2);
  });
});

describe('GeminiIngester', () => {
  let ingester: GeminiIngester;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    ingester = new GeminiIngester(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('name property', () => {
    it('returns "gemini"', () => {
      expect(ingester.name).toBe('gemini');
    });
  });

  describe('parseSession()', () => {
    it('parses a complete session file', async () => {
      const sessionPath = join(tempDir, 'session-001.json');
      writeFileSync(sessionPath, makeSampleSession());

      const session = await ingester.parseSession(sessionPath);

      expect(session.id).toBe('sess-gemini-001');
      expect(session.agent).toBe('gemini');
      expect(session.endedAt).toBeDefined();
    });

    it('uses session summary when available', async () => {
      const sessionPath = join(tempDir, 'session-summary.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({ summary: 'Added JWT auth to the API' }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.summary).toBe('Added JWT auth to the API');
    });

    it('builds summary from first user message when no summary exists', async () => {
      const sessionPath = join(tempDir, 'session-no-summary.json');
      writeFileSync(sessionPath, makeSampleSession());

      const session = await ingester.parseSession(sessionPath);

      expect(session.summary).toContain('Gemini session:');
      expect(session.summary).toContain('Add authentication to the API');
      expect(session.summary).toContain('1 prompts');
      expect(session.summary).toContain('2 responses');
    });

    it('truncates long first messages in summary to 200 chars', async () => {
      const longMessage = 'A'.repeat(300);
      const sessionPath = join(tempDir, 'session-long.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({
          messages: [
            { id: '1', type: 'user', content: [{ text: longMessage }] },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      // "Gemini session: " + 200 chars + "..." + count info
      expect(session.summary).toContain('...');
      expect(session.summary.indexOf('...')).toBeLessThanOrEqual(220);
    });

    it('extracts file paths from tool_use messages', async () => {
      const sessionPath = join(tempDir, 'session-files.json');
      writeFileSync(sessionPath, makeSampleSession());

      const session = await ingester.parseSession(sessionPath);

      expect(session.filesModified).toContain('src/auth.ts');
    });

    it('extracts file paths from tool_result messages', async () => {
      const sessionPath = join(tempDir, 'session-tool-result.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({
          messages: [
            { id: '1', type: 'user', content: [{ text: 'Create files' }] },
            {
              id: '2',
              type: 'tool_result',
              content: [{ text: 'Modified ./src/index.ts and tests/main.test.ts' }],
            },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.filesModified).toContain('./src/index.ts');
      expect(session.filesModified).toContain('tests/main.test.ts');
    });

    it('deduplicates file paths', async () => {
      const sessionPath = join(tempDir, 'session-dedup.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({
          messages: [
            { id: '1', type: 'user', content: [{ text: 'Edit file' }] },
            { id: '2', type: 'tool_use', content: [{ text: 'Writing src/auth.ts' }] },
            { id: '3', type: 'tool_result', content: [{ text: 'Updated src/auth.ts' }] },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      const count = session.filesModified.filter((f) => f === 'src/auth.ts').length;
      expect(count).toBe(1);
    });

    it('does not extract file paths from user or assistant messages', async () => {
      const sessionPath = join(tempDir, 'session-no-extract.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({
          messages: [
            {
              id: '1',
              type: 'user',
              content: [{ text: 'Please edit src/secret.ts' }],
            },
            {
              id: '2',
              type: 'assistant',
              content: [{ text: 'I see src/other.ts needs changes' }],
            },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.filesModified).toEqual([]);
    });

    it('extracts key decisions from assistant messages', async () => {
      const sessionPath = join(tempDir, 'session-decisions.json');
      writeFileSync(sessionPath, makeSampleSession());

      const session = await ingester.parseSession(sessionPath);

      expect(session.keyDecisions.length).toBeGreaterThan(0);
      expect(session.keyDecisions.some((d) => d.includes('decided'))).toBe(true);
    });

    it('caps key decisions at 10', async () => {
      const messages = [
        { id: '1', type: 'user', content: [{ text: 'Build it all' }] },
        {
          id: '2',
          type: 'assistant',
          content: [
            {
              text: Array.from({ length: 15 }, (_, i) =>
                `I decided to use approach ${i + 1} for component ${i + 1}`,
              ).join('. '),
            },
          ],
        },
      ];
      const sessionPath = join(tempDir, 'session-many-decisions.json');
      writeFileSync(sessionPath, makeSampleSession({ messages }));

      const session = await ingester.parseSession(sessionPath);

      expect(session.keyDecisions.length).toBeLessThanOrEqual(10);
    });

    it('builds rawCheckpoint with full transcript', async () => {
      const sessionPath = join(tempDir, 'session-raw.json');
      writeFileSync(sessionPath, makeSampleSession());

      const session = await ingester.parseSession(sessionPath);

      expect(session.rawCheckpoint).toContain('User: Add authentication to the API');
      expect(session.rawCheckpoint).toContain('Assistant: I will add JWT authentication');
      expect(session.rawCheckpoint).toContain('tool_use:');
    });

    it('includes session summary in rawCheckpoint when present', async () => {
      const sessionPath = join(tempDir, 'session-raw-summary.json');
      writeFileSync(
        sessionPath,
        makeSampleSession({ summary: 'Auth implementation session' }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.rawCheckpoint).toContain('Summary: Auth implementation session');
    });

    it('uses filename as fallback session ID when sessionId is missing', async () => {
      const sessionPath = join(tempDir, 'session-1234-fallback.json');
      writeFileSync(
        sessionPath,
        JSON.stringify({
          messages: [
            { id: '1', type: 'user', content: [{ text: 'Hello' }] },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.id).toBe('session-1234-fallback');
    });
  });

  describe('parseSession() edge cases', () => {
    it('handles a session with no messages', async () => {
      const sessionPath = join(tempDir, 'session-empty.json');
      writeFileSync(
        sessionPath,
        JSON.stringify({ sessionId: 'empty-sess', messages: [] }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.id).toBe('empty-sess');
      expect(session.agent).toBe('gemini');
      expect(session.summary).toContain('Unknown task');
      expect(session.filesModified).toEqual([]);
      expect(session.keyDecisions).toEqual([]);
    });

    it('handles messages with empty content arrays', async () => {
      const sessionPath = join(tempDir, 'session-empty-content.json');
      writeFileSync(
        sessionPath,
        JSON.stringify({
          sessionId: 'empty-content',
          messages: [
            { id: '1', type: 'user', content: [] },
            { id: '2', type: 'assistant', content: [] },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.id).toBe('empty-content');
      expect(session.summary).toContain('Unknown task');
    });

    it('handles messages with content blocks missing text', async () => {
      const sessionPath = join(tempDir, 'session-no-text.json');
      writeFileSync(
        sessionPath,
        JSON.stringify({
          sessionId: 'no-text',
          messages: [
            { id: '1', type: 'user', content: [{}] },
            { id: '2', type: 'assistant', content: [{ notText: 'something' }] },
          ],
        }),
      );

      const session = await ingester.parseSession(sessionPath);

      expect(session.id).toBe('no-text');
      expect(session.summary).toContain('Unknown task');
    });

    it('throws on invalid JSON', async () => {
      const sessionPath = join(tempDir, 'session-bad.json');
      writeFileSync(sessionPath, '{ not valid json }');

      await expect(ingester.parseSession(sessionPath)).rejects.toThrow();
    });
  });

  describe('findLatestSession()', () => {
    it('returns null when no chats directory exists', async () => {
      const result = await ingester.findLatestSession('/nonexistent/project');
      expect(result).toBeNull();
    });

    it('returns null when chats directory is empty', async () => {
      const hash = getProjectHash('/test/project');
      const chatsDir = join(tempDir, hash, 'chats');
      mkdirSync(chatsDir, { recursive: true });

      const result = await ingester.findLatestSession('/test/project');

      expect(result).toBeNull();
    });

    it('finds the latest session by mtime in the hashed project dir', async () => {
      const projectPath = '/test/project';
      const hash = getProjectHash(projectPath);
      const chatsDir = join(tempDir, hash, 'chats');
      mkdirSync(chatsDir, { recursive: true });

      const olderPath = join(chatsDir, 'session-2025-01-01-aaa.json');
      const newerPath = join(chatsDir, 'session-2025-01-02-bbb.json');

      writeFileSync(olderPath, makeSampleSession({ sessionId: 'older' }));
      // Brief delay to ensure different mtime
      writeFileSync(newerPath, makeSampleSession({ sessionId: 'newer' }));

      const result = await ingester.findLatestSession(projectPath);

      expect(result).toBe(newerPath);
    });

    it('falls back to scanning all project dirs when hash does not match', async () => {
      // Create a chats dir under an arbitrary hash
      const arbitraryHash = 'abcdef0123456789';
      const chatsDir = join(tempDir, arbitraryHash, 'chats');
      mkdirSync(chatsDir, { recursive: true });
      const sessionPath = join(chatsDir, 'session-001.json');
      writeFileSync(sessionPath, makeSampleSession());

      // Search with a path whose hash won't match
      const result = await ingester.findLatestSession('/some/other/path');

      expect(result).toBe(sessionPath);
    });
  });

  describe('parseLatestSession()', () => {
    it('returns null when no sessions exist', async () => {
      const result = await ingester.parseLatestSession('/nonexistent/project');
      expect(result).toBeNull();
    });

    it('parses the latest session for a project', async () => {
      const projectPath = '/test/project';
      const hash = getProjectHash(projectPath);
      const chatsDir = join(tempDir, hash, 'chats');
      mkdirSync(chatsDir, { recursive: true });

      writeFileSync(
        join(chatsDir, 'session-2025-01-01-aaa.json'),
        makeSampleSession({ sessionId: 'the-latest' }),
      );

      const result = await ingester.parseLatestSession(projectPath);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('the-latest');
      expect(result!.agent).toBe('gemini');
    });
  });

  describe('findChatsDir()', () => {
    it('returns null when baseDir does not exist', async () => {
      const noBaseIngester = new GeminiIngester(join(tempDir, 'nonexistent'));
      const result = await noBaseIngester.findChatsDir('/some/path');
      expect(result).toBeNull();
    });

    it('returns the hashed chats directory when it exists', async () => {
      const projectPath = '/test/my-project';
      const hash = getProjectHash(projectPath);
      const chatsDir = join(tempDir, hash, 'chats');
      mkdirSync(chatsDir, { recursive: true });

      const result = await ingester.findChatsDir(projectPath);

      expect(result).toBe(chatsDir);
    });

    it('returns most recently modified chats dir when hash does not match', async () => {
      // Create two project dirs
      const dir1 = join(tempDir, 'proj1', 'chats');
      const dir2 = join(tempDir, 'proj2', 'chats');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      // Write a file in dir2 to make it more recent
      writeFileSync(join(dir2, 'session.json'), makeSampleSession());

      const result = await ingester.findChatsDir('/unmatched/path');

      expect(result).toBe(dir2);
    });
  });
});
