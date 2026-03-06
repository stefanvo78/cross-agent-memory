import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';
import { SessionStore } from '../../src/db/sessions.js';
import { KnowledgeStore } from '../../src/db/knowledge.js';
import { exportToRepo, loadSyncConfig, getAgentMemoryDir } from '../../src/sync/exporter.js';
import type { SessionData } from '../../src/types.js';

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'sess-1',
    agent: 'copilot',
    projectId: 'local/test-project',
    projectPath: '/tmp/test-project',
    endedAt: '2025-01-15T10:00:00',
    summary: 'Implemented authentication',
    tasksCompleted: ['Add JWT auth'],
    tasksPending: ['Add refresh tokens'],
    filesModified: ['src/auth.ts'],
    keyDecisions: ['Use bcrypt'],
    ...overrides,
  };
}

describe('Exporter', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'cam-export-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates correct directory structure', () => {
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId: `local/${tmpDir.split('/').pop()}` }));

    exportToRepo(db, tmpDir);

    expect(existsSync(join(tmpDir, '.agent-memory'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agent-memory', 'sessions'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agent-memory', 'knowledge'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agent-memory', 'config.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.agent-memory', 'HANDOFF.md'))).toBe(true);
  });

  it('exports sessions as JSON files', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId }));

    exportToRepo(db, tmpDir);

    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);

    const data = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'));
    expect(data.id).toBe('sess-1');
    expect(data.agent).toBe('copilot');
    expect(data.summary).toBe('Implemented authentication');
  });

  it('exported sessions do not contain rawCheckpoint', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId, rawCheckpoint: 'SECRET_DATA' }));

    exportToRepo(db, tmpDir);

    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const data = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'));
    expect(data.rawCheckpoint).toBeUndefined();
  });

  it('skips sessions for excluded agents', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId, id: 's1', agent: 'copilot' }));
    store.insert(makeSession({ projectId, id: 's2', agent: 'claude' }));

    // Write config that excludes claude
    const dir = getAgentMemoryDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      version: 1, maxSessions: 20, includeKnowledge: true, excludeAgents: ['claude'],
    }));

    const result = exportToRepo(db, tmpDir);
    expect(result.sessionsExported).toBe(1);
  });

  it('respects maxSessions limit', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    for (let i = 0; i < 5; i++) {
      store.insert(makeSession({
        projectId,
        id: `sess-${i}`,
        endedAt: `2025-01-1${i}T10:00:00`,
      }));
    }

    const dir = getAgentMemoryDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      version: 1, maxSessions: 3, includeKnowledge: true, excludeAgents: [],
    }));

    exportToRepo(db, tmpDir);

    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(3);
  });

  it('deduplicates — does not re-export same session', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId }));

    const result1 = exportToRepo(db, tmpDir);
    expect(result1.sessionsExported).toBe(1);

    const result2 = exportToRepo(db, tmpDir);
    expect(result2.sessionsExported).toBe(0);
  });

  it('prunes oldest sessions beyond maxSessions', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    for (let i = 0; i < 5; i++) {
      store.insert(makeSession({
        projectId,
        id: `sess-${i}`,
        endedAt: `2025-01-1${i}T10:00:00`,
      }));
    }

    // First export all 5
    exportToRepo(db, tmpDir);
    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    expect(readdirSync(sessionsDir).filter(f => f.endsWith('.json')).length).toBe(5);

    // Now set maxSessions to 3 and re-export
    writeFileSync(join(tmpDir, '.agent-memory', 'config.json'), JSON.stringify({
      version: 1, maxSessions: 3, includeKnowledge: true, excludeAgents: [],
    }));
    exportToRepo(db, tmpDir);
    expect(readdirSync(sessionsDir).filter(f => f.endsWith('.json')).length).toBe(3);
  });

  it('creates config file if missing', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId }));

    exportToRepo(db, tmpDir);

    const configPath = join(tmpDir, '.agent-memory', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(1);
    expect(config.maxSessions).toBe(20);
  });

  it('loads and respects existing config', () => {
    const config = loadSyncConfig(tmpDir);
    expect(config.version).toBe(1);
    expect(config.maxSessions).toBe(20);

    const dir = getAgentMemoryDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ maxSessions: 5 }));

    const loaded = loadSyncConfig(tmpDir);
    expect(loaded.maxSessions).toBe(5);
    expect(loaded.includeKnowledge).toBe(true); // default preserved
  });

  it('exports knowledge entries', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const kStore = new KnowledgeStore(db);
    kStore.insert({ projectId, type: 'decision', title: 'Use REST', content: 'REST over GraphQL', sourceAgent: 'copilot' });

    const sStore = new SessionStore(db);
    sStore.insert(makeSession({ projectId }));

    const result = exportToRepo(db, tmpDir);
    expect(result.knowledgeExported).toBe(1);

    const entriesPath = join(tmpDir, '.agent-memory', 'knowledge', 'entries.json');
    const entries = JSON.parse(readFileSync(entriesPath, 'utf-8'));
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe('Use REST');
  });

  it('skips knowledge export when disabled in config', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const kStore = new KnowledgeStore(db);
    kStore.insert({ projectId, type: 'decision', title: 'Test', content: 'Content' });

    const sStore = new SessionStore(db);
    sStore.insert(makeSession({ projectId }));

    const dir = getAgentMemoryDir(tmpDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ includeKnowledge: false }));

    const result = exportToRepo(db, tmpDir);
    expect(result.knowledgeExported).toBe(0);
  });

  it('session filenames sort chronologically', () => {
    const projectId = `local/${tmpDir.split('/').pop()}`;
    const store = new SessionStore(db);
    store.insert(makeSession({ projectId, id: 'aaa-111', endedAt: '2025-01-10T10:00:00' }));
    store.insert(makeSession({ projectId, id: 'bbb-222', endedAt: '2025-01-15T10:00:00' }));

    exportToRepo(db, tmpDir);

    const sessionsDir = join(tmpDir, '.agent-memory', 'sessions');
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json')).sort();
    expect(files[0]).toContain('2025-01-10');
    expect(files[1]).toContain('2025-01-15');
  });

  it('handles empty database gracefully', () => {
    const result = exportToRepo(db, tmpDir);
    expect(result.sessionsExported).toBe(0);
    expect(result.knowledgeExported).toBe(0);
    expect(existsSync(join(tmpDir, '.agent-memory', 'HANDOFF.md'))).toBe(true);
  });
});
