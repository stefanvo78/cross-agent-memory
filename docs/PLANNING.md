# Planning

## Phase Overview

The PoC is built in 4 phases, each delivered as a feature branch with PR review before merging to main.

| Phase | Branch | Description | Depends On |
|-------|--------|-------------|------------|
| [Phase 1](phases/PHASE-1.md) | `feat/foundation` | Database schema, embedding engine, core library | — |
| [Phase 2](phases/PHASE-2.md) | `feat/copilot-ingester` | Copilot CLI session parser + ingest command | Phase 1 |
| [Phase 3](phases/PHASE-3.md) | `feat/claude-ingester` | Claude Code session parser + ingest command | Phase 2 |
| [Phase 4](phases/PHASE-4.md) | `feat/mcp-server` | MCP server with handoff, search, and knowledge tools | Phase 3 |

## PR Review Process

Each phase follows this workflow:

1. **Develop** on feature branch
2. **Create PR** to `main`
3. **Automated review** by three specialized agents:
   - 🏗️ **Architecture Agent** — Reviews software design, patterns, modularity, extensibility
   - 🔒 **Security Agent** — Reviews for vulnerabilities, data handling, file permissions
   - 🧪 **Testing Agent** — Creates unit tests, runs them, verifies coverage
4. **Address feedback** from reviews
5. **Merge** to main

## Technology Decisions

| Choice | Technology | Rationale |
|--------|-----------|-----------|
| Language | TypeScript + Node.js | MCP ecosystem standard, sqlite-vec has excellent Node bindings |
| Database | SQLite + sqlite-vec | Single file, ACID, built-in vector search, FTS5 |
| Embeddings | ONNX (all-MiniLM-L6-v2) | Local-first, 384 dims, ~23MB model, ~50ms/embed |
| MCP SDK | @modelcontextprotocol/sdk | Official SDK |
| Testing | Vitest | Fast, TypeScript-native |
| Build | tsup | Fast bundler for TypeScript CLIs |
| CLI | Commander | Standard Node.js CLI framework |

## Directory Structure

```
cross-agent-memory/
├── docs/
│   ├── PROJECT.md              # Project idea and description
│   ├── ARCHITECTURE.md         # System architecture
│   ├── PLANNING.md             # This file (phase overview)
│   └── phases/
│       ├── PHASE-1.md          # Foundation
│       ├── PHASE-2.md          # Copilot ingester
│       ├── PHASE-3.md          # Claude ingester
│       └── PHASE-4.md          # MCP server
├── src/
│   ├── db/
│   │   ├── schema.ts           # Table definitions + migrations
│   │   ├── connection.ts       # SQLite + sqlite-vec setup
│   │   ├── sessions.ts         # Session CRUD operations
│   │   └── knowledge.ts        # Knowledge CRUD operations
│   ├── embedding/
│   │   ├── engine.ts           # Embedding interface + ONNX impl
│   │   └── chunker.ts          # Text chunking for long summaries
│   ├── ingest/
│   │   ├── types.ts            # Shared ingest types
│   │   ├── copilot.ts          # Copilot CLI parser
│   │   ├── claude.ts           # Claude Code parser
│   │   └── project-detector.ts # Git remote → project_id
│   ├── mcp/
│   │   ├── server.ts           # MCP server setup
│   │   └── tools.ts            # Tool definitions (handoff, search, etc.)
│   ├── cli/
│   │   └── index.ts            # CLI entry point
│   └── index.ts                # Library entry point
├── tests/
│   ├── db/
│   ├── embedding/
│   ├── ingest/
│   └── mcp/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── README.md
```
