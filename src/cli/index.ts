import { Command } from 'commander';
import { CopilotIngester } from '../ingest/copilot.js';
import { ClaudeIngester } from '../ingest/claude.js';
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
    default:
      throw new Error(`Unknown agent: ${agent}. Supported: copilot, claude`);
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
        if (agent === 'claude') {
          // Claude sessions are JSONL files in the project directory
          const claude = ingester as ClaudeIngester;
          const cwd = options.cwd ?? process.cwd();
          const { join } = await import('node:path');
          const { homedir } = await import('node:os');
          const { encodeProjectPath } = await import('../ingest/claude.js');
          const encoded = encodeProjectPath(cwd);
          const sessionFile = join(homedir(), '.claude', 'projects', encoded, `${options.sessionId}.jsonl`);
          sessionData = await claude.parseSession(sessionFile);
        } else {
          // Copilot sessions are directories
          const copilot = ingester as CopilotIngester;
          const { join } = await import('node:path');
          const { homedir } = await import('node:os');
          const sessionDir = join(homedir(), '.copilot', 'session-state', options.sessionId);
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
    const agents = agent ? [agent] : ['copilot', 'claude', 'mcp'];

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
            SessionEnd: {
              command: 'cross-agent-memory ingest claude --cwd ' + projectDir,
            },
          };
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          console.log(`✓ Updated ${join('.claude', 'settings.json')}`);
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
          console.error(`Unknown agent: ${a}. Supported: copilot, claude, mcp`);
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

program.parse();
