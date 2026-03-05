export const SCHEMA_SQL = `
-- Core session tracking
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_path TEXT,
  started_at TEXT,
  ended_at TEXT DEFAULT (datetime('now')),
  reason TEXT,
  summary TEXT,
  tasks_completed TEXT,
  tasks_pending TEXT,
  files_modified TEXT,
  key_decisions TEXT,
  raw_checkpoint TEXT
);

-- Metadata for session chunks (vec0 only stores vectors + rowid)
CREATE TABLE IF NOT EXISTS session_chunk_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL
);

-- Persistent knowledge
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_agent TEXT,
  source_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project_id);
CREATE INDEX IF NOT EXISTS idx_chunk_meta_session ON session_chunk_meta(session_id);

-- Vector tables (sqlite-vec virtual tables)
CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks USING vec0(
  embedding float[384]
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
  embedding float[384]
);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  summary, tasks_completed, tasks_pending, key_decisions,
  content='sessions', content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(rowid, summary, tasks_completed, tasks_pending, key_decisions)
  VALUES (NEW.rowid, NEW.summary, NEW.tasks_completed, NEW.tasks_pending, NEW.key_decisions);
END;

CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, summary, tasks_completed, tasks_pending, key_decisions)
  VALUES ('delete', OLD.rowid, OLD.summary, OLD.tasks_completed, OLD.tasks_pending, OLD.key_decisions);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, summary, tasks_completed, tasks_pending, key_decisions)
  VALUES ('delete', OLD.rowid, OLD.summary, OLD.tasks_completed, OLD.tasks_pending, OLD.key_decisions);
  INSERT INTO sessions_fts(rowid, summary, tasks_completed, tasks_pending, key_decisions)
  VALUES (NEW.rowid, NEW.summary, NEW.tasks_completed, NEW.tasks_pending, NEW.key_decisions);
END;
`;
