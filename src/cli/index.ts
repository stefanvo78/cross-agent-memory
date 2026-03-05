#!/usr/bin/env node
import { Command } from 'commander';
import { CopilotIngester } from '../ingest/copilot.js';
import { ingestSession } from '../ingest/pipeline.js';
import { getDb, closeDb } from '../db/connection.js';
import { SessionStore } from '../db/sessions.js';
import { VectorStore } from '../db/vectors.js';
import type { AgentIngester, AgentType } from '../types.js';

function getIngester(agent: string): AgentIngester {
  switch (agent) {
    case 'copilot':
      return new CopilotIngester();
    default:
      throw new Error(`Unknown agent: ${agent}. Supported: copilot`);
  }
}

const program = new Command()
  .name('cross-agent-memory')
  .description('Seamlessly switch between AI coding agents without losing context')
  .version('0.1.0');

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
        // Parse a specific session by finding its directory
        const copilot = ingester as CopilotIngester;
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const sessionDir = join(homedir(), '.copilot', 'session-state', options.sessionId);
        sessionData = await copilot.parseSession(sessionDir);
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
    } catch (err) {
      console.error('Ingest failed:', (err as Error).message);
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
    } catch (err) {
      console.error('Status failed:', (err as Error).message);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program.parse();
