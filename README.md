# 🪿 Flightplan

> **Token runway awareness for AI coding sessions.**  
> A goose knows how far it can fly before it needs to land.

---

## What is Flightplan?

Flightplan is a local-first MCP (Model Context Protocol) server that gives AI coding agents **token runway awareness**. Before starting a large refactor, generating a complex component, or any high-cost operation, the agent calls `get_runway()` and knows whether it has enough runway to proceed — or whether it should wrap up and land first.

No cloud. No subscriptions. No provider lock-in. One SQLite file in `~/.flightplan/`.

---

## The Problem

AI coding agents (Claude Code, Codex, Gemini CLI) have finite context windows. When a session runs out of tokens mid-task:

- Work is lost
- The agent cuts off mid-thought
- The user has to restart and re-explain context
- Expensive operations get abandoned halfway

Providers don't publish hard token limits. They use opaque session windows that change with demand. Community estimates go stale silently.

**Flightplan's answer:** stop guessing. Track real burn. The user sets a baseline at init. The agent self-reports at session end. Dead Reckoning (Phase 2) calibrates automatically from real observed data.

---

## The Goose Scale

Eight flight states covering the full session lifecycle:

| Level | Meaning | % Consumed |
|-------|---------|------------|
| `PREFLIGHT` | No session active — waiting for `session_start()` | — |
| `CRUISING` | Nominal burn. Runway estimate is reliable. | 0–50% |
| `HEADWIND` | Burning faster than baseline. Still on course. | 50–75% |
| `TURBULENCE` | Tight runway. Wrap up soon. | 75–90% |
| `HONK` | Runway exhausted. Call `record_session()` now. | 90%+ |
| `LANDING` | Session ended gracefully. Data archived. | — |
| `REFUELLED` | New session started. Runway restored. | — |
| `WAYWARD` | Dead Reckoning drifted significantly. *(Phase 2)* | — |

---

## Quick Start

### Install

```bash
git clone https://github.com/andrewdhannah/flightplan-mcp.git
cd flightplan-mcp
nvm use 20
npm install
npm run build
npm run smoke
npm link                    # makes `flightplan` available globally
```

See [docs/INSTALL.md](docs/INSTALL.md) for detailed install instructions,
including MCP client configuration for Claude Desktop, Codex, and OpenWork.

### Initialize

```bash
flightplan-mcp init
```

Three questions. 30 seconds. Done.

### Check your runway

```bash
flightplan status
```

```
🪿 Flightplan  ·  CRUISING  ·  Claude Code

  [████████████░░░░░░░░░░░░]  52% remaining

  Session
    Tokens observed   20,800 / 40,000 baseline
    Runway remaining  19,200 tokens
    Duration          34 min

  Status
    Nominal burn rate. Runway estimate is reliable.

  Dead Reckoning
     3 sessions archived  ·  2 more until baseline auto-calibrates
```

### Estimate runway for a task

```bash
flightplan estimate --model deepseek-v4-flash --provider OpenWork --json
```

### Check gate decision before expensive work

```bash
flightplan gate --model deepseek-v4-flash --provider OpenWork --work-type sprint --json
```

---

## MCP Tools

Flightplan registers five MCP tools. Detailed documentation with input schemas
and examples: [docs/MCP-TOOLS.md](docs/MCP-TOOLS.md)

| Tool | Purpose | Mutates DB |
|---|---|---|
| `get_runway()` | Check current token runway state | No |
| `session_start(...)` | Open a new tracking session | Yes |
| `record_session(...)` | Archive session data and close | Yes |
| `estimate_work_runway(...)` | Estimate runway + governed decision | No |
| `land_session(...)` | Assess landing requirements | No |

### `get_runway()`

Check current token runway state. Call at session start and before any
high-cost operation. No parameters required.

