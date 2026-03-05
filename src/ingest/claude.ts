import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectProject } from './project-detector.js';
import type { AgentIngester, SessionData } from '../types.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/** Encode a filesystem path to Claude's project directory name (replace / with -) */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/** Decode a Claude project directory name back to a filesystem path */
export function decodeProjectPath(encoded: string): string {
  // The encoded form starts with - (from the leading /), so restore leading /
  // E.g. "-Users-stefanvo-Sources-SmartPIN" → "/Users/stefanvo/Sources/SmartPIN"
  return encoded.replace(/-/g, '/');
}

interface ClaudeEvent {
  type: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export class ClaudeIngester implements AgentIngester {
  name = 'claude' as const;

  async parseLatestSession(cwd: string): Promise<SessionData | null> {
    const sessionPath = await this.findLatestSession(cwd);
    if (!sessionPath) return null;
    return this.parseSession(sessionPath);
  }

  async parseSession(sessionPath: string): Promise<SessionData> {
    const content = await readFile(sessionPath, 'utf-8');
    const events = parseJsonl(content);

    // Extract session metadata from the first event with sessionId
    let sessionId = '';
    let cwd = '';
    let startedAt = '';
    let endedAt = '';

    for (const event of events) {
      if (event.sessionId && !sessionId) sessionId = event.sessionId;
      if (event.cwd && !cwd) cwd = event.cwd;
      if (event.timestamp) {
        if (!startedAt) startedAt = event.timestamp;
        endedAt = event.timestamp;
      }
    }

    // Use filename as fallback session ID (UUID before .jsonl)
    if (!sessionId) {
      const { basename } = await import('node:path');
      sessionId = basename(sessionPath, '.jsonl');
    }

    // Derive project path from the parent directory name if cwd not found
    if (!cwd) {
      const { basename, dirname } = await import('node:path');
      const projectDirName = basename(dirname(sessionPath));
      cwd = decodeProjectPath(projectDirName);
    }

    const project = detectProject(cwd);

    // Extract messages
    const humanMessages = extractHumanMessages(events);
    const assistantTexts = extractAssistantTexts(events);
    const filesModified = extractModifiedFiles(events);

    // Build summary from first human message + last assistant text
    const summaryParts: string[] = [];
    if (humanMessages.length > 0) {
      const firstMsg = humanMessages[0];
      summaryParts.push(firstMsg.length > 500 ? firstMsg.slice(0, 500) + '...' : firstMsg);
    }
    if (assistantTexts.length > 0) {
      const lastMsg = assistantTexts[assistantTexts.length - 1];
      summaryParts.push(lastMsg.length > 500 ? lastMsg.slice(0, 500) + '...' : lastMsg);
    }
    const summary = summaryParts.join('\n\n---\n\n') || 'Claude Code session';

    // Build raw transcript for embedding (all human + assistant text blocks)
    const rawParts: string[] = [];
    for (const event of events) {
      if (event.type === 'user' && !event.isMeta) {
        const text = extractTextContent(event);
        if (text) rawParts.push(`Human: ${text}`);
      } else if (event.type === 'assistant') {
        const text = extractTextContent(event);
        if (text) rawParts.push(`Assistant: ${text}`);
      }
    }
    const rawCheckpoint = rawParts.join('\n\n') || undefined;

    // Read MEMORY.md if available
    const memoryContent = await this.readMemory(cwd);
    if (memoryContent) {
      rawParts.push(`\n\nProject Memory:\n${memoryContent}`);
    }

    return {
      id: sessionId,
      agent: 'claude',
      projectId: project.id,
      projectPath: cwd,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: endedAt || new Date().toISOString(),
      summary,
      tasksCompleted: [],
      tasksPending: [],
      filesModified: [...new Set(filesModified)],
      keyDecisions: [],
      rawCheckpoint,
    };
  }

  async findLatestSession(cwd: string): Promise<string | null> {
    const encoded = encodeProjectPath(cwd);
    const projectDir = join(CLAUDE_PROJECTS_DIR, encoded);

    if (!existsSync(projectDir)) return null;

    const entries = await readdir(projectDir);
    const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) return null;

    // Find the most recently modified JSONL file
    let bestPath: string | null = null;
    let bestMtime = 0;

    for (const file of jsonlFiles) {
      const filePath = join(projectDir, file);
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

  async readMemory(cwd: string): Promise<string | null> {
    const encoded = encodeProjectPath(cwd);
    const memoryPath = join(CLAUDE_PROJECTS_DIR, encoded, 'memory', 'MEMORY.md');

    if (!existsSync(memoryPath)) return null;

    try {
      return await readFile(memoryPath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/** Parse JSONL content into an array of events */
function parseJsonl(content: string): ClaudeEvent[] {
  const events: ClaudeEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ClaudeEvent);
    } catch {
      // Skip unparseable lines
    }
  }
  return events;
}

/** Extract human messages (non-meta, non-command) */
function extractHumanMessages(events: ClaudeEvent[]): string[] {
  const messages: string[] = [];
  for (const event of events) {
    if (event.type !== 'user' || event.isMeta) continue;
    const text = extractTextContent(event);
    // Skip command messages (wrapped in XML tags)
    if (text && !text.startsWith('<')) {
      messages.push(text);
    }
  }
  return messages;
}

/** Extract assistant text blocks */
function extractAssistantTexts(events: ClaudeEvent[]): string[] {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!content || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

/** Extract text content from a user or assistant event */
function extractTextContent(event: ClaudeEvent): string | null {
  const content = event.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlocks = content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!);
    return textBlocks.length > 0 ? textBlocks.join('\n') : null;
  }
  return null;
}

/** Extract file paths from tool_use events (Write, Edit, MultiEdit, create) */
function extractModifiedFiles(events: ClaudeEvent[]): string[] {
  const files: string[] = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      const name = block.name?.toLowerCase() ?? '';
      if (name === 'write' || name === 'edit' || name === 'multiedit' || name === 'create') {
        const filePath = block.input?.file_path as string | undefined;
        if (filePath) files.push(filePath);
      }
    }
  }
  return files;
}
