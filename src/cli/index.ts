import { Command } from 'commander';
import { CopilotIngester } from '../ingest/copilot.js';
import { ClaudeIngester } from '../ingest/claude.js';
import { GeminiIngester } from '../ingest/gemini.js';
import { ingestSession } from '../ingest/pipeline.js';
import { getDb, closeDb } from '../db/connection.js';
import { SessionStore } from '../db/sessions.js';
import { VectorStore } from '../db/vectors.js';
import { OnnxEmbeddingEngine } from '../embedding/engine.js';
import type { AgentIngester, AgentType } from '../types.js';

function getIngester(agent: string): AgentIngester {
  switch (agent) {
    case 'copilot':
      return new CopilotIngester();
    case 'claude':
      return new ClaudeIngester();
    case 'gemini':
      return new GeminiIngester();
    default:
      throw new Error(`Unknown agent: ${agent}. Supported: copilot, claude, gemini`);
  }
}

const program = new Command()
  .name('cross-agent-memory')
  .description('Seamlessly switch between AI coding agents without losing context')
  .version('0.1.0')
  .option('--verbose', 'Show full stack traces on error');

program
  .command('init')
  .description('Initialize: download embedding model and create database')
  .action(async () => {
    try {
      console.log('Initializing cross-agent-memory...');
      console.log('Downloading embedding model (all-MiniLM-L6-v2, ~23MB)...');
      const engine = new OnnxEmbeddingEngine();
      await engine.embed('test initialization');
      console.log('✓ Embedding model ready');

      const db = getDb();
      closeDb();
      console.log('✓ Database created at ~/.agent-memory/memory.db');
      console.log('\nReady! Configure your agents with: cross-agent-memory setup <agent>');
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }
  });

