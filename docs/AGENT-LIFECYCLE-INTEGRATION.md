# FlightPlan Agent Lifecycle Integration

## Overview

FlightPlan provides standard lifecycle hooks for long-running agent sessions.
Any agent (Codex, OpenWork Claude, Librarian agent, etc.) should integrate
these hooks as a routine part of session management — not as optional
tribal knowledge.

The lifecycle has three phases:

1. **Startup / Preflight** — assess runway before beginning work
2. **Periodic Check** — re-assess before expensive operations
3. **Handoff / Closeout** — land the session and record evidence

---

## 1. Startup / Preflight Hook

Every long-running agent session **must** begin with FlightPlan checks.

### Required startup sequence

```bash
# 1. Check current runway state
flightplan status --json

# 2. Check aggregate statistics for context
flightplan stats --json

# 3. Estimate token burn for this session's work
flightplan estimate --json --model "<model>" --provider "<provider>" --project "<project>"

# 4. Get governed gate decision
flightplan gate --json --model "<model>" --provider "<provider>" --project "<project>" --work-type "<work-type>"
```

### Start a tracked session (MCP only)

If the agent has access to MCP tools, it must open a tracking session:

```
session_start(provider="<provider>", model="<model>", project_id="<project>",
              plan_id="<plan-id>", work_order_id="<work-order-id>",
              work_session_id="<work-session-id>", agent="<agent>")
```

**Note:** `session_start` is an MCP tool, not a CLI command. Agents without
MCP access skip session tracking but must still run the CLI checks above.

### Startup result format

Include the following in the agent's preflight report:

```text
FlightPlan status:        <level> (<runway_pct>% remaining)
FlightPlan estimate:      p50=<tokens> p80=<tokens> p95=<tokens>
FlightPlan gate decision: <proceed|proceed_with_checkpoint|split|land_first>
Calibration confidence:   <high|medium|low|wayward>
Allowed action:           <description>
Restrictions:             <any scope or action restrictions>
```

---

## 2. Periodic Check Hook

Agents must check FlightPlan periodically during long sessions.

### Required check points

- Before `npm install` / dependency changes
- Before multi-file edits
- Before large documentation rewrites
- Before full test runs
- Before package/release actions
- Before `git push`
- After any major failure or retry loop
- Every 45–60 minutes during long sessions
- Whenever the agent believes context/runway may be degraded

### Required command

```bash
flightplan gate --json \
  --model "<model>" \
  --provider "<provider>" \
  --project "<project>" \
  --work-type "<current-action>"
```

### Decision interpretation

| Gate Decision | Meaning | Required Action |
|---|---|---|
| `proceed` | Normal work allowed | Continue normally. Re-evaluate before major operations. |
| `proceed_with_checkpoint` | Work allowed with checkpoint | Write a checkpoint before continuing. Do not expand scope. |
| `split` | Work must be bounded | Stop scope expansion. Finish only the current bounded unit. Prepare a handoff for remaining work. |
| `land_first` | Runway unsafe | Stop new work. Run `flightplan land --json`. Prepare handoff/closeout. |
| `refuse` | Work blocked | Stop and report the blocker. Cannot proceed under current conditions. |

### Scope expansion rule

When the gate returns `proceed_with_checkpoint` or `split`, the agent must
**not** expand the scope of work. Only finish what is already in progress.
If the work is larger than anticipated, split it into independently
completable units and file a handoff for the remainder.

---

## 3. Handoff / Closeout Hook

Every long session must end with a FlightPlan closeout attempt.

### Required closeout sequence

```bash
# 1. Assess landing status
flightplan land --json
```

If the real token count is available:

```bash
# 2. Record the session (MCP tool — only if agent has MCP access)
record_session(tokens_total=<actual-token-total>,
               outcome="<completed|checkpointed|partial|failed>",
               notes="Short non-sensitive summary only.")
```

Then generate evidence:

```bash
# 3. Generate session receipt
flightplan receipt --last --json

# 4. Capture final stats for the closeout report
flightplan stats --json
flightplan calibration report --json
```

### Token-count honesty rule

If the exact token count is **unavailable**, the agent **must not** invent one.
It must state:

```text
Token count unavailable; session not recorded for calibration.
```

Do not use placeholder values (0, -1, estimated, etc.) as tokens_total.
An unrecorded session is honest data. An invented token count corrupts
the calibration baseline.

### Closeout report format

```text
FlightPlan session ID:          <uuid>
Final Goose level:              <level>
Reported tokens:                <number> | Unavailable
Outcome:                        <completed|checkpointed|partial|failed>
Calibration eligible:           <yes|no>
Receipt generated:              <yes|no>
Data quality notes:             <any anomalies or warnings>
Whether this session should
influence future calibration:   <yes|no — no if tokens unavailable>
```

---

## 4. Full Lifecycle Pseudocode

```
function run_agent_session(work_item, config):
    # ── PREFLIGHT ──
    status = exec("flightplan status --json")
    stats = exec("flightplan stats --json")
    estimate = exec("flightplan estimate --json --model {model} --provider {prov}")
    gate = exec("flightplan gate --json --model {model} --provider {prov} --project {proj}")
    
    if gate.decision in ("land_first", "refuse"):
        log("FlightPlan blocks work: {gate.decision}")
        return handoff(gate)
    
    # Start MCP session if available
    if mcp_available:
        session = session_start(provider=prov, model=model, project_id=proj, ...)
    
    # ── MAIN WORK LOOP ──
    while work_remaining and not landing_required:
        # Periodic check before expensive operations
        if expensive_op or time_since_last_check > 45min:
            gate = exec("flightplan gate --json ...")
            if gate.decision in ("split", "land_first", "refuse"):
                break
        
        work_result = do_next_work_unit()
    
    # ── CLOSEOUT ──
    landing = exec("flightplan land --json")
    
    if actual_tokens_available:
        record_session(tokens_total=actual_tokens, outcome=outcome, notes=summary)
    
    receipt = exec("flightplan receipt --last --json")
    final_stats = exec("flightplan stats --json")
    cal_report = exec("flightplan calibration report --json")
    
    return closeout_report(receipt, final_stats, cal_report)
```

---

## 5. Related Documents

- [Agent Packet Template](AGENT-PACKET-FLIGHTPLAN-TEMPLATE.md) — copy-paste
  template sections for agent prompts
- [CLI Reference](CLI.md) — full command reference
- [MCP Tools](MCP-TOOLS.md) — MCP tool schemas and examples
- [README.md](../README.md) — project overview and quick start

---

## Appendix: Command Summary

| Phase | Action | Access | Required |
|---|---|---|---|
| Preflight | `flightplan status --json` | CLI | Yes |
| Preflight | `flightplan stats --json` | CLI | Yes |
| Preflight | `flightplan estimate --json` | CLI | Yes |
| Preflight | `flightplan gate --json` | CLI | Yes |
| Preflight | `session_start(...)` | MCP | If available |
| Periodic | `flightplan gate --json` | CLI | Yes |
| Periodic | `get_runway()` | MCP | If available |
| Closeout | `flightplan land --json` | CLI | Yes |
| Closeout | `record_session(...)` | MCP | If tokens available |
| Closeout | `flightplan receipt --last --json` | CLI | Yes |
| Closeout | `flightplan stats --json` | CLI | Yes |
| Closeout | `flightplan calibration report --json` | CLI | Yes |
