# Flightplan — Project Plan
**Created:** 2026-05-05
**Status:** Tier 1 complete. Tier 2 in progress. v0.1.0 publish pending.

This is the canonical roadmap. Three buckets: ship 0.1.0, Phase 2, and future Flightplan. Items inside each bucket are unordered unless noted.

---

## Bucket 1 — Ship 0.1.0

Everything in this bucket gets done before `npm publish`. Total estimate: ~3–4 hours of focused work, splittable across sessions.

### 1A. Fast wins (~15 min total)
- [ ] **1.3** Replace `yourusername` placeholder in `package.json` and `README.md`
- [ ] **2.3** Delete duplicate `tokens_total` validation in `src/index.ts` lines 192–199 (Zod handles it at the MCP boundary)
- [ ] **2.4** Tighten `RECOMMENDED_ACTIONS` typing in `src/tools/get_runway.ts` line 65: `Record<string, string>` → `Record<GooseLevel, string>`. Simplifies the fallback chain at line 153.

### 1B. Documentation polish (~65 min)
- [ ] **2.1** `CHANGELOG.md` at repo root. Use Opus's draft from AUDIT_AND_ROADMAP §2.1 plus this session's additions (`flightplan export`, `RUNWAY_STATE.md` via `state_generator.ts`, Tier 1 fixes 1.4–1.7, 3 new lifecycle tests).
- [ ] **2.2** "What Flightplan stores" section in README, between Database Schema and Roadmap. Full text drafted in AUDIT_AND_ROADMAP §2.2.
- [ ] **2.10** Integration Patterns section in README. Use the draft from `INTEGRATION_PATTERNS_DRAFT.md` produced 2026-05-05. Verify Codex/Copilot MCP support claims against current docs before merge.

### 1C. Markdown carrier hardening (~40 min)
*The Markdown carrier is the third leg of the support matrix. Without these two items it's meaningfully weaker than MCP and JSON.*
- [ ] **2.7** Strict Agent Contract block at the top of `RUNWAY_STATE.md` in `src/state/state_generator.ts`. Imperative MUST/STOP language for each Goose level. Source: ChatGPT's review, 2026-05-05.
- [ ] **2.8** Timestamp + staleness warning at the bottom of `RUNWAY_STATE.md`. Source: ChatGPT's review.

### 1D. Verification items (~15 min if no fixes needed)
- [ ] **2.9** Confirm `record_session` retry behavior. If duplicate `session_id` produces a duplicate row (vs. error or no-op), add `ON CONFLICT DO NOTHING` to the INSERT. Source: Gemini's idempotency point.
- [ ] **2.11** `toSlug` empty-string fallback in `src/cli.ts`: add `|| 'custom_provider'` to handle the edge case where a user types only special characters. Two-line fix. Source: Augure's review.

### 1E. GitHub push + pre-launch checklist (~30–60 min)
- [ ] Create `flightplan-mcp` repo on GitHub (public; verify name available on npm)
- [ ] Fill Andrew's legal name in `LICENSE`
- [ ] `git init && git add . && git commit -m "feat: Phase 1.5 — Tier 1 fixes + flightplan export"`
- [ ] `git tag v0.1.0 && git push`
- [ ] Pre-launch verification:
  - [ ] `npm test` (13 green)
  - [ ] `npm run smoke` (5 green)
  - [ ] `rm -rf dist && npm run build` (clean build)
  - [ ] `npm audit` (0 vulnerabilities)
  - [ ] `npm pack --dry-run` (verify only `dist/` ships)
  - [ ] Manual end-to-end test on a clean machine

---

## Bucket 2 — Phase 2 (Dead Reckoning)

**Deliberately deferred until 0.1.0 ships and real-world feedback arrives.** Items below are scope, not commitments. Phase 2 starts when you decide it does — not before.

### Core Phase 2 (already in original roadmap)
- [ ] Auto-calibrated baseline replacing manual `session_baseline` after 5 archived sessions
- [ ] `burn_rate_per_hour` based on observed velocity
- [ ] `time_remaining_minutes` based on observed velocity
- [ ] `data_source` returns `"calibrated"` or `"observed"` (not `"agent_report"`)
- [ ] `confidence` field becomes meaningful (LOW/MEDIUM/HIGH based on calibration data quality). *Note: this is when ChatGPT's confidence-field point becomes worth doing — not in 0.1.0, where Phase 1's `data_source` and `formation_trust` fields already encode the same information structurally.*

