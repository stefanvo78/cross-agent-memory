import type Database from 'better-sqlite3';
import type { SearchResult, AgentType } from '../types.js';

export class VectorStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insertSessionChunk(sessionId: string, chunkText: string, embedding: Float32Array): number {
    // Insert metadata
    const metaResult = this.db.prepare(
      'INSERT INTO session_chunk_meta (session_id, chunk_text) VALUES (?, ?)'
    ).run(sessionId, chunkText);

    const id = Number(metaResult.lastInsertRowid);

    // Insert vector (rowid must match session_chunk_meta.id)
    // vec0 virtual tables require BigInt for rowid values
    this.db.prepare(
      'INSERT INTO session_chunks (rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(id), Buffer.from(embedding.buffer));

    return id;
  }

  insertKnowledgeVector(knowledgeId: number, embedding: Float32Array): void {
    // vec0 virtual tables require BigInt for rowid values
    this.db.prepare(
      'INSERT INTO knowledge_vec (rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(knowledgeId), Buffer.from(embedding.buffer));
  }

  searchSessions(queryEmbedding: Float32Array, limit = 10, projectId?: string): SearchResult[] {
    let sql: string;
    let params: unknown[];

    if (projectId) {
      sql = `
        SELECT
          sc.distance,
          m.chunk_text,
          m.session_id,
          s.agent,
          s.ended_at
        FROM session_chunks sc
        JOIN session_chunk_meta m ON m.id = sc.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE sc.embedding MATCH ? AND k = ?
          AND s.project_id = ?
        ORDER BY sc.distance
      `;
      params = [Buffer.from(queryEmbedding.buffer), limit * 2, projectId];
    } else {
      sql = `
        SELECT
          sc.distance,
          m.chunk_text,
          m.session_id,
          s.agent,
          s.ended_at
        FROM session_chunks sc
        JOIN session_chunk_meta m ON m.id = sc.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE sc.embedding MATCH ? AND k = ?
        ORDER BY sc.distance
      `;
      params = [Buffer.from(queryEmbedding.buffer), limit * 2];
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      distance: number;
      chunk_text: string;
      session_id: string;
      agent: string;
      ended_at: string;
    }>;

    // Convert distance to similarity (cosine distance → similarity)
    return rows.slice(0, limit).map((r) => ({
      sessionId: r.session_id,
      agent: r.agent as AgentType,
      chunkText: r.chunk_text,
      similarityScore: 1 - r.distance,
      timestamp: r.ended_at,
    }));
  }

  searchKnowledge(queryEmbedding: Float32Array, limit = 10, projectId?: string): Array<{ id: number; distance: number }> {
    let sql: string;
    let params: unknown[];

    if (projectId) {
      sql = `
        SELECT kv.rowid as id, kv.distance
        FROM knowledge_vec kv
        JOIN knowledge k ON k.id = kv.rowid
        WHERE kv.embedding MATCH ? AND k = ?
          AND k.project_id = ?
        ORDER BY kv.distance
      `;
      params = [Buffer.from(queryEmbedding.buffer), limit, projectId];
    } else {
      sql = `
        SELECT kv.rowid as id, kv.distance
        FROM knowledge_vec kv
        WHERE kv.embedding MATCH ? AND k = ?
        ORDER BY kv.distance
      `;
      params = [Buffer.from(queryEmbedding.buffer), limit];
    }

    return this.db.prepare(sql).all(...params) as Array<{ id: number; distance: number }>;
  }

  sessionChunkCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM session_chunk_meta').get() as { cnt: number };
    return row.cnt;
  }
}