```json
{
  "level": "CRUISING",
  "window_remaining_pct": 52,
  "window_remaining_tokens": 19200,
  "token_range": null,
  "burn_rate_per_hour": null,
  "time_remaining_minutes": null,
  "data_source": "agent_report",
  "formation_trust": "observer",
  "recommended_action": "Runway is healthy. Proceed with planned work."
}
```

### `session_start(provider?, model?, project_id?, ...)`

Open a new tracking session. All parameters optional.

```json
{
  "session_id": "a1b2c3d4-...",
  "started_at": "2026-05-04T19:30:00.000Z",
  "level": "REFUELLED",
  "message": "Session started. Runway restored."
}
```

### `record_session(tokens_total, notes?, outcome?, ...)`

Archive session data and close the session. `tokens_total` is required.

```json
{
  "session_id": "a1b2c3d4-...",
  "tokens_total": 28500,
  "duration_minutes": 47.3,
  "final_level": "HEADWIND",
  "sessions_archived": 4,
  "outcome": "completed",
  "message": "Session archived. 28,500 tokens over 47.3 minutes."
}
```

### `estimate_work_runway(model?, provider?, project_id?, work_type?, ...)`

Estimate token runway for a proposed task. Combines Dead Reckoning historical
data with gate policy. Returns a governed decision.

```json
{
  "decision": "proceed",
  "confidence": "medium",
  "estimated_tokens": { "p50": 18000, "p80": 45000, "p95": 85000 },
  "goose_level": "PREFLIGHT",
  "recommended_action": "Normal work allowed. Monitor runway and re-evaluate before major operations.",
  "policy_reasons": ["No active session — using conservative estimate"]
}
```

### `land_session(tokens_total?, outcome?)`

Assess whether the session needs to land. Returns landing recommendation,
handoff template, and whether `record_session` can be called.

```json
{
  "level": "PREFLIGHT",
  "landing_required": false,
  "can_record": false,
  "recommended_action": "No active session. Call session_start() to begin tracking."
}
```

---

## Using Flightplan with Other Tools

Flightplan works with any LLM client, regardless of whether it supports MCP.
There are three integration patterns, in order of preference:

### Pattern 1 — Native MCP

If your client supports MCP, Flightplan plugs in directly. The three tools —
`get_runway`, `session_start`, `record_session` — become callable from inside
your session.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flightplan": {
      "command": "npx",
      "args": ["-y", "flightplan-mcp"]
    }
  }
}
```

**OpenAI Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.flightplan]
command = "npx"
args = ["-y", "flightplan-mcp"]
```

**GitHub Copilot** (VS Code — `.vscode/mcp.json`):

```json
{
  "servers": {
    "flightplan": {
      "command": "npx",
      "args": ["-y", "flightplan-mcp"]
    }
  }
}
```

> **Copilot Business / Enterprise users:** MCP requires the
> "MCP servers in Copilot" policy to be enabled by your org admin.
> Copilot Free, Pro, and Pro+ are not affected by this restriction.

This is the richest integration: the agent can check runway mid-session and
adjust behaviour without any wrapper code.

### Pattern 2 — CLI as a function tool

If your client supports custom tools or function calling but not MCP, register
`flightplan status --json` as a tool. The agent calls it like any other
function and receives structured runway data.

```ts
// Example shape — adapt to your framework
{
  name: "get_runway",
  description: "Check current token runway state.",
  handler: async () => {
    const { stdout } = await execFile("flightplan", ["status", "--json"]);
    return JSON.parse(stdout);
  }
}
```

> Use `execFile` (or an async `exec` wrapper) rather than `execSync`.
> A blocking call inside an async tool handler will stall the agent loop.

### Pattern 3 — Markdown snapshot

For clients with no tool-calling at all (plain chat windows, mobile clients),
use `flightplan export` to produce a `RUNWAY_STATE.md` snapshot. Paste or
upload it and the model gets the same context — just without live updates.

```bash
flightplan export           # writes ./RUNWAY_STATE.md
flightplan export --out ~/Desktop/RUNWAY_STATE.md
```

