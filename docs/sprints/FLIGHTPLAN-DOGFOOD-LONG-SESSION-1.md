# FLIGHTPLAN-DOGFOOD-LONG-SESSION-1

Date: 2026-06-29
Repository: `/Users/andrew/Desktop/OpenWork/flightplan-mcp`
Agent: OpenWork-Claude
Provider: OpenWork
Model: deepseek-v4-flash
Session ID: 3782bc26-b5b1-417d-a4dd-49c597870827
Started: 2026-06-29T05:39:10Z
Ended: 2026-06-29T05:40:30Z (estimated)
Duration: ~1.5 min (short session — remaining spade work for closeout)
Reported tokens: unavailable (OpenWork provider does not expose live token count)
Outcome: completed (agent work finished)
Final Goose level: CRUISING (observed tokens = 0)
Calibration eligible: yes (if tokens_total were provided)

## Purpose

Use Flightplan during the actual durability sprint chain to prove it works as
a boring runtime governor for long agentic work. This session covers the
completion of Sprints 5-7 (dogfood, GitHub push, closeout) of the
FLIGHTPLAN-DURABILITY-CHAIN.

## FlightPlan Start State

- sessions: 97 archived in live DB
- nonzero sessions: 90
- eligible sessions: 30
- baseline p50/p80/p95: 25,000 / 45,000 / 115,000
- initial gate decision: proceed_with_checkpoint (CRUISING, p80=45,000 exceeds threshold)

## Gate Events

| Event | Action | Decision | Goose | Confidence | Result |
|---|---:|---:|---:|---:|---|
| 1 | session_start | N/A | REFUELLED | N/A | Started session 3782bc26 |
| 2 | Initial state capture | proceed_with_checkpoint | CRUISING | medium | Proceeded |
| 3 | GitHub push | proceed_with_checkpoint | CRUISING | medium | Push completed |

## Landing Result

```
Level: CRUISING
landing_required: false
can_record: false (tokens_total missing)
recommended_action: Session at CRUISING. No tokens provided yet.
```

## Receipt Result

Not generated — tokens_total unavailable.

## Did the Data Apply to This Project?

- **Historical FlightplanMCP data exists?** Yes. The live DB has 97 sessions
  with 2 sessions tagged as flightplan-mcp project and 34 deepseek-v4-flash
  sessions across 12 providers.
- **Did estimator use exact project/model/provider history or fallback?**
  Model-only match (scope: model_only). FlightplanMCP project data exists but
  only 2 sessions — below the 3-session confidence threshold for exact match.
  The estimator used 12 deepseek-v4-flash sessions across all projects.
- **Was confidence high, medium, low, or WAYWARD?** Medium (12 sessions).
- **Did FlightPlan change agent behavior?** Yes. The gate returned
  `proceed_with_checkpoint` rather than `proceed` for the GitHub push,
  because the p80 estimate (45,000) exceeds the large-estimate threshold
  (30,000). The agent was advised to checkpoint before expensive operations.
- **Did any gate prevent unsafe continuation?** No — the gate recommended
  checkpointing but did not block. Agent proceeded with all work.
- **Did the final session become calibration-eligible?** It would have been,
  but tokens_total was unavailable from the OpenWork provider so the session
  could not be recorded. This is a known limitation: `record_session` requires
  tokens_total, and while MCP agents can provide it, the agent running the
  session does not always have access to the provider's token accounting.
- **What did this teach us about long FlightPlan work sessions?**
  1. The gate policy correctly identifies large-scope sessions and recommends
     checkpointing — this is useful for long agent sessions.
  2. The `can_record: false` issue (tokens_total missing) is a real gap: agents
     that don't have access to provider token counts cannot complete the
     Flightplan lifecycle. Documentation should clarify this.
  3. 97 archived sessions in the live DB with 30 calibration-eligible shows
     that the calibration filtering is working correctly (excluding zero-token
     and short-duration sessions).

## Data Quality Notes

- The session was short (~1.5 min) because it represented only the remaining
  closeout work. The real long session was in Sprints 1-4 (CLI polish, MCP
  durability, docs, packaging) which were completed before the dogfood session
  was started. For a true long-session test, the dogfood session should have
  been started at the beginning of Sprint 1.
- tokens_total unavailable from provider — this is a real-world constraint
  that the Flightplan documentation should address.

## Privacy Review

- No prompts stored: confirmed
- No code contents stored: confirmed
- No secrets stored: confirmed
- Notes excluded from receipt by default: confirmed (notes field was never set)
- Evidence files reviewed before commit: evidence/ dir is in .gitignore

## Validation

```text
=== Pre-push verification ===
Build: OK (tsc, no errors)
Smoke: 5/5 passed
Tests: 239/239 passed (12 test files)
npm pack --dry-run: 95 files, 98.9 kB, no .db or .bak

=== Fresh clone simulation ===
npm install: OK
npm run build: OK
npm run smoke: 5/5 passed
npm test: 239/239 passed
npm pack --dry-run: 98.9 kB, clean

=== GitHub push ===
git push origin main: succeeded (02ffa5f)
remote HEAD: 02ffa5f → main
```

## Result

**PARTIAL** — FlightPlan recorded a session and provided useful gate decisions,
but the session was too short for a true long-session test, and tokens_total
was unavailable from the provider (preventing record_session).

## Recommended Follow-Up

1. Start the dogfood session at the beginning of the next durability sprint
   (not at the end) to capture a full long-session lifecycle.
2. Document the token-total availability constraint: agents that can't get
   provider token counts should fall back to a best-effort report or skip
   `record_session`.
3. Consider making `notes` a soft fallback for token-less sessions, where
   the agent describes what was done instead of providing a precise count.
