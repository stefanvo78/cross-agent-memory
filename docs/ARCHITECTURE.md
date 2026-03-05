# Architecture

## System Overview

```
                         SESSION END (Stop Hooks)
                        ┌──────────────────────────────────────────┐
                        │                                          │
┌─────────────┐   sessionEnd    ┌──────────────┐   SessionEnd     │
│  Copilot CLI │──────hook──────►│              │◄─────hook────────│
│              │                 │   Ingest     │                  │
└─────────────┘                 │   Engine     │    ┌─────────────┤
                                │              │    │ Claude Code  │
                                │  1. Parse    │    │              │
                                │  2. Summarize│    └──────────────┘
                                │  3. Embed    │
                                │  4. Store    │
                                └──────┬───────┘
                                       │
                                       ▼
                         ┌─────────────────────────────┐
                         │  ~/.agent-memory/memory.db   │
                         │  (SQLite + sqlite-vec)       │
                         │                              │
                         │  sessions          (meta)    │
                         │  session_chunks    (vectors) │
                         │  knowledge         (facts)   │
                         │  knowledge_vec     (vectors) │
                         │  sessions_fts      (FTS5)    │
                         └──────────────┬──────────────┘
                                        │
                         SESSION START (MCP Query)
                                        │
                         ┌──────────────▼──────────────┐
                         │     MCP Server               │
                         │                              │
                         │  • get_handoff()             │
                         │  • search_memory()           │
                         │  • store_knowledge()         │
                         │  • get_project_context()     │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         │                              │
                   ┌─────▼──────┐              ┌───────▼─────┐
                   │ Copilot CLI │              │ Claude Code  │
                   │ (MCP client)│              │ (MCP client) │
                   └─────────────┘              └──────────────┘
```

## Components

### 1. Database Layer (`src/db/`)

Single SQLite file at `~/.agent-memory/memory.db` with sqlite-vec extension.

**Schema:**

```sql
-- Core session tracking
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- UUID
  agent TEXT NOT NULL,                -- 'copilot' | 'claude' | 'gemini'
  project_id TEXT NOT NULL,           -- normalized git remote: 'user/repo'
  project_path TEXT,                  -- local filesystem path
  started_at TEXT,                    -- ISO 8601
  ended_at TEXT DEFAULT (datetime('now')),
  reason TEXT,                        -- 'complete' | 'error' | 'user_exit'
  summary TEXT,                       -- plain text session summary
  tasks_completed TEXT,               -- JSON array
  tasks_pending TEXT,                 -- JSON array
  files_modified TEXT,                -- JSON array
  key_decisions TEXT,                 -- JSON array
  raw_checkpoint TEXT                 -- full native checkpoint text
);

-- Vector embeddings for semantic search across session chunks
CREATE VIRTUAL TABLE session_chunks USING vec0(
  embedding float[384]                -- all-MiniLM-L6-v2 = 384 dims
);

-- Metadata for session chunks (vec0 only stores vectors)
CREATE TABLE session_chunk_meta (
  id INTEGER PRIMARY KEY,             -- matches rowid in session_chunks
  session_id TEXT NOT NULL REFERENCES sessions(id),
  chunk_text TEXT NOT NULL
);

-- Persistent knowledge (survives across sessions)
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- 'decision' | 'gotcha' | 'pattern' | 'architecture'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_agent TEXT,
  source_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Vector index for knowledge
CREATE VIRTUAL TABLE knowledge_vec USING vec0(
  embedding float[384]
);

-- Full-text search index for keyword search
CREATE VIRTUAL TABLE sessions_fts USING fts5(
  summary, tasks_completed, tasks_pending, key_decisions,
  content='sessions', content_rowid='rowid'
);

-- Indexes
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_agent ON sessions(agent);
CREATE INDEX idx_sessions_ended ON sessions(ended_at);
CREATE INDEX idx_knowledge_project ON knowledge(project_id);
CREATE INDEX idx_chunk_meta_session ON session_chunk_meta(session_id);
```

