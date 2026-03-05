import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import {
  getHandoff,
  searchMemory,
  storeKnowledge,
  getProjectContext,
  type ToolDependencies,
} from '../../src/mcp/tools.js';
import type { SessionData } from '../../src/types.js';

const PROJECT_ID = 'test/project';

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'sess-1',
    agent: 'copilot',
    projectId: PROJECT_ID,
    projectPath: '/home/user/repo',
    startedAt: '2025-01-01T10:00:00',
    endedAt: '2025-01-01T11:00:00',
    summary: 'Added authentication module',
    tasksCompleted: ['Implement JWT auth'],
    tasksPending: ['Add refresh tokens'],
    filesModified: ['src/auth.ts'],
    keyDecisions: ['Use bcrypt for hashing'],
    ...overrides,
  };
}

describe('MCP Tools', () => {
  let db: Database.Database;
  let deps: ToolDependencies;
  let sessionStore: SessionStore;
  let knowledgeStore: KnowledgeStore;

  beforeEach(() => {
    db = createTestDb();
    deps = {
      db,
      embeddingEngine: undefined,
      defaultProjectId: PROJECT_ID,
    };
    sessionStore = new SessionStore(db);
    knowledgeStore = new KnowledgeStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── getHandoff ──────────────────────────────────────────────────────

  describe('getHandoff', () => {
    it('returns hasPreviousSession false when no sessions exist', async () => {
      const result = await getHandoff(deps, {});

      expect(result.hasPreviousSession).toBe(false);
      expect(result.lastSession).toBeUndefined();
      expect(result.suggestedPrompt).toContain('No previous sessions');
    });

    it('returns hasPreviousSession false with explicit project_id', async () => {
      const result = await getHandoff(deps, { project_id: 'other/project' });

      expect(result.hasPreviousSession).toBe(false);
    });

    it('returns correct last session data when a session exists', async () => {
      sessionStore.insert(makeSession());

      const result = await getHandoff(deps, {});

      expect(result.hasPreviousSession).toBe(true);
      expect(result.lastSession).toBeDefined();
      expect(result.lastSession!.agent).toBe('copilot');
      expect(result.lastSession!.summary).toBe('Added authentication module');
      expect(result.lastSession!.tasksCompleted).toEqual(['Implement JWT auth']);
      expect(result.lastSession!.tasksPending).toEqual(['Add refresh tokens']);
      expect(result.lastSession!.filesModified).toEqual(['src/auth.ts']);
      expect(result.lastSession!.keyDecisions).toEqual(['Use bcrypt for hashing']);
    });

    it('returns the most recent session when multiple exist', async () => {
      sessionStore.insert(makeSession({
        id: 'sess-old',
        endedAt: '2025-01-01T10:00:00',
        summary: 'Old session',
      }));
      sessionStore.insert(makeSession({
        id: 'sess-new',
        endedAt: '2025-01-02T10:00:00',
        summary: 'New session',
        agent: 'claude',
      }));

      const result = await getHandoff(deps, {});

      expect(result.hasPreviousSession).toBe(true);
      expect(result.lastSession!.summary).toBe('New session');
      expect(result.lastSession!.agent).toBe('claude');
    });

    it('includes suggested prompt with pending tasks and decisions', async () => {
      sessionStore.insert(makeSession({
        tasksPending: ['Add refresh tokens', 'Write tests'],
        keyDecisions: ['Use bcrypt for hashing'],
      }));

      const result = await getHandoff(deps, {});

      expect(result.suggestedPrompt).toContain('Continue working');
      expect(result.suggestedPrompt).toContain('Add refresh tokens');
      expect(result.suggestedPrompt).toContain('bcrypt');
    });

    it('suggested prompt omits tasks/decisions sections when empty', async () => {
      sessionStore.insert(makeSession({
        tasksPending: [],
        keyDecisions: [],
      }));

      const result = await getHandoff(deps, {});

      expect(result.suggestedPrompt).toContain('Continue working');
      expect(result.suggestedPrompt).not.toContain('Remaining tasks');
      expect(result.suggestedPrompt).not.toContain('Key decisions');
    });

    it('includes knowledge entries in response', async () => {
      knowledgeStore.insert({
        projectId: PROJECT_ID,
        type: 'decision',
        title: 'Use PostgreSQL',
        content: 'Chose PostgreSQL for primary DB',
      });

      const result = await getHandoff(deps, {});

      expect(result.recentKnowledge).toHaveLength(1);
      expect(result.recentKnowledge[0].title).toBe('Use PostgreSQL');
    });

    it('limits knowledge entries to 10', async () => {
      for (let i = 0; i < 15; i++) {
        knowledgeStore.insert({
          projectId: PROJECT_ID,
          type: 'gotcha',
          title: `Entry ${i}`,
          content: `Content ${i}`,
        });
      }

      const result = await getHandoff(deps, {});

      expect(result.recentKnowledge).toHaveLength(10);
    });

    it('includes knowledge in suggestedPrompt when no sessions but knowledge exists', async () => {
      knowledgeStore.insert({
        projectId: PROJECT_ID,
        type: 'pattern',
        title: 'Some pattern',
        content: 'Details',
      });

      const result = await getHandoff(deps, {});

      expect(result.hasPreviousSession).toBe(false);
      expect(result.suggestedPrompt).toContain('1 knowledge entries');
    });
  });

  // ── searchMemory ────────────────────────────────────────────────────

  describe('searchMemory', () => {
    it('returns empty results when no sessions exist', async () => {
      const result = await searchMemory(deps, { query: 'auth' });

      expect(result.results).toEqual([]);
    });

    it('finds sessions via FTS5 keyword search', async () => {
      sessionStore.insert(makeSession({
        id: 'sess-auth',
        summary: 'Implemented authentication with JWT tokens',
      }));
      sessionStore.insert(makeSession({
        id: 'sess-db',
        summary: 'Fixed database migration scripts',
      }));

      const result = await searchMemory(deps, { query: 'authentication' });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].sessionId).toBe('sess-auth');
      expect(result.results[0].chunkText).toContain('authentication');
      expect(result.results[0].similarityScore).toBe(0.5);
    });

    it('scopes search to project_id when provided', async () => {
      sessionStore.insert(makeSession({
        id: 'sess-a',
        projectId: 'proj-a',
        summary: 'Auth work in project A',
      }));
      sessionStore.insert(makeSession({
        id: 'sess-b',
        projectId: 'proj-b',
        summary: 'Auth work in project B',
      }));

      const result = await searchMemory(deps, {
        query: 'auth',
        project_id: 'proj-a',
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].sessionId).toBe('sess-a');
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        sessionStore.insert(makeSession({
          id: `sess-${i}`,
          summary: `Session about authentication ${i}`,
          endedAt: `2025-01-0${i + 1}T10:00:00`,
        }));
      }

      const result = await searchMemory(deps, {
        query: 'authentication',
        limit: 2,
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('uses default limit of 10', async () => {
      for (let i = 0; i < 15; i++) {
        sessionStore.insert(makeSession({
          id: `sess-${i}`,
          summary: `Session about authentication item ${i}`,
          endedAt: `2025-01-${String(i + 1).padStart(2, '0')}T10:00:00`,
        }));
      }

      const result = await searchMemory(deps, { query: 'authentication' });

      expect(result.results.length).toBeLessThanOrEqual(10);
    });

    it('returns results with expected shape', async () => {
      sessionStore.insert(makeSession({
        id: 'sess-1',
        agent: 'claude',
        summary: 'Refactored database layer',
        endedAt: '2025-06-01T12:00:00',
      }));

      const result = await searchMemory(deps, { query: 'database' });

      expect(result.results).toHaveLength(1);
      const r = result.results[0];
      expect(r.sessionId).toBe('sess-1');
      expect(r.agent).toBe('claude');
      expect(r.chunkText).toBe('Refactored database layer');
      expect(r.timestamp).toBe('2025-06-01T12:00:00');
      expect(typeof r.similarityScore).toBe('number');
    });
  });

  // ── storeKnowledge ──────────────────────────────────────────────────

  describe('storeKnowledge', () => {
    it('stores a knowledge entry and returns its id', async () => {
      const result = await storeKnowledge(deps, {
        type: 'decision',
        title: 'Use PostgreSQL',
        content: 'Chose PostgreSQL for the primary database.',
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.stored).toBe(true);

      // Verify it was actually stored
      const entry = knowledgeStore.getById(result.id);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe('Use PostgreSQL');
      expect(entry!.content).toBe('Chose PostgreSQL for the primary database.');
      expect(entry!.type).toBe('decision');
      expect(entry!.projectId).toBe(PROJECT_ID);
    });

    it('stores with explicit project_id', async () => {
      const result = await storeKnowledge(deps, {
        type: 'pattern',
        title: 'Singleton pattern',
        content: 'Use singleton for DB connection',
        project_id: 'custom/project',
      });

      const entry = knowledgeStore.getById(result.id);
      expect(entry!.projectId).toBe('custom/project');
    });

    it.each(['decision', 'gotcha', 'pattern', 'architecture'] as const)(
      'accepts valid type: %s',
      async (type) => {
        const result = await storeKnowledge(deps, {
          type,
          title: `Test ${type}`,
          content: `Content for ${type}`,
        });

        expect(result.stored).toBe(true);
        expect(result.id).toBeGreaterThan(0);
      },
    );

    it('throws on invalid knowledge type', async () => {
      await expect(
        storeKnowledge(deps, {
          type: 'invalid-type',
          title: 'Bad',
          content: 'Bad content',
        }),
      ).rejects.toThrow('Invalid knowledge type: "invalid-type"');
    });

    it('throws on empty string type', async () => {
      await expect(
        storeKnowledge(deps, {
          type: '',
          title: 'Bad',
          content: 'Bad content',
        }),
      ).rejects.toThrow('Invalid knowledge type');
    });
  });

  // ── getProjectContext ───────────────────────────────────────────────

  describe('getProjectContext', () => {
    it('returns zero counts for empty project', async () => {
      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.project_id).toBe(PROJECT_ID);
      expect(result.total_sessions).toBe(0);
      expect(result.agents_used).toEqual([]);
      expect(result.recent_sessions).toEqual([]);
      expect(result.knowledge).toEqual([]);
      expect(result.files_frequently_modified).toEqual([]);
    });

    it('returns correct session counts and agents', async () => {
      sessionStore.insert(makeSession({ id: 's1', agent: 'copilot' }));
      sessionStore.insert(makeSession({ id: 's2', agent: 'claude' }));
      sessionStore.insert(makeSession({ id: 's3', agent: 'copilot' }));

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.total_sessions).toBe(3);
      expect(result.agents_used).toEqual(['claude', 'copilot']);
    });

    it('returns recent sessions with correct shape', async () => {
      sessionStore.insert(makeSession({
        id: 'sess-recent',
        agent: 'gemini',
        endedAt: '2025-06-01T12:00:00',
        summary: 'Added tests',
      }));

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.recent_sessions).toHaveLength(1);
      expect(result.recent_sessions[0]).toEqual({
        id: 'sess-recent',
        agent: 'gemini',
        ended_at: '2025-06-01T12:00:00',
        summary: 'Added tests',
      });
    });

    it('limits recent sessions to 5', async () => {
      for (let i = 0; i < 8; i++) {
        sessionStore.insert(makeSession({
          id: `s-${i}`,
          endedAt: `2025-01-${String(i + 1).padStart(2, '0')}T10:00:00`,
        }));
      }

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.recent_sessions).toHaveLength(5);
    });

    it('includes knowledge entries', async () => {
      knowledgeStore.insert({
        projectId: PROJECT_ID,
        type: 'architecture',
        title: 'Microservices',
        content: 'Using microservices architecture',
      });

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.knowledge).toHaveLength(1);
      expect(result.knowledge[0].title).toBe('Microservices');
      expect(result.knowledge[0].type).toBe('architecture');
    });

    it('computes frequently modified files across sessions', async () => {
      sessionStore.insert(makeSession({
        id: 's1',
        filesModified: ['src/auth.ts', 'src/db.ts'],
        endedAt: '2025-01-01T10:00:00',
      }));
      sessionStore.insert(makeSession({
        id: 's2',
        filesModified: ['src/auth.ts', 'src/api.ts'],
        endedAt: '2025-01-02T10:00:00',
      }));
      sessionStore.insert(makeSession({
        id: 's3',
        filesModified: ['src/auth.ts'],
        endedAt: '2025-01-03T10:00:00',
      }));

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.files_frequently_modified[0]).toEqual({
        path: 'src/auth.ts',
        count: 3,
      });
    });

    it('does not include sessions from other projects', async () => {
      sessionStore.insert(makeSession({ id: 's1', projectId: PROJECT_ID }));
      sessionStore.insert(makeSession({ id: 's2', projectId: 'other/project' }));

      const result = await getProjectContext(deps, { project_id: PROJECT_ID });

      expect(result.total_sessions).toBe(1);
    });
  });
});
