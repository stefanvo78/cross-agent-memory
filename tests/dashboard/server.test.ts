import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import { createRequestHandler } from '../../src/dashboard/server.js';
import type { SessionData, KnowledgeInput } from '../../src/types.js';

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

function makeKnowledge(overrides: Partial<KnowledgeInput> = {}): KnowledgeInput {
  return {
    projectId: 'user/repo',
    type: 'decision',
    title: 'Use bcrypt',
    content: 'Decided to use bcrypt for password hashing',
    sourceAgent: 'copilot',
    sourceSessionId: 'sess-1',
    ...overrides,
  };
}

/** Simulate an HTTP request against the handler and collect the response. */
function request(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  method: string,
  url: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    let status = 200;

    const req = {
      method,
      url,
      headers: {},
    } as unknown as IncomingMessage;

    const res = {
      writeHead(code: number, hdrs?: Record<string, string>) {
        status = code;
        if (hdrs) Object.assign(headers, hdrs);
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(data?: string | Buffer) {
        if (data) chunks.push(Buffer.from(data));
        resolve({ status, headers, body: Buffer.concat(chunks).toString() });
      },
      write(data: string | Buffer) {
        chunks.push(Buffer.from(data));
      },
    } as unknown as ServerResponse;

    handler(req, res);
  });
}

function requestWithOrigin(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  method: string,
  url: string,
  origin: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    let status = 200;

    const req = {
      method,
      url,
      headers: { origin },
    } as unknown as IncomingMessage;

    const res = {
      writeHead(code: number, hdrs?: Record<string, string>) {
        status = code;
        if (hdrs) Object.assign(headers, hdrs);
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(data?: string | Buffer) {
        if (data) chunks.push(Buffer.from(data));
        resolve({ status, headers, body: Buffer.concat(chunks).toString() });
      },
      write(data: string | Buffer) {
        chunks.push(Buffer.from(data));
      },
    } as unknown as ServerResponse;

    handler(req, res);
  });
}

