import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { VectorStore } from '../../src/db/vectors.js';
import { SessionStore } from '../../src/db/sessions.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import type { SessionData } from '../../src/types.js';

/** Create a deterministic embedding with a known direction. */
function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  // Normalize to unit vector for cosine similarity
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}

function makeSession(id: string): SessionData {
  return {
    id,
    agent: 'copilot',
    projectId: 'user/repo',
    endedAt: '2025-01-01T12:00:00',
    summary: `Session ${id}`,
    tasksCompleted: [],
    tasksPending: [],
    filesModified: [],
    keyDecisions: [],
  };
}

describe('VectorStore', () => {
  let db: Database.Database;
  let vectors: VectorStore;
  let sessions: SessionStore;
  let knowledge: KnowledgeStore;

  beforeEach(() => {
    db = createTestDb();
    vectors = new VectorStore(db);
    sessions = new SessionStore(db);
    knowledge = new KnowledgeStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insertSessionChunk()', () => {
    it('stores a chunk and returns its id', () => {
      sessions.insert(makeSession('sess-1'));
      const embedding = makeEmbedding(1);

      const id = vectors.insertSessionChunk('sess-1', 'some chunk text', embedding);
      expect(id).toBeGreaterThan(0);
    });

    it('stores multiple chunks for the same session', () => {
      sessions.insert(makeSession('sess-1'));

      const id1 = vectors.insertSessionChunk('sess-1', 'chunk 1', makeEmbedding(1));
      const id2 = vectors.insertSessionChunk('sess-1', 'chunk 2', makeEmbedding(2));

      expect(id2).toBeGreaterThan(id1);
      expect(vectors.sessionChunkCount()).toBe(2);
    });
  });

  describe('searchSessions()', () => {
    it('returns results sorted by similarity', () => {
      sessions.insert(makeSession('sess-1'));
      sessions.insert(makeSession('sess-2'));

      const emb1 = makeEmbedding(1);
      const emb2 = makeEmbedding(2);
      vectors.insertSessionChunk('sess-1', 'text about auth', emb1);
      vectors.insertSessionChunk('sess-2', 'text about database', emb2);

      // Query with emb1 — should match sess-1 better
      const results = vectors.searchSessions(emb1, 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].sessionId).toBe('sess-1');
      expect(results[0].similarityScore).toBeGreaterThan(results[results.length - 1].similarityScore);
    });

    it('returns chunkText and metadata', () => {
      sessions.insert(makeSession('sess-1'));
      vectors.insertSessionChunk('sess-1', 'auth implementation details', makeEmbedding(1));

      const results = vectors.searchSessions(makeEmbedding(1), 10);
      expect(results[0]).toMatchObject({
        sessionId: 'sess-1',
        agent: 'copilot',
        chunkText: 'auth implementation details',
      });
      expect(results[0].similarityScore).toBeCloseTo(1.0, 1);
      expect(results[0].timestamp).toBeDefined();
    });

    it('respects limit parameter', () => {
      sessions.insert(makeSession('sess-1'));
      for (let i = 0; i < 5; i++) {
        vectors.insertSessionChunk('sess-1', `chunk ${i}`, makeEmbedding(i + 1));
      }

      const results = vectors.searchSessions(makeEmbedding(1), 2);
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no chunks exist', () => {
      const results = vectors.searchSessions(makeEmbedding(1), 10);
      expect(results).toEqual([]);
    });
  });

  describe('insertKnowledgeVector()', () => {
    it('stores a knowledge vector', () => {
      const knowledgeId = knowledge.insert({
        projectId: 'user/repo',
        type: 'decision',
        title: 'Use bcrypt',
        content: 'Chose bcrypt for hashing',
      });

      expect(() => {
        vectors.insertKnowledgeVector(knowledgeId, makeEmbedding(1));
      }).not.toThrow();
    });
  });

  describe('sessionChunkCount()', () => {
    it('returns 0 when no chunks exist', () => {
      expect(vectors.sessionChunkCount()).toBe(0);
    });

    it('returns correct count after inserts', () => {
      sessions.insert(makeSession('sess-1'));
      vectors.insertSessionChunk('sess-1', 'chunk 1', makeEmbedding(1));
      vectors.insertSessionChunk('sess-1', 'chunk 2', makeEmbedding(2));
      vectors.insertSessionChunk('sess-1', 'chunk 3', makeEmbedding(3));

      expect(vectors.sessionChunkCount()).toBe(3);
    });
  });
});
