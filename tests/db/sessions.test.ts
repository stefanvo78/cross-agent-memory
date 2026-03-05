import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import type { SessionData } from '../../src/types.js';

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'sess-1',
    agent: 'copilot',
    projectId: 'user/repo',
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

describe('SessionStore', () => {
  let db: Database.Database;
  let store: SessionStore;

  beforeEach(() => {
    db = createTestDb();
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert() and getById()', () => {
    it('stores a session and retrieves it by id', () => {
      const data = makeSession();
      store.insert(data);

      const session = store.getById('sess-1');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('sess-1');
      expect(session!.agent).toBe('copilot');
      expect(session!.projectId).toBe('user/repo');
      expect(session!.summary).toBe('Added authentication module');
      expect(session!.tasksCompleted).toEqual(['Implement JWT auth']);
      expect(session!.tasksPending).toEqual(['Add refresh tokens']);
      expect(session!.filesModified).toEqual(['src/auth.ts']);
      expect(session!.keyDecisions).toEqual(['Use bcrypt for hashing']);
    });

    it('returns null for non-existent id', () => {
      expect(store.getById('non-existent')).toBeNull();
    });

    it('upserts when inserting with same id', () => {
      store.insert(makeSession({ summary: 'Original' }));
      store.insert(makeSession({ summary: 'Updated' }));

      const session = store.getById('sess-1');
      expect(session!.summary).toBe('Updated');
      expect(store.count()).toBe(1);
    });
  });

  describe('getLatest()', () => {
    it('returns the most recent session for a project', () => {
      store.insert(makeSession({ id: 'sess-old', endedAt: '2025-01-01T10:00:00' }));
      store.insert(makeSession({ id: 'sess-new', endedAt: '2025-01-02T10:00:00' }));

      const latest = store.getLatest('user/repo');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe('sess-new');
    });

    it('returns null when no sessions exist for project', () => {
      expect(store.getLatest('no-project')).toBeNull();
    });

    it('does not return sessions from other projects', () => {
      store.insert(makeSession({ id: 'sess-other', projectId: 'other/repo' }));

      expect(store.getLatest('user/repo')).toBeNull();
    });
  });

  describe('getRecent()', () => {
    it('returns sessions ordered by ended_at DESC', () => {
      store.insert(makeSession({ id: 's1', endedAt: '2025-01-01T10:00:00' }));
      store.insert(makeSession({ id: 's2', endedAt: '2025-01-03T10:00:00' }));
      store.insert(makeSession({ id: 's3', endedAt: '2025-01-02T10:00:00' }));

      const recent = store.getRecent('user/repo');
      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe('s2');
      expect(recent[1].id).toBe('s3');
      expect(recent[2].id).toBe('s1');
    });

    it('respects limit parameter', () => {
      store.insert(makeSession({ id: 's1', endedAt: '2025-01-01T10:00:00' }));
      store.insert(makeSession({ id: 's2', endedAt: '2025-01-02T10:00:00' }));
      store.insert(makeSession({ id: 's3', endedAt: '2025-01-03T10:00:00' }));

      const recent = store.getRecent('user/repo', 2);
      expect(recent).toHaveLength(2);
    });

    it('returns empty array when no sessions exist', () => {
      expect(store.getRecent('user/repo')).toEqual([]);
    });
  });

  describe('searchFTS()', () => {
    it('finds sessions by keyword in summary', () => {
      store.insert(makeSession({ id: 's1', summary: 'Added authentication module' }));
      store.insert(makeSession({ id: 's2', summary: 'Fixed database migration' }));

      const results = store.searchFTS('authentication');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('s1');
    });

    it('finds sessions by keyword in tasks_completed', () => {
      store.insert(
        makeSession({ id: 's1', tasksCompleted: ['Setup CI pipeline'] }),
      );

      const results = store.searchFTS('pipeline');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('s1');
    });

    it('scopes search to project when projectId provided', () => {
      store.insert(makeSession({ id: 's1', projectId: 'proj-a', summary: 'auth work' }));
      store.insert(makeSession({ id: 's2', projectId: 'proj-b', summary: 'auth work' }));

      const results = store.searchFTS('auth', 'proj-a');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('s1');
    });

    it('returns empty array for no matches', () => {
      store.insert(makeSession());
      expect(store.searchFTS('xyznomatch')).toEqual([]);
    });
  });

  describe('count()', () => {
    it('returns 0 for empty database', () => {
      expect(store.count()).toBe(0);
    });

    it('returns total count', () => {
      store.insert(makeSession({ id: 's1' }));
      store.insert(makeSession({ id: 's2' }));
      expect(store.count()).toBe(2);
    });

    it('returns count filtered by projectId', () => {
      store.insert(makeSession({ id: 's1', projectId: 'proj-a' }));
      store.insert(makeSession({ id: 's2', projectId: 'proj-a' }));
      store.insert(makeSession({ id: 's3', projectId: 'proj-b' }));

      expect(store.count('proj-a')).toBe(2);
      expect(store.count('proj-b')).toBe(1);
    });
  });

  describe('getAgentsUsed()', () => {
    it('returns distinct agents for a project', () => {
      store.insert(makeSession({ id: 's1', agent: 'copilot' }));
      store.insert(makeSession({ id: 's2', agent: 'claude' }));
      store.insert(makeSession({ id: 's3', agent: 'copilot' }));

      const agents = store.getAgentsUsed('user/repo');
      expect(agents).toEqual(['claude', 'copilot']);
    });

    it('returns empty array when no sessions exist', () => {
      expect(store.getAgentsUsed('user/repo')).toEqual([]);
    });
  });
});
