import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/db/connection.js';

describe('Database Schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('tables', () => {
    const expectedTables = [
      'sessions',
      'session_chunk_meta',
      'knowledge',
      'session_chunks',
      'knowledge_vec',
      'sessions_fts',
    ];

    it.each(expectedTables)('table "%s" exists', (table) => {
      // Virtual tables (vec0, fts5) don't appear in sqlite_master as 'table'
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE name = ? AND type IN ('table', 'shadow')`,
        )
        .get(table) as { name: string } | undefined;

      // For virtual tables, check if we can query them
      if (!row) {
        expect(() => db.prepare(`SELECT * FROM ${table} LIMIT 0`).all()).not.toThrow();
      } else {
        expect(row.name).toBe(table);
      }
    });
  });

  describe('indexes', () => {
    const expectedIndexes = [
      'idx_sessions_project',
      'idx_sessions_agent',
      'idx_sessions_ended',
      'idx_knowledge_project',
      'idx_chunk_meta_session',
    ];

    it.each(expectedIndexes)('index "%s" exists', (index) => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
        .get(index) as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe(index);
    });
  });

  describe('triggers', () => {
    const expectedTriggers = ['sessions_ai', 'sessions_ad', 'sessions_au'];

    it.each(expectedTriggers)('trigger "%s" exists', (trigger) => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?`)
        .get(trigger) as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe(trigger);
    });
  });

  it('schema version is set to 1', () => {
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(1);
  });
});
