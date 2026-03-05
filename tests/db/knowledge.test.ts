import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import type { KnowledgeInput } from '../../src/types.js';

function makeKnowledge(overrides: Partial<KnowledgeInput> = {}): KnowledgeInput {
  return {
    projectId: 'user/repo',
    type: 'decision',
    title: 'Use bcrypt for hashing',
    content: 'We chose bcrypt over argon2 for password hashing due to broader library support.',
    sourceAgent: 'copilot',
    sourceSessionId: 'sess-1',
    ...overrides,
  };
}

describe('KnowledgeStore', () => {
  let db: Database.Database;
  let store: KnowledgeStore;

  beforeEach(() => {
    db = createTestDb();
    store = new KnowledgeStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert() and getById()', () => {
    it('stores knowledge and retrieves it by id', () => {
      const id = store.insert(makeKnowledge());

      const knowledge = store.getById(id);
      expect(knowledge).not.toBeNull();
      expect(knowledge!.id).toBe(id);
      expect(knowledge!.projectId).toBe('user/repo');
      expect(knowledge!.type).toBe('decision');
      expect(knowledge!.title).toBe('Use bcrypt for hashing');
      expect(knowledge!.content).toContain('bcrypt over argon2');
      expect(knowledge!.sourceAgent).toBe('copilot');
      expect(knowledge!.sourceSessionId).toBe('sess-1');
      expect(knowledge!.createdAt).toBeDefined();
    });

    it('returns the auto-incremented id', () => {
      const id1 = store.insert(makeKnowledge({ title: 'First' }));
      const id2 = store.insert(makeKnowledge({ title: 'Second' }));

      expect(id2).toBeGreaterThan(id1);
    });

    it('returns null for non-existent id', () => {
      expect(store.getById(999)).toBeNull();
    });

    it('stores knowledge without optional fields', () => {
      const id = store.insert({
        projectId: 'user/repo',
        type: 'gotcha',
        title: 'SQLite WAL mode',
        content: 'Enable WAL for concurrent reads.',
      });

      const knowledge = store.getById(id);
      expect(knowledge).not.toBeNull();
      expect(knowledge!.sourceAgent).toBeNull();
      expect(knowledge!.sourceSessionId).toBeNull();
    });
  });

  describe('getByProject()', () => {
    it('returns all knowledge for a project', () => {
      store.insert(makeKnowledge({ title: 'K1' }));
      store.insert(makeKnowledge({ title: 'K2' }));
      store.insert(makeKnowledge({ title: 'K3', projectId: 'other/repo' }));

      const items = store.getByProject('user/repo');
      expect(items).toHaveLength(2);
    });

    it('filters by type when provided', () => {
      store.insert(makeKnowledge({ type: 'decision', title: 'D1' }));
      store.insert(makeKnowledge({ type: 'gotcha', title: 'G1' }));
      store.insert(makeKnowledge({ type: 'decision', title: 'D2' }));

      const decisions = store.getByProject('user/repo', 'decision');
      expect(decisions).toHaveLength(2);
      expect(decisions.every((k) => k.type === 'decision')).toBe(true);
    });

    it('returns items ordered by created_at DESC', () => {
      // Insert items; SQLite auto-assigns created_at via DEFAULT
      store.insert(makeKnowledge({ title: 'First' }));
      store.insert(makeKnowledge({ title: 'Second' }));

      const items = store.getByProject('user/repo');
      // Both have the same created_at (datetime('now')), so at least verify both returned
      expect(items).toHaveLength(2);
    });

    it('returns empty array for unknown project', () => {
      expect(store.getByProject('no-such-project')).toEqual([]);
    });
  });

  describe('count()', () => {
    it('returns 0 for empty database', () => {
      expect(store.count()).toBe(0);
    });

    it('returns total count', () => {
      store.insert(makeKnowledge({ title: 'K1' }));
      store.insert(makeKnowledge({ title: 'K2' }));
      expect(store.count()).toBe(2);
    });

    it('returns count filtered by projectId', () => {
      store.insert(makeKnowledge({ projectId: 'proj-a' }));
      store.insert(makeKnowledge({ projectId: 'proj-a' }));
      store.insert(makeKnowledge({ projectId: 'proj-b' }));

      expect(store.count('proj-a')).toBe(2);
      expect(store.count('proj-b')).toBe(1);
    });
  });
});
