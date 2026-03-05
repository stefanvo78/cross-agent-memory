// Agent types supported by cross-agent-memory
export type AgentType = 'copilot' | 'claude' | 'gemini' | 'chatgpt';

// Knowledge types for persistent facts
export type KnowledgeType = 'decision' | 'gotcha' | 'pattern' | 'architecture';

// Session data extracted from an agent's native format
export interface SessionData {
  id: string;
  agent: AgentType;
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

// Session as stored in the database
export interface Session extends SessionData {
  rowid?: number;
}

// Input for creating knowledge entries
export interface KnowledgeInput {
  projectId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  sourceAgent?: AgentType;
  sourceSessionId?: string;
}

// Knowledge as stored in the database
export interface Knowledge extends KnowledgeInput {
  id: number;
  createdAt: string;
  updatedAt?: string;
}

// Search result with similarity score
export interface SearchResult {
  sessionId: string;
  agent: AgentType;
  chunkText: string;
  similarityScore: number;
  timestamp: string;
}

// Handoff context returned by the MCP server
export interface HandoffContext {
  hasPreviousSession: boolean;
  lastSession?: {
    agent: AgentType;
    endedAt: string;
    summary: string;
    tasksCompleted: string[];
    tasksPending: string[];
    filesModified: string[];
    keyDecisions: string[];
  };
  recentKnowledge: Knowledge[];
  suggestedPrompt: string;
}

// Project identification
export interface ProjectInfo {
  id: string;
  name: string;
  gitRemote?: string;
  rootPath: string;
}

// Embedding engine interface
export interface EmbeddingEngine {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

// Agent ingester interface
export interface AgentIngester {
  name: AgentType;
  parseLatestSession(cwd: string): Promise<SessionData | null>;
  parseSession(sessionPath: string): Promise<SessionData>;
}
