import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import { importFromRepo } from '../../src/sync/importer.js';
import type { ExportedSession } from '../../src/sync/exporter.js';

function makeExportedSession(overrides: Partial<ExportedSession> = {}): ExportedSession {
  return {
    id: 'sess-import-1',
    agent: 'claude',
    endedAt: '2025-01-15T14:00:00',
    author: 'Test User',
    summary: 'Refactored database layer',
    tasksCompleted: ['Migrate to Postgres'],
    tasksPending: ['Add indexes'],
    filesModified: ['src/db.ts'],
    keyDecisions: ['Use connection pooling'],
    ...overrides,
  };
}

describe('Importer', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'cam-import-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns zeros when .agent-memory/ does not exist', () => {
    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(0);
    expect(result.knowledgeImported).toBe(0);
  });

  it('imports sessions from .agent-memory/sessions/', () => {
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const exported = makeExportedSession();
    writeFileSync(join(sessionsDir, '2025-01-15T14-00-00-claude-sess-imp.json'), JSON.stringify(exported));

    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(1);

    const store = new SessionStore(db);
    const session = store.getById('sess-import-1');
    expect(session).not.toBeNull();
    expect(session!.agent).toBe('claude');
    expect(session!.summary).toBe('Refactored database layer');
  });

  it('skips sessions that already exist in DB', () => {
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const exported = makeExportedSession();
    writeFileSync(join(sessionsDir, 'session.json'), JSON.stringify(exported));

    // Insert into DB first
    const store = new SessionStore(db);
    store.insert({
      id: 'sess-import-1',
      agent: 'claude',
      projectId: 'local/test',
      endedAt: '2025-01-15T14:00:00',
      summary: 'Already here',
      tasksCompleted: [],
      tasksPending: [],
      filesModified: [],
      keyDecisions: [],
    });

    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(0);
  });

  it('imports multiple sessions', () => {
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(join(sessionsDir, 'a.json'), JSON.stringify(makeExportedSession({ id: 'sess-a' })));
    writeFileSync(join(sessionsDir, 'b.json'), JSON.stringify(makeExportedSession({ id: 'sess-b' })));

    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(2);
  });

  it('imports knowledge entries', () => {
    const knowledgeDir = join(tmpDir, '.agent-memory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    const entries = [
      { type: 'decision', title: 'Use REST', content: 'REST over GraphQL', sourceAgent: 'copilot', createdAt: '2025-01-15' },
    ];
    writeFileSync(join(knowledgeDir, 'entries.json'), JSON.stringify(entries));

    const result = importFromRepo(db, tmpDir);
    expect(result.knowledgeImported).toBe(1);

    const projectId = `local/${tmpDir.split('/').pop()}`;
    const kStore = new KnowledgeStore(db);
    const imported = kStore.getByProject(projectId);
    expect(imported.length).toBe(1);
    expect(imported[0].title).toBe('Use REST');
  });

  it('deduplicates knowledge entries', () => {
    const knowledgeDir = join(tmpDir, '.agent-memory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    const entries = [
      { type: 'decision', title: 'Use REST', content: 'REST over GraphQL', sourceAgent: 'copilot' },
    ];
    writeFileSync(join(knowledgeDir, 'entries.json'), JSON.stringify(entries));

    importFromRepo(db, tmpDir);
    const result2 = importFromRepo(db, tmpDir);
    expect(result2.knowledgeImported).toBe(0);
  });

  it('handles corrupt session JSON gracefully', () => {
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(join(sessionsDir, 'corrupt.json'), 'NOT VALID JSON{{{');
    writeFileSync(join(sessionsDir, 'valid.json'), JSON.stringify(makeExportedSession({ id: 'valid-1' })));

    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(1);
  });

  it('handles corrupt knowledge JSON gracefully', () => {
    const knowledgeDir = join(tmpDir, '.agent-memory', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    writeFileSync(join(knowledgeDir, 'entries.json'), 'NOT VALID JSON');

    const result = importFromRepo(db, tmpDir);
    expect(result.knowledgeImported).toBe(0);
  });

  it('ignores non-JSON files in sessions directory', () => {
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(join(sessionsDir, 'readme.txt'), 'not a session');
    writeFileSync(join(sessionsDir, 'valid.json'), JSON.stringify(makeExportedSession()));

    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(1);
  });

  it('handles missing sessions directory', () => {
    mkdirSync(join(tmpDir, '.agent-memory'), { recursive: true });
    const result = importFromRepo(db, tmpDir);
    expect(result.sessionsImported).toBe(0);
    expect(result.knowledgeImported).toBe(0);
  });
});
