import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { SCHEMA_SQL } from './schema.js';

const DEFAULT_DB_DIR = join(homedir(), '.agent-memory');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'memory.db');

let db: Database.Database | null = null;

export function getDbPath(customPath?: string): string {
  if (customPath) {
    // Normalize and validate custom paths
    const normalized = resolve(customPath);
    const home = homedir();
    if (!normalized.startsWith(home) && !normalized.startsWith('/tmp')) {
      throw new Error(`Database path must be within home directory or /tmp: ${normalized}`);
    }
    return normalized;
  }
  return DEFAULT_DB_PATH;
}

export function getDb(customPath?: string): Database.Database {
  if (db) return db;

  const dbPath = getDbPath(customPath);
  const dbDir = join(dbPath, '..');

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  }

  db = new Database(dbPath);

  // Secure file permissions: owner read/write only
  chmodSync(dbPath, 0o600);
  sqliteVec.load(db);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  initSchema(db);

  return db;
}

function initSchema(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    database.exec(SCHEMA_SQL);
    database.pragma('user_version = 1');
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// For testing: create an in-memory database
export function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  sqliteVec.load(testDb);
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
  testDb.pragma('user_version = 1');
  return testDb;
}
