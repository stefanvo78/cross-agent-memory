# Project: Cross-Agent Memory

## Vision

A local-first tool that enables developers to seamlessly switch between AI coding agents (GitHub Copilot CLI, Claude Code, Gemini CLI, ChatGPT, etc.) without losing project context. When one agent's tokens are exhausted, you switch to another and it picks up exactly where the first left off.

## Problem Statement

Today's AI coding agents operate in silos:

- **GitHub Copilot CLI** stores session state in `~/.copilot/session-state/` (JSONL events, YAML workspace, Markdown checkpoints, SQLite session store)
- **Claude Code** stores state in `~/.claude/projects/` (JSONL transcripts, MEMORY.md, settings.json)
- **Other agents** have their own proprietary formats

When a developer switches agents — because tokens ran out, or one tool is better for a specific task — all context is lost. The new agent starts from zero, requiring the developer to re-explain the project, its architecture, decisions made, files modified, and current task progress.

## Solution

**Cross-Agent Memory** solves this with three components:

### 1. Stop Hooks (Session Capture)

Each supported agent has a **sessionEnd hook** that fires automatically when a session ends. The hook runs an ingest script that:

- Reads the agent's native session state files
- Extracts a structured summary: what was done, what's pending, key decisions, files modified
- Generates text embeddings using a local ONNX model (no API keys needed)
- Stores everything in a shared SQLite + sqlite-vec database

### 2. Unified Vector Database

A single SQLite file (`~/.agent-memory/memory.db`) with the sqlite-vec extension serves as the shared memory:

- **Sessions table** — Structured metadata per session (agent, project, summary, tasks, files, decisions)
- **Session embeddings** — Vector embeddings of session chunks for semantic search
- **Knowledge table** — Persistent facts, decisions, gotchas that survive across sessions
- **FTS5 index** — Full-text keyword search complementing vector similarity

All projects and all agents share one database. Project isolation is via `project_id` (normalized git remote, e.g., `user/repo`).

### 3. MCP Server

An MCP (Model Context Protocol) server that any agent can connect to. Exposes tools:

- **`get_handoff`** — Returns a structured "pick up where I left off" prompt with the last session's summary, pending tasks, key decisions, and suggested next steps
- **`search_memory`** — Semantic + keyword search across all sessions for a project
- **`store_knowledge`** — Agents can explicitly store important facts/decisions
- **`get_project_context`** — Full project overview with knowledge + recent sessions

## Design Principles

1. **Local-first** — Everything runs locally. No cloud, no API keys required for core functionality
2. **Single file** — One SQLite database file for all agents and projects
3. **Automatic capture** — Stop hooks capture state without relying on agents to explicitly save
4. **Agent-agnostic** — Any MCP-compatible agent can query the shared memory
5. **Minimal dependencies** — `better-sqlite3` + `sqlite-vec` + ONNX runtime
6. **Non-invasive** — Doesn't modify agent internals; uses official hook mechanisms

## Target Users

- Developers using multiple AI coding agents
- Teams that want to standardize context sharing across tools
- Anyone hitting token limits on one agent and needing to continue with another

## Competitive Landscape

| Tool | Approach | Gap |
|------|----------|-----|
| **Memorix** | MCP server with Orama in-memory + JSON files | No session continuity, no stop hooks, must rebuild index on restart |
| **GitHub Copilot Memory** | Cross-agent within Copilot ecosystem only | Copilot-only, not cross-tool |
| **CLAUDE.md / copilot-instructions.md** | Manual instruction files | Must be manually maintained, no session state |
| **Cross-Agent Memory (this)** | sqlite-vec + stop hooks + MCP | Automatic, persistent, cross-agent session handoff |

## Success Criteria (PoC)

1. Copilot CLI session ends → summary automatically captured in DB
2. Claude Code session ends → summary automatically captured in DB
3. New Copilot session can call `get_handoff()` and receive Claude's last session context (and vice versa)
4. Semantic search across sessions returns relevant results
5. All operations work offline with zero API keys
