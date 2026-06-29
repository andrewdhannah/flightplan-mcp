# FlightPlan Agent Packet Template

Copy-paste sections for use in Codex, OpenWork, Librarian, or any other
long-running agent prompt or system instruction packet.

---

## FlightPlan Startup

```markdown
## FlightPlan Startup — Run Before Beginning Work

Run these commands at the start of every long-running session:

```
flightplan status --json
flightplan stats --json
flightplan estimate --json --model "<model>" --provider "<provider>" --project "<project>"
flightplan gate --json --model "<model>" --provider "<provider>" --project "<project>" --work-type "<work-type>"
```

### If MCP is available:

```
session_start(provider="<provider>", model="<model>", project_id="<project>",
              plan_id="<plan-id>", work_order_id="<work-order-id>",
              work_session_id="<work-session-id>", agent="<agent>")
```

### Record startup state:

```
FlightPlan status:          <level> (<runway_pct>% remaining)
FlightPlan estimate:        p50=<tokens> p80=<tokens> p95=<tokens>
FlightPlan gate decision:   <decision>
Calibration confidence:     <high|medium|low|wayward>
Allowed action:             <description>
Restrictions:               <any restrictions>
```
```

---

## FlightPlan Periodic Checks

```markdown
## FlightPlan Periodic Checks — During Long Work

Re-check FlightPlan before any expensive operation:

| Trigger | Action |
|---|---|
| Before `npm install` / dependency changes | `flightplan gate --json` |
| Before multi-file edits | `flightplan gate --json` |
| Before large documentation rewrites | `flightplan gate --json` |
| Before full test runs | `flightplan gate --json` |
| Before package/release actions | `flightplan gate --json` |
| Before `git push` | `flightplan gate --json` |
| After failure or retry loop | `flightplan gate --json` |
| Every 45–60 minutes | `flightplan gate --json` |
| Context/runway seems degraded | `flightplan gate --json` |

### Decision meanings

| Decision | Meaning | Required Action |
|---|---|---|
| `proceed` | Normal work allowed | Continue. Re-evaluate before major ops. |
| `proceed_with_checkpoint` | Work allowed | Write checkpoint. Do not expand scope. |
| `split` | Must bound work | Stop scope expansion. Finish current unit only. Prepare handoff. |
| `land_first` | Runway unsafe | Stop new work. Run `flightplan land --json`. Prepare closeout. |
| `refuse` | Blocked | Stop and report blocker. |

### Command

```bash
flightplan gate --json --model "<model>" --provider "<provider>" --project "<project>"
```
```

---

## FlightPlan Landing

```markdown
## FlightPlan Landing — End of Session

Run this sequence at the end of every long session:

### 1. Assess landing

```bash
flightplan land --json
```

### 2. If tokens are available (MCP only)

```
record_session(tokens_total=<actual-number>,
               outcome="<completed|checkpointed|partial|failed>",
               notes="Short non-sensitive summary only.")
```

### 3. If tokens are NOT available

```
Token count unavailable; session not recorded for calibration.
```

Do **not** invent token counts. An honest omission is better than a false record.
```
```

---

## FlightPlan Receipt

```markdown
## FlightPlan Receipt — Evidence Generation

Generate evidence after landing:

```bash
flightplan receipt --last --json
flightplan stats --json
flightplan calibration report --json
```

### Closeout report template

```
FlightPlan session ID:          <uuid>
Final Goose level:              <level>
Reported tokens:                <number> | Unavailable
Outcome:                        <completed|checkpointed|partial|failed>
Calibration eligible:           <yes|no>
Receipt generated:              <yes|no>
Data quality notes:             <any warnings>
Should influence calibration:   <yes|no>
```
```

---

## FlightPlan Evidence

```markdown
## FlightPlan Evidence — What to Save

Save the following artifacts for the closeout report:

1. `flightplan status --json` output (startup state)
2. `flightplan gate --json` output (final gate decision)
3. `flightplan receipt --last --json` output (session receipt)
4. `flightplan stats --json` output (final aggregate stats)
5. `flightplan calibration report --json` output (data quality)

These five JSON documents form the complete FlightPlan evidence record
for any session. They are deterministic, machine-readable, and safe to
commit or share (no secrets, no prompts, no conversation content).
```

---

## Full Startup Block (Single Copy-Paste)

```markdown
## Required: FlightPlan Startup

Before beginning any work, I must check my token runway:

```
flightplan status --json
flightplan stats --json
flightplan estimate --json --model "<model>" --provider "<provider>"
flightplan gate --json --model "<model>" --provider "<provider>"
```

If MCP is available, I also start a tracking session:
`session_start(provider=..., model=..., project_id=...)`

I record the results in my preflight report:
- FlightPlan status: <level> (<pct>% remaining)
- Gate decision: <decision>
- Restrictions: <any>
```

## Full Landing Block (Single Copy-Paste)

```markdown
## Required: FlightPlan Landing

Before ending work, I must close out my FlightPlan session:

1. `flightplan land --json` — assess landing
2. If tokens are known: `record_session(tokens_total=<actual>, outcome="...")`
3. If tokens are unknown: note "Token count unavailable"
4. `flightplan receipt --last --json` — generate receipt
5. `flightplan stats --json` — final stats
6. `flightplan calibration report --json` — data quality

I save all JSON outputs as evidence.
```
