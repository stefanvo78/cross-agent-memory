# Cross-Agent Memory

> Seamlessly switch between AI coding agents without losing context.

A local-first tool that captures session state from different AI coding agents (GitHub Copilot CLI, Claude Code, and more) and makes it available to any agent via MCP, so you can pick up exactly where you left off — even with a different tool.

## The Problem

AI coding agents forget everything when you switch tools. If Copilot's tokens run out and you switch to Claude Code, you start from zero — re-explaining your project, decisions, and progress. This wastes time and tokens.

## The Solution

**Cross-Agent Memory** provides:

1. **Stop Hooks** — Automatically capture session summaries when an agent session ends
2. **Unified Vector DB** — Single SQLite + sqlite-vec database storing all sessions across all agents and projects
3. **MCP Server** — Any agent can query the shared memory via standard MCP protocol to get context, search history, and receive a "handoff" prompt

## Quick Start

```bash
npm install -g cross-agent-memory

# One-time setup: installs hooks for your agents
cross-agent-memory setup

# Start the MCP server (agents connect automatically)
cross-agent-memory serve
```

## How It Works

```
Agent A session ends → Stop Hook fires → Ingest script reads session state
→ Embeds summary → Stores in ~/.agent-memory/memory.db

Agent B starts → MCP Server is running → Agent calls get_handoff()
→ Gets: "Last session (Copilot) completed X. Remaining: Y, Z."
```

## Supported Agents

- [x] GitHub Copilot CLI
- [x] Claude Code
- [ ] Gemini CLI (planned)
- [ ] ChatGPT/Codex (planned)
- [ ] Cursor (planned)

## Tech Stack

- **Language:** TypeScript + Node.js
- **Database:** SQLite + [sqlite-vec](https://github.com/asg017/sqlite-vec) (vector search)
- **Embeddings:** Local ONNX (all-MiniLM-L6-v2, 384 dims, ~23MB, no API key)
- **Protocol:** [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- **Testing:** Vitest

## License

MIT
