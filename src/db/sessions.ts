import type Database from 'better-sqlite3';
import type { SessionData, Session } from '../types.js';

export class SessionStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(data: SessionData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, agent, project_id, project_path, started_at, ended_at, reason,
         summary, tasks_completed, tasks_pending, files_modified, key_decisions, raw_checkpoint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.agent,
      data.projectId,
      data.projectPath ?? null,
      data.startedAt ?? null,
      data.endedAt,
      data.reason ?? null,
      data.summary,
      JSON.stringify(data.tasksCompleted),
      JSON.stringify(data.tasksPending),
      JSON.stringify(data.filesModified),
      JSON.stringify(data.keyDecisions),
      data.rawCheckpoint ?? null,
    );
  }

  getLatest(projectId: string): Session | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ?
      ORDER BY ended_at DESC
      LIMIT 1
    `).get(projectId) as Record<string, unknown> | undefined;

    return row ? this.rowToSession(row) : null;
  }

  getRecent(projectId: string, limit = 10): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ?
      ORDER BY ended_at DESC
      LIMIT ?
    `).all(projectId, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToSession(r));
  }

  getById(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    return row ? this.rowToSession(row) : null;
  }

  searchFTS(query: string, projectId?: string): Session[] {
    let sql = `
      SELECT s.* FROM sessions s
      JOIN sessions_fts fts ON s.rowid = fts.rowid
      WHERE sessions_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (projectId) {
      sql += ' AND s.project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY rank LIMIT 20';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSession(r));
  }

  count(projectId?: string): number {
    if (projectId) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE project_id = ?')
        .get(projectId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM sessions')
      .get() as { cnt: number };
    return row.cnt;
  }

  getAgentsUsed(projectId: string): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT agent FROM sessions WHERE project_id = ? ORDER BY agent'
    ).all(projectId) as { agent: string }[];
    return rows.map((r) => r.agent);
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      agent: row.agent as Session['agent'],
      projectId: row.project_id as string,
      projectPath: row.project_path as string | undefined,
      startedAt: row.started_at as string | undefined,
      endedAt: row.ended_at as string,
      reason: row.reason as string | undefined,
      summary: row.summary as string,
      tasksCompleted: JSON.parse((row.tasks_completed as string) || '[]'),
      tasksPending: JSON.parse((row.tasks_pending as string) || '[]'),
      filesModified: JSON.parse((row.files_modified as string) || '[]'),
      keyDecisions: JSON.parse((row.key_decisions as string) || '[]'),
      rawCheckpoint: row.raw_checkpoint as string | undefined,
    };
  }
}
