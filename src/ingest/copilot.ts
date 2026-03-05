import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { detectProject } from './project-detector.js';
import type { AgentIngester, SessionData } from '../types.js';

const SESSION_STATE_DIR = join(homedir(), '.copilot', 'session-state');

interface WorkspaceData {
  id: string;
  cwd: string;
  summary?: string;
  summary_count?: number;
  created_at: string;
  updated_at: string;
  git_root?: string;
  repository?: string;
  branch?: string;
}

interface CheckpointData {
  overview: string;
  history: string;
  work_done: string;
  technical_details: string;
  important_files: string;
  next_steps: string;
  raw: string;
}

export class CopilotIngester implements AgentIngester {
  name = 'copilot' as const;

  async parseLatestSession(cwd: string): Promise<SessionData | null> {
    const sessionDir = await this.findLatestSession(cwd);
    if (!sessionDir) return null;
    return this.parseSession(sessionDir);
  }

  async parseSession(sessionDir: string): Promise<SessionData> {
    const workspace = await this.parseWorkspace(join(sessionDir, 'workspace.yaml'));
    const checkpoint = await this.findLatestCheckpoint(sessionDir);
    const files = await this.extractFilesFromEvents(join(sessionDir, 'events.jsonl'));

    const project = detectProject(workspace.cwd);

    // Build summary from workspace and checkpoint
    let summary = workspace.summary ?? '';
    if (checkpoint?.overview) {
      summary = checkpoint.overview;
    }

    // Extract structured data from checkpoint sections
    const tasksCompleted = checkpoint?.work_done
      ? extractListItems(checkpoint.work_done)
      : [];
    const tasksPending = checkpoint?.next_steps
      ? extractListItems(checkpoint.next_steps)
      : [];
    const keyDecisions = checkpoint?.history
      ? extractListItems(checkpoint.history)
      : [];

    // Merge files from checkpoint and events
    const checkpointFiles = checkpoint?.important_files
      ? extractListItems(checkpoint.important_files)
      : [];
    const filesModified = deduplicateFiles([...checkpointFiles, ...files]);

    // Build raw checkpoint text for embedding
    const rawCheckpoint = checkpoint?.raw ?? undefined;

    return {
      id: workspace.id,
      agent: 'copilot',
      projectId: project.id,
      projectPath: workspace.cwd,
      startedAt: workspace.created_at,
      endedAt: workspace.updated_at,
      summary,
      tasksCompleted,
      tasksPending,
      filesModified,
      keyDecisions,
      rawCheckpoint,
    };
  }

  async findLatestSession(cwd?: string): Promise<string | null> {
    if (!existsSync(SESSION_STATE_DIR)) return null;

    const entries = await readdir(SESSION_STATE_DIR);
    let bestDir: string | null = null;
    let bestTime = '';

    for (const entry of entries) {
      const sessionDir = join(SESSION_STATE_DIR, entry);
      const workspacePath = join(sessionDir, 'workspace.yaml');
      if (!existsSync(workspacePath)) continue;

      try {
        const workspace = await this.parseWorkspace(workspacePath);

        // If cwd is specified, filter by matching cwd
        if (cwd && workspace.cwd !== cwd) continue;

        if (workspace.updated_at > bestTime) {
          bestTime = workspace.updated_at;
          bestDir = sessionDir;
        }
      } catch {
        // Skip unparseable sessions
        continue;
      }
    }

    return bestDir;
  }

  async parseWorkspace(yamlPath: string): Promise<WorkspaceData> {
    const content = await readFile(yamlPath, 'utf-8');
    const data = parseYaml(content) as Record<string, unknown>;

    return {
      id: String(data.id ?? ''),
      cwd: String(data.cwd ?? ''),
      summary: data.summary ? String(data.summary) : undefined,
      summary_count: data.summary_count as number | undefined,
      created_at: String(data.created_at ?? new Date().toISOString()),
      updated_at: String(data.updated_at ?? new Date().toISOString()),
      git_root: data.git_root ? String(data.git_root) : undefined,
      repository: data.repository ? String(data.repository) : undefined,
      branch: data.branch ? String(data.branch) : undefined,
    };
  }

  async findLatestCheckpoint(sessionDir: string): Promise<CheckpointData | null> {
    const checkpointsDir = join(sessionDir, 'checkpoints');
    if (!existsSync(checkpointsDir)) return null;

    const entries = await readdir(checkpointsDir);
    const checkpointFiles = entries
      .filter((f) => f.endsWith('.md') && f !== 'index.md')
      .sort();

    if (checkpointFiles.length === 0) return null;

    // Parse the latest (last) checkpoint
    const latestFile = checkpointFiles[checkpointFiles.length - 1];
    return this.parseCheckpoint(join(checkpointsDir, latestFile));
  }

  async parseCheckpoint(mdPath: string): Promise<CheckpointData> {
    const content = await readFile(mdPath, 'utf-8');
    return {
      overview: extractSection(content, 'overview'),
      history: extractSection(content, 'history'),
      work_done: extractSection(content, 'work_done'),
      technical_details: extractSection(content, 'technical_details'),
      important_files: extractSection(content, 'important_files'),
      next_steps: extractSection(content, 'next_steps'),
      raw: content,
    };
  }

  async extractFilesFromEvents(eventsPath: string): Promise<string[]> {
    if (!existsSync(eventsPath)) return [];

    const files = new Set<string>();
    try {
      const content = await readFile(eventsPath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as {
            type: string;
            data?: { toolName?: string; arguments?: { path?: string } };
          };

          if (
            event.type === 'tool.execution_start' &&
            event.data?.toolName &&
            (event.data.toolName === 'edit' || event.data.toolName === 'create') &&
            event.data.arguments?.path
          ) {
            files.add(event.data.arguments.path);
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // File read error — return empty
    }

    return [...files];
  }
}

/** Extract content between <tag>...</tag> from checkpoint markdown */
function extractSection(content: string, tag: string): string {
  const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

/** Extract list items (lines starting with - or numbered) from text */
function extractListItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim())
    .filter((line) => line.length > 0);
}

/** Deduplicate file paths, keeping the order */
function deduplicateFiles(files: string[]): string[] {
  const seen = new Set<string>();
  return files.filter((f) => {
    const normalized = f.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
