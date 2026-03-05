import type Database from 'better-sqlite3';
import { SessionStore } from '../db/sessions.js';
import { KnowledgeStore } from '../db/knowledge.js';
import { VectorStore } from '../db/vectors.js';
import { detectProject } from '../ingest/project-detector.js';
import type {
  HandoffContext,
  SearchResult,
  KnowledgeType,
  EmbeddingEngine,
} from '../types.js';

const VALID_KNOWLEDGE_TYPES: KnowledgeType[] = ['decision', 'gotcha', 'pattern', 'architecture'];

export interface ToolDependencies {
  db: Database.Database;
  embeddingEngine?: EmbeddingEngine;
  defaultProjectId?: string;
}

function resolveProjectId(deps: ToolDependencies, providedId?: string): string {
  if (providedId) return providedId;
  if (deps.defaultProjectId) return deps.defaultProjectId;
  return detectProject().id;
}

export async function getHandoff(
  deps: ToolDependencies,
  input: { project_id?: string },
): Promise<HandoffContext> {
  const projectId = resolveProjectId(deps, input.project_id);
  const sessions = new SessionStore(deps.db);
  const knowledge = new KnowledgeStore(deps.db);

  const lastSession = sessions.getLatest(projectId);
  const recentKnowledge = knowledge.getByProject(projectId);

  if (!lastSession) {
    return {
      hasPreviousSession: false,
      recentKnowledge: recentKnowledge.slice(0, 10),
      suggestedPrompt: recentKnowledge.length > 0
        ? `This project has ${recentKnowledge.length} knowledge entries. No previous sessions found.`
        : 'No previous sessions or knowledge found for this project.',
    };
  }

  const pendingStr = lastSession.tasksPending.length > 0
    ? `Remaining tasks: ${lastSession.tasksPending.join(', ')}.`
    : '';
  const decisionsStr = lastSession.keyDecisions.length > 0
    ? `Key decisions: ${lastSession.keyDecisions.join(', ')}.`
    : '';

  const suggestedPrompt = [
    `Continue working on this project.`,
    `The last session (${lastSession.agent}) completed: ${lastSession.summary}.`,
    pendingStr,
    decisionsStr,
  ].filter(Boolean).join(' ');

  return {
    hasPreviousSession: true,
    lastSession: {
      agent: lastSession.agent,
      endedAt: lastSession.endedAt,
      summary: lastSession.summary,
      tasksCompleted: lastSession.tasksCompleted,
      tasksPending: lastSession.tasksPending,
      filesModified: lastSession.filesModified,
      keyDecisions: lastSession.keyDecisions,
    },
    recentKnowledge: recentKnowledge.slice(0, 10),
    suggestedPrompt,
  };
}

export async function searchMemory(
  deps: ToolDependencies,
  input: { query: string; project_id?: string; limit?: number },
): Promise<{ results: SearchResult[] }> {
  const projectId = resolveProjectId(deps, input.project_id);
  const limit = input.limit ?? 10;
  const sessions = new SessionStore(deps.db);

  const resultMap = new Map<string, SearchResult>();

  // FTS5 keyword search
  try {
    const ftsResults = sessions.searchFTS(input.query, projectId);
    for (const session of ftsResults) {
      const key = `fts-${session.id}`;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          sessionId: session.id,
          agent: session.agent,
          chunkText: session.summary,
          similarityScore: 0.5, // Default score for keyword matches
          timestamp: session.endedAt,
        });
      }
    }
  } catch {
    // FTS may fail on malformed queries; continue with vector search
  }

  // Vector similarity search (if embedding engine available)
  if (deps.embeddingEngine) {
    try {
      const vectors = new VectorStore(deps.db);
      const queryEmbedding = await deps.embeddingEngine.embed(input.query);
      const vectorResults = vectors.searchSessions(queryEmbedding, limit, projectId);
      for (const result of vectorResults) {
        const existing = resultMap.get(`fts-${result.sessionId}`);
        if (existing) {
          // Boost score if found in both FTS and vector search
          existing.similarityScore = Math.max(existing.similarityScore, result.similarityScore);
        } else {
          resultMap.set(`vec-${result.sessionId}-${result.chunkText.slice(0, 20)}`, result);
        }
      }
    } catch {
      // Vector search may fail if no vectors stored; continue with FTS results
    }
  }

  const results = Array.from(resultMap.values())
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, limit);

  return { results };
}

export async function storeKnowledge(
  deps: ToolDependencies,
  input: { type: string; title: string; content: string; project_id?: string },
): Promise<{ id: number; stored: boolean }> {
  if (!VALID_KNOWLEDGE_TYPES.includes(input.type as KnowledgeType)) {
    throw new Error(
      `Invalid knowledge type: "${input.type}". Must be one of: ${VALID_KNOWLEDGE_TYPES.join(', ')}`,
    );
  }

  const projectId = resolveProjectId(deps, input.project_id);
  const knowledge = new KnowledgeStore(deps.db);

  const id = knowledge.insert({
    projectId,
    type: input.type as KnowledgeType,
    title: input.title,
    content: input.content,
  });

  // Optionally embed and store vector
  if (deps.embeddingEngine) {
    try {
      const vectors = new VectorStore(deps.db);
      const embedding = await deps.embeddingEngine.embed(`${input.title}\n${input.content}`);
      vectors.insertKnowledgeVector(id, embedding);
    } catch {
      // Embedding failure is non-fatal
    }
  }

  return { id, stored: true };
}

export async function getProjectContext(
  deps: ToolDependencies,
  input: { project_id: string },
): Promise<{
  project_id: string;
  total_sessions: number;
  agents_used: string[];
  recent_sessions: Array<{
    id: string;
    agent: string;
    ended_at: string;
    summary: string;
  }>;
  knowledge: Array<{
    id: number;
    type: string;
    title: string;
    content: string;
  }>;
  files_frequently_modified: Array<{ path: string; count: number }>;
}> {
  const projectId = input.project_id;
  const sessionStore = new SessionStore(deps.db);
  const knowledgeStore = new KnowledgeStore(deps.db);

  const totalSessions = sessionStore.count(projectId);
  const agentsUsed = sessionStore.getAgentsUsed(projectId);
  const recentSessions = sessionStore.getRecent(projectId, 5);
  const knowledgeEntries = knowledgeStore.getByProject(projectId);

  // Compute frequently modified files across all recent sessions
  const fileCounts = new Map<string, number>();
  const allSessions = sessionStore.getRecent(projectId, 50);
  for (const session of allSessions) {
    for (const file of session.filesModified) {
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
  }
  const filesFrequentlyModified = Array.from(fileCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    project_id: projectId,
    total_sessions: totalSessions,
    agents_used: agentsUsed,
    recent_sessions: recentSessions.map((s) => ({
      id: s.id,
      agent: s.agent,
      ended_at: s.endedAt,
      summary: s.summary,
    })),
    knowledge: knowledgeEntries.map((k) => ({
      id: k.id,
      type: k.type,
      title: k.title,
      content: k.content,
    })),
    files_frequently_modified: filesFrequentlyModified,
  };
}