### New Phase 2 items from 2026-05-05 reviews
- [ ] `flightplan purge` or `flightplan repair` for outlier sessions. Source: Gemini's "Black Box Recovery" point. Pair with existing Tier 3 items 3.6 (`flightplan reset` / `flightplan clear-notes`).

---

## Bucket 3 — Future Flightplan

No commitments. Captured ideas with honest framing. Each item has a one-line note about why it's parked.

### Phase 3 — Formation Trust (already in roadmap)
- Opt-in shared velocity profiles ("Flock Files")
- Trust-weighted predictions
- *Note: this is where strict agent compliance enforcement starts to make sense. Phase 1's deliberate humility (`formation_trust: "observer"`) ends here.*

### Browser extension + local HTTP server (TBD)
*Concept: glanceable Goose Scale indicator in the browser toolbar.*
- Badge with color (green/yellow/orange/red) + remaining %
- Notifications on level transitions (TURBULENCE, HONK)
- Requires a `flightplan serve` subcommand with:
  - 127.0.0.1 binding only (never 0.0.0.0)
  - Token auth via `Authorization` header
  - Origin allowlist matching the extension's origin
  - Read-only by default; write endpoints behind opt-in flag
  - Token stored at `~/.flightplan/token`
- **Blocked on Phase 2** for genuinely useful mid-session data. Without burn rate, the badge mostly sits at one number and updates only between sessions.
- **Open question:** is a snapshot-only version worth shipping standalone, or wait for streaming?
- Security review required before publishing the extension.

### Internationalization (i18n)
*Source: Gemini's contribution, 2026-05-05.*
- Bilingual init wizard with OS language detection (`LANG` / `LC_ALL`)
- Canadian English spelling pass (centre, behaviour, modelling)
- French (and Québécois) translation throughout CLI
- Adds a `language` column to the `config` table
- *Triggered by demand signal — wait until users ask, not before.*

### LLM-mode export
*Source: ChatGPT's review, 2026-05-05.*
- `flightplan export --mode=llm` — token-efficient stripped-down format
- *Park until a concrete user complains about token spend on the snapshot. Premature mode-splitting otherwise.*

### UX touches from Copilot's parallel implementation
- ASCII progress bar in `flightplan status` output: `[████░░░░] 52% remaining`
- "Dead Reckoning unlocks in N more sessions" messaging in `record_session` response
- *Both small, both nice-to-haves. Wait for Phase 2 polish work.*

### Pattern Libraries (Phase 4)
*Source: Gemini.*
- Recognize task types ("Refactor" vs. "Boilerplate") and adjust burn estimates
- *Genuinely interesting but very far out. Needs substantial session data to make work.*

### Cloud / enterprise integrations
*Source: Gemini.*
- Vertex AI Extension wrapping
- Cloud Run sidecar Dockerfile
- BigQuery export via `flightplan export --format=csv`
- *All filed under "if real demand arrives." Don't pre-build for hypothetical users.*

---

## Compatibility notes

**What changes for cross-LLM compatibility in 0.1.0:** items 2.7, 2.8, and 2.10. All three strengthen the Markdown carrier (the leg that lets non-MCP clients use Flightplan via copy/paste of `RUNWAY_STATE.md`). None touch the MCP or JSON paths.

**What doesn't change:** the MCP carrier and the JSON carrier. Both already work; the reviews surfaced no actionable issues there for 0.1.0.

**Verify before publishing platform-specific claims:**
- GitHub Copilot MCP support (changes frequently)
- OpenAI Codex CLI MCP support (ChatGPT claimed yes; verify)
- Continue.dev MCP support (Copilot claimed yes; verify)

The Integration Patterns draft handles this defensively by not committing to platform-specific claims and pointing readers to verify their client's current docs.

---

## Provenance

This plan synthesizes:
- Ash's `SESSION_HANDOFF_2026-05-05.md`
- Pre-existing `AUDIT_AND_ROADMAP.md`
- Cross-LLM review session 2026-05-05 (Copilot + Gemini + ChatGPT + Augure handoffs)
- Chrome extension scaffold from earlier session (deferred to Future Flightplan, security-reviewed)

Items added by review source:
- **Copilot:** 2 future UX items (progress bar, "unlocks in N sessions")
- **Gemini:** 1 verify item (2.9), 1 Phase 2 item (`flightplan purge`), and i18n / Pattern Libraries / cloud items in Future
- **ChatGPT:** 2 ship items (2.7, 2.8), 1 future item (`--mode=llm` export)
- **Augure:** 1 verify item (2.11)

🪿 *Each carrier flies its own course. The flock arrives together.*
