# Flightplan CLI Reference

Flightplan provides two binaries: `flightplan` (human-facing CLI) and
`flightplan-mcp` (MCP server for AI agents).

## Installation

```bash
npm install -g flightplan-mcp
# or
npx flightplan-mcp
```

See [INSTALL.md](INSTALL.md) for detailed setup instructions.

---

## `flightplan status`

Show current token runway state.

**Usage:** `flightplan status [--json]`

**Options:**
- `--json` — Machine-readable JSON output for non-MCP agents

**Examples:**
```bash
flightplan status            # human-readable display
flightplan status --json     # JSON for programmatic use
```

**Exit codes:** 0 = success, 1 = runtime error

---

## `flightplan stats`

Show aggregate usage statistics across all sessions.

**Usage:** `flightplan stats [--json]`

**Output fields (--json):** `total_sessions`, `nonzero_sessions`,
`total_tokens`, `average_tokens_per_nonzero_session`, `min_tokens`,
`max_tokens`, `sessions_by_model`, `sessions_by_provider`,
`sessions_by_project`, `token_buckets`

**Examples:**
```bash
flightplan stats              # human-readable summary
flightplan stats --json       # JSON for processing
```

**Exit codes:** 0 = success, 1 = runtime error

---

## `flightplan calibration`

Calibration eligibility management for Dead Reckoning.

**Usage:**
```bash
flightplan calibration report [--json]
flightplan calibration candidates [--json]
```

**Subcommands:**
- `report` — Show calibration eligibility report (default)
- `candidates` — List calibration-eligible sessions

**Examples:**
```bash
flightplan calibration report           # eligibility summary
flightplan calibration candidates       # list eligible sessions
flightplan calibration report --json
```

**Exit codes:** 0 = success, 1 = runtime error

---

## `flightplan anomalies`

Detect anomalous sessions (idle skew, zero-token, missing metadata).

**Usage:** `flightplan anomalies [--json]`

**Examples:**
```bash
flightplan anomalies              # human-readable anomaly report
flightplan anomalies --json       # JSON for programmatic use
```

**Exit codes:** 0 = success, 1 = runtime error

---

## `flightplan estimate`

Estimate token runway needed for a proposed task using historical data.

**Usage:**
```bash
flightplan estimate --model <model> --provider <provider> [--project <project>] [--json]
```

**Required:**
- `--model <model>` — Model name (e.g. `deepseek-v4-flash`)
- `--provider <provider>` — AI provider (e.g. `OpenWork`)

**Options:**
- `--project <project>` — Project name for scoped estimate
- `--json` — Machine-readable JSON output

**Output fields (--json):** `estimated_tokens` (p50/p80/p95), `confidence`,
`historical_basis` (matching_sessions, scope), `fallback_used`

**Examples:**
```bash
flightplan estimate --model deepseek-v4-flash --provider OpenWork
flightplan estimate --model gpt-4 --provider OpenAI --project MyApp --json
```

**Error behavior:**
- Missing `--model` or `--provider` exits with code 1
- If no historical data matches, falls back to configured baseline with
  `confidence: "wayward"`

**Exit codes:** 0 = success, 1 = missing args or runtime error

---

## `flightplan gate`

Check governed runway decision before starting work.

**Usage:**
```bash
flightplan gate --model <model> --provider <provider> [--project <project>] [--work-type <type>] [--json]
```

**Required:**
- `--model <model>` — Model name (e.g. `deepseek-v4-flash`)
- `--provider <provider>` — AI provider (e.g. `OpenWork`)

**Options:**
- `--project <project>` — Project name for scoped estimate
- `--work-type <type>` — Type of work (e.g. `sprint`, `refactor`)
- `--json` — Machine-readable JSON output

**Decisions:**
| Decision | Meaning |
|---|---|
| `proceed` | Normal work allowed |
| `proceed_with_checkpoint` | Work allowed, checkpoint first |
| `split` | Split into smaller units |
| `land_first` | Land before starting new work |
| `refuse` | Cannot proceed |

**Examples:**
```bash
flightplan gate --model deepseek-v4-flash --provider OpenWork --work-type sprint
flightplan gate --model gpt-4 --provider OpenAI --json
```

**Exit codes:** 0 = success, 1 = missing args or runtime error

---

## `flightplan receipt`

Export a deterministic session receipt.

**Usage:**
```bash
flightplan receipt (--last | --session <id>) [--json] [--out <path>]
```

**Options:**
- `--last` — Get the most recent session receipt
- `--session <id>` — Get receipt for a specific session ID
- `--json` — Print JSON to stdout
- `--out <path>` — Write receipt JSON to file

**Examples:**
```bash
flightplan receipt --last                        # show latest receipt
flightplan receipt --last --json                 # JSON to stdout
flightplan receipt --session <id> --json         # specific session
flightplan receipt --last --out receipt.json     # write to file
```

**Exit codes:** 0 = success, 1 = missing args or runtime error

---

## `flightplan land`

Assess whether the current session needs to land.

**Usage:**
```bash
flightplan land [--tokens-total <n>] [--outcome <o>] [--json]
```

**Options:**
- `--tokens-total <n>` — Token total for landing assessment
- `--outcome <o>` — Session outcome (`completed`, `checkpointed`, `stale`,
  `blocked`, `aborted`, `honk`)
- `--json` — Machine-readable JSON output

**Examples:**
```bash
flightplan land                              # check landing status
flightplan land --tokens-total 50000 --json  # assess with token count
```

**Exit codes:** 0 = success, 1 = runtime error

---

## `flightplan export`

Write current runway state as Markdown for any LLM to read.

**Usage:** `flightplan export [--out <path>]`

**Options:**
- `--out <path>` — Custom output path (default: `./RUNWAY_STATE.md`)

**Examples:**
```bash
flightplan export                    # write to ./RUNWAY_STATE.md
flightplan export --out /tmp/state   # write to custom path
```

**Exit codes:** 0 = success, 1 = runtime error

---

## JSON Error Format

When `--json` is used and an error occurs, Flightplan returns a consistent
error shape:

```json
{
  "ok": false,
  "error": {
    "code": "MISSING_REQUIRED_ARGUMENT",
    "message": "Missing required argument: --model and --provider are required"
  }
}
```

**Error codes:**
| Code | Meaning |
|---|---|
| `MISSING_REQUIRED_ARGUMENT` | A required argument was not provided |
| `UNKNOWN_COMMAND` | Command not recognized |
| `DATABASE_NOT_FOUND` | Flightplan DB not found (run init first) |
| `RUNTIME_ERROR` | An unexpected error occurred |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User/input/runtime error |