describe('Dashboard server', () => {
  let db: Database.Database;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeEach(() => {
    db = createTestDb();
    handler = createRequestHandler({ db });
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /', () => {
    it('returns HTML page', async () => {
      const res = await request(handler, 'GET', '/');
      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toContain('text/html');
      expect(res.body).toContain('cross-agent-memory');
    });
  });

  describe('GET /api/stats', () => {
    it('returns zero counts for empty database', async () => {
      const res = await request(handler, 'GET', '/api/stats');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.totalSessions).toBe(0);
      expect(data.totalKnowledge).toBe(0);
      expect(data.totalChunks).toBe(0);
      expect(data.byAgent).toEqual({});
    });

    it('returns correct counts after inserting data', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession());
      sessions.insert(makeSession({ id: 'sess-2', agent: 'claude' }));
      const knowledge = new KnowledgeStore(db);
      knowledge.insert(makeKnowledge());

      const res = await request(handler, 'GET', '/api/stats');
      const data = JSON.parse(res.body);
      expect(data.totalSessions).toBe(2);
      expect(data.totalKnowledge).toBe(1);
      expect(data.byAgent.copilot).toBe(1);
      expect(data.byAgent.claude).toBe(1);
    });
  });

  describe('GET /api/projects', () => {
    it('returns empty array for empty database', async () => {
      const res = await request(handler, 'GET', '/api/projects');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns distinct projects with session counts', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession());
      sessions.insert(makeSession({ id: 'sess-2', projectId: 'user/repo' }));
      sessions.insert(makeSession({ id: 'sess-3', projectId: 'other/project' }));

      const res = await request(handler, 'GET', '/api/projects');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(2);
      const repo = data.find((p: { projectId: string }) => p.projectId === 'user/repo');
      expect(repo.sessionCount).toBe(2);
      const other = data.find((p: { projectId: string }) => p.projectId === 'other/project');
      expect(other.sessionCount).toBe(1);
    });
  });

  describe('GET /api/sessions', () => {
    it('returns empty array for empty database', async () => {
      const res = await request(handler, 'GET', '/api/sessions');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns sessions ordered by ended_at desc', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({ id: 'sess-old', endedAt: '2025-01-01T10:00:00' }));
      sessions.insert(makeSession({ id: 'sess-new', endedAt: '2025-01-02T10:00:00' }));

      const res = await request(handler, 'GET', '/api/sessions');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('sess-new');
      expect(data[1].id).toBe('sess-old');
    });

    it('filters sessions by project', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({ id: 'sess-a', projectId: 'proj-a' }));
      sessions.insert(makeSession({ id: 'sess-b', projectId: 'proj-b' }));

      const res = await request(handler, 'GET', '/api/sessions?project=proj-a');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('sess-a');
      expect(data[0].projectId).toBe('proj-a');
    });

    it('returns all sessions when no project filter', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({ id: 'sess-a', projectId: 'proj-a' }));
      sessions.insert(makeSession({ id: 'sess-b', projectId: 'proj-b' }));

      const res = await request(handler, 'GET', '/api/sessions');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(2);
    });

    it('includes summary in session list', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({ summary: 'Refactored the auth module' }));

      const res = await request(handler, 'GET', '/api/sessions');
      const data = JSON.parse(res.body);
      expect(data[0].summary).toBe('Refactored the auth module');
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(handler, 'GET', '/api/sessions/nonexistent');
      expect(res.status).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error).toBe('Not found');
    });

    it('returns session detail with all fields', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({
        id: 'sess-detail',
        rawCheckpoint: 'raw data here',
      }));

      const res = await request(handler, 'GET', '/api/sessions/sess-detail');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe('sess-detail');
      expect(data.agent).toBe('copilot');
      expect(data.summary).toBe('Added authentication module');
      expect(data.filesModified).toEqual(['src/auth.ts']);
      expect(data.keyDecisions).toEqual(['Use bcrypt for hashing']);
      expect(data.tasksCompleted).toEqual(['Implement JWT auth']);
      expect(data.tasksPending).toEqual(['Add refresh tokens']);
      expect(data.rawCheckpoint).toBe('raw data here');
    });

    it('handles URL-encoded session IDs', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession({ id: 'sess/special' }));

      const res = await request(handler, 'GET', '/api/sessions/sess%2Fspecial');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe('sess/special');
    });
  });

  describe('GET /api/knowledge', () => {
    it('returns empty array for empty database', async () => {
      const res = await request(handler, 'GET', '/api/knowledge');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns knowledge entries with correct fields', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession());
      const knowledge = new KnowledgeStore(db);
      knowledge.insert(makeKnowledge());

      const res = await request(handler, 'GET', '/api/knowledge');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Use bcrypt');
      expect(data[0].type).toBe('decision');
      expect(data[0].projectId).toBe('user/repo');
      expect(data[0].sourceAgent).toBe('copilot');
    });

    it('returns multiple knowledge entries ordered by created_at desc', async () => {
      const sessions = new SessionStore(db);
      sessions.insert(makeSession());
      const knowledge = new KnowledgeStore(db);
      knowledge.insert(makeKnowledge({ title: 'First' }));
      knowledge.insert(makeKnowledge({ title: 'Second' }));

      const res = await request(handler, 'GET', '/api/knowledge');
      const data = JSON.parse(res.body);
      expect(data).toHaveLength(2);
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown paths', async () => {
      const res = await request(handler, 'GET', '/unknown');
      expect(res.status).toBe(404);
    });

    it('returns 404 for POST requests', async () => {
      const res = await request(handler, 'POST', '/api/sessions');
      expect(res.status).toBe(404);
    });
  });

  describe('CORS headers', () => {
    it('does not set CORS header when no origin is sent', async () => {
      const res = await request(handler, 'GET', '/api/stats');
      expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('sets CORS header for localhost origin', async () => {
      const res = await requestWithOrigin(handler, 'GET', '/api/stats', 'http://localhost:3847');
      expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3847');
    });

    it('rejects CORS for non-localhost origin', async () => {
      const res = await requestWithOrigin(handler, 'GET', '/api/stats', 'https://evil.com');
      expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });
});
