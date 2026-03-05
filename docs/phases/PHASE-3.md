# Phase 3: Claude Code Ingester

> Branch: `feat/claude-ingester`
> Depends on: Phase 2 (Copilot Ingester)

## Goal

Build a parser that reads Claude Code session state and ingests it into the shared database.

## Claude Code Session State Format

### Session Transcripts

Location: `~/.claude/projects/{encoded-path}/{session-id}.jsonl`

The path is the project directory with `/` replaced by `-`:
- `/Users/user/Sources/MyProject` → `-Users-user-Sources-MyProject`

Each line is a JSON object representing a conversation event:

```jsonl
{"type":"file-history-snapshot","messageId":"...","snapshot":{...},"timestamp":"..."}
{"type":"human","text":"Add login endpoint","timestamp":"..."}
{"type":"assistant","text":"I'll create...","timestamp":"..."}
{"type":"tool_use","name":"edit","input":{...},"timestamp":"..."}
{"type":"tool_result","content":"...","timestamp":"..."}
```

### Session Directories

For longer sessions, subdirectories contain subagent transcripts and tool results:
```
{session-id}/
├── subagents/
│   └── agent-{hash}.jsonl
└── tool-results/
    └── {hash}.json
```

### MEMORY.md

Location: `~/.claude/projects/{encoded-path}/memory/MEMORY.md`

Persistent project knowledge in Markdown format:
```markdown
# ProjectName — Project Memory

## What is this?
Description of the project...

## Current State
What's been built so far...

## Key Files
- src/auth/jwt.ts — JWT middleware
...

## Important Patterns
- Pattern descriptions...

## Tech Stack
- Framework choices...
```

### Session Index

`~/.claude/history.jsonl` — One JSON object per line tracking session exits:
```jsonl
{"display":"exit","timestamp":1768840251531,"project":"/path","sessionId":"uuid"}
```

## Deliverables

### 1. Claude Parser (`src/ingest/claude.ts`)

- `parseClaudeSession(sessionPath: string): Promise<SessionData>`
  - Parse JSONL transcript for conversation events
  - Extract human messages, assistant responses, tool calls
  - Identify file modifications from `edit` and `create` tool calls
  - Summarize conversation into structured SessionData
  - Extract decisions, tasks from assistant responses

- `findLatestClaudeSession(cwd: string): Promise<string | null>`
  - Encode cwd to Claude's path format
  - Scan `~/.claude/projects/{encoded-path}/` for JSONL files
  - Return most recently modified session file

- `parseClaudeMemory(cwd: string): Promise<string | null>`
  - Read and return MEMORY.md content if it exists

### 2. Ingest Command

- `cross-agent-memory ingest claude [--session-id <uuid>] [--cwd <path>]`
  - Finds latest Claude session for the project
  - Parses transcript
  - Also reads MEMORY.md and stores as knowledge entries
  - Embeds and stores in database

### 3. Hook Configuration Generator

- `cross-agent-memory setup claude [--project <path>]`
  - Updates `.claude/settings.json` to add SessionEnd hook:
    ```json
    {
      "hooks": {
        "SessionEnd": [{
          "hooks": [{
            "type": "command",
            "command": "cross-agent-memory ingest claude"
          }]
        }]
      }
    }
    ```

## Tests

- Parse Claude JSONL transcript → correct message extraction
- Extract file modifications from tool_use events
- Encode/decode project path → matches Claude's format
- Parse MEMORY.md → correct knowledge entries
- Full ingest pipeline: parse → embed → store → retrieve

## Acceptance Criteria

- [ ] Can parse a real Claude Code session JSONL
- [ ] Transcript correctly mapped to SessionData
- [ ] MEMORY.md imported as knowledge entries
- [ ] Ingest command stores session in DB with embeddings
- [ ] Setup command generates correct settings.json hook
- [ ] Can retrieve ingested Claude session via DB queries
