# Cross-Agent Memory

> Seamlessly switch between AI coding agents without losing context.

A local-first tool that captures session state from different AI coding agents (GitHub Copilot CLI, Claude Code, Gemini CLI, and more) and makes it available to any agent via MCP, so you can pick up exactly where you left off — even with a different tool.

## The Problem

AI coding agents forget everything when you switch tools. If Copilot's tokens run out and you switch to Claude Code, you start from zero — re-explaining your project, decisions, and progress. This wastes time and tokens.

## The Solution

**Cross-Agent Memory** provides:

1. **Stop Hooks** — Automatically capture session summaries when an agent session ends
2. **Unified Vector DB** — Single SQLite + sqlite-vec database storing all sessions across all agents and projects
3. **MCP Server** — Any agent can query the shared memory via standard MCP protocol to get context, search history, and receive a "handoff" prompt
4. **Auto-Summarization** — Heuristic extraction of objectives, decisions, files, errors, and next steps from raw transcripts
5. **Web Dashboard** — Browse sessions, knowledge, and project stats at `localhost:3847`

## Quick Start

```bash
npm install -g cross-agent-memory

# Initialize: download embedding model + create database
cross-agent-memory init

# Set up hooks for your agents
cross-agent-memory setup copilot --project /path/to/project
cross-agent-memory setup claude --project /path/to/project
cross-agent-memory setup gemini --project /path/to/project

# Start the MCP server (agents connect automatically)
cross-agent-memory serve

# Or manually ingest a session
cross-agent-memory ingest copilot
cross-agent-memory ingest claude
cross-agent-memory ingest gemini

# View status
cross-agent-memory status

# Launch the web dashboard
cross-agent-memory dashboard

# Share context with your team via git
cross-agent-memory push     # Export sessions → .agent-memory/
cross-agent-memory pull     # Import .agent-memory/ → local DB
cross-agent-memory sync     # Bidirectional (pull + push)
```

## How It Works

### Solo (cross-agent)

```
Agent A session ends → Stop Hook fires → Ingest script reads session state
→ Summarizes & embeds → Stores in ~/.agent-memory/memory.db

Agent B starts → MCP Server is running → Agent calls get_handoff()
→ Gets: "Last session (Copilot) completed X. Remaining: Y, Z."
```

### Team (cross-developer)

```
Dev A: session ends → local DB → push → .agent-memory/ → git commit + push
Dev B: git pull → pull → local DB → get_handoff() → picks up Dev A's context
```

The `.agent-memory/` directory in your repo contains:
```
.agent-memory/
├── HANDOFF.md              # Human + agent readable handoff document
├── sessions/               # Structured summaries (no raw transcripts)
├── knowledge/              # Shared decisions, patterns, gotchas
└── config.json             # Team sync settings
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_handoff` | Get complete context from the last agent session for seamless continuation |
| `search_memory` | Semantic + keyword search across all sessions and knowledge |
| `store_knowledge` | Save important decisions, patterns, or gotchas |
| `get_project_context` | Get all knowledge and recent sessions for a project |

## Supported Agents

- [x] GitHub Copilot CLI
- [x] Claude Code
- [x] Gemini CLI
- [ ] ChatGPT/Codex (planned)
- [ ] Cursor (planned)

## Configuration

Config file at `~/.agent-memory/config.json`:

```json
{
  "dbPath": "~/.agent-memory/memory.db",
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "embeddingDimensions": 384,
  "autoEmbed": true,
  "logLevel": "normal"
}
```

## Tech Stack

- **Language:** TypeScript + Node.js (ESM)
- **Database:** SQLite + [sqlite-vec](https://github.com/asg017/sqlite-vec) (vector search + FTS5)
- **Embeddings:** Local ONNX (all-MiniLM-L6-v2, 384 dims, ~23MB, no API key)
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- **Testing:** Vitest (310 tests)
- **CI:** GitHub Actions (test + build + typecheck on Node 20/22)

## Development

```bash
git clone https://github.com/stefanvo78/cross-agent-memory
cd cross-agent-memory
npm install
npm test          # Run all tests
npm run build     # Build to dist/
npm link          # Global install for development
```

## License

MIT
