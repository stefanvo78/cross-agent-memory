import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { SessionStore } from '../db/sessions.js';
import { KnowledgeStore } from '../db/knowledge.js';
import { detectProject } from '../ingest/project-detector.js';
import { generateHandoff } from './handoff.js';

export interface ExportedSession {
  id: string;
  agent: string;
  endedAt: string;
  author?: string;
  summary: string;
  tasksCompleted: string[];
  tasksPending: string[];
  filesModified: string[];
  keyDecisions: string[];
}

export interface SyncConfig {
  version: 1;
  maxSessions: number;
  includeKnowledge: boolean;
  excludeAgents: string[];
}

const DEFAULT_CONFIG: SyncConfig = {
  version: 1,
  maxSessions: 20,
  includeKnowledge: true,
  excludeAgents: [],
};

export function getAgentMemoryDir(projectPath: string): string {
  return join(projectPath, '.agent-memory');
}

export function loadSyncConfig(projectPath: string): SyncConfig {
  const configPath = join(getAgentMemoryDir(projectPath), 'config.json');
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return { ...DEFAULT_CONFIG, ...raw };
  }
  return { ...DEFAULT_CONFIG };
}

/** Export sessions and knowledge from local DB to .agent-memory/ */
export function exportToRepo(db: Database.Database, projectPath: string): { sessionsExported: number; knowledgeExported: number } {
  const project = detectProject(projectPath);
  const config = loadSyncConfig(projectPath);
  const dir = getAgentMemoryDir(projectPath);
  const sessionsDir = join(dir, 'sessions');
  const knowledgeDir = join(dir, 'knowledge');

  // Create directories
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(knowledgeDir, { recursive: true });

  // Export sessions
  const sessionStore = new SessionStore(db);
  const sessions = sessionStore.getRecent(project.id, config.maxSessions);

  // Read existing exported sessions to avoid duplicates
  const existingIds = new Set<string>();
  for (const file of readdirSync(sessionsDir)) {
    if (file.endsWith('.json')) {
      try {
        const data = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8'));
        existingIds.add(data.id);
      } catch { /* skip corrupt files */ }
    }
  }

  let sessionsExported = 0;
  for (const session of sessions) {
    if (config.excludeAgents.includes(session.agent)) continue;
    if (existingIds.has(session.id)) continue;

    const exported: ExportedSession = {
      id: session.id,
      agent: session.agent,
      endedAt: session.endedAt,
      author: getGitUserName(projectPath),
      summary: session.summary,
      tasksCompleted: session.tasksCompleted,
      tasksPending: session.tasksPending,
      filesModified: session.filesModified,
      keyDecisions: session.keyDecisions,
    };

    const timestamp = session.endedAt.replace(/[:.]/g, '-').slice(0, 19);
    const shortId = session.id.slice(0, 8);
    const filename = `${timestamp}-${session.agent}-${shortId}.json`;
    writeFileSync(join(sessionsDir, filename), JSON.stringify(exported, null, 2) + '\n');
    sessionsExported++;
  }

  // Prune old sessions (keep maxSessions most recent)
  pruneOldSessions(sessionsDir, config.maxSessions);

  // Export knowledge
  let knowledgeExported = 0;
  if (config.includeKnowledge) {
    const knowledgeStore = new KnowledgeStore(db);
    const entries = knowledgeStore.getByProject(project.id);
    const exported = entries.map(k => ({
      id: k.id,
      type: k.type,
      title: k.title,
      content: k.content,
      sourceAgent: k.sourceAgent,
      createdAt: k.createdAt,
    }));
    writeFileSync(join(knowledgeDir, 'entries.json'), JSON.stringify(exported, null, 2) + '\n');
    knowledgeExported = exported.length;
  }

  // Write sync config if it doesn't exist
  const configPath = join(dir, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  }

  // Generate HANDOFF.md
  generateHandoff(db, projectPath, sessions);

  return { sessionsExported, knowledgeExported };
}

function pruneOldSessions(sessionsDir: string, maxSessions: number): void {
  const files = readdirSync(sessionsDir)
    .filter((f: string) => f.endsWith('.json'))
    .sort()
    .reverse();  // newest first

  for (let i = maxSessions; i < files.length; i++) {
    unlinkSync(join(sessionsDir, files[i]));
  }
}

function getGitUserName(cwd: string): string | undefined {
  try {
    return execSync('git config user.name', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}