### 2. Embedding Engine (`src/embedding/`)

Local-first embedding using ONNX Runtime:

- **Model:** `all-MiniLM-L6-v2` (384 dimensions, ~23MB)
- **Runtime:** `@xenova/transformers` (ONNX in Node.js)
- **Performance:** ~50ms per embedding on modern hardware
- **Chunking:** Session summaries are split into ~500 token chunks before embedding

```typescript
interface EmbeddingEngine {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}
```

### 3. Ingest Engine (`src/ingest/`)

Agent-specific parsers that read native session state and produce a unified format.

```typescript
interface SessionData {
  id: string;
  agent: 'copilot' | 'claude';
  projectId: string;
  projectPath: string;
  startedAt?: string;
  endedAt: string;
  reason?: string;
  summary: string;
  tasksCompleted: string[];
  tasksPending: string[];
  filesModified: string[];
  keyDecisions: string[];
  rawCheckpoint?: string;
}

interface AgentIngester {
  name: string;
  parseLatestSession(cwd: string): Promise<SessionData>;
}
```

#### Copilot CLI Ingester (`src/ingest/copilot.ts`)

Reads from `~/.copilot/session-state/{uuid}/`:
- `workspace.yaml` → session metadata (id, cwd, summary, timestamps)
- `checkpoints/*.md` → structured state (overview, work_done, next_steps, important_files)
- `events.jsonl` → file operations, tool calls (for files_modified)

#### Claude Code Ingester (`src/ingest/claude.ts`)

Reads from `~/.claude/projects/{encoded-path}/`:
- `{session-id}.jsonl` → conversation transcript (for summary extraction)
- `memory/MEMORY.md` → persistent project knowledge
- Session metadata from `~/.claude/history.jsonl`

### 4. MCP Server (`src/mcp/`)

Standard MCP server using `@modelcontextprotocol/sdk`:

| Tool | Input | Output |
|------|-------|--------|
| `get_handoff` | `{ project_id? }` | Last session summary, pending tasks, decisions, suggested prompt |
| `search_memory` | `{ query, project_id?, limit? }` | Ranked results with similarity scores |
| `store_knowledge` | `{ type, title, content, project_id }` | Confirmation |
| `get_project_context` | `{ project_id }` | Full overview: knowledge + recent sessions |

### 5. CLI (`src/cli/`)

```bash
cross-agent-memory setup          # Install hooks for Copilot + Claude
cross-agent-memory ingest copilot # Manually trigger Copilot ingest
cross-agent-memory ingest claude  # Manually trigger Claude ingest
cross-agent-memory serve          # Start MCP server
cross-agent-memory status         # Show DB stats
cross-agent-memory search <query> # Search from terminal
```

## Data Flow

### Session End → Ingest

```
1. Agent session ends
2. Stop hook fires (sessionEnd / SessionEnd)
3. Hook executes: `cross-agent-memory ingest <agent>`
4. Ingester reads agent's native session state files
5. Produces unified SessionData
6. Embedding engine generates vectors for summary chunks
7. Database layer stores session + chunks + updates FTS index
```

### Session Start → Handoff

```
1. New agent session starts
2. Agent connects to MCP server (already running or auto-started)
3. Agent calls get_handoff({ project_id })
4. MCP server queries DB for latest session on this project
5. Returns structured handoff with summary, tasks, decisions
6. Agent uses this context to continue work seamlessly
```

## Project Identification

Projects are identified by normalized git remote URL:
- `https://github.com/user/repo.git` → `user/repo`
- `git@github.com:user/repo.git` → `user/repo`
- Non-git projects fall back to `local/<dirname>`

## Security Considerations

- All data stored locally in user's home directory
- No network calls for core functionality (local ONNX embeddings)
- SQLite file permissions: `0600` (owner read/write only)
- No credentials or API keys stored in the DB
- Session data may contain code snippets — treat DB as sensitive
