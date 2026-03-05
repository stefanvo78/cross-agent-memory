# Phase 4: MCP Server

> Branch: `feat/mcp-server`
> Depends on: Phase 3 (Claude Ingester)

## Goal

Build an MCP server that exposes the shared memory to any connected agent, enabling seamless cross-agent handoff.

## MCP Server Architecture

The server runs as a stdio-based MCP server using `@modelcontextprotocol/sdk`. Agents connect to it via their MCP configuration.

```
Agent ←→ MCP Server (stdio) ←→ SQLite + sqlite-vec DB
```

## Deliverables

### 1. MCP Server (`src/mcp/server.ts`)

Standard MCP server setup:
- Uses `@modelcontextprotocol/sdk` Server class
- stdio transport
- Registers all tools
- Auto-detects project from cwd

### 2. MCP Tools (`src/mcp/tools.ts`)

#### `get_handoff`

The core tool for session continuity. Returns structured context for the new agent.

```typescript
// Input
{ project_id?: string }

// Output
{
  has_previous_session: true,
  last_session: {
    agent: "copilot",
    ended_at: "2026-03-05T01:30:00Z",
    summary: "Built JWT auth module with login/logout endpoints",
    tasks_completed: ["JWT middleware", "Login endpoint", "Logout endpoint"],
    tasks_pending: ["Write tests", "Add refresh token rotation"],
    files_modified: ["src/auth/jwt.ts", "src/auth/middleware.ts"],
    key_decisions: ["15-min JWT expiry", "bcrypt for password hashing"]
  },
  recent_knowledge: [
    { type: "decision", title: "JWT with 15-min expiry", content: "..." }
  ],
  suggested_prompt: "Continue working on the auth module. The last session (Copilot CLI) completed JWT middleware and login/logout endpoints. Remaining tasks: write tests, add refresh token rotation. Key decisions: 15-min JWT expiry, bcrypt for passwords."
}
```

#### `search_memory`

Semantic + keyword search across all sessions for a project.

```typescript
// Input
{ query: string, project_id?: string, limit?: number }

// Output
{
  results: [
    {
      session_id: "abc-123",
      agent: "copilot",
      chunk_text: "Implemented JWT with refresh tokens...",
      similarity_score: 0.87,
      timestamp: "2026-03-05T01:30:00Z"
    }
  ]
}
```

#### `store_knowledge`

Agents can explicitly store important facts/decisions.

```typescript
// Input
{ type: "decision" | "gotcha" | "pattern" | "architecture", title: string, content: string, project_id?: string }

// Output
{ id: 42, stored: true }
```

#### `get_project_context`

Full project overview: all knowledge + recent sessions.

```typescript
// Input
{ project_id: string }

// Output
{
  project_id: "user/repo",
  total_sessions: 12,
  agents_used: ["copilot", "claude"],
  recent_sessions: [...],
  knowledge: [...],
  files_frequently_modified: [...]
}
```

### 3. Agent Configuration Generator

- `cross-agent-memory setup mcp`
  - Generates MCP config for supported agents:

  **Copilot CLI** (`.vscode/mcp.json`):
  ```json
  { "servers": { "cross-agent-memory": { "command": "cross-agent-memory", "args": ["serve"] } } }
  ```

  **Claude Code**:
  ```bash
  claude mcp add cross-agent-memory -- cross-agent-memory serve
  ```

### 4. CLI Serve Command

- `cross-agent-memory serve` — Start MCP server on stdio
- `cross-agent-memory serve --debug` — With verbose logging to stderr

## Tests

- `get_handoff` with no sessions → `{ has_previous_session: false }`
- `get_handoff` with sessions → returns correct last session
- `search_memory` returns results sorted by relevance
- `store_knowledge` persists and is searchable
- `get_project_context` aggregates correctly
- MCP protocol compliance: tools list, tool call/response format

## Acceptance Criteria

- [ ] MCP server starts and lists all 4 tools
- [ ] `get_handoff` returns correct context from previously ingested sessions
- [ ] `search_memory` returns semantically relevant results
- [ ] `store_knowledge` persists knowledge and it's searchable
- [ ] Can configure Copilot CLI and Claude Code to connect to the server
- [ ] End-to-end: Copilot session → ingest → start Claude → `get_handoff` → correct context
