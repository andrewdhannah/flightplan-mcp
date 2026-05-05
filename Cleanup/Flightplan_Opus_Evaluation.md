# Flightplan — Full Project Evaluation Brief
**For:** Claude Opus  
**From:** Andrew (project author)  
**Date:** May 4, 2026  
**Purpose:** Independent technical and strategic review of Phase 1

---

## What I need from you

A full honest evaluation of this project. Push back hard where warranted.
I want to know what's good, what's missing, what's wrong, and what I haven't thought of.
Do not soften the feedback.

Specific questions at the end — but read everything first.

---

## What Flightplan is

An MCP (Model Context Protocol) server that gives AI coding agents token runway awareness.
Local-first, SQLite-backed, Canadian-built.

The agent calls `get_runway()` before high-cost operations and knows whether it has
runway to proceed. The metaphor: a goose knows how far it can fly before it needs to land.

**Core problem it solves:**
AI coding agents have finite context windows. When a session runs out mid-task, work is
lost, the agent cuts off mid-thought, and the user restarts from scratch. Providers don't
publish hard token limits — they use opaque session windows that change with demand.
Community estimates go stale silently.

**Flightplan's answer:** stop guessing. Track real burn. Dead Reckoning (Phase 2) calibrates
automatically from real observed session data.

---

## Architecture decisions — locked in Phase 1

- **Two binaries:** `flightplan-mcp` (MCP server + init wizard) and `flightplan` (status CLI)
- **Single DB file:** `~/.flightplan/flightplan.db` — no separate config file
- **Mechanism A:** Agent self-reports tokens at session end. No continuous per-turn ticks
  (Mechanism B rejected — costs too many tokens to track tokens)
- **Provider-agnostic:** No hardcoded plan limits. User sets their own baseline at init.
- **ESM throughout:** `"type": "module"` in package.json
- **Local-first:** One SQLite file. No cloud, no auth, no telemetry.
- **Node 18–22 required:** better-sqlite3 and sqlite-vec have pre-built binaries for this range only

---

## The Goose Scale

Eight flight states:

| Level | Meaning | % Consumed |
|-------|---------|------------|
| PREFLIGHT | No session active | — |
| CRUISING | Nominal burn | 0–50% |
| HEADWIND | Burning faster than baseline | 50–75% |
| TURBULENCE | Tight runway | 75–90% |
| HONK | Exhausted | 90%+ |
| LANDING | Session ended | — |
| REFUELLED | New session started | — |
| WAYWARD | Dead Reckoning drifted (Phase 2) | — |

---

## What was built (Phase 1 — complete)

### Files

```
src/
├── index.ts          — MCP server, registers 3 tools
├── cli.ts            — init wizard (3 questions, optional calibration)
├── status.ts         — flightplan status CLI (human-readable + --json flag)
├── types.ts          — shared TypeScript interfaces
├── db/
│   ├── paths.ts      — cross-platform ~/.flightplan/ path
│   ├── schema.ts     — SQL DDL (3 tables)
│   └── connection.ts — DB singleton, WAL mode, schema application
├── tools/
│   ├── get_runway.ts     — MCP tool: returns RunwayResponse
│   ├── session_start.ts  — MCP tool: opens tracking session
│   └── record_session.ts — MCP tool: archives session, clears active
└── state/
    └── goose_scale.ts — 8 states, level calculation, baseline resolution
```

### Database schema

**config** — key/value, written by init wizard:
- provider_name, provider_key, session_baseline, baseline_source, warn_threshold, initialized_at

**active_session** — single-row table (id = 'current'):
- session_id (nullable — null = PREFLIGHT), started_at, goose_level,
  tokens_observed, provider, model, project_id

**usage_snapshots** — historical archive:
- session_id (UNIQUE), started_at, ended_at, duration_minutes, tokens_total,
  goose_level_final, provider, model, project_id, baseline_at_time, notes

### MCP tools

**get_runway()** — no parameters
- Reads active_session + config
- Returns: level, window_remaining_pct, window_remaining_tokens, token_range,
  burn_rate_per_hour (0 in Phase 1), time_remaining_minutes (0 in Phase 1),
  data_source, formation_trust, recommended_action, _debug block

**session_start(provider?, model?, project_id?)**
- Upserts active_session row
- Generates UUID session_id
- Returns: session_id, started_at, level (REFUELLED), message

