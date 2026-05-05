# 🪿 Flightplan — Phase 1.5 Refinement Brief

**For:** Ash (Claude Sonnet 4.6)
**From:** Andrew, with input from Opus (Claude 4.7) eval, May 4, 2026
**Purpose:** Refine the shipped Phase 1 codebase before npm publish, and prepare Flightplan to operate either standalone or as a component of a larger project.
**Status:** Draft — Andrew to revise, then Ash to implement

---

## Why this document exists

Phase 1 shipped clean: 800 lines of TypeScript, all strict-mode, builds clean, smoke test passes. The architecture is sound. The codebase is small and well-commented.

After an Opus review pass, four real issues surfaced and two framing problems became clear. This document is the punch-list for fixing them, plus a small forward-looking section on making Flightplan composable so a parent project can drive it without forking.

It is not a rewrite. It's a refinement pass before launch.

---

## The thesis (write this down once, reference everywhere)

> **Flightplan is a sprint-velocity tracker for AI-pair-programming sessions.** It measures tokens-per-session as a proxy for how much work an agent can do inside a Pro/Max plan window, and learns the user's real burn rate over time so the agent can plan its own scope against a sprint budget.

This sentence belongs at the top of the README, the top of any future eval brief, and the top of the npm description. Everything else flows from it.

What it implies:
- Flightplan tracks **session-quota tokens**, not in-conversation context tokens. The model already knows the latter.
- The unit of analysis is **the session**, not the turn or the conversation.
- The goal is **cross-session learning**, which is the thing the model can't do on its own.
- The audience is **developers working agile-style with AI pairs**, especially BMAD users.
- The agent is the **primary caller**; the human gets `flightplan status` as a window in.

---

## Issues to fix (in priority order)

Each item below has a why, a what, and a where. Ash should treat these as a checklist. Andrew should review and reorder if needed before Ash starts.

### 1. In-session signal — decide and document

**Why:** Right now, between `session_start` and `record_session`, nothing increments `tokens_observed`. So `get_runway` always returns `CRUISING` at 100% remaining for the whole session. The level system is decorative until session end, at which point the level is computed from the final number and immediately archived. Mid-session HEADWIND/TURBULENCE/HONK transitions cannot occur.

This is either a bug or a deliberate Phase-1 simplification. We need to pick one and say so out loud.

**Decision (Andrew, May 4, 2026):** Option A for v0.1.0. Option B revisits as a Phase 1.5 follow-up after first user feedback.

**What:**
- Add a comment block to `get_runway.ts` stating that Phase 1 returns the level at `session_start` time and does not transition mid-session.
- Change `recommended_action` for `CRUISING` to acknowledge this honestly: "Runway estimate is based on your baseline. Mid-session transitions activate in Phase 2."
- Add a single sentence to the README's MCP Tools section: "Phase 1 sets the level at session start; mid-session transitions arrive with Dead Reckoning in Phase 2."

**Where:**
- `src/tools/get_runway.ts` — comment update or new tool
- `src/index.ts` — register fourth tool if Option B
- `README.md` — explain the choice

---

### 2. Restore `flightplan_meta` with schema_version

**Why:** The build plan included a `flightplan_meta` table with a `schema_version` row. The shipped code dropped it. Without a version row, every Phase 2 schema change becomes a guessing game: did this DB go through migration N or not? With a version row, migrations branch on a single SELECT.

Ten minutes now. Hours saved later. No reason to wait.

**What:**
1. Add a `flightplan_meta` table to `schema.ts`:
   ```sql
   CREATE TABLE IF NOT EXISTS flightplan_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   ```
2. Seed `schema_version = '1'` on first open via `INSERT OR IGNORE`.
3. Add a `getSchemaVersion(db)` helper in a new `src/db/meta.ts` for Phase 2 to call.
4. Document the migration policy in a comment at the top of `schema.ts`: "Schema changes bump `schema_version` and ship as numbered migration steps. Never edit shipped DDL."

**Where:**
- `src/db/schema.ts` — add table + seed
- `src/db/meta.ts` — new file, helper functions
- `scripts/smoke-test.js` — add a check that `schema_version` row exists after schema apply

---

### 3. Honest typing for Phase-1 unmeasured fields

**Why:** `RunwayResponse` returns `burn_rate_per_hour: 0` and `time_remaining_minutes: 0` in Phase 1. An agent reading those values has no way to distinguish "actually zero" from "not yet measured." If an agent multiplies `burn_rate_per_hour * planned_minutes` to size a task, it'll get zero and conclude everything is fine. `null` is the honest signal for "not measured."

Same goes for `token_range` — Phase 1 returns `{ low: x, high: x }` which masquerades as a confidence interval but isn't. Should be `null` until Phase 2 widens it.

