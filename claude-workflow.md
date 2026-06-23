# Working with Claude Code — VGCtool

> Practical guide for getting the most out of Claude on this project.  
> Project root: `C:\Users\InfoWare31\Desktop\pokemon-vgc`

---

## How the context system works

Claude starts every session cold — no memory of previous conversations. Three things pre-load context automatically:

| What | File | Purpose |
|---|---|---|
| Project guide | `CLAUDE.md` | Architecture, file map, routes, patterns — loaded every session |
| Memory index | `~/.claude/projects/.../memory/MEMORY.md` | Who you are, preferences, project state |
| Slash commands | `.claude/commands/*.md` | Focused context per subsystem — loaded on demand |

The goal: Claude should **never need to read large source files just to orient itself**. The above system replaces that cold-start reading.

---

## Starting a session

### Step 1 — Open with the right slash command

Always start by typing the command that matches what you're working on:

| Command | Subsystem |
|---|---|
| `/tournament` | Live bracket system (service, routes, Tournament.jsx) |
| `/browse` | TournamentTeams + TournamentResults archive pages |
| `/meta` | MetaAnalysis, MoveLookup, usage data |
| `/teams` | TeamBuilder, slots, EVs, import/export |
| `/draft` | Game Room, Draft/Auction, Socket.IO rooms |
| `/tools` | Calculator, Speed Tier |
| `/data-sync` | Smogon/RK9 sync, DB schema, data routes |
| `/session-end` | End of session — updates CLAUDE.md + memory |

Without a command, Claude starts blind and wastes the first few exchanges re-reading files.

### Step 2 — State the task immediately after

Don't wait for Claude to ask. Give the task in the same message or right after:

```
/tournament

The organizer drop button is not forfeiting playoff matches correctly — 
only Swiss matches get the walkover. Fix it.
```

---

## During a session

### Keep sessions scoped to one feature

One session = one logical unit of work. If you finish a bug fix and want to refactor something unrelated, use `/compact` or start a new session. Cross-feature sessions inflate context with noise that slows Claude down.

### Use `/compact` when switching topics mid-session

After a feature lands and you want to pivot, type `/compact`. Claude compresses everything above into a summary — you keep the context, lose the raw file reads and intermediate reasoning.

### Tell Claude to use Explore agents for searches

When you need to find something across the codebase ("where is X called?", "which files touch Y?"), prompt Claude explicitly:

```
Use an Explore agent to find all places where activated_at is read on the frontend.
```

This keeps the search results out of the main context window. Without this prompt Claude reads files directly, which bloats context.

### Don't over-explain — Claude knows the project

Since CLAUDE.md and the slash commands pre-load the architecture, you don't need to re-explain how the socket system works, what `clientId` is, or what `activated_at` does. Just state the problem:

```
❌  "As you know, we use a signal-not-state socket design where the server 
     pushes tournament:changed and clients refetch their own view…"

✅  "The standings don't refresh after a resolve — check the mut() broadcast."
```

---

## Ending a session

Always run `/session-end` before closing. It will:

1. Update `CLAUDE.md` with any structural changes (new files, routes, status values, component props)
2. Prune stale memory files

**What counts as a structural change** (update needed):
- New file created
- New REST route added
- New status value or lifecycle change
- New shared component or changed props
- New convention established

**What doesn't** (skip the update):
- Bug fixes with no API or file changes
- Style/copy tweaks
- Refactors that don't change the public shape of a module

---

## Memory system

Memory files live at:
```
C:\Users\InfoWare31\.claude\projects\C--Users-InfoWare31-Desktop-pokemon-vgc\memory\
```

Four types — Claude writes these automatically when it learns something:

| Type | What it stores |
|---|---|
| `user` | Your role, preferences, how you like to work |
| `feedback` | Things that worked or didn't — corrections and confirmations |
| `project` | Current goals, deadlines, pending decisions |
| `reference` | Where to find things (external tools, docs, dashboards) |

### To force-save something to memory

```
Remember that I prefer X over Y for this project.
```

### To correct a stale memory

```
Forget that — we changed the approach, now we do Z instead.
```

---

## How to phrase requests

### Bug fixes

Give the symptom, not the hypothesis. Let Claude diagnose:

```
✅  "The organizer can see the Close button when status is running — only complete should show it."
❌  "In the footer conditional, the isMaster check is missing, add it."
```

### New features

Describe the desired behaviour, not the implementation:

```
✅  "Previous rounds should collapse when a new round starts. Clicking a round header should toggle it open/closed."
❌  "Add an openRounds Set to useState and use it to conditionally render the matches div."
```

### Ambiguous requests

If something could go multiple ways, sketch what you expect first (even in plain text) and ask Claude to confirm alignment before implementing. This avoids a full implementation you then have to undo.

---

## What Claude will ask confirmation for

Claude will pause and ask before:
- Pushing to git remote
- Deleting files or branches
- Any irreversible operation

For everything else (editing files, running tests, reading code) it proceeds directly. This is intentional — don't be surprised by it acting without asking.

---

## Running tests

Backend tournament tests:
```
cd backend && node --test src/tournament/match.test.js
```

If you add a new service function that has meaningful edge cases, ask Claude to add a test in `match.test.js`. The test suite uses an in-memory sql.js DB — no setup needed, runs in seconds.

---

## Quick reference — key architectural facts

| Concept | Short answer |
|---|---|
| Player identity | `clientId` from localStorage — stable across refreshes |
| Live updates | Socket pushes `tournament:changed`, clients refetch REST |
| Active match gate | `activated_at != null` — never use `round === currentRound` |
| Tournament status flow | `lobby → running → complete → closed / destroyed` |
| Stale room sweep | Cron at 03:00 daily, 7-day cutoff, sweeps `lobby/running/complete` |
| Teams storage | localStorage `vgc_teams_v2` — no server-side team storage |
| API base | `http://localhost:3001/api` |
| Live tournament routes | `/api/tourney/*` |
| External tournament data | `/api/tournaments/vgc/*` |
