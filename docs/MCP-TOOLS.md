# Flightplan MCP Tools

Flightplan registers five MCP tools. Each tool is documented below with
its purpose, input schema, response shape, error handling, and privacy notes.

---

## Tool: `get_runway`

### Purpose

Check your current token runway before high-cost operations. Returns the
Goose Scale level, remaining tokens, and a recommended action. Call this
at session start and before any large code generation, analysis, or
refactoring task.

### Input Schema

No parameters required.

### Example Request

```json
{}
```

### Example Response

```json
{
  "level": "CRUISING",
  "window_remaining_pct": 75,
  "window_remaining_tokens": 30000,
  "token_range": null,
  "burn_rate_per_hour": null,
  "time_remaining_minutes": null,
  "data_source": "agent_report",
  "formation_trust": "observer",
  "recommended_action": "Runway is healthy. Proceed with planned work.",
  "project_id": "MyProject",
  "plan_id": null,
  "work_order_id": null,
  "work_session_id": null,
  "agent": "OpenWork-Claude",
  "debug": {
    "baseline_tokens": 40000,
    "tokens_observed": 10000,
    "session_active": true,
    "session_id": "uuid-here",
    "provider": "OpenWork",
    "model": "deepseek-v4-flash",
    "sessions_archived": 12,
    "warn_threshold_pct": 25
  }
}
```

### Error Response

```json
{
  "level": "PREFLIGHT",
  "window_remaining_pct": 100,
  "window_remaining_tokens": 40000,
  "recommended_action": "Flightplan is in PREFLIGHT — no session active. Call session_start to begin tracking."
}
```

`get_runway` does not throw on error paths — it always returns a valid
`RunwayResponse`. If the database is missing, the process exits with an error
before the MCP server starts.

### Mutates DB

No. Read-only.

### Privacy Notes

- Returns `project_id`, `plan_id`, `work_order_id`, `work_session_id`, `agent`
  from the active session — these are user-supplied work tags.
- Does not return prompts, code, conversation content, or notes.
- Debug object includes `provider` and `model` names for transparency.

---

## Tool: `session_start`

### Purpose

Start a new Flightplan tracking session. Call this at the beginning of each
working session before doing any work. Returns a `session_id` you will need
when calling `record_session()` at the end.

### Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | string | no | AI tool name (e.g. "claude-code") |
| `model` | string | no | Model name if known (e.g. "claude-sonnet-4-6") |
| `project_id` | string | no | Optional project tag for grouping sessions |
| `plan_id` | string | no | Optional FP-1: Librarian plan ID (e.g. "Sprint-E") |
| `work_order_id` | string | no | Optional FP-1: Librarian Work Order ID (e.g. "A1") |
| `work_session_id` | string | no | Optional FP-1: Librarian Work Session ID |
| `agent` | string | no | Optional FP-1: Agent name (e.g. "OpenWork-Claude") |

All string inputs are capped at 256 characters (Tier 1.6 safety bound).

### Example Request

```json
{
  "provider": "OpenWork",
  "model": "deepseek-v4-flash",
  "project_id": "FlightplanMCP",
  "plan_id": "FLIGHTPLAN-DURABILITY-CHAIN",
  "work_order_id": "S1",
  "agent": "OpenWork-Claude"
}
```

### Example Response

```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "started_at": "2026-06-29T05:17:03.214Z",
  "level": "REFUELLED",
  "message": "Session started. Runway restored. Call get_runway() to check status. Call record_session() with your final token count when done.",
  "project_id": "FlightplanMCP",
  "plan_id": "FLIGHTPLAN-DURABILITY-CHAIN",
  "work_order_id": "S1",
  "agent": "OpenWork-Claude"
}
```

### Error Response (already active)

```json
{
  "session_id": "existing-session-id",
  "started_at": "2026-06-29T04:00:00.000Z",
  "level": "CRUISING",
  "message": "A session is already active (existing-session-id). Call record_session() with your token count to close it before starting a new one. Tokens observed so far: 15,000."
}
```

### Mutates DB

Yes. Writes to `active_session` table.

### Privacy Notes

- Stores provider, model, project_id, plan_id, work_order_id, work_session_id,
  agent in the local DB. These are user-supplied metadata tags.
- Does NOT store prompts, code, conversation content, or notes.

---

## Tool: `record_session`

### Purpose

End the current Flightplan tracking session and record your token usage.
Call this when you are done working for the session. Provide `tokens_total` —
your final token count from this session. This data improves your baseline
estimate over time.

### Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `tokens_total` | number | **yes** | Total tokens used in this session |
| `notes` | string | no | Optional notes about this session (max 2,000 chars) |
| `outcome` | enum | no | FP-1: Session outcome: `completed`, `checkpointed`, `stale`, `blocked`, `aborted`, `honk` |
| `project_id` | string | no | FP-1: Override project tag |
| `plan_id` | string | no | FP-1: Override plan ID (e.g. "Sprint-E") |
| `work_order_id` | string | no | FP-1: Override Work Order ID (e.g. "A1") |
| `work_session_id` | string | no | FP-1: Override Work Session ID |
| `agent` | string | no | FP-1: Override agent name (e.g. "OpenWork-Claude") |

### Example Request

```json
{
  "tokens_total": 18000,
  "outcome": "completed",
  "project_id": "FlightplanMCP"
}
```

### Example Response

```json
{
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tokens_total": 18000,
  "duration_minutes": 47.3,
  "final_level": "CRUISING",
  "sessions_archived": 13,
  "outcome": "completed",
  "message": "Session archived. 18,000 tokens over 47.3 minutes. Final level: CRUISING. Outcome: completed. Dead Reckoning active — baseline improving automatically."
}
```