**What:**
1. Update `RunwayResponse` in `src/types.ts`:
   ```typescript
   burn_rate_per_hour: number | null;        // null in Phase 1
   time_remaining_minutes: number | null;    // null in Phase 1
   token_range: { low: number; high: number } | null;  // null in Phase 1
   ```
2. Update `get_runway.ts` to return `null` for these in Phase 1.
3. Add a JSDoc comment on each null-returning field: `// null = not yet computed; Phase 2 fills this in`.
4. Update the README example response to show the nulls.

**Where:**
- `src/types.ts`
- `src/tools/get_runway.ts`
- `README.md`

---

### 4. Replace the `_debug` smuggle with a typed optional block

**Why:** `get_runway.ts` currently casts the response to `any` to attach a `_debug` field. The codebase is otherwise strict-mode clean — this is the one ugly spot, and a careful reader will spot it in seconds. The fix is small and the codebase is small enough that doing it now is cheap.

**What:**
1. Add to `RunwayResponse`:
   ```typescript
   debug?: {
     baseline_tokens: number;
     tokens_observed: number;
     session_active: boolean;
     session_id: string | null;
     provider: string | null;
     model: string | null;
     sessions_archived: number;
     warn_threshold_pct: number;
   };
   ```
2. Remove the `as any` cast in `get_runway.ts` and assign `result.debug = { ... }` directly.
3. Rename the field from `_debug` to `debug` — leading underscore was a hack to hide it from JSON consumers; making it optional in the type does the same job cleaner.

**Where:**
- `src/types.ts`
- `src/tools/get_runway.ts`

---

### 5. Schema additions for Phase 2 (do now, populate later)

**Why:** Three small schema additions that cost nothing now and avoid a migration headache when Phase 2 calibration math goes in. All nullable in Phase 1; Phase 2 starts populating them.

**What:**

In `usage_snapshots`:
1. `baseline_source_at_time TEXT` — was the baseline `default`, `manual`, `calibrated`, or `api` when this session ran? Phase 2 calibration needs to know which sessions to mix.
2. `excluded_from_calibration INTEGER NOT NULL DEFAULT 0` — boolean flag (SQLite has no real bool). User or auto-detection can mark outliers without deleting the row.
3. `tags TEXT` — JSON array as text, e.g. `'["debugging","refactor"]'`. Phase 2 pattern classification will use it. Null in Phase 1.

**Where:**
- `src/db/schema.ts` — add the three columns to the CREATE TABLE statement
- `src/tools/record_session.ts` — write `baseline_source_at_time` from current config; leave the others null
- Update Phase 2 plan doc to call out these columns as the calibration inputs

---

### 6. Real lifecycle test

**Why:** The current "smoke test" verifies dependencies load. It does not verify Flightplan's own code works. The phrase "smoke test 5/5" reads as more reassurance than it earns. One small Vitest file fixes this.

**What:** Add `tests/lifecycle.test.ts`:
- Open in-memory DB with full schema applied
- Write a test config row (provider, baseline)
- Call `sessionStart()` → assert active_session row exists with non-null session_id
- Call `getRunway()` → assert level is `CRUISING`, `data_source` is `agent_report`
- Call `recordSession({ tokens_total: 30000 })` → assert usage_snapshots row exists, active_session cleared
- Call `getRunway()` → assert level is back to `PREFLIGHT`

This is roughly 60 lines of test code, runs in <100ms, catches the entire happy path.

**Where:**
- `tests/lifecycle.test.ts` — new
- `package.json` — add `vitest` to devDependencies, add `"test": "vitest run"` to scripts
- The smoke test stays — it does a different job

---

### 7. README rewrite — lead with the thesis

**Why:** The current README pitches "token runway awareness" as if Flightplan were a fuel gauge. The thesis is sharper than that: Flightplan is a sprint-velocity meter for AI pair programming. The README should sell that.

**What:**
- New opening paragraph (the thesis quote at the top of this doc, paraphrased).
- New section: **What problem does this solve, exactly?** — name the rate-limit world (5-hour windows, weekly caps, peak-hour throttling) explicitly. State that Flightplan is *not* about in-context tokens (the model already knows those).
- New section: **What it's not.** Disambiguate from `ccusage` (human dashboard), `Claude-Code-Usage-Monitor` (live chart), `context-mode` (in-conversation token reduction). Flightplan is the only one of these that's an MCP server the agent calls itself.
- Expanded **Quick start** with the actual `npm install -g`, `flightplan-mcp init`, claude_desktop_config.json snippet, and `flightplan status` walkthrough — keep it under 30 seconds of reading.
- Goose Scale table stays. It's an asset.
- **Roadmap** stays but gets a one-line "Why these phases?" preamble.

Length target: under 250 lines. Current is 296. Tighter is better.

