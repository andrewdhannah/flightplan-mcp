# FLIGHTPLAN-DURABILITY-CLOSEOUT-1

Date: 2026-06-29
Repository: `/Users/andrew/Desktop/OpenWork/flightplan-mcp`
Starting HEAD: `006c49d18298ffa1877199dd6b2a76017dfe46b5` (from prior closeout)
Ending HEAD: `02ffa5f71f043d9a98f1d559e955e3eb8e451c15`
Branch: `main`
Remote: `origin → https://github.com/andrewdhannah/flightplan-mcp.git`
GitHub pushed: yes
Version: 0.2.0 (bumped from 0.1.5)

## Summary

Completed the Flightplan MCP durability and GitHub update chain: CLI polish,
MCP tool hardening, full documentation (README, CLI, INSTALL, MCP-TOOLS),
package/release preparation, dogfood session, and GitHub push. The repo is
now ready for immediate use by anyone cloning or installing Flightplan MCP.

## Baseline Verified

- Prior overnight closeout found: `docs/sprints/FLIGHTPLAN-OVERNIGHT-CLOSEOUT-1.md`
- Prior test status: 173 tests passed, smoke 5/5, build clean
- Prior receipt correction performed: Changed "7 sprints" to "6 implementation
  sprints plus closeout" and added closeout row to sprint table

## Sprints Completed

| Sprint | Status | Commit | Notes |
|---|---:|---:|---|
| FLIGHTPLAN-CLI-POLISH-1 | PASS | `b8943c2` | --help, JSON errors, exit codes, 29 CLI tests |
| FLIGHTPLAN-MCP-DURABILITY-1 | PASS | `24b931d` | MCP-TOOLS.md, 37 schema/tool tests, smoke:mcp |
| FLIGHTPLAN-README-AND-INSTALL-1 | PASS | `4efea06` | README update, CLI.md, INSTALL.md |
| FLIGHTPLAN-PACKAGING-AND-RELEASE-1 | PASS | `67af2fd` | v0.2.0, clean pack, fresh clone simulation |
| FLIGHTPLAN-DOGFOOD-LONG-SESSION-1 | PARTIAL | `docs/sprints/...` | Short session, tokens unavailable from provider |
| FLIGHTPLAN-GITHUB-UPDATE-1 | PASS | `02ffa5f` | Push to origin/main, verified |
| FLIGHTPLAN-DURABILITY-CLOSEOUT-1 | PASS | (current) | This report |

## Files Created

```
docs/CLI.md                        — Full CLI reference for all commands
docs/INSTALL.md                    — Installation and MCP client configuration
docs/MCP-TOOLS.md                  — Complete MCP tool documentation
docs/sprints/FLIGHTPLAN-DOGFOOD-LONG-SESSION-1.md  — Dogfood session report
tests/cli-integration.test.ts      — 29 CLI integration tests
tests/mcp-tools.test.ts            — 37 MCP tool registration and schema tests
```

## Files Modified

```
.gitignore          — Added evidence/ to gitignore
package.json        — version 0.1.5 → 0.2.0, added smoke:mcp script
README.md           — Rewrote with CLI commands, MCP tools, Goose Scale, testing, privacy
src/status.ts       — Added --help for all commands, JSON error shape, exit codes
src/db/connection.ts — Added FLIGHTPLAN_DB_PATH env var for test isolation
docs/sprints/FLIGHTPLAN-OVERNIGHT-CLOSEOUT-1.md — Fixed "7 sprints" language
```

## CLI Surface Final

| Command | --help | --json | Exit codes |
|---|---:|---:|---|
| `status` | ✓ | ✓ | 0, 1 |
| `export` | ✓ | — | 0, 1 |
| `stats` | ✓ | ✓ | 0, 1 |
| `calibration report` | ✓ | ✓ | 0, 1 |
| `calibration candidates` | ✓ | ✓ | 0, 1 |
| `anomalies` | ✓ | ✓ | 0, 1 |
| `estimate` | ✓ | ✓ | 0, 1 |
| `gate` | ✓ | ✓ | 0, 1 |
| `receipt` | ✓ | ✓ | 0, 1 |
| `land` | ✓ | ✓ | 0, 1 |

JSON error shape:
```json
{"ok": false, "error": {"code": "MISSING_REQUIRED_ARGUMENT", "message": "..."}}
```

## MCP Surface Final

| Tool | Docs | Schema tests | Privacy OK | Mutates DB |
|---|---:|---:|---:|---|
| `get_runway` | ✓ | ✓ | ✓ | No |
| `session_start` | ✓ | ✓ | ✓ | Yes |
| `record_session` | ✓ | ✓ | ✓ | Yes |
| `estimate_work_runway` | ✓ | ✓ | ✓ | No |
| `land_session` | ✓ | ✓ | ✓ | No |

