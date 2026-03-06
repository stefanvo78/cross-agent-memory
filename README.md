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
```

> 📖 **New to cross-agent-memory?** Follow the step-by-step [Getting Started Guide](docs/GETTING-STARTED.md) for a complete walkthrough with hands-on test scenarios.

## How It Works

```
Agent A session ends → Stop Hook fires → Ingest script reads session state
→ Summarizes & embeds → Stores in ~/.agent-memory/memory.db

Agent B starts → MCP Server is running → Agent calls get_handoff()
→ Gets: "Last session (Copilot) completed X. Remaining: Y, Z."
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_handoff` | Get complete context from the last agent session for seamless continuation |
| `search_memory` | Semantic + keyword search across all sessions and knowledge |
| `store_knowledge` | Save important decisions, patterns, or gotchas |
| `get_project_context` | Get all knowledge and recent sessions for a project |

## Git Sync — Team Sharing

Cross-agent-memory includes git-like commands to share session context across team members through your existing git workflow. No extra infrastructure needed — context travels with your code.

### Commands

```bash
# Export local sessions and knowledge to .agent-memory/ in your repo
cross-agent-memory push

# Import .agent-memory/ from repo into your local database
cross-agent-memory pull

# Bidirectional sync (pull first, then push)
cross-agent-memory sync
```

### How It Works

```
Dev A: agent session ends → local DB → push → .agent-memory/ → git commit + push
Dev B: git pull → pull → local DB → get_handoff() → picks up Dev A's context
```

The `push` command exports structured session summaries (no raw transcripts, no embeddings, no local paths) into a `.agent-memory/` directory in your repo:

```
.agent-memory/
├── HANDOFF.md              # Human + agent readable handoff document
├── sessions/               # Structured summaries per session
│   └── <session-id>.json
├── knowledge/              # Shared decisions, patterns, gotchas
│   └── entries.json
└── config.json             # Team sync settings
```

### HANDOFF.md

The `HANDOFF.md` file is the centerpiece — a markdown document that both humans and agents can read. It includes:

- **Latest session summary** — what was done, what's pending
- **Key decisions** — architectural choices, trade-offs
- **Files modified** — what changed and where
- **Session history table** — chronological overview of all sessions
- **Knowledge entries** — team-shared patterns, gotchas, conventions

### Typical Workflow

```bash
# You finish a coding session — the stop hook fires automatically
# Then share your progress:
cross-agent-memory push
git add .agent-memory/
git commit -m "Update agent memory with session context"
git push

# Your teammate pulls and picks up where you left off:
git pull
cross-agent-memory pull
# Their next agent session will automatically get your context via MCP
```

### Privacy & Safety

- **No raw transcripts** — only structured summaries are exported
- **No embeddings** — vectors stay in your local DB
- **No absolute paths** — file paths are sanitized to relative paths
- **No credentials** — config files and environment variables are never exported

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