### Carrier compatibility

| Mode | Command | Best for |
|:---|:---|:---|
| MCP Live | `get_runway()` called by agent | Clients with native MCP |
| JSON Pipe | `flightplan status --json` | Frameworks with custom tools |
| MD Snapshot | `flightplan export` | Plain chat UIs, handoffs |

> MCP support changes quickly. Check your client's current docs before
> committing to an integration pattern.

### Recommended call points

Whichever pattern you use, the same three call points apply:

- **`session_start()`** — when the agent begins meaningful work
- **`get_runway()`** — before any expensive operation
- **`record_session()`** — at session end, to archive tokens and feed Dead Reckoning

---

## Architecture

```
flightplan-mcp/
├── src/
│   ├── index.ts              ← MCP server entry point (5 tools)
│   ├── cli.ts                ← flightplan-mcp init wizard
│   ├── status.ts             ← flightplan status CLI + command routing
│   ├── commands.ts           ← CLI command handlers (stats, gate, etc.)
│   ├── types.ts              ← shared TypeScript interfaces
│   ├── db/
│   │   ├── paths.ts          ← cross-platform DB path (~/.flightplan/)
│   │   ├── schema.ts         ← SQL DDL (config, active_session, usage_snapshots)
│   │   └── connection.ts     ← DB singleton + WAL mode
│   ├── tools/
│   │   ├── get_runway.ts     ← MCP tool: check runway state
│   │   ├── session_start.ts  ← MCP tool: open tracking session
│   │   └── record_session.ts ← MCP tool: archive session data
│   ├── analytics/
│   │   ├── stats.ts          ← aggregate usage statistics
│   │   ├── calibration.ts    ← calibration eligibility rules
│   │   ├── anomalies.ts      ← anomaly detection
│   │   ├── dead_reckoning.ts ← historical token estimation
│   │   ├── gates.ts          ← governed proceed/split/land decisions
│   │   ├── receipts.ts       ← session receipt generation
│   │   ├── landing.ts        ← landing assessment with handoff
│   │   ├── percentiles.ts    ← p50/p80/p95 calculation
│   │   └── types.ts          ← shared analytics types
│   └── state/
│       ├── goose_scale.ts    ← 8 flight states + level calculation
│       └── state_generator.ts ← RUNWAY_STATE.md Markdown snapshot generator
└── scripts/
    └── smoke-test.js         ← dependency verification
```

**Key decisions:**

- **Two binaries:** `flightplan-mcp` (MCP server / init) and `flightplan` (status CLI). Different names, different jobs.
- **Single DB file:** `~/.flightplan/flightplan.db` holds everything. No separate config file.
- **Mechanism A:** Agent self-reports tokens at session end. No continuous per-turn ticks — that costs too many tokens to track tokens.
- **Provider-agnostic:** No hardcoded plan limits. User sets their own session baseline at init. Providers don't publish hard limits anyway — community estimates go stale silently.
- **ESM throughout:** `"type": "module"` in package.json. All imports use `.js` extensions per TypeScript ESM requirements.
- **Local-first:** One SQLite file. No cloud, no auth, no telemetry.

---

## Database Schema

Three tables. All in `~/.flightplan/flightplan.db`.

**`config`** — key/value store for user settings from init.

| Key | Example Value |
|-----|--------------|
| `provider_name` | `Claude Code` |
| `provider_key` | `claude_code` |
| `session_baseline` | `40000` |
| `baseline_source` | `default` \| `manual` \| `calibrated` \| `api` |
| `warn_threshold` | `25` |
| `initialized_at` | ISO timestamp |

**`active_session`** — single-row table tracking the current session.

