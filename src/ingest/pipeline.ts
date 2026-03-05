import { getDb } from '../db/connection.js';
import { SessionStore } from '../db/sessions.js';
import { VectorStore } from '../db/vectors.js';
import { OnnxEmbeddingEngine } from '../embedding/engine.js';
import { chunkText } from '../embedding/chunker.js';
import type { SessionData } from '../types.js';

export interface IngestResult {
  sessionId: string;
  projectId: string;
  chunksStored: number;
}

export async function ingestSession(sessionData: SessionData): Promise<IngestResult> {
  const db = getDb();
  const sessions = new SessionStore(db);
  const vectors = new VectorStore(db);
  const engine = new OnnxEmbeddingEngine();

  // 1. Store session in database
  sessions.insert(sessionData);

  // 2. Build text to embed: summary + raw checkpoint
  const textsToEmbed: string[] = [];
  if (sessionData.summary) {
    textsToEmbed.push(sessionData.summary);
  }
  if (sessionData.rawCheckpoint) {
    textsToEmbed.push(...chunkText(sessionData.rawCheckpoint));
  }

  // If no text to embed, still count as success
  if (textsToEmbed.length === 0) {
    return { sessionId: sessionData.id, projectId: sessionData.projectId, chunksStored: 0 };
  }

  // 3. Embed and store chunks
  const embeddings = await engine.embedBatch(textsToEmbed);
  for (let i = 0; i < textsToEmbed.length; i++) {
    vectors.insertSessionChunk(sessionData.id, textsToEmbed[i], embeddings[i]);
  }

  return {
    sessionId: sessionData.id,
    projectId: sessionData.projectId,
    chunksStored: textsToEmbed.length,
  };
}