**Where:**
- `README.md`

---

### 8. Goose Scale — document the active-vs-reserved split

**Why:** The eight Goose Levels are not a contradiction with Phase 1's behaviour — they're a deliberate type-system choice. Phase 1 actively calculates four levels (PREFLIGHT, CRUISING, HEADWIND, TURBULENCE, HONK — five if you count HONK, which `calculateGooseLevel` can return). The other three (WAYWARD, LANDING, REFUELLED) are reserved for Phase 2 and Phase 3 so the type union doesn't have to widen later and trigger a migration of every consumer that pattern-matched on the strings.

The eval flagged this as a problem because the distinction wasn't obvious from the code alone. The fix is documentation, not code.

**What:**
1. Restructure the constant in `src/state/goose_scale.ts` to make the split visually obvious:
   ```typescript
   /**
    * The Goose Scale.
    *
    * Active in Phase 1 (calculateGooseLevel can return these):
    *   PREFLIGHT, CRUISING, HEADWIND, TURBULENCE, HONK
    *
    * Active via tool side-effects (not from calculateGooseLevel):
    *   REFUELLED — set by session_start
    *   LANDING — set by record_session
    *
    * Reserved for Phase 2 (Dead Reckoning):
    *   WAYWARD — drift detection, activates after 3+ session sample
    *
    * The full union is shipped in v0.1.0 so adding behaviour later
    * is a code change, not a type-system migration.
    */
   ```
2. Update the README's Goose Scale table to mark which levels are active in Phase 1, which are set by lifecycle tools, and which are reserved. A small "Phase" column on the right is enough.
3. Add a one-line note under the table: *"All eight states are reserved in the type system from v0.1.0 onward. Phase 1 actively transitions through five of them; the rest activate as later phases ship."*

This is purely a clarity pass. No behaviour change, no schema change, no API change.

**Where:**
- `src/state/goose_scale.ts` — comment block
- `README.md` — table column + footnote

---

## Composability — making Flightplan a good citizen of a larger project

This is the forward-looking section. Andrew has a larger project in mind (BMAD-aware, Agile-environment-style, multi-component) where Flightplan would be one piece. The goal here is to make sure standalone Flightplan and parent-project-driven Flightplan can be the same binary, controlled by configuration.

### Three usage modes to support

1. **Standalone.** User runs `flightplan-mcp init`, answers the wizard, registers the MCP server with their AI tool. This is the npm-published path. No parent project involved.

2. **Parent-driven, ephemeral.** A larger project spawns Flightplan as a subprocess for a specific session, passes config via env vars or flags, doesn't touch `~/.flightplan/`. Parent owns the data lifecycle.

3. **Parent-driven, persistent.** A larger project installs Flightplan once, configures it via a shared config file, lets it persist data normally, but reads/writes Flightplan's DB to coordinate with other components.

All three should work without code branches. The differences should be config and storage location.

### Config resolution order

Flightplan should resolve its config in this order (first match wins):

1. **CLI flags** — `--db-path`, `--baseline`, `--provider`, etc. Highest precedence.
2. **Environment variables** — `FLIGHTPLAN_DB_PATH`, `FLIGHTPLAN_BASELINE`, `FLIGHTPLAN_PROVIDER`. For parent processes that spawn Flightplan.
3. **`flightplan.ini` in current working directory** — for project-scoped overrides. Optional.
4. **`~/.flightplan/flightplan.db` config table** — the standalone path. Set by the init wizard.
5. **Built-in defaults** — `CONSERVATIVE_FALLBACK_TOKENS`, etc.

Implementation note: this is a single resolver function that runs at server start and produces a frozen `ResolvedConfig` object. Every other module reads from that, not from env vars or files directly. One source of truth at runtime.

### The `flightplan.ini` format

For Mode 3 (persistent, parent-driven), a project-local config file gives the parent a non-DB way to influence Flightplan behavior. Plain INI for human-readability — TOML or YAML are overkill for the surface area.

Example `flightplan.ini`:

```ini
[flightplan]
# Override the DB location — useful when a parent project wants Flightplan
# data inside its own data directory instead of ~/.flightplan/
db_path = ./.project-data/flightplan.db

# Override the session baseline — parent project may know better than the user
session_baseline = 80000

# Tag every session written from this directory with a project_id automatically
project_id = bmad-runtime

# Suppress the Phase 2 countdown message in record_session responses
# (parent project will surface its own telemetry)
suppress_countdown = true

[flightplan.parent]
# Optional metadata the parent project wants Flightplan to record
# Stored in usage_snapshots.notes as JSON
parent_name = my-bigger-project
parent_version = 0.3.0
```

Every key in `flightplan.ini` should also be settable via CLI flag and env var. The init wizard can offer to write one ("This looks like a project directory — want a project-scoped config?") but never assumes.