| Column | Type | FP-1 | Description |
|--------|------|------|-------------|
| `id` | `TEXT PK` | | Always `'current'` |
| `session_id` | `TEXT` | | UUID |
| `started_at` | `TEXT` | | ISO 8601 |
| `goose_level` | `TEXT` | | Current flight state |
| `tokens_observed` | `INTEGER` | | Running token count |
| `provider` | `TEXT` | | AI tool name |
| `model` | `TEXT` | | Model identifier |
| `project_id` | `TEXT` | | Project grouping tag |
| `plan_id` | `TEXT` | ✅ | Librarian Sprint/Plan ID |
| `work_order_id` | `TEXT` | ✅ | Librarian Work Order ID |
| `work_session_id` | `TEXT` | ✅ | Librarian Work Session ID |
| `agent` | `TEXT` | ✅ | Agent name |

**`usage_snapshots`** — historical archive of completed sessions. The ground truth for Phase 2 Dead Reckoning calibration.

All `active_session` columns above, plus: `ended_at`, `duration_minutes`, `tokens_total`, `goose_level_final`, `baseline_at_time`, `baseline_source_at_time`, `notes` (max 2,000 chars), and **FP-1 columns**: `plan_id`, `work_order_id`, `work_session_id`, `agent`, `outcome`.

---

## What Flightplan Stores

Everything lives in one SQLite file: `~/.flightplan/flightplan.db`.
Nothing leaves your machine.

**What is stored:**
- Provider name and key (e.g. `Claude Code` / `claude_code`) — set by you at init
- Session baseline and warning threshold — set by you at init
- Per-session data you explicitly record: token count, duration, model, project tag, optional notes
- **FP-1:** Optional Librarian work tags for session correlation: `plan_id`, `work_order_id`, `work_session_id`, `agent`
- **FP-1:** Optional session `outcome` for tracking completion status (`completed`, `checkpointed`, `stale`, `blocked`, `aborted`, `honk`)
- Timestamps for session start and end

**What is never stored:**
- Conversation content — not a single word of what you or the agent said
- Code, diffs, filenames, or any project content
- API keys, credentials, or any authentication data
- Anything from your editor, terminal, or filesystem

**Notes field:** The optional `notes` parameter in `record_session()` is
agent-controlled freeform text (max 2,000 characters). It is capped and
sanitized before storage. If you render notes in a web UI, treat the value
as untrusted — never use `dangerouslySetInnerHTML` or parse as markdown
without sanitisation.

**Retention:** Data stays until you delete it. `~/.flightplan/flightplan.db`
is a standard SQLite file — open it with any SQLite browser, back it up,
or delete it at any time.

---

## CLI Commands

Full CLI reference: [docs/CLI.md](docs/CLI.md)

| Command | Description |
|---|---|
| `flightplan status` | Show current runway state |
| `flightplan stats` | Show aggregate usage statistics |
| `flightplan calibration report` | Calibration eligibility report |
| `flightplan calibration candidates` | List calibration-eligible sessions |
| `flightplan anomalies` | Detect anomalous sessions |
| `flightplan estimate` | Estimate token runway for a task |
| `flightplan gate` | Check governed runway decision |
| `flightplan receipt` | Export session receipt |
| `flightplan land` | Assess landing status |
| `flightplan export` | Write RUNWAY_STATE.md for any LLM |

All commands support `--json` for machine-readable output and `--help`
for command-specific help. Exit codes: 0 (success), 1 (error).

---

## Goose Scale Policy

Eight flight states governing agent behaviour:

| Level | Allowance | Action |
|---|---|---|
| `PREFLIGHT` | No active session | Call `session_start()` |
| `CRUISING` | Normal work allowed | Proceed |
| `HEADWIND` | Continue, no scope expansion | Finish current task |
| `TURBULENCE` | Checkpoint before expensive work | Wrap up soon |
| `HONK` | Land immediately | Call `record_session()` now |
| `LANDING` | Handoff/receipt only | Session ended |
| `REFUELLED` | New session started | Runway restored |
| `WAYWARD` | Calibration low, use conservative fallback | Dead Reckoning drifted |