**record_session(tokens_total, notes?)**
- Validates tokens_total
- Reads active_session
- Calculates duration
- Writes to usage_snapshots (ON CONFLICT DO NOTHING — idempotent)
- Clears active_session to PREFLIGHT
- Returns: session_id, tokens_total, duration_minutes, final_level,
  sessions_archived, message (with Phase 2 countdown)

### Config and tooling
- package.json: ESM, two bin entries, Node engine range 18–22
- tsconfig.json: NodeNext modules, strict mode, noUncheckedIndexedAccess
- .nvmrc: pins Node 20 LTS
- scripts/smoke-test.js: verifies better-sqlite3 and sqlite-vec load correctly
- Three-layer Node version protection: .nvmrc + engines field + runtime check in index.ts

---

## Phase 2 plan (Dead Reckoning)

After 5 sessions archived in usage_snapshots:
- Calculate average tokens per session → replace user baseline with observed average
- Calculate burn_rate_per_hour from duration_minutes + tokens_total
- Derive time_remaining_minutes from burn rate + runway remaining
- Widen token_range into a real confidence interval
- Add pattern_library table for project-specific velocity profiles
- WAYWARD level activates when Dead Reckoning drifts >40% over 3+ sessions

---

## Phase 3 plan (Formation Trust)

- Flock File: opt-in anonymous session sharing for community velocity profiles
- Formation Trust active state: community profiles improve individual estimates
- HONK notes: auto-generated session summaries when runway is exhausted
- Multi-agent coordination (speculative)

---

## What I want evaluated

### 1. Architecture — is it sound?
- Is Mechanism A (end-of-session self-reporting) the right call?
  What failure modes am I not seeing?
- Is the single active_session row pattern robust enough?
  What happens if session_start is called without record_session first?
- Is SQLite the right storage layer for this use case?
- Is there anything in the schema that will cause pain in Phase 2?

### 2. The Goose Scale — is it right?
- Are the threshold percentages (50/75/90) well-chosen?
- Are 8 levels the right number? Too many? Too few?
- Is WAYWARD well-placed for Phase 2? Is the >40% drift threshold reasonable?
- Is HONK at 90% too late? Should it be 85%?

### 3. MCP tool design — are these the right tools?
- Are the three tools the right decomposition?
- Is the get_runway() response shape well-designed for agent consumption?
- Should session_start() and record_session() be merged into one tool?
- Anything in the tool descriptions that would confuse an agent?

### 4. Phase 2 / Dead Reckoning — is the plan realistic?
- Is 5 sessions a reasonable threshold before calibration kicks in?
- Is burn_rate_per_hour a useful metric, or is tokens_per_session more actionable?
- What's missing from the schema that Phase 2 will need?

### 5. Blind spots — what am I missing?
- What's the most likely failure mode in real-world use?
- What will the first bug report be about?
- Is there a competitive tool or approach I should know about?
- What question should I be asking that I'm not asking?

### 6. README and positioning — does it land?
- Does the README clearly explain the problem and solution?
- Is the Goose Scale metaphor an asset or a liability for adoption?
- What's the one-line pitch?
- Who is the real target user?

### 7. Go-to-market — when is it ready?
- What's missing before this is ready for npm publish?
- Is Show HN the right launch venue?
- What communities beyond r/ClaudeAI should see this?

---

## Context about the build process

- Built in 2 sessions (May 2 + May 4, 2026) by Andrew + Ash (Claude Sonnet 4.6)
- Andrew's background: experienced developer, new to TypeScript and app programming
- BMAD methodology was discussed but not formally applied — build plan served as PRD
- ~800 lines of production TypeScript, fully documented
- All TypeScript strict mode errors resolved
- Smoke test: 5/5
- Build: clean

---

## Attached files for review

Please review all of the following before responding:

1. `README.md` — project documentation
2. `src/index.ts` — MCP server entry point
3. `src/cli.ts` — init wizard
4. `src/status.ts` — status CLI
5. `src/types.ts` — shared types
6. `src/db/paths.ts` — path resolution
7. `src/db/schema.ts` — SQL DDL
8. `src/db/connection.ts` — DB singleton
9. `src/tools/get_runway.ts` — core MCP tool
10. `src/tools/session_start.ts` — session open tool
11. `src/tools/record_session.ts` — session archive tool
12. `src/state/goose_scale.ts` — Goose Scale + calculations
13. `package.json` — project config
14. `tsconfig.json` — TypeScript config
15. `scripts/smoke-test.js` — dependency verification

---

*Push back hard. The 🪿 can take it.*
