export { getDb, closeDb, createTestDb, getDbPath } from './db/connection.js';
export { SessionStore } from './db/sessions.js';
export { KnowledgeStore } from './db/knowledge.js';
export { VectorStore } from './db/vectors.js';
export { OnnxEmbeddingEngine, EMBEDDING_DIMENSIONS, validateEmbedding } from './embedding/engine.js';
export { chunkText } from './embedding/chunker.js';
export { detectProject, normalizeGitRemote } from './ingest/project-detector.js';
export type * from './types.js';