### Error Response (no active session)

```json
{
  "ok": false,
  "error": {
    "code": "NO_ACTIVE_SESSION",
    "message": "record_session: no active session found. Call session_start() before record_session()."
  }
}
```

### Error Response (invalid tokens_total)

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "record_session: tokens_total must be a non-negative number. Got: -100"
  }
}
```

### Mutates DB

Yes. Writes to `usage_snapshots`, clears `active_session`.

### Privacy Notes

- `notes` field is untrusted freeform text. Capped at 2,000 characters.
  Notes are excluded from receipts by default (privacy boundary).
- Does NOT store prompts, code, or conversation content.
- The `tokens_total` is the only hard requirement — all other fields are optional.

---

## Tool: `estimate_work_runway`

### Purpose

Estimate the token runway needed for a proposed work item and get a governed
proceed/checkpoint/split/land decision. Combines Dead Reckoning historical
estimates with gate policy. Call this before starting large tasks when you
need to know if you have enough runway.

### Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | no | Model name |
| `provider` | string | no | AI provider |
| `project_id` | string | no | Project identifier |
| `plan_id` | string | no | Plan ID (e.g. "Sprint-E") |
| `work_order_id` | string | no | Work Order ID (e.g. "A1") |
| `work_session_id` | string | no | Work Session ID |
| `agent` | string | no | Agent name |
| `work_type` | string | no | Type of work (e.g. sprint, refactor) |
| `expected_scope` | string | no | Expected scope description |

### Example Request

```json
{
  "model": "deepseek-v4-flash",
  "provider": "OpenWork",
  "project_id": "TheLibrarian",
  "work_type": "sprint"
}
```

### Example Response

```json
{
  "decision": "proceed",
  "confidence": "medium",
  "estimated_tokens": {
    "p50": 18000,
    "p80": 45000,
    "p95": 85000
  },
  "historical_basis": {
    "matching_sessions": 10,
    "scope": "provider_model"
  },
  "goose_level": "PREFLIGHT",
  "recommended_action": "Normal work allowed. Monitor runway and re-evaluate before major operations.",
  "policy_reasons": [
    "No active session — using conservative estimate"
  ]
}
```

### Error Response

`estimate_work_runway` returns a valid response for all inputs (no required
fields). If insufficient historical data exists, it falls back to the configured
baseline with `confidence: "wayward"` and `fallback_used: true`.

### Mutates DB

No. Read-only (calls `openDb()` to read session state and historical data).

### Privacy Notes

- Does not store prompts, code, or conversation content.
- Reads historical token totals from `usage_snapshots` but only aggregate
  percentiles (p50/p80/p95) are returned — individual session data is not
  exposed unless enough sessions exist to form a distribution.
- Work tags (project_id, plan_id, etc.) are returned as provided by the caller.

---

## Tool: `land_session`

### Purpose

Assess the current session and determine whether it needs to land. Returns a
landing recommendation, handoff template, and whether `record_session` can be
called. Call this when HONK is detected or before ending work.

### Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `tokens_total` | number | no | Optional token total to record with landing |
| `outcome` | enum | no | Session outcome: `completed`, `checkpointed`, `stale`, `blocked`, `aborted`, `honk` |

### Example Request

```json
{}
```

### Example Response

```json
{
  "level": "PREFLIGHT",
  "landing_required": false,
  "can_record": false,
  "missing": [],
  "recommended_action": "No active session. Call session_start() to begin tracking.",
  "handoff_template": null
}
```

With active session:

```json
{
  "level": "HONK",
  "landing_required": true,
  "can_record": true,
  "missing": [],
  "recommended_action": "Runway exhausted. Call record_session() with your token count immediately. Then create a restart packet describing what was completed and what remains.",
  "handoff_template": {
    "restart_packet": {
      "completed": [],
      "in_progress": [],
      "next": [],
      "blockers": []
    }
  }
}
```

### Error Response

`land_session` always returns a valid landing assessment. If no session is
active, it returns `PREFLIGHT` with `landing_required: false`.

### Mutates DB

No. Read-only (reads session state from `active_session`).

### Privacy Notes

- Does not store prompts, code, or conversation content.
- `handoff_template` is generated from session metadata only — no private data
  is included.
- Notes are not returned in the handoff template.

---

## Error Response Format

All MCP tools return errors through the standard MCP error mechanism (the MCP
SDK's `McpError` or thrown `Error` objects). For tools that support graceful
error handling, the error response follows this shape when serialized:

```json
{
  "ok": false,
  "error": {
    "code": "NO_ACTIVE_SESSION",
    "message": "record_session: no active session found. Call session_start() before record_session()."
  }
}
```

Common error codes:

| Code | Meaning |
|---|---|
| `NO_ACTIVE_SESSION` | No session is currently active |
| `INVALID_ARGUMENT` | A parameter failed validation |
| `DATABASE_ERROR` | Database read/write failure |

---

## Privacy Summary

All five tools follow the Flightplan privacy boundary:

- **No telemetry**: zero network requests, no cloud sync
- **No conversation content**: prompts, code, and agent responses are never stored
- **Local-only DB**: `~/.flightplan/flightplan.db`
- **Notes excluded from receipts**: the `notes` field is agent-controlled
  freeform text; it is stored in the DB but excluded from receipt output
  by default
- **Work tags are metadata**: `project_id`, `plan_id`, `work_order_id`,
  `work_session_id`, and `agent` are user-supplied tags — not content