### One init question to add

In `flightplan-mcp init`, after the existing three questions, add:

> **Q4 (optional)** — Will Flightplan be used standalone, or as part of a larger project?
>
>   1. Standalone (default — write config to ~/.flightplan/)
>   2. Part of a larger project (write a flightplan.ini in this directory)
>   3. Both (write to both — this directory's config overrides for project work)

If they pick 2 or 3, write `flightplan.ini` to `process.cwd()` with the same config they entered. If 3, also write to `~/.flightplan/`. The DB still lives at the resolved `db_path`.

### Schema fields that exist for parent integration

Some fields in the existing schema were already designed for this. Document them clearly so a parent project knows what hooks exist:

- `usage_snapshots.project_id` — parent project can tag sessions with its own project IDs (BMAD epic ID, sprint ID, ticket ID, whatever)
- `usage_snapshots.notes` — parent can stash JSON metadata
- `active_session.project_id` — same, for in-flight sessions
- `config.provider_key` — parent can set this to its own slug

Add a section to the README titled **"Using Flightplan inside a larger project"** that lists these and links to the `flightplan.ini` reference.

### What NOT to add for composability (yet)

- A plugin/hook system. YAGNI until a second consumer exists.
- A separate REST API. The MCP server and the SQLite file are the API.
- A "headless mode" flag. Standalone Flightplan is already headless to its agent caller.
- Auth. Local SQLite + filesystem permissions are the auth model. Keep it that way until someone asks for more.

---

## Implementation order

Suggested order for Ash:

**Pass 1 — small, low-risk fixes (≈30 min)**
- #2 schema_version
- #3 honest nulls
- #4 typed debug block

**Pass 2 — schema additions for Phase 2 (≈20 min)**
- #5 baseline_source_at_time, excluded_from_calibration, tags

**Pass 3 — testing and decisions (≈45 min)**
- #6 lifecycle test
- #1 mid-session signal — confirm Option A with Andrew, document and ship; or build Option B as a separate task

**Pass 4 — README and composability (≈45 min)**
- #7 README rewrite
- #8 Goose Scale split documented in code and README
- Composability section — config resolver, ini support, init Q4

Total: ~2.5 hours, less than one Phase-1 build session.

---

## Phase 1.5 success criteria

After this refinement pass, all of these must be true:

1. The thesis statement appears verbatim at the top of the README and in any new eval brief.
2. `flightplan_meta` table exists with `schema_version = '1'`.
3. Phase-1 unmeasured fields return `null`, not `0`.
4. No `as any` casts remain in `src/`.
5. `npm test` runs the lifecycle test and it passes.
6. `flightplan.ini` in the current directory overrides `~/.flightplan/` config for that run.
7. `FLIGHTPLAN_DB_PATH` env var redirects the DB location for that run.
8. README explains the rate-limit-vs-context distinction in one paragraph and disambiguates from the three named competitors.
9. README's Goose Scale table marks active-in-Phase-1, set-by-lifecycle, and reserved-for-future levels clearly.
10. `goose_scale.ts` has a comment block making the same split obvious to anyone reading the code.
11. Init wizard offers the standalone-vs-project question.
12. `flightplan status` still works in all three modes.

If any of these fail, Phase 1.5 isn't done.

---

## Open questions for Andrew

These need answers before Ash starts:

1. **Name of the larger project?** The composability section uses "the larger project" as a placeholder. If it has a name, it goes in the README.
2. **Confirm Vitest as the test runner?** Could also use Node's built-in `node:test` to avoid a devDep. Vitest is faster to write and has better watch mode; node:test is zero-dependency. Either is fine; Vitest is the default recommendation.
3. **Is there a target launch date that constrains scope?** If yes, drop items 5 and 6 to a Phase 1.6 follow-up.

Already resolved:
- Mid-session signal: Option A for v0.1.0.
- `flightplan.ini` pickup: automatic with one-line stderr notice.
- Goose Scale: keep all eight levels in the type system; document the four-active / four-reserved split clearly (see item #8 below).

---

## What this document is NOT

- A new build plan. The Phase 1 build plan stands.
- A pivot. The thesis was always there; we're surfacing it.
- An exhaustive future roadmap. Phase 2 (Dead Reckoning) and Phase 3 (Formation Trust) are still defined in the original brief.
- A response to every Opus eval finding. The findings that are speculative, cosmetic, or contingent on user feedback are deliberately not in here. We'll revisit after launch.

---

*Flightplan Phase 1.5 Refinement Brief — Andrew + Opus (Claude 4.7)*
*May 4, 2026 — For Ash to refine and implement*
*"The smaller version is the one that gets built. The clearer version is the one that gets understood." 🪿*
