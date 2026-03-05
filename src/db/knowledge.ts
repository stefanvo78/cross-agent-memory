import type Database from 'better-sqlite3';
import type { KnowledgeInput, Knowledge, KnowledgeType } from '../types.js';

export class KnowledgeStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(data: KnowledgeInput): number {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge
        (project_id, type, title, content, source_agent, source_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.projectId,
      data.type,
      data.title,
      data.content,
      data.sourceAgent ?? null,
      data.sourceSessionId ?? null,
    );

    return Number(result.lastInsertRowid);
  }

  getByProject(projectId: string, type?: KnowledgeType): Knowledge[] {
    let sql = 'SELECT * FROM knowledge WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToKnowledge(r));
  }

  getById(id: number): Knowledge | null {
    const row = this.db.prepare('SELECT * FROM knowledge WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToKnowledge(row) : null;
  }

  count(projectId?: string): number {
    if (projectId) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM knowledge WHERE project_id = ?')
        .get(projectId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM knowledge')
      .get() as { cnt: number };
    return row.cnt;
  }

  private rowToKnowledge(row: Record<string, unknown>): Knowledge {
    return {
      id: row.id as number,
      projectId: row.project_id as string,
      type: row.type as KnowledgeType,
      title: row.title as string,
      content: row.content as string,
      sourceAgent: row.source_agent as Knowledge['sourceAgent'],
      sourceSessionId: row.source_session_id as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string | undefined,
    };
  }
}
