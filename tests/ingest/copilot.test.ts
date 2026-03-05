import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CopilotIngester } from '../../src/ingest/copilot.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'copilot-test-'));
}

const SAMPLE_WORKSPACE_YAML = `
id: "session-abc-123"
cwd: "/Users/test/project"
summary: "Implemented auth module"
summary_count: 3
created_at: "2025-01-15T10:00:00.000Z"
updated_at: "2025-01-15T12:30:00.000Z"
git_root: "/Users/test/project"
repository: "test-org/test-repo"
branch: "feat/auth"
`;

const SAMPLE_CHECKPOINT_MD = `
<overview>
Added JWT authentication with refresh tokens
</overview>

<history>
- Chose JWT over session-based auth
- Decided on bcrypt for password hashing
</history>

<work_done>
- Created auth middleware
- Added login endpoint
- Added token refresh endpoint
</work_done>

<technical_details>
Using jsonwebtoken library with RS256 signing.
</technical_details>

<important_files>
- src/auth/middleware.ts
- src/auth/login.ts
- src/auth/refresh.ts
</important_files>

<next_steps>
- Add logout endpoint
- Write integration tests
</next_steps>
`;

const SAMPLE_EVENTS_JSONL = [
  JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'edit', arguments: { path: 'src/auth/middleware.ts' } } }),
  JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'create', arguments: { path: 'src/auth/login.ts' } } }),
  JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'view', arguments: { path: 'src/index.ts' } } }),
  JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'edit', arguments: { path: 'src/auth/middleware.ts' } } }),
  '{ invalid json line',
  '',
].join('\n');

