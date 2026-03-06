import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { SessionStore } from '../db/sessions.js';
import { KnowledgeStore } from '../db/knowledge.js';
import { VectorStore } from '../db/vectors.js';
import { DASHBOARD_HTML } from './html.js';

export interface DashboardDeps {
  db: Database.Database;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function notFound(res: ServerResponse): void {
  json(res, { error: 'Not found' }, 404);
}

function parseUrl(url: string): { pathname: string; searchParams: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, searchParams: parsed.searchParams };
}

export function createRequestHandler(deps: DashboardDeps) {
  const sessions = new SessionStore(deps.db);
  const knowledge = new KnowledgeStore(deps.db);
  const vectors = new VectorStore(deps.db);

  return (req: IncomingMessage, res: ServerResponse) => {
    const { pathname, searchParams } = parseUrl(req.url ?? '/');

    // CORS: restrict to localhost only
    const origin = req.headers.origin ?? '';
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'GET' && pathname === '/') {
      return html(res, DASHBOARD_HTML);
    }

    if (req.method === 'GET' && pathname === '/api/stats') {
      const totalSessions = sessions.count();
      const totalKnowledge = knowledge.count();
      const totalChunks = vectors.sessionChunkCount();

      // Count by agent
      const agentRows = deps.db.prepare(
        'SELECT agent, COUNT(*) as cnt FROM sessions GROUP BY agent'
      ).all() as { agent: string; cnt: number }[];
      const byAgent: Record<string, number> = {};
      for (const r of agentRows) byAgent[r.agent] = r.cnt;

      return json(res, { totalSessions, totalKnowledge, totalChunks, byAgent });
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      const rows = deps.db.prepare(
        'SELECT project_id, COUNT(*) as cnt FROM sessions GROUP BY project_id ORDER BY cnt DESC'
      ).all() as { project_id: string; cnt: number }[];

      return json(res, rows.map(r => ({ projectId: r.project_id, sessionCount: r.cnt })));
    }

    if (req.method === 'GET' && pathname === '/api/knowledge') {
      const rows = deps.db.prepare(
        'SELECT * FROM knowledge ORDER BY created_at DESC'
      ).all() as Record<string, unknown>[];

      return json(res, rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        type: r.type,
        title: r.title,
        content: r.content,
        sourceAgent: r.source_agent,
        sourceSessionId: r.source_session_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })));
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      const project = searchParams.get('project');
      let sql = 'SELECT * FROM sessions';
      const params: unknown[] = [];

      if (project) {
        sql += ' WHERE project_id = ?';
        params.push(project);
      }
      sql += ' ORDER BY ended_at DESC';

      const rows = deps.db.prepare(sql).all(...params) as Record<string, unknown>[];
      return json(res, rows.map(r => ({
        id: r.id,
        agent: r.agent,
        projectId: r.project_id,
        projectPath: r.project_path,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        summary: r.summary,
      })));
    }

    // Session detail: /api/sessions/:id
    const sessionMatch = pathname.match(/^\/api\/sessions\/(.+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const session = sessions.getById(id);
      if (!session) return notFound(res);
      return json(res, session);
    }

    return notFound(res);
  };
}

export async function startDashboard(port = 3847, deps?: DashboardDeps): Promise<ReturnType<typeof createServer>> {
  let db: Database.Database;

  if (deps) {
    db = deps.db;
  } else {
    const { getDb } = await import('../db/connection.js');
    db = getDb();
  }

  const handler = createRequestHandler({ db });
  const server = createServer(handler);

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Dashboard running at http://localhost:${port}`);
      resolve(server);
    });
  });
}