program
  .command('ingest <agent>')
  .description('Ingest a session from an agent')
  .option('--session-id <id>', 'Specific session UUID')
  .option('--cwd <path>', 'Project working directory')
  .action(async (agent: string, options: { sessionId?: string; cwd?: string }) => {
    try {
      const ingester = getIngester(agent);
      let sessionData;

      if (options.sessionId) {
        // Sanitize sessionId to prevent path traversal
        const { basename } = await import('node:path');
        const sanitizedId = basename(options.sessionId);
        if (sanitizedId !== options.sessionId || sanitizedId.includes('..')) {
          throw new Error('Invalid session ID: must not contain path separators');
        }

        if (agent === 'claude') {
          // Claude sessions are JSONL files in the project directory
          const claude = ingester as ClaudeIngester;
          const cwd = options.cwd ?? process.cwd();
          const { join } = await import('node:path');
          const { homedir } = await import('node:os');
          const { encodeProjectPath } = await import('../ingest/claude.js');
          const encoded = encodeProjectPath(cwd);
          const sessionFile = join(homedir(), '.claude', 'projects', encoded, `${sanitizedId}.jsonl`);
          sessionData = await claude.parseSession(sessionFile);
        } else if (agent === 'gemini') {
          // Gemini sessions are JSON files in the chats directory
          const gemini = ingester as GeminiIngester;
          const cwd = options.cwd ?? process.cwd();
          const { join } = await import('node:path');
          const { homedir } = await import('node:os');
          const { getProjectHash } = await import('../ingest/gemini.js');
          const hash = getProjectHash(cwd);
          const sessionFile = join(homedir(), '.gemini', 'tmp', hash, 'chats', `${sanitizedId}.json`);
          sessionData = await gemini.parseSession(sessionFile);
        } else {
          // Copilot sessions are directories
          const copilot = ingester as CopilotIngester;
          const { join } = await import('node:path');
          const { homedir } = await import('node:os');
          const sessionDir = join(homedir(), '.copilot', 'session-state', sanitizedId);
          sessionData = await copilot.parseSession(sessionDir);
        }
      } else {
        const cwd = options.cwd ?? process.cwd();
        sessionData = await ingester.parseLatestSession(cwd);
        if (!sessionData) {
          console.error(`No session found for ${agent} in ${cwd}`);
          process.exit(1);
        }
      }

      console.log(`Ingesting ${agent} session ${sessionData.id}...`);
      const result = await ingestSession(sessionData);

      console.log(`✓ Session ingested successfully`);
      console.log(`  Session ID:  ${result.sessionId}`);
      console.log(`  Project:     ${result.projectId}`);
      console.log(`  Chunks:      ${result.chunksStored}`);
      console.log(`  Summary:     ${sessionData.summary.slice(0, 100)}${sessionData.summary.length > 100 ? '...' : ''}`);
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('status')
  .description('Show database statistics')
  .action(async () => {
    try {
      const db = getDb();
      const sessions = new SessionStore(db);
      const vectors = new VectorStore(db);

      const sessionCount = sessions.count();
      const chunkCount = vectors.sessionChunkCount();

      console.log('cross-agent-memory status');
      console.log(`  Sessions:  ${sessionCount}`);
      console.log(`  Chunks:    ${chunkCount}`);
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('serve')
  .description('Start MCP server')
  .option('--debug', 'Enable debug logging')
  .action(async (options: { debug?: boolean }) => {
    try {
      const { startServer } = await import('../mcp/server.js');
      await startServer({ debug: options.debug });
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }
  });

program
  .command('setup [agent]')
  .description('Install hooks and MCP config for an agent')
  .option('--project <path>', 'Project directory')
  .action(async (agent?: string, options?: { project?: string }) => {
    try {
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const projectDir = options?.project ?? process.cwd();
    const agents = agent ? [agent] : ['copilot', 'claude', 'gemini', 'mcp'];

    for (const a of agents) {
      switch (a) {
        case 'copilot': {
          const hooksDir = join(projectDir, '.github', 'hooks');
          mkdirSync(hooksDir, { recursive: true });
          const hooksConfig = {
            hooks: {
              sessionEnd: {
                command: 'cross-agent-memory',
                args: ['ingest', 'copilot', '--cwd', projectDir],
              },
            },
          };
          writeFileSync(
            join(hooksDir, 'hooks.json'),
            JSON.stringify(hooksConfig, null, 2) + '\n',
          );
          console.log(`✓ Created ${join('.github', 'hooks', 'hooks.json')}`);
          break;
        }
        case 'claude': {
          const claudeDir = join(projectDir, '.claude');
          mkdirSync(claudeDir, { recursive: true });
          const settingsPath = join(claudeDir, 'settings.json');
          let settings: Record<string, unknown> = {};
          if (existsSync(settingsPath)) {
            settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          }
          (settings as Record<string, unknown>).hooks = {
            SessionEnd: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: `cross-agent-memory ingest claude --cwd '${projectDir.replace(/'/g, "'\\''")}'`,
                  },
                ],
              },
            ],
          };
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          console.log(`✓ Updated ${join('.claude', 'settings.json')}`);
          break;
        }
        case 'gemini': {
          const { homedir } = await import('node:os');
          const geminiSettingsDir = join(homedir(), '.gemini');
          mkdirSync(geminiSettingsDir, { recursive: true });
          const geminiSettingsPath = join(geminiSettingsDir, 'settings.json');
          let geminiSettings: Record<string, unknown> = {};
          if (existsSync(geminiSettingsPath)) {
            geminiSettings = JSON.parse(readFileSync(geminiSettingsPath, 'utf-8'));
          }
          (geminiSettings as Record<string, unknown>).hooks = {
            SessionEnd: {
              command: `cross-agent-memory ingest gemini --cwd '${projectDir.replace(/'/g, "'\\''")}'`,
            },
          };
          writeFileSync(geminiSettingsPath, JSON.stringify(geminiSettings, null, 2) + '\n');
          console.log(`✓ Updated ${join('~/.gemini', 'settings.json')}`);
          break;
        }
        case 'mcp': {
          console.log('\nMCP Server Configuration:');
          console.log('\n  Copilot CLI (.vscode/mcp.json):');
          console.log('  ' + JSON.stringify({
            servers: {
              'cross-agent-memory': {
                command: 'cross-agent-memory',
                args: ['serve'],
              },
            },
          }, null, 2).split('\n').join('\n  '));
          console.log('\n  Claude Code:');
          console.log('  claude mcp add cross-agent-memory -- cross-agent-memory serve');
          break;
        }
        default:
          console.error(`Unknown agent: ${a}. Supported: copilot, claude, gemini, mcp`);
          process.exit(1);
      }
    }
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Launch web dashboard to browse sessions and knowledge')
  .option('--port <port>', 'Port number', '3847')
  .action(async (options: { port: string }) => {
    try {
      const { startDashboard } = await import('../dashboard/server.js');
      await startDashboard(parseInt(options.port));
    } catch (error) {
      if (program.opts().verbose) {
        console.error(error);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }
  });

program
  .command('push')
  .description('Export sessions and knowledge to .agent-memory/ for git sharing')
  .option('--cwd <path>', 'Project directory')
  .action(async (options: { cwd?: string }) => {
    try {
      const cwd = options.cwd ?? process.cwd();
      const { exportToRepo } = await import('../sync/exporter.js');
      const db = getDb();
      const result = exportToRepo(db, cwd);
      closeDb();
      console.log(`✓ Exported to .agent-memory/`);
      console.log(`  Sessions:  ${result.sessionsExported} new`);
      console.log(`  Knowledge: ${result.knowledgeExported} entries`);
      console.log(`  HANDOFF.md updated`);
      console.log(`\nRun 'git add .agent-memory && git commit' to share with your team.`);
    } catch (error) {
      if (program.opts().verbose) console.error(error);
      else console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('pull')
  .description('Import sessions and knowledge from .agent-memory/ into local DB')
  .option('--cwd <path>', 'Project directory')
  .action(async (options: { cwd?: string }) => {
    try {
      const cwd = options.cwd ?? process.cwd();
      const { importFromRepo } = await import('../sync/importer.js');
      const db = getDb();
      const result = importFromRepo(db, cwd);
      closeDb();
      console.log(`✓ Imported from .agent-memory/`);
      console.log(`  Sessions:  ${result.sessionsImported} new`);
      console.log(`  Knowledge: ${result.knowledgeImported} new entries`);
    } catch (error) {
      if (program.opts().verbose) console.error(error);
      else console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('sync')
  .description('Pull from .agent-memory/, then push (bidirectional sync)')
  .option('--cwd <path>', 'Project directory')
  .action(async (options: { cwd?: string }) => {
    try {
      const cwd = options.cwd ?? process.cwd();
      const { importFromRepo } = await import('../sync/importer.js');
      const { exportToRepo } = await import('../sync/exporter.js');
      const db = getDb();

      const imported = importFromRepo(db, cwd);
      console.log(`↓ Imported: ${imported.sessionsImported} sessions, ${imported.knowledgeImported} knowledge`);

      const exported = exportToRepo(db, cwd);
      console.log(`↑ Exported: ${exported.sessionsExported} sessions, ${exported.knowledgeExported} knowledge`);

      closeDb();
      console.log(`✓ Sync complete. HANDOFF.md updated.`);
    } catch (error) {
      if (program.opts().verbose) console.error(error);
      else console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program.parse();
