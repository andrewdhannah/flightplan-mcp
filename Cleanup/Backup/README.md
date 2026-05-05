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
npm install -g flightplan-mcp
```

### Initialize

```bash
npx flightplan-mcp init
```

Three questions. 30 seconds. Done.

### Register with your AI tool

Add to `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flightplan": {
      "command": "npx",
      "args": ["flightplan-mcp"]
    }
  }
}
```

For other tools, point them at: `npx flightplan-mcp`

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

---

## MCP Tools

Three tools the agent calls. No parameters required for `get_runway()`.

### `get_runway()`

Check current token runway state. Call this at session start and before any high-cost operation.

```json
{
  "level": "CRUISING",
  "window_remaining_pct": 52,
  "window_remaining_tokens": 19200,
  "token_range": { "low": 19200, "high": 19200 },
  "burn_rate_per_hour": 0,
  "time_remaining_minutes": 0,
  "data_source": "agent_report",
  "formation_trust": "observer",
  "recommended_action": "Runway is healthy. Proceed with planned work."
}
```

### `session_start(provider?, model?, project_id?)`

Open a new tracking session. Call at the beginning of each working session.

```json
{
  "session_id": "a1b2c3d4-...",
  "started_at": "2026-05-04T19:30:00.000Z",
  "level": "REFUELLED",
  "message": "Session started. Runway restored."
}
```

### `record_session(tokens_total, notes?)`

Archive session data and close the session. Call at session end with your final token count.

```json
{
  "session_id": "a1b2c3d4-...",
  "tokens_total": 28500,
  "duration_minutes": 47.3,
  "final_level": "HEADWIND",
  "sessions_archived": 4,
  "message": "Session archived. 28,500 tokens over 47.3 minutes. Dead Reckoning unlocks in 1 more session."
}
```

---

## Non-MCP Usage

For agents that don't support MCP (Augere, shell scripts, custom tooling):

```bash
flightplan status --json
```

Returns structured JSON on stdout. Same data, no MCP required.

---

## Architecture

```
flightplan-mcp/
├── src/
│   ├── index.ts              ← MCP server entry point
│   ├── cli.ts                ← flightplan-mcp init wizard
│   ├── status.ts             ← flightplan status CLI
│   ├── types.ts              ← shared TypeScript interfaces
│   ├── db/
│   │   ├── paths.ts          ← cross-platform DB path (~/.flightplan/)
│   │   ├── schema.ts         ← SQL DDL (config, active_session, usage_snapshots)
│   │   └── connection.ts     ← DB singleton + WAL mode
│   ├── tools/
│   │   ├── get_runway.ts     ← MCP tool: check runway state
│   │   ├── session_start.ts  ← MCP tool: open tracking session
│   │   └── record_session.ts ← MCP tool: archive session data
│   └── state/
│       └── goose_scale.ts    ← 8 flight states + level calculation
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

**`usage_snapshots`** — historical archive of completed sessions. The ground truth for Phase 2 Dead Reckoning calibration.

---

## Roadmap

### Phase 1 — Static Baseline ✅ *Current*
User-set baseline. Agent self-reports. Goose Scale levels. Status CLI. MCP tools.

### Phase 2 — Dead Reckoning *(planned)*
Velocity calculation from `usage_snapshots` history. Auto-calibrating baseline after 5 sessions. Real `burn_rate_per_hour` and `time_remaining_minutes`. Confidence scoring. Project-specific velocity profiles via `project_id`.

### Phase 3 — Formation Trust *(planned)*
Community velocity profiles via Flock File. Opt-in anonymous session sharing. Formation Trust active state. HONK notes generated automatically.

---

## Development

```bash
# Clone and install
git clone https://github.com/yourusername/flightplan-mcp.git
cd flightplan-mcp
nvm use          # requires Node 20 LTS — see .nvmrc
npm install

# Verify dependencies
npm run smoke

# Build
npm run build

# Initialize your own DB
npm run init

# Check status
node dist/status.js
```

**Node version:** Flightplan requires Node 18–22. Node 23+ cannot compile the native SQLite dependencies. Use `nvm` to manage versions — a `.nvmrc` is included.

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
