# Phase 2: Copilot CLI Ingester

> Branch: `feat/copilot-ingester`
> Depends on: Phase 1 (Foundation)

## Goal

Build a parser that reads GitHub Copilot CLI session state and ingests it into the shared database.

## Copilot CLI Session State Format

Location: `~/.copilot/session-state/{session-uuid}/`

```
{session-uuid}/
├── workspace.yaml          # Session metadata
├── events.jsonl            # Conversation events (user messages, tool calls, responses)
├── checkpoints/
│   ├── index.md            # Checkpoint index
│   ├── 001-some-title.md   # Structured checkpoint (overview, history, work_done, etc.)
│   └── 002-another.md
├── files/                  # Session artifacts (plan.md, etc.)
└── research/               # Research artifacts
```

### workspace.yaml

```yaml
id: ee3a2643-f9cc-4f15-8a61-f723405c3fe7
cwd: /Users/user/project
summary: Build authentication module
summary_count: 0
created_at: 2026-03-05T01:25:21.817Z
updated_at: 2026-03-05T01:28:18.455Z
```

### Checkpoint format (XML-like sections in Markdown)

```markdown
<overview>
The user is building an auth module...
</overview>

<history>
1. Created JWT middleware
2. Added login endpoint
</history>

<work_done>
Files created:
- src/auth/jwt.ts
- src/auth/middleware.ts
</work_done>

<technical_details>
Using bcrypt for password hashing...
</technical_details>

<important_files>
- src/auth/jwt.ts
- src/auth/middleware.ts
</important_files>

<next_steps>
- Add logout endpoint
- Write tests
</next_steps>
```

## Deliverables

### 1. Copilot Parser (`src/ingest/copilot.ts`)

- `parseCopilotSession(sessionDir: string): Promise<SessionData>`
  - Parse `workspace.yaml` for metadata
  - Find and parse latest checkpoint for structured state
  - Extract file operations from `events.jsonl`
  - Map checkpoint sections to SessionData fields:
    - `overview` + `history` → `summary`
    - `work_done` → `tasksCompleted`
    - `next_steps` → `tasksPending`
    - `important_files` + events → `filesModified`
    - decisions from history → `keyDecisions`

- `findLatestCopilotSession(cwd?: string): Promise<string | null>`
  - Scan `~/.copilot/session-state/` for sessions matching the cwd
  - Return most recently updated session directory

### 2. Ingest Command

- `cross-agent-memory ingest copilot [--session-id <uuid>] [--cwd <path>]`
  - Finds latest session (or specific one)
  - Parses it
  - Embeds summary chunks
  - Stores in database

### 3. Hook Configuration Generator

- `cross-agent-memory setup copilot [--project <path>]`
  - Generates `.github/hooks/hooks.json` in the project:
    ```json
    {
      "version": 1,
      "hooks": {
        "sessionEnd": [{
          "type": "command",
          "bash": "cross-agent-memory ingest copilot",
          "timeoutSec": 30
        }]
      }
    }
    ```

## Tests

- Parse workspace.yaml → correct metadata
- Parse checkpoint markdown → correct section extraction
- Extract files from events.jsonl → correct file list
- Find latest session by cwd → correct session directory
- Full ingest pipeline: parse → embed → store → retrieve

## Acceptance Criteria

- [ ] Can parse a real Copilot session directory
- [ ] Checkpoint sections correctly mapped to SessionData
- [ ] Ingest command stores session in DB with embeddings
- [ ] Setup command generates correct hooks.json
- [ ] Can retrieve ingested Copilot session via DB queries
