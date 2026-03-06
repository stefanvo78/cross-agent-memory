import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { SessionStore } from '../db/sessions.js';
import { KnowledgeStore } from '../db/knowledge.js';
import { detectProject } from '../ingest/project-detector.js';
import { getAgentMemoryDir } from './exporter.js';
import type { ExportedSession } from './exporter.js';
import type { AgentType } from '../types.js';

/** Import sessions and knowledge from .agent-memory/ into local DB */
export function importFromRepo(db: Database.Database, projectPath: string): { sessionsImported: number; knowledgeImported: number } {
  const dir = getAgentMemoryDir(projectPath);
  if (!existsSync(dir)) return { sessionsImported: 0, knowledgeImported: 0 };

  const sessionsDir = join(dir, 'sessions');
  const knowledgeDir = join(dir, 'knowledge');

  const sessionStore = new SessionStore(db);
  let sessionsImported = 0;

  // Import sessions
  if (existsSync(sessionsDir)) {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data: ExportedSession = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8'));
        // Check if already exists
        if (sessionStore.getById(data.id)) continue;

        // Import as session (without rawCheckpoint)
        const project = detectProject(projectPath);
        sessionStore.insert({
          id: data.id,
          agent: data.agent as AgentType,
          projectId: project.id,
          projectPath,
          endedAt: data.endedAt,
          summary: data.summary,
          tasksCompleted: data.tasksCompleted,
          tasksPending: data.tasksPending,
          filesModified: data.filesModified,
          keyDecisions: data.keyDecisions,
        });
        sessionsImported++;
      } catch { /* skip corrupt files */ }
    }
  }

  // Import knowledge
  let knowledgeImported = 0;
  const entriesPath = join(knowledgeDir, 'entries.json');
  if (existsSync(entriesPath)) {
    try {
      const entries = JSON.parse(readFileSync(entriesPath, 'utf-8'));
      const knowledgeStore = new KnowledgeStore(db);
      const project = detectProject(projectPath);
      for (const entry of entries) {
        // Simple dedup: skip if identical title+content exists
        const existing = knowledgeStore.getByProject(project.id, entry.type);
        if (existing.some((k: { title: string; content: string }) => k.title === entry.title && k.content === entry.content)) continue;

        knowledgeStore.insert({
          projectId: project.id,
          type: entry.type,
          title: entry.title,
          content: entry.content,
          sourceAgent: entry.sourceAgent,
        });
        knowledgeImported++;
      }
    } catch { /* skip corrupt entries file */ }
  }

  return { sessionsImported, knowledgeImported };
}
