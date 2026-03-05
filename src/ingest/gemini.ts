import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { detectProject } from './project-detector.js';
import type { AgentIngester, SessionData } from '../types.js';

const GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp');

interface GeminiMessage {
  id: string;
  type: string;
  content: Array<{ text?: string }>;
}

interface GeminiSession {
  sessionId: string;
  summary?: string;
  messages: GeminiMessage[];
}

/** Hash a project path to find the Gemini project directory */
export function getProjectHash(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

export class GeminiIngester implements AgentIngester {
  name = 'gemini' as const;
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? GEMINI_TMP_DIR;
  }

  async parseLatestSession(cwd: string): Promise<SessionData | null> {
    const sessionPath = await this.findLatestSession(cwd);
    if (!sessionPath) return null;
    return this.parseSession(sessionPath);
  }

  async parseSession(sessionPath: string): Promise<SessionData> {
    const raw = await readFile(sessionPath, 'utf-8');
    const session: GeminiSession = JSON.parse(raw);

    // Derive project path from grandparent directory name (chats -> <hash> -> tmp)
    // We can't reverse the hash, so use cwd detection from the session file location
    const chatsDir = join(sessionPath, '..');
    const projectHashDir = join(chatsDir, '..');
    let projectPath: string | undefined;

    // Try to detect project from the current working directory as fallback
    const project = detectProject(process.cwd());

    const sessionId = session.sessionId || basename(sessionPath, '.json');

    // Extract messages by type
    const userMessages = session.messages.filter((m) => m.type === 'user');
    const assistantMessages = session.messages.filter((m) => m.type === 'assistant');

    // Build summary
    const summary = session.summary || buildSummary(userMessages, assistantMessages);

    // Extract file modifications from tool messages
    const filesModified = extractFilesModified(session.messages);

    // Extract key decisions from assistant messages
    const keyDecisions = extractKeyDecisions(assistantMessages);

    // Build raw transcript for embedding
    const rawCheckpoint = buildFullText(session);

    // Use file mtime as endedAt
    let endedAt: string;
    try {
      const stats = await stat(sessionPath);
      endedAt = stats.mtime.toISOString();
    } catch {
      endedAt = new Date().toISOString();
    }

    return {
      id: sessionId,
      agent: 'gemini',
      projectId: project.id,
      projectPath: projectPath,
      endedAt,
      summary,
      tasksCompleted: [],
      tasksPending: [],
      filesModified: [...new Set(filesModified)],
      keyDecisions,
      rawCheckpoint,
    };
  }

  async findLatestSession(cwd: string): Promise<string | null> {
    const chatsDir = await this.findChatsDir(cwd);
    if (!chatsDir) return null;

    const entries = await readdir(chatsDir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();

    if (jsonFiles.length === 0) return null;

    // Find the most recently modified session file
    let bestPath: string | null = null;
    let bestMtime = 0;

    for (const file of jsonFiles) {
      const filePath = join(chatsDir, file);
      try {
        const stats = await stat(filePath);
        if (stats.mtimeMs > bestMtime) {
          bestMtime = stats.mtimeMs;
          bestPath = filePath;
        }
      } catch {
        continue;
      }
    }

    return bestPath;
  }

  /** Find the chats directory for a given project path */
  async findChatsDir(cwd: string): Promise<string | null> {
    // Try hashed project path first
    const hash = getProjectHash(cwd);
    const chatsDir = join(this.baseDir, hash, 'chats');
    if (existsSync(chatsDir)) return chatsDir;

    // Fallback: scan all project dirs for any chats
    if (!existsSync(this.baseDir)) return null;

    const dirs = await readdir(this.baseDir, { withFileTypes: true });
    const projectDirs = dirs.filter((d) => d.isDirectory());

    let bestDir: string | null = null;
    let bestMtime = 0;

    for (const d of projectDirs) {
      const candidate = join(this.baseDir, d.name, 'chats');
      if (!existsSync(candidate)) continue;
      try {
        const stats = await stat(candidate);
        if (stats.mtimeMs > bestMtime) {
          bestMtime = stats.mtimeMs;
          bestDir = candidate;
        }
      } catch {
        continue;
      }
    }

    return bestDir;
  }
}

/** Build a summary from the first user message */
function buildSummary(
  userMessages: GeminiMessage[],
  assistantMessages: GeminiMessage[],
): string {
  const firstPrompt = userMessages[0]?.content?.[0]?.text || 'Unknown task';
  const truncated =
    firstPrompt.length > 200 ? firstPrompt.slice(0, 200) + '...' : firstPrompt;
  return `Gemini session: ${truncated} (${userMessages.length} prompts, ${assistantMessages.length} responses)`;
}

/** Extract file paths from tool_use and tool_result messages */
function extractFilesModified(messages: GeminiMessage[]): string[] {
  const files: string[] = [];
  for (const msg of messages) {
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      for (const part of msg.content) {
        if (part.text) {
          const pathMatches = part.text.match(
            /(?:^|\s)((?:\.\/|\/|src\/|tests?\/)\S+\.\w+)/g,
          );
          if (pathMatches) {
            for (const match of pathMatches) {
              files.push(match.trim());
            }
          }
        }
      }
    }
  }
  return files;
}

/** Extract key decisions from assistant messages */
function extractKeyDecisions(assistantMessages: GeminiMessage[]): string[] {
  const decisions: string[] = [];
  for (const msg of assistantMessages) {
    for (const part of msg.content) {
      if (part.text) {
        const pattern =
          /(?:decided|choosing|will use|going with|opted for|selected)\s+(.{10,100})/gi;
        const matches = part.text.matchAll(pattern);
        for (const match of matches) {
          decisions.push(match[0].trim());
        }
      }
    }
  }
  return decisions.slice(0, 10);
}

/** Build the full text transcript for embedding */
function buildFullText(session: GeminiSession): string {
  const parts: string[] = [];
  if (session.summary) {
    parts.push(`Summary: ${session.summary}`);
  }
  for (const msg of session.messages) {
    const role =
      msg.type === 'user'
        ? 'User'
        : msg.type === 'assistant'
          ? 'Assistant'
          : msg.type;
    for (const part of msg.content) {
      if (part.text) {
        parts.push(`${role}: ${part.text}`);
      }
    }
  }
  return parts.join('\n\n');
}
