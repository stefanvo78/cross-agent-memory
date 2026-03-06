# Cross-Agent Memory — Getting Started Tutorial

> A step-by-step guide to installing, configuring, and using cross-agent-memory with GitHub Copilot CLI and Claude Code on a real project.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Create a Test Project](#3-create-a-test-project)
4. [Configure Stop Hooks](#4-configure-stop-hooks)
5. [Configure the MCP Server](#5-configure-the-mcp-server)
6. [Test 1: Work with GitHub Copilot CLI](#6-test-1-work-with-github-copilot-cli)
7. [Test 2: Ingest the Copilot Session](#7-test-2-ingest-the-copilot-session)
8. [Test 3: Switch to Claude Code](#8-test-3-switch-to-claude-code)
9. [Test 4: Verify the Handoff](#9-test-4-verify-the-handoff)
10. [Test 5: Check the Dashboard](#10-test-5-check-the-dashboard)
11. [Test 6: Share with Your Team (Git Sync)](#11-test-6-share-with-your-team-git-sync)
12. [Test 7: Simulate a Teammate Picking Up](#12-test-7-simulate-a-teammate-picking-up)
13. [Test 8: Store and Search Knowledge](#13-test-8-store-and-search-knowledge)
14. [Test 9: Automatic Stop Hooks (End-to-End)](#14-test-9-automatic-stop-hooks-end-to-end)
15. [Test 10: Multi-Session History](#15-test-10-multi-session-history)
16. [Configuration Reference](#16-configuration-reference)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Prerequisites

Before you start, make sure you have:

- **Node.js 20+** — `node --version`
- **Git** — `git --version`
- **GitHub Copilot CLI** — installed and authenticated (`gh copilot --version` or the standalone `copilot` command)
- **Claude Code** — installed and authenticated (`claude --version`)

> 💡 You don't need both agents to follow this tutorial. You can test with just one and skip the other's sections.

---

## 2. Installation

### Install cross-agent-memory globally

```bash
# Clone and build from source
git clone https://github.com/stefanvo78/cross-agent-memory.git
cd cross-agent-memory
npm install
npm run build
npm link

# Verify
cross-agent-memory --version
```

### Initialize the database and embedding model

```bash
cross-agent-memory init
```

This does two things:
1. Downloads the ONNX embedding model (`all-MiniLM-L6-v2`, ~23MB) for local semantic search
2. Creates the SQLite database at `~/.agent-memory/memory.db`

### Verify the installation

```bash
cross-agent-memory status
```

You should see:
```
cross-agent-memory status
  Sessions:  0
  Chunks:    0
```

✅ **Checkpoint:** The tool is installed and the database is empty.

---

## 3. Create a Test Project

Create a small project that both agents will work on:

```bash
mkdir ~/test-agent-handoff
cd ~/test-agent-handoff
git init
```

Create a simple starter file:

```bash
cat > app.js << 'EOF'
// Simple Express API — needs authentication and a database
const express = require('express');
const app = express();

app.get('/api/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }]);
});

app.listen(3000, () => console.log('Server on :3000'));
EOF

cat > package.json << 'EOF'
{
  "name": "test-agent-handoff",
  "version": "1.0.0",
  "scripts": { "start": "node app.js" }
}
EOF

git add -A && git commit -m "Initial commit: simple Express API"
```

✅ **Checkpoint:** You have a small project with a starter Express API.

---

## 4. Configure Stop Hooks

Stop hooks automatically capture session context when an agent session ends.

```bash
cd ~/test-agent-handoff

# Set up hooks for both agents
cross-agent-memory setup copilot --project ~/test-agent-handoff
cross-agent-memory setup claude --project ~/test-agent-handoff
```

This creates:
- `.github/hooks/hooks.json` — triggers `cross-agent-memory ingest copilot` when a Copilot CLI session ends
- `.claude/settings.json` — triggers `cross-agent-memory ingest claude` when a Claude Code session ends

### Verify the hook files

```bash
cat .github/hooks/hooks.json
```

Expected:
```json
{
  "hooks": {
    "sessionEnd": {
      "command": "cross-agent-memory",
      "args": ["ingest", "copilot", "--cwd", "/Users/you/test-agent-handoff"]
    }
  }
}
```

```bash
cat .claude/settings.json
```

Expected:
```json
{
  "hooks": {
    "SessionEnd": {
      "command": "cross-agent-memory ingest claude --cwd /Users/you/test-agent-handoff"
    }
  }
}
```

✅ **Checkpoint:** Stop hooks are configured for both agents.

---

## 5. Configure the MCP Server

The MCP server allows agents to **query** the shared memory during a session (not just at session end).

### For GitHub Copilot CLI

Create `.vscode/mcp.json` in your project:

```bash
mkdir -p .vscode
cat > .vscode/mcp.json << 'EOF'
{
  "servers": {
    "cross-agent-memory": {
      "command": "cross-agent-memory",
      "args": ["serve"]
    }
  }
}
EOF
```

### For Claude Code

```bash
claude mcp add cross-agent-memory -- cross-agent-memory serve
```

Or manually add to your Claude MCP configuration.

### Verify the MCP server starts

```bash
# Test that the server starts without errors (Ctrl+C to stop)
cross-agent-memory serve --debug
```

You should see it waiting for MCP connections on stdin/stdout.

✅ **Checkpoint:** The MCP server is configured for both agents.

---

## 6. Test 1: Work with GitHub Copilot CLI

Start a Copilot CLI session and give it a task. This is the "first agent" that will create context.

```bash
cd ~/test-agent-handoff
```

Open **GitHub Copilot CLI** and give it this prompt:

> Add JWT authentication middleware to app.js. Create a middleware function that verifies Bearer tokens from the Authorization header. Also create an auth.js module with login and token generation functions. Use jsonwebtoken. Don't actually install packages, just write the code.

Let Copilot work on the task. When it's done (or when you've had a few back-and-forth exchanges), **end the session** (Ctrl+C, `/exit`, or close the terminal).

> 💡 The stop hook should fire automatically and run `cross-agent-memory ingest copilot`. If you see errors, you can run it manually in the next step.

✅ **Checkpoint:** You've completed a Copilot session that made some changes to the project.

---

## 7. Test 2: Ingest the Copilot Session

If the stop hook didn't fire automatically, ingest manually:

```bash
# Ingest the most recent Copilot session for this project
cross-agent-memory ingest copilot --cwd ~/test-agent-handoff
```

Expected output:
```
Ingesting copilot session abc12345...
✓ Session ingested successfully
  Session ID:  abc12345-...
  Project:     you/test-agent-handoff
  Chunks:      6
  Summary:     ## Session: Add JWT authentication middleware...
```

### Verify the data is stored

```bash
cross-agent-memory status
```

Expected:
```
cross-agent-memory status
  Sessions:  1
  Chunks:    6
```

✅ **Checkpoint:** The Copilot session is captured in the database with embedded chunks.

---

## 8. Test 3: Switch to Claude Code

Now pretend Copilot's tokens ran out and you need to switch to Claude Code. Start a Claude session in the **same project**:

```bash
cd ~/test-agent-handoff
claude
```

**Don't give it any task yet.** Instead, if the MCP server is configured, Claude can query the shared memory. Try asking Claude:

> Use the cross-agent-memory MCP server to call get_handoff and find out what was done in the previous session. Then continue the work — add rate limiting middleware and input validation to the auth endpoints.

Claude should:
1. Call `get_handoff()` via MCP
2. See the Copilot session's summary, pending tasks, files modified, and decisions
3. Continue the work with full context

### If MCP isn't available, simulate the handoff manually

If the MCP connection isn't working, you can show Claude the context by first checking what's available:

```bash
# See what the handoff would look like
cross-agent-memory push --cwd ~/test-agent-handoff
cat ~/test-agent-handoff/.agent-memory/HANDOFF.md
```

Then start Claude and paste the contents of `HANDOFF.md` as context.

✅ **Checkpoint:** Claude has the context from Copilot's session and can continue the work.

---

## 9. Test 4: Verify the Handoff

After Claude finishes, ingest its session too:

```bash
cross-agent-memory ingest claude --cwd ~/test-agent-handoff
```

Now check status:

```bash
cross-agent-memory status
```

Expected:
```
cross-agent-memory status
  Sessions:  2
  Chunks:    12
```

You now have **two sessions from two different agents** in the same database, both for the same project.

✅ **Checkpoint:** Both agent sessions are captured. The memory spans across agents.

---

## 10. Test 5: Check the Dashboard

Launch the web dashboard to visualize everything:

```bash
cross-agent-memory dashboard
```

Open [http://localhost:3847](http://localhost:3847) in your browser.

### What to verify:

| Section | What you should see |
|---------|-------------------|
| **Stats cards** | 2 sessions, 12+ chunks, 1 project |
| **Sessions table** | Two rows: one `copilot` (green badge), one `claude` (orange badge) |
| **Project filter** | Your test project listed |
| **Session detail** | Click a session → see summary, files modified, decisions |

✅ **Checkpoint:** The dashboard shows both sessions with their summaries and metadata.

---

## 11. Test 6: Share with Your Team (Git Sync)

Export the session data to the git repo so teammates can pick up your work:

```bash
cd ~/test-agent-handoff

# Export sessions and knowledge to .agent-memory/
cross-agent-memory push --cwd ~/test-agent-handoff
```

Expected output:
```
✓ Exported to .agent-memory/
  Sessions:  2 new
  Knowledge: 0 entries
  HANDOFF.md updated

Run 'git add .agent-memory && git commit' to share with your team.
```

### Inspect the exported files

```bash
# The auto-generated handoff document
cat .agent-memory/HANDOFF.md
```

You should see a clean markdown document with:
- The latest session summary
- Pending tasks
- Files modified
- Key decisions
- A session history table

```bash
# The exported session files (structured JSON, no raw transcripts)
ls .agent-memory/sessions/
cat .agent-memory/sessions/*.json | head -30
```

Each session file contains only the structured summary — no raw conversation transcripts, no embeddings, no absolute paths.

```bash
# The sync config
cat .agent-memory/config.json
```

### Commit and push to share

```bash
git add .agent-memory
git commit -m "chore: update agent memory handoff"
git push
```

✅ **Checkpoint:** The `.agent-memory/` directory is in git with structured session data and a human-readable `HANDOFF.md`.

---

## 12. Test 7: Simulate a Teammate Picking Up

To simulate a teammate receiving your context:

```bash
# Clear your local database to simulate a fresh machine
rm ~/.agent-memory/memory.db

# Verify it's empty
cross-agent-memory init
cross-agent-memory status
# → Sessions: 0, Chunks: 0

# Import from the git repo
cross-agent-memory pull --cwd ~/test-agent-handoff
```

Expected output:
```
✓ Imported from .agent-memory/
  Sessions:  2 new
  Knowledge: 0 new entries
```

```bash
cross-agent-memory status
# → Sessions: 2, Chunks: 0 (embeddings regenerated on demand, not from file)
```

Now start either agent, and the handoff context is available:

```bash
cd ~/test-agent-handoff
# Read the HANDOFF.md directly
cat .agent-memory/HANDOFF.md

# Or start an agent and use MCP to call get_handoff()
```

✅ **Checkpoint:** A "teammate" can pull session history from git and continue with full context.

---

## 13. Test 8: Store and Search Knowledge

Knowledge entries are persistent facts that survive across sessions (decisions, gotchas, patterns).

### Store knowledge via the MCP server

Start an agent and ask it to use the MCP tool:

> Use the cross-agent-memory MCP tool `store_knowledge` to save this decision: "We chose JWT over session-based auth because the API is stateless and will be used by mobile clients."

Or, after pushing sessions, knowledge entries are automatically exported.

### Search knowledge

From an agent, use the MCP tool:

> Use `search_memory` to find everything about "authentication" in this project.

The tool performs both keyword (FTS5) and semantic (vector) search across all sessions and knowledge.

✅ **Checkpoint:** Knowledge can be stored and searched across agents.

---

## 14. Test 9: Automatic Stop Hooks (End-to-End)

This is the full hands-off flow. Verify that **no manual `ingest` is needed**:

1. Start Copilot CLI in the test project
2. Do some work (ask it to add a `/api/health` endpoint)
3. End the session normally (Ctrl+C or `/exit`)
4. Check if the session was automatically ingested:
   ```bash
   cross-agent-memory status
   ```
   The session count should have increased by 1.

5. Now start Claude Code in the same project
6. Ask Claude to use `get_handoff()` — it should see the session you just ended
7. End the Claude session
8. Check status again — count should increase again

If the hook didn't fire, check:
```bash
# Copilot hook config
cat ~/test-agent-handoff/.github/hooks/hooks.json

# Claude hook config  
cat ~/test-agent-handoff/.claude/settings.json

# Try running the ingest manually to see errors
cross-agent-memory ingest copilot --cwd ~/test-agent-handoff --verbose
```

✅ **Checkpoint:** Sessions are automatically captured at session end without manual steps.

---

## 15. Test 10: Multi-Session History

After running several sessions (at least 3-4 across both agents), verify the full history:

```bash
# Dashboard shows all sessions
cross-agent-memory dashboard
# → Open http://localhost:3847

# Push all sessions to git
cross-agent-memory push --cwd ~/test-agent-handoff

# Check the HANDOFF.md has a history table
cat .agent-memory/HANDOFF.md
```

The `HANDOFF.md` should now show a **Session History** table like:

```markdown
## Session History

| Agent   | When                 | Summary                                      |
|---------|----------------------|----------------------------------------------|
| claude  | 2026-03-06T22:30:00Z | Added rate limiting and input validation...   |
| copilot | 2026-03-06T22:15:00Z | Added JWT authentication middleware...        |
| claude  | 2026-03-06T22:45:00Z | Added health endpoint and error handling...   |
```

### Bidirectional sync

```bash
# After a teammate pushed their sessions:
git pull
cross-agent-memory sync --cwd ~/test-agent-handoff
```

This runs `pull` (import their sessions) then `push` (export yours), keeping everything in sync.

✅ **Checkpoint:** Full session history is tracked, visible in the dashboard, and synced via git.

---

## 16. Configuration Reference

### Global config: `~/.agent-memory/config.json`

```json
{
  "dbPath": "~/.agent-memory/memory.db",
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "embeddingDimensions": 384,
  "autoEmbed": true,
  "logLevel": "normal"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `~/.agent-memory/memory.db` | Path to the SQLite database |
| `embeddingModel` | `Xenova/all-MiniLM-L6-v2` | ONNX model for local embeddings |
| `embeddingDimensions` | `384` | Vector dimensions (must match model) |
| `autoEmbed` | `true` | If `false`, store text without vectors (faster, no semantic search) |
| `logLevel` | `normal` | `quiet`, `normal`, or `verbose` |

### Team sync config: `.agent-memory/config.json` (in repo)

```json
{
  "version": 1,
  "maxSessions": 20,
  "includeKnowledge": true,
  "excludeAgents": []
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxSessions` | `20` | Max sessions to keep in the repo |
| `includeKnowledge` | `true` | Whether to sync knowledge entries |
| `excludeAgents` | `[]` | Agents to exclude (e.g., `["chatgpt"]`) |

### CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Download embedding model + create database |
| `ingest <agent>` | Manually ingest a session (`copilot`, `claude`, `gemini`) |
| `setup [agent]` | Install stop hooks and MCP config |
| `serve` | Start the MCP server |
| `status` | Show database statistics |
| `dashboard` | Launch web dashboard (default port 3847) |
| `push` | Export sessions → `.agent-memory/` in repo |
| `pull` | Import `.agent-memory/` → local database |
| `sync` | Pull then push (bidirectional) |

### MCP Tools (available to agents)

| Tool | Description |
|------|-------------|
| `get_handoff` | Get complete context from the last session for seamless continuation |
| `search_memory` | Semantic + keyword search across all sessions and knowledge |
| `store_knowledge` | Save a decision, pattern, gotcha, or architecture note |
| `get_project_context` | Get all knowledge and recent sessions for a project |

---

## 17. Troubleshooting

### "No session found for copilot"

The ingester couldn't find a session in `~/.copilot/session-state/`. This happens if:
- The Copilot CLI session directory is in a different location
- The session hasn't been saved yet (Copilot may buffer writes)
- You're using VS Code's Copilot Chat (different format from Copilot CLI)

**Fix:** Specify the session ID directly:
```bash
ls ~/.copilot/session-state/
cross-agent-memory ingest copilot --session-id <uuid-from-above>
```

### "No session found for claude"

Claude stores sessions at `~/.claude/projects/<encoded-path>/`. The encoded path is derived from your project directory.

**Fix:**
```bash
ls ~/.claude/projects/
cross-agent-memory ingest claude --cwd ~/test-agent-handoff
```

### MCP server not connecting

Make sure the server starts cleanly:
```bash
cross-agent-memory serve --debug
```

For Copilot, ensure `.vscode/mcp.json` is correct. For Claude, verify with:
```bash
claude mcp list
```

### Embedding model download fails

If you're behind a proxy or firewall, the ONNX model download may fail. You can disable embeddings:
```bash
# Edit ~/.agent-memory/config.json
{ "autoEmbed": false }
```

Sessions will still be stored and searchable via keyword (FTS5), but semantic vector search won't be available.

### Stop hooks not firing

- **Copilot:** Check `.github/hooks/hooks.json` exists in the project root and the `sessionEnd` command is correct
- **Claude:** Check `.claude/settings.json` has the `SessionEnd` hook configured
- Run the ingest command manually with `--verbose` to see errors:
  ```bash
  cross-agent-memory ingest copilot --cwd ~/test-agent-handoff --verbose
  ```

---

## Summary: What You've Tested

| # | Feature | Tested? |
|---|---------|---------|
| 1 | Install and initialize | ☐ |
| 2 | Configure stop hooks (Copilot + Claude) | ☐ |
| 3 | Configure MCP server | ☐ |
| 4 | Copilot session → ingest | ☐ |
| 5 | Switch to Claude → handoff via MCP | ☐ |
| 6 | Web dashboard visualization | ☐ |
| 7 | Git push (export to repo) | ☐ |
| 8 | Git pull (import from repo) | ☐ |
| 9 | Knowledge store and search | ☐ |
| 10 | Automatic stop hooks (end-to-end) | ☐ |
| 11 | Multi-session history | ☐ |
| 12 | Bidirectional team sync | ☐ |

Check off each item as you complete it. If all 12 pass, the tool is working correctly! 🎉