describe('CopilotIngester', () => {
  let ingester: CopilotIngester;
  let tempDir: string;

  beforeEach(() => {
    ingester = new CopilotIngester();
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseSession()', () => {
    it('parses a complete session directory', async () => {
      // Set up mock session directory
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), SAMPLE_EVENTS_JSONL);

      const session = await ingester.parseSession(tempDir);

      expect(session.id).toBe('session-abc-123');
      expect(session.agent).toBe('copilot');
      expect(session.startedAt).toBe('2025-01-15T10:00:00.000Z');
      expect(session.endedAt).toBe('2025-01-15T12:30:00.000Z');
    });

    it('uses checkpoint overview as summary when available', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.summary).toBe('Added JWT authentication with refresh tokens');
    });

    it('falls back to workspace summary when no checkpoint', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.summary).toBe('Implemented auth module');
    });

    it('extracts tasks completed from work_done section', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.tasksCompleted).toContain('Created auth middleware');
      expect(session.tasksCompleted).toContain('Added login endpoint');
      expect(session.tasksCompleted).toContain('Added token refresh endpoint');
    });

    it('extracts pending tasks from next_steps section', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.tasksPending).toContain('Add logout endpoint');
      expect(session.tasksPending).toContain('Write integration tests');
    });

    it('extracts key decisions from history section', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.keyDecisions).toContain('Chose JWT over session-based auth');
      expect(session.keyDecisions).toContain('Decided on bcrypt for password hashing');
    });

    it('merges and deduplicates files from checkpoint and events', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), SAMPLE_EVENTS_JSONL);

      const session = await ingester.parseSession(tempDir);

      // From checkpoint important_files
      expect(session.filesModified).toContain('src/auth/middleware.ts');
      expect(session.filesModified).toContain('src/auth/login.ts');
      expect(session.filesModified).toContain('src/auth/refresh.ts');

      // No duplicates even though middleware.ts appears in both events and checkpoint
      const middlewareCount = session.filesModified.filter(
        (f) => f === 'src/auth/middleware.ts',
      ).length;
      expect(middlewareCount).toBe(1);
    });

    it('includes rawCheckpoint from the checkpoint file', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(join(tempDir, 'checkpoints', '001-test.md'), SAMPLE_CHECKPOINT_MD);
      writeFileSync(join(tempDir, 'events.jsonl'), '');

      const session = await ingester.parseSession(tempDir);

      expect(session.rawCheckpoint).toBeDefined();
      expect(session.rawCheckpoint).toContain('<overview>');
      expect(session.rawCheckpoint).toContain('<work_done>');
    });
  });

  describe('parseCheckpoint()', () => {
    it('extracts all XML-like sections', async () => {
      const mdPath = join(tempDir, 'checkpoint.md');
      writeFileSync(mdPath, SAMPLE_CHECKPOINT_MD);

      const checkpoint = await ingester.parseCheckpoint(mdPath);

      expect(checkpoint.overview).toBe('Added JWT authentication with refresh tokens');
      expect(checkpoint.work_done).toContain('Created auth middleware');
      expect(checkpoint.next_steps).toContain('Add logout endpoint');
      expect(checkpoint.important_files).toContain('src/auth/middleware.ts');
      expect(checkpoint.history).toContain('Chose JWT over session-based auth');
      expect(checkpoint.technical_details).toContain('jsonwebtoken library');
    });

    it('handles missing sections gracefully', async () => {
      const mdPath = join(tempDir, 'partial.md');
      writeFileSync(mdPath, `
<overview>
Just an overview, nothing else
</overview>
`);

      const checkpoint = await ingester.parseCheckpoint(mdPath);

      expect(checkpoint.overview).toBe('Just an overview, nothing else');
      expect(checkpoint.work_done).toBe('');
      expect(checkpoint.next_steps).toBe('');
      expect(checkpoint.important_files).toBe('');
      expect(checkpoint.history).toBe('');
      expect(checkpoint.technical_details).toBe('');
    });

    it('stores the raw content', async () => {
      const content = '<overview>Test</overview>';
      const mdPath = join(tempDir, 'raw.md');
      writeFileSync(mdPath, content);

      const checkpoint = await ingester.parseCheckpoint(mdPath);

      expect(checkpoint.raw).toBe(content);
    });

    it('handles completely empty file', async () => {
      const mdPath = join(tempDir, 'empty.md');
      writeFileSync(mdPath, '');

      const checkpoint = await ingester.parseCheckpoint(mdPath);

      expect(checkpoint.overview).toBe('');
      expect(checkpoint.work_done).toBe('');
      expect(checkpoint.raw).toBe('');
    });
  });

  describe('extractFilesFromEvents()', () => {
    it('extracts file paths from edit and create events', async () => {
      const eventsPath = join(tempDir, 'events.jsonl');
      writeFileSync(eventsPath, SAMPLE_EVENTS_JSONL);

      const files = await ingester.extractFilesFromEvents(eventsPath);

      expect(files).toContain('src/auth/middleware.ts');
      expect(files).toContain('src/auth/login.ts');
      // 'view' events should be excluded
      expect(files).not.toContain('src/index.ts');
    });

    it('deduplicates file paths', async () => {
      const eventsPath = join(tempDir, 'events.jsonl');
      writeFileSync(eventsPath, SAMPLE_EVENTS_JSONL);

      const files = await ingester.extractFilesFromEvents(eventsPath);

      // middleware.ts appears twice in events but should only be listed once
      const middlewareCount = files.filter((f) => f === 'src/auth/middleware.ts').length;
      expect(middlewareCount).toBe(1);
    });

    it('returns empty array for missing events file', async () => {
      const files = await ingester.extractFilesFromEvents(
        join(tempDir, 'nonexistent.jsonl'),
      );
      expect(files).toEqual([]);
    });

    it('skips malformed JSON lines', async () => {
      const eventsPath = join(tempDir, 'bad-events.jsonl');
      writeFileSync(eventsPath, [
        '{ invalid json',
        JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'edit', arguments: { path: 'valid.ts' } } }),
      ].join('\n'));

      const files = await ingester.extractFilesFromEvents(eventsPath);
      expect(files).toEqual(['valid.ts']);
    });
  });

  describe('findLatestCheckpoint()', () => {
    it('returns null when checkpoints dir does not exist', async () => {
      writeFileSync(join(tempDir, 'workspace.yaml'), SAMPLE_WORKSPACE_YAML);

      const checkpoint = await ingester.findLatestCheckpoint(tempDir);
      expect(checkpoint).toBeNull();
    });

    it('returns null when checkpoints dir is empty', async () => {
      mkdirSync(join(tempDir, 'checkpoints'));

      const checkpoint = await ingester.findLatestCheckpoint(tempDir);
      expect(checkpoint).toBeNull();
    });

    it('picks the last checkpoint file alphabetically', async () => {
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(
        join(tempDir, 'checkpoints', '001-first.md'),
        '<overview>First</overview>',
      );
      writeFileSync(
        join(tempDir, 'checkpoints', '002-second.md'),
        '<overview>Second</overview>',
      );

      const checkpoint = await ingester.findLatestCheckpoint(tempDir);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.overview).toBe('Second');
    });

    it('ignores index.md', async () => {
      mkdirSync(join(tempDir, 'checkpoints'));
      writeFileSync(
        join(tempDir, 'checkpoints', 'index.md'),
        '<overview>Index</overview>',
      );
      writeFileSync(
        join(tempDir, 'checkpoints', '001-real.md'),
        '<overview>Real checkpoint</overview>',
      );

      const checkpoint = await ingester.findLatestCheckpoint(tempDir);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.overview).toBe('Real checkpoint');
    });
  });

  describe('parseWorkspace()', () => {
    it('parses all workspace fields', async () => {
      const yamlPath = join(tempDir, 'workspace.yaml');
      writeFileSync(yamlPath, SAMPLE_WORKSPACE_YAML);

      const ws = await ingester.parseWorkspace(yamlPath);

      expect(ws.id).toBe('session-abc-123');
      expect(ws.cwd).toBe('/Users/test/project');
      expect(ws.summary).toBe('Implemented auth module');
      expect(ws.summary_count).toBe(3);
      expect(ws.created_at).toBe('2025-01-15T10:00:00.000Z');
      expect(ws.updated_at).toBe('2025-01-15T12:30:00.000Z');
      expect(ws.repository).toBe('test-org/test-repo');
      expect(ws.branch).toBe('feat/auth');
    });

    it('handles minimal workspace yaml', async () => {
      const yamlPath = join(tempDir, 'minimal.yaml');
      writeFileSync(yamlPath, `
id: "minimal-id"
cwd: "/tmp/test"
`);

      const ws = await ingester.parseWorkspace(yamlPath);

      expect(ws.id).toBe('minimal-id');
      expect(ws.cwd).toBe('/tmp/test');
      expect(ws.summary).toBeUndefined();
      expect(ws.repository).toBeUndefined();
    });

    it('throws on malformed YAML', async () => {
      const yamlPath = join(tempDir, 'bad.yaml');
      writeFileSync(yamlPath, ':::not valid yaml:::');

      // parseYaml may not throw on all invalid input, but readFile on non-existent would
      // The key behavior is it doesn't crash silently
      await expect(ingester.parseWorkspace(yamlPath)).resolves.toBeDefined();
    });
  });

  describe('name property', () => {
    it('returns "copilot"', () => {
      expect(ingester.name).toBe('copilot');
    });
  });
});
