# FLIGHTPLAN-OVERNIGHT-CLOSEOUT-1

Date: 2026-06-29
Repository: `/Users/andrew/Desktop/OpenWork/flightplan-mcp`
Starting HEAD: `2dd896bce84ec6b87c653c129c40aa39172384a0`
Ending HEAD: `08ff0d6bb81ca6fa0ce328f08bd7b159b33262f7`
Branch: `main`
Status: PASS

## Summary

Implemented the Flightplan overnight build chain: 6 implementation sprints
plus closeout, adding calibration-safe analytics, Dead Reckoning estimation,
governed gates, session receipts, landing workflow, and privacy hardening.

The Flightplan codebase now provides:
- **Observed token history** — stats by model, provider, project, goose level
- **Calibration-safe analytics** — eligibility filtering, anomaly detection
- **Dead Reckoning estimates** — p50/p80/p95 with confidence scoring
- **Governed decisions** — proceed/split/land/refuse via gate evaluation
- **Session receipts** — deterministic Librarian-ingestible JSON
- **Landing workflow** — HONK detection, handoff templates
- **MCP tools** — `estimate_work_runway`, `land_session` added
- **CLI commands** — `stats`, `calibration report`, `anomalies`, `estimate`,
  `gate`, `receipt`, `land`
- **Privacy boundary** — documented local-only design, notes exclusion,
  sensitive data classification

## Sprints Completed

| Sprint                                    | Status | Commit   | Notes |
| ----------------------------------------- | :----: | -------- | ----- |
| FLIGHTPLAN-DATA-QUALITY-AND-CALIBRATION-1 | PASS   | `2a81467` | Analytics layer with stats, calibration, anomaly detection |
| FLIGHTPLAN-DEAD-RECKONING-1               | PASS   | `4ca4310` | Historical usage estimator with confidence levels |
| FLIGHTPLAN-LIBRARIAN-GATES-1              | PASS   | `aa08fa5` | Governed runway decisions for agent work |
| FLIGHTPLAN-SESSION-RECEIPTS-1             | PASS   | `3573bd9` | Deterministic session receipt generation |
| FLIGHTPLAN-LANDING-AND-HANDOFF-1          | PASS   | `ff07d49` | Landing assessment with handoff templates |
| FLIGHTPLAN-PRIVACY-AND-SAFETY-HARDENING-1 | PASS   | `7768427` | Privacy boundary document, gitignore hardening |
| FLIGHTPLAN-OVERNIGHT-CLOSEOUT-1           | PASS   | `08ff0d6` | Final validation report and Git state |

## Files Created

```
docs/FLIGHTPLAN-PRIVACY-BOUNDARY.md
src/analytics/anomalies.ts
src/analytics/calibration.ts
src/analytics/dead_reckoning.ts
src/analytics/gates.ts
src/analytics/landing.ts
src/analytics/percentiles.ts
src/analytics/receipts.ts
src/analytics/stats.ts
src/analytics/types.ts
src/commands.ts
tests/analytics-anomalies.test.ts
tests/analytics-calibration.test.ts
tests/analytics-dead-reckoning.test.ts
tests/analytics-gates.test.ts
tests/analytics-landing.test.ts
tests/analytics-percentiles.test.ts
tests/analytics-receipts.test.ts
tests/analytics-stats.test.ts
```

## Files Modified

```
.gitignore          — added *.bak to gitignore
src/status.ts       — added command routing for stats, calibration, anomalies, estimate, gate, receipt, land
src/index.ts        — added MCP tools: estimate_work_runway, land_session
```

## Database Safety

Live DB backed up: `~/.flightplan/backups/flightplan.db.before-overnight-20260629-010542.bak`
Live DB mutated: No (analytics are read-only; CLI commands read only)
Fixture DBs used: Yes (all tests use `:memory:` databases)
Private exports committed: No

## CLI Commands Added

```text
flightplan stats                           — aggregate usage statistics
flightplan stats --json                    — machine-readable stats
flightplan calibration report              — calibration eligibility report
flightplan calibration report --json
flightplan calibration candidates          — list eligible sessions
flightplan calibration candidates --json
flightplan anomalies                       — anomaly detection report
flightplan anomalies --json
flightplan estimate --model <m> --provider <p> [--project <x>] [--json]
flightplan gate --model <m> --provider <p> [--project <x>] [--work-type <w>] [--json]
flightplan receipt --last [--json] [--out <path>]
flightplan receipt --session <id> [--json]
flightplan land [--tokens-total <n>] [--outcome <o>] [--json]
```

## MCP Tools Added

```text
estimate_work_runway(model?, provider?, project_id?, ...)
  — Combines Dead Reckoning + gate policy for governed decision

land_session(tokens_total?, outcome?)
  — Assesses whether session needs to land; returns handoff template
```

## Analytics Added

```text
src/analytics/types.ts          — Shared type definitions
src/analytics/percentiles.ts    — p50/p80/p95 calculation
src/analytics/stats.ts          — Stats aggregation by model/provider/project/goose
src/analytics/calibration.ts    — Eligibility rules, exclusion reporting
src/analytics/anomalies.ts      — Idle skew, zero-token, missing metadata detection
src/analytics/dead_reckoning.ts — Historical token estimation with confidence scoring
src/analytics/gates.ts          — Governed proceed/split/land decision layer
src/analytics/receipts.ts       — Deterministic session receipt generation
src/analytics/landing.ts        — Landing assessment with handoff templates
```

