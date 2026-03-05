import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import type { SessionData } from '../../src/types.js';

function makeSampleSession(overrides?: Partial<SessionData>): SessionData {
  return {
    id: 'test-session-001',
    agent: 'copilot',
    projectId: 'test-org/test-repo',
    projectPath: '/Users/test/project',
    startedAt: '2025-01-15T10:00:00.000Z',
    endedAt: '2025-01-15T12:30:00.000Z',
    summary: 'Implemented auth module with JWT',
    tasksCompleted: ['Created auth middleware', 'Added login endpoint'],
    tasksPending: ['Add logout endpoint'],
    filesModified: ['src/auth/middleware.ts', 'src/auth/login.ts'],
    keyDecisions: ['Chose JWT over session-based auth'],
    rawCheckpoint: '<overview>Implemented auth</overview>',
    ...overrides,
  };
}

describe('ingest pipeline — session storage', () => {
  let db: Database.Database;
  let sessions: SessionStore;

  beforeEach(() => {
    db = createTestDb();
    sessions = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('stores a session in the database', () => {
    const data = makeSampleSession();
    sessions.insert(data);

    const stored = sessions.getById(data.id);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(data.id);
    expect(stored!.agent).toBe('copilot');
    expect(stored!.summary).toBe('Implemented auth module with JWT');
    expect(stored!.projectId).toBe('test-org/test-repo');
  });

  it('stores and retrieves arrays correctly', () => {
    const data = makeSampleSession();
    sessions.insert(data);

    const stored = sessions.getById(data.id)!;
    expect(stored.tasksCompleted).toEqual(['Created auth middleware', 'Added login endpoint']);
    expect(stored.tasksPending).toEqual(['Add logout endpoint']);
    expect(stored.filesModified).toEqual(['src/auth/middleware.ts', 'src/auth/login.ts']);
    expect(stored.keyDecisions).toEqual(['Chose JWT over session-based auth']);
  });

  it('retrieves the latest session by project', () => {
    sessions.insert(makeSampleSession({
      id: 'old-session',
      endedAt: '2025-01-14T10:00:00.000Z',
      summary: 'Old session',
    }));
    sessions.insert(makeSampleSession({
      id: 'new-session',
      endedAt: '2025-01-16T10:00:00.000Z',
      summary: 'New session',
    }));

    const latest = sessions.getLatest('test-org/test-repo');
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe('new-session');
    expect(latest!.summary).toBe('New session');
  });

  it('handles session with empty arrays', () => {
    const data = makeSampleSession({
      id: 'empty-arrays',
      tasksCompleted: [],
      tasksPending: [],
      filesModified: [],
      keyDecisions: [],
    });
    sessions.insert(data);

    const stored = sessions.getById('empty-arrays')!;
    expect(stored.tasksCompleted).toEqual([]);
    expect(stored.tasksPending).toEqual([]);
    expect(stored.filesModified).toEqual([]);
    expect(stored.keyDecisions).toEqual([]);
  });

  it('upserts a session with same id (INSERT OR REPLACE)', () => {
    sessions.insert(makeSampleSession({ summary: 'Version 1' }));
    sessions.insert(makeSampleSession({ summary: 'Version 2' }));

    const stored = sessions.getById('test-session-001')!;
    expect(stored.summary).toBe('Version 2');

    const count = sessions.count('test-org/test-repo');
    expect(count).toBe(1);
  });

  it('stores rawCheckpoint', () => {
    const data = makeSampleSession({
      rawCheckpoint: '<overview>Full checkpoint text here</overview>',
    });
    sessions.insert(data);

    const stored = sessions.getById(data.id)!;
    expect(stored.rawCheckpoint).toBe('<overview>Full checkpoint text here</overview>');
  });

  it('handles session with no rawCheckpoint', () => {
    const data = makeSampleSession({ rawCheckpoint: undefined });
    sessions.insert(data);

    const stored = sessions.getById(data.id)!;
    expect(stored.rawCheckpoint).toBeFalsy();
  });
});