The gate policy combines Goose Level with Dead Reckoning estimates to produce
guarded decisions: `proceed`, `proceed_with_checkpoint`, `split`,
`land_first`, or `refuse`.

---

## Testing

```bash
# Smoke test — verify dependencies and DB schema
npm run smoke

# MCP tool registration and schema validation
npm run smoke:mcp

# Build
npm run build

# Run all tests (239+ tests, all using in-memory DBs)
npm test
```

All tests use **in-memory SQLite databases** — they never touch the live DB
at `~/.flightplan/flightplan.db`. The `FLIGHTPLAN_DB_PATH` environment
variable is available for redirecting the DB path in custom test scenarios.

---

## Privacy

Flightplan is local-first by design. Detailed privacy boundary:
[docs/FLIGHTPLAN-PRIVACY-BOUNDARY.md](docs/FLIGHTPLAN-PRIVACY-BOUNDARY.md)

- **No telemetry.** Zero network requests, no cloud sync, no analytics.
- **No conversation content.** Prompts, code, and agent responses are never stored.
- **Local DB only.** `~/.flightplan/flightplan.db` stays on your machine.
- **Notes excluded from receipts.** The optional `notes` field is agent-controlled
  freeform text stored in the DB but excluded from receipts by default.
- **No secrets stored.** Project IDs and work tags are metadata, not content.

---

### Phase 1 — Static Baseline ✅ *Current*
User-set baseline. Agent self-reports. Goose Scale levels. Status CLI. MCP tools.

**FP-1 (v2 schema):** Librarian work-order tagging. `plan_id`, `work_order_id`, `work_session_id`, `agent`, and `outcome` fields on sessions. Auto-migration from v1 → v2.

### Phase 2 — Dead Reckoning *(planned)*
Velocity calculation from `usage_snapshots` history. Auto-calibrating baseline after 5 sessions. Real `burn_rate_per_hour` and `time_remaining_minutes`. Confidence scoring. Project-specific velocity profiles via `project_id`.

### Phase 3 — Formation Trust *(planned)*
Community velocity profiles via Flock File. Opt-in anonymous session sharing. Formation Trust active state. HONK notes generated automatically.

---

## Development

```bash
# Clone and install
git clone https://github.com/andrewdhannah/flightplan-mcp.git
cd flightplan-mcp
nvm use          # requires Node 20 LTS — see .nvmrc
npm install

# Verify dependencies
npm run smoke

# Verify MCP tools register correctly
npm run smoke:mcp

# Build
npm run build

# Run all tests (in-memory DBs only)
npm test

# Initialize your own DB
npm run init

# Check status
node dist/status.js
```

**Node version:** Flightplan requires Node 18–22. Node 23+ cannot compile
the native SQLite dependencies. Use `nvm` to manage versions — a `.nvmrc`
is included.

**Test safety:** All tests use in-memory SQLite databases. They never touch
the live DB at `~/.flightplan/flightplan.db`. You can set the
`FLIGHTPLAN_DB_PATH` environment variable to redirect the DB for testing
or development purposes.

---

## Why Canadian?

PIPEDA and Quebec Law 25 compliance is a reasonable baseline for privacy-respecting local tools. No personal data leaves the machine. No provider data is hardcoded. The community localizes for other jurisdictions.

Also, geese are Canadian. This was non-negotiable.

---

## Contributing

Phase 1 is the calibration run. If you use Flightplan and want to contribute:

- **Flock File data:** Share anonymized session velocity profiles to improve community baselines. *(Phase 3)*
- **Provider profiles:** If you've characterized token behaviour for a provider not listed, open an issue.
- **Bug reports:** Open an issue. Include your Node version, OS, and the output of `flightplan status --json`.

---

## License

MIT — see LICENSE.

---

## Acknowledgements

Built by Andrew with Ash (Claude Sonnet 4.6) in two sessions, May 2026.  
*"The smaller version is the one that gets built."*

---

*🪿 The goose knows how far it can fly.*