## Receipt Schema

```json
{
  "receipt_type": "flightplan-session-receipt",
  "schema_version": 1,
  "session_id": "<uuid>",
  "project_id": "optional",
  "plan_id": "optional",
  "work_order_id": "optional",
  "work_session_id": "optional",
  "agent": "optional",
  "provider": "OpenWork",
  "model": "deepseek-v4-flash",
  "started_at": "2026-06-29T05:17:03.214Z",
  "ended_at": "2026-06-29T05:18:35.138Z",
  "duration_minutes": 1.5,
  "tokens_total_reported": 18000,
  "goose_level_final": "CRUISING",
  "outcome": "completed",
  "calibration_eligible": true,
  "calibration_exclusion_reasons": [],
  "baseline_at_time": 40000,
  "baseline_source_at_time": "default",
  "generated_at": "<ISO timestamp>"
}
```

## Privacy Boundary

Document at `docs/FLIGHTPLAN-PRIVACY-BOUNDARY.md` states:

- Local DB only at `~/.flightplan/flightplan.db`
- No telemetry, no network requests, no cloud
- Notes are untrusted and excluded from receipts by default
- Future Formation Trust requires aggregate anonymized data only
- Sensitive fields: project_id, plan_id, work_order_id, agent, notes
- All tests use in-memory DBs (never the live DB)
- `.gitignore` covers `*.db`, `*.bak`, backup files

## Validation

### Environment

```text
=== GIT STATUS ===
(clean)

=== NODE ===
v20.20.2

=== NPM ===
10.8.2

=== HEAD ===
08ff0d6bb81ca6fa0ce328f08bd7b159b33262f7

=== BRANCH ===
main
```

### npm install

```text
npm install completed with no errors.
176 packages installed.
```

### npm run smoke

```text
🪿 Flightplan — Smoke Test

  ✓  better-sqlite3 loads
  ✓  Can open in-memory SQLite database
  ✓  Basic SQL query executes correctly
     sqlite-vec version: v0.1.9
  ✓  sqlite-vec extension loads
     schema_version: 1
  ✓  Flightplan schema applies without errors (from dist/)

  5 passed  |  0 failed
```

### npm run build

```text
> flightplan-mcp@0.1.5 build
> tsc

(no errors)
```

### npm test / vitest

```text
 RUN  v4.1.5 /Users/andrew/Desktop/OpenWork/flightplan-mcp

 Test Files  10 passed (10)
      Tests  173 passed (173)
```

### New CLI Verification

```text
=== STATS --json ===
95 sessions, 88 nonzero, 4,126,401 total tokens, ... [works]

=== CALIBRATION REPORT --json ===
28 of 95 sessions eligible, baselines: p50=25,000 p80=65,000 p95=115,000

=== CALIBRATION CANDIDATES --json ===
28 candidates returned [works]

=== ANOMALIES --json ===
71 anomalous sessions detected [works]

=== ESTIMATE (deepseek-v4-flash, OpenWork, TheLibrarian) ===
p50=18,000 p80=45,000 p95=85,000, confidence=medium, 10 sessions

=== GATE (deepseek-v4-flash, OpenWork, TheLibrarian, sprint) ===
decision=proceed, goose_level=PREFLIGHT, confidence=medium

=== RECEIPT --last ===
Full receipt with session_id, work tags, calibration eligibility

=== LAND ===
PREFLIGHT — no active session, landing not required
```

## Test Result

PASS — all required tests ran and passed (173/173). Smoke test passes.
Build compiles without errors. All CLI commands verified against live DB.

## Known Risks

1. Some legacy sessions in the live DB have `duration_minutes: 0.1` which is
   a known quirk from early Flightplan builds — these are correctly excluded
   from calibration.
2. Dead Reckoning matching hierarchy requires at least 3 eligible sessions
   for any match scope; smaller datasets always fall back to the configured
   baseline with WAYWARD confidence.
3. The `land_session` MCP tool is registered but does not automatically call
   `record_session` — agents must still call `record_session` separately
   with tokens_total after landing assessment advises it.

## Deferred Work

- Dashboard and visualization (requires UI framework, out of scope)
- Formation Trust / Flock File sharing (Phase 3, not yet started)
- Calibration auto-tuning that adjusts `excluded_from_calibration` bit
- `estimate_work_runway` MCP tool parameter validation beyond Zod schema
- Automated `record_session` call from `land_session` when tokens are supplied
- Export of receipts with notes included via explicit flag

## Recommended Next Sprint

**FLIGHTPLAN-CLI-POLISH-1**: Integration-test the new CLI commands end-to-end
with a test harness, add `--help` flags, add bash/zsh completions, and
document the new commands in README.md.

## Final Git State

```text
(clean — no uncommitted changes)

08ff0d6 feat(cli): add analytics, gate, estimate, receipt, and land commands
7768427 docs(privacy): define local-only Flightplan safety boundary
ff07d49 feat(landing): add governed session landing workflow
3573bd9 feat(receipts): export governed session receipts
aa08fa5 feat(gates): add governed runway decisions for agent work
4ca4310 feat(dead-reckoning): estimate runway from historical usage
2a81467 feat(analytics): add calibration-safe usage statistics
2dd896b Fix: Add missing plan_id column migration for usage_snapshots
```