## Install Flow Verified

Fresh clone simulation (temp dir with cp -R):
- `npm install`: OK (176 packages)
- `npm run build`: OK (tsc, no errors)
- `npm run smoke`: 5/5 passed
- `npm test`: 239/239 passed (12 test files)
- `npm pack --dry-run`: 95 files, 98.9 kB, clean

## Package Contents Verified

`npm pack --dry-run` includes:
- `dist/` (all compiled JS, .d.ts, .js.map)
- `LICENSE` (MIT)
- `README.md`
- `package.json`

Excludes:
- `*.db`, `*.bak` (gitignored)
- `node_modules/` (gitignored)
- `evidence/` (gitignored)
- `docs/` (not in `files` — intentional, docs are for GitHub)
- Source `.ts` files (compiled to `dist/`)

## Privacy Boundary Verified

- No telemetry: confirmed (zero network dependencies)
- No conversation content stored: confirmed (no prompt/response storage)
- Notes excluded from receipts: confirmed (receipt generator strips notes)
- Local DB only: confirmed (`~/.flightplan/flightplan.db`)
- All tests use in-memory DBs: confirmed (239 tests, zero live-DB mutations)
- `FLIGHTPLAN_DB_PATH` env var for test isolation: added

## Validation Output

### git status before push

```text
?? evidence/
```

(evidence/ added to .gitignore before push)

### npm run smoke

```text
5 passed | 0 failed
```

### npm run build

```text
> tsc
(no errors)
```

### npm test

```text
Test Files  12 passed (12)
     Tests  239 passed (239)
```

### npm pack --dry-run

```text
package size: 98.9 kB
unpacked size: 392.4 kB
total files: 95
No .db, .bak, or evidence files
```

### fresh clone simulation

```text
npm install: 176 packages
npm run build: OK
npm run smoke: 5/5
npm test: 239/239
npm pack --dry-run: 98.9 kB, clean
```

### git push

```text
To https://github.com/andrewdhannah/flightplan-mcp.git
   2dd896b..02ffa5f  main -> main
```

## Final Git State

```text
02ffa5f chore: add evidence/ to gitignore
67af2fd chore(release): prepare Flightplan MCP package for GitHub
4efea06 docs: document Flightplan CLI, MCP tools, and install flow
24b931d feat(mcp): harden Flightplan tool contracts
b8943c2 feat(cli): polish Flightplan operator commands
17e9cbc docs(closeout): clarify Flightplan overnight closeout status
006c49d docs(closeout): complete Flightplan overnight integration report
08ff0d6 feat(cli): add analytics, gate, estimate, receipt, and land commands
```
(clean — no uncommitted changes)

## Known Risks

1. **Fresh clone simulation used cp -R** rather than a true `git clone` from
   GitHub. The git push to GitHub was successful and the remote HEAD matches,
   so a real clone should work identically — but this was not explicitly
   validated after the push.

2. **Dogfood session was too short.** The session was started after Sprints 1-4
   were already completed. A proper long-session test would start at the
   beginning of the first sprint. The dogfood report (PARTIAL) documents this.

3. **tokens_total unavailable from provider during dogfood session.** The
   OpenWork model provider did not expose a live token count during the
   session. The `record_session` MCP tool requires tokens_total, which means
   agents that cannot obtain provider token counts cannot complete the
   Flightplan lifecycle.

4. **Some legacy sessions** in the live DB have `duration_minutes: 0.1` which
   is a known quirk from early Flightplan builds. These are correctly excluded
   from calibration but clutter the exclusion report.

## Deferred Work

- Dashboard and visualization (requires UI framework, out of scope)
- Formation Trust / Flock File sharing (Phase 3, not yet started)
- Calibration auto-tuning that adjusts `excluded_from_calibration` bit
- Automated `record_session` call from `land_session` when tokens are supplied
- Export of receipts with notes included via explicit flag
- Bash/zsh shell completions for CLI commands
- Implementation of Phase 2 Dead Reckoning velocity fields (burn_rate, time_remaining)

## Recommended Next Sprint

**FLIGHTPLAN-PHASE-2-VELOCITY-1**: Implement Dead Reckoning velocity fields
— `burn_rate_per_hour`, `time_remaining_minutes`, confidence intervals from
real historical usage data. This is the last Phase 1→2 bridge item before
Flightplan enters Phase 2 proper.

Short-term: Add a `tokens_total` fallback mechanism for agents that can't
get exact token counts from their provider, and add a `token_estimation` mode
to `record_session`.

## Final Decision

**PASS** — Flightplan MCP is boring, durable, documented, tested, packaged,
and pushed to GitHub. All required deliverables are complete. The dogfood
session was PARTIAL (short session, missing token count) but this does not
block the durability closeout.
