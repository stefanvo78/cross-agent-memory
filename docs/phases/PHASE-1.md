# Phase 1: Foundation

> Branch: `feat/foundation`

## Goal

Build the core database layer, embedding engine, and shared types. Everything that Phase 2–4 depend on.

## Deliverables

### 1. Database Layer (`src/db/`)

- **`connection.ts`** — Open/create SQLite database at `~/.agent-memory/memory.db`, load sqlite-vec extension, run migrations
- **`schema.ts`** — All CREATE TABLE/INDEX statements, schema version tracking
- **`sessions.ts`** — CRUD for sessions table + FTS5 sync:
  - `insertSession(data: SessionData): Promise<void>`
  - `getLatestSession(projectId: string): Promise<Session | null>`
  - `getRecentSessions(projectId: string, limit: number): Promise<Session[]>`
  - `searchSessionsFTS(query: string, projectId?: string): Promise<Session[]>`
- **`knowledge.ts`** — CRUD for knowledge table:
  - `insertKnowledge(data: KnowledgeInput): Promise<number>`
  - `getKnowledge(projectId: string): Promise<Knowledge[]>`
  - `searchKnowledge(query: string, projectId?: string): Promise<Knowledge[]>`

### 2. Embedding Engine (`src/embedding/`)

- **`engine.ts`** — Local ONNX embedding using `@xenova/transformers`:
  - `embed(text: string): Promise<Float32Array>`
  - `embedBatch(texts: string[]): Promise<Float32Array[]>`
  - Auto-downloads model on first use
  - Lazy initialization (don't load model until first embed call)
- **`chunker.ts`** — Split text into ~500 token chunks with overlap:
  - `chunkText(text: string, maxTokens?: number): string[]`

### 3. Vector Operations (`src/db/vectors.ts`)

- Insert session chunk embeddings into `session_chunks` vec0 table
- Insert knowledge embeddings into `knowledge_vec` vec0 table
- KNN search: `searchSimilar(embedding: Float32Array, limit: number)`
- Combined search: vector similarity + FTS5 keyword ranking

### 4. Shared Types (`src/types.ts`)

```typescript
export interface SessionData {
  id: string;
  agent: 'copilot' | 'claude' | 'gemini' | 'chatgpt';
  projectId: string;
  projectPath?: string;
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

export interface Knowledge {
  id: number;
  projectId: string;
  type: 'decision' | 'gotcha' | 'pattern' | 'architecture';
  title: string;
  content: string;
  sourceAgent?: string;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt?: string;
}
```

### 5. Project Detector (`src/ingest/project-detector.ts`)

- Detect project from git remote URL
- Normalize to `user/repo` format
- Fallback to `local/<dirname>` for non-git projects

### 6. Project Scaffold

- `package.json` with dependencies
- `tsconfig.json` (strict mode, ESM output)
- `tsup.config.ts` (build config)
- `vitest.config.ts` (test config)
- `.gitignore`
- `.eslintrc` or `eslint.config.js`

## Tests

- Database: schema creation, session CRUD, knowledge CRUD, FTS5 search
- Embedding: embed produces 384-dim Float32Array, chunker splits correctly
- Vectors: KNN search returns results sorted by similarity
- Project detector: normalizes git URLs correctly

## Acceptance Criteria

- [ ] `memory.db` created at `~/.agent-memory/` with correct schema
- [ ] Can insert a session and retrieve it by project_id
- [ ] Can embed text and store/search vectors
- [ ] FTS5 keyword search works
- [ ] All tests pass
- [ ] Zero external API calls needed
