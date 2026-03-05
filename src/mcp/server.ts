import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDb, closeDb } from '../db/connection.js';
import { detectProject } from '../ingest/project-detector.js';
import {
  getHandoff,
  searchMemory,
  storeKnowledge,
  getProjectContext,
  type ToolDependencies,
} from './tools.js';

const TOOL_DEFINITIONS = [
  {
    name: 'get_handoff',
    description:
      'Get handoff context from the last coding session. Returns what was done, what is pending, key decisions, and a suggested prompt for continuing work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project identifier (auto-detected from cwd if omitted)',
        },
      },
    },
  },
  {
    name: 'search_memory',
    description:
      'Search across all sessions for a project using keyword and semantic search. Returns ranked results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        project_id: {
          type: 'string',
          description: 'Project identifier (auto-detected from cwd if omitted)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'store_knowledge',
    description:
      'Store an important fact, decision, gotcha, or architectural pattern for this project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['decision', 'gotcha', 'pattern', 'architecture'],
          description: 'Type of knowledge entry',
        },
        title: { type: 'string', description: 'Short title' },
        content: { type: 'string', description: 'Detailed content' },
        project_id: {
          type: 'string',
          description: 'Project identifier (auto-detected from cwd if omitted)',
        },
      },
      required: ['type', 'title', 'content'],
    },
  },
  {
    name: 'get_project_context',
    description:
      'Get a full project overview: session count, agents used, recent sessions, all knowledge entries, and frequently modified files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Project identifier',
        },
      },
      required: ['project_id'],
    },
  },
];

function log(message: string): void {
  process.stderr.write(`[cross-agent-memory] ${message}\n`);
}

export async function startServer(options?: { debug?: boolean }): Promise<void> {
  const debug = options?.debug ?? false;

  const server = new Server(
    { name: 'cross-agent-memory', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Auto-detect project
  let defaultProjectId: string | undefined;
  try {
    const project = detectProject();
    defaultProjectId = project.id;
    if (debug) log(`Detected project: ${project.id} (${project.rootPath})`);
  } catch {
    if (debug) log('Could not auto-detect project');
  }

  const db = getDb();
  const deps: ToolDependencies = { db, defaultProjectId };

  // Try to load embedding engine (non-fatal if unavailable)
  try {
    const { OnnxEmbeddingEngine } = await import('../embedding/engine.js');
    deps.embeddingEngine = new OnnxEmbeddingEngine();
    if (debug) log('Embedding engine loaded');
  } catch {
    if (debug) log('Embedding engine not available, using keyword search only');
  }

  // Register ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Register CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (debug) log(`Tool call: ${name} ${JSON.stringify(args)}`);

    try {
      let result: unknown;

      switch (name) {
        case 'get_handoff':
          result = await getHandoff(deps, (args ?? {}) as { project_id?: string });
          break;
        case 'search_memory':
          result = await searchMemory(deps, args as { query: string; project_id?: string; limit?: number });
          break;
        case 'store_knowledge':
          result = await storeKnowledge(deps, args as { type: string; title: string; content: string; project_id?: string });
          break;
        case 'get_project_context':
          result = await getProjectContext(deps, args as { project_id: string });
          break;
        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (debug) log(`Tool error: ${message}`);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (debug) log('MCP server started on stdio');

  // Cleanup on exit
  process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
  });
}
