# AUDIT_AND_ROADMAP — Update Block (2026-05-05)
**For pasting into the existing `AUDIT_AND_ROADMAP.md`. Do not replace the whole file — paste these blocks into the corresponding sections.**

---

## Items to mark complete

These were finished in the 2026-05-05 session before the cross-LLM review and should already be marked in your local copy. Listed here for completeness:

- [x] **1.1** LICENSE
- [x] **1.2** .gitignore
- [x] **1.4** smoke-test.js schema-drift fix
- [x] **1.5** record_session.ts notes cap (2,000 chars + `[truncated]` marker)
- [x] **1.6** session_start.ts field length caps (256 chars on provider/model/project_id)
- [x] **1.7** session_start.ts refuse-on-active guard
- [x] **2.5** Security comment on notes field (done inside 1.5)
- [x] **2.6** gatherStatusData() refactor (done as part of `flightplan export`)

## Items still open from the original Tier 1/2/3

These remain open and unchanged:

- [ ] **1.3** Repo URL — replace `yourusername` placeholder. Blocked on GitHub repo creation.
- [ ] **2.1** CHANGELOG.md
- [ ] **2.2** README "What Flightplan stores" section
- [ ] **2.3** Deduplicate `tokens_total` validation in `index.ts`
- [ ] **2.4** Tighten `RECOMMENDED_ACTIONS` typing in `get_runway.ts`
- [ ] **3.1** CONTRIBUTING.md
- [ ] **3.2** SECURITY.md
- [ ] **3.3** `cli.ts` isMain check fix
- [ ] **3.6** `flightplan reset` / `flightplan clear-notes` command
- [ ] **3.7** `connection.ts` chmod 0600

---

## NEW Tier 2 items (from 2026-05-05 cross-LLM review)

### 2.7 — Strict Agent Contract block in `RUNWAY_STATE.md`
**Source:** ChatGPT review.
**Why:** The Markdown carrier (`flightplan export`) is the third leg of the support matrix and is meaningfully weaker than MCP and JSON without enforceable language. LLMs treat advisory guidance as optional unless told otherwise.
**File:** `src/state/state_generator.ts`
**Action:** Add a top-of-document section with imperative language. Example shape:

```markdown
## Agent Contract (Strict)

You MUST follow these rules:

- **HONK:** STOP. Do not begin new work. Summarize and prepare to end session.
- **TURBULENCE:** Do NOT start large tasks. Wrap up or checkpoint only.
- **HEADWIND:** Small, scoped tasks only.
- **CRUISING:** Safe to proceed.

Before any major task: re-evaluate runway status.
If uncertain: default to conservative behavior.
```

**Estimate:** ~30 min. Wording matters; iterate.

### 2.8 — Timestamp + staleness warning in `RUNWAY_STATE.md`
**Source:** ChatGPT review.
**Why:** Markdown snapshots are point-in-time. Users will export once and keep working with stale data.
**File:** `src/state/state_generator.ts`
**Action:** Add at the bottom of the export:

```markdown
---

> Snapshot taken at {ISO_TIMESTAMP}. Re-export before long tasks, refactors, or multi-step operations.
```

**Estimate:** ~10 min.

### 2.9 — Verify `record_session` retry idempotency
**Source:** Gemini review.
**Why:** If the agent retries a `record_session` call (network hiccup, MCP transport issue), duplicate session_id should not produce duplicate rows.
**File:** `src/tools/record_session.ts`
**Action:** Inspect current behavior. If duplicate rows can occur, add `ON CONFLICT(id) DO NOTHING` to the `INSERT INTO usage_snapshots` statement. Add a test case to `tests/lifecycle.test.ts` verifying double-call behavior.
**Estimate:** ~5 min check, ~15 min if a fix is needed.

### 2.10 — Integration Patterns section in README
**Source:** Synthesis from Copilot's integration guide + cross-LLM session learnings.
**Why:** The README currently describes the carrier matrix but doesn't show users how to integrate with non-MCP clients.
**File:** `README.md`
**Action:** Use the draft from `INTEGRATION_PATTERNS_DRAFT.md` (created 2026-05-05). Verify Codex/Copilot/Continue.dev MCP support claims against current docs before merge.
**Estimate:** ~30 min for revision + verification.

### 2.11 — `toSlug` empty-string fallback in `cli.ts`
**Source:** Augure review.
**Why:** If a user types only special characters as a provider name, `toSlug` returns `""`, which then becomes the DB key. Edge case but real.
**File:** `src/cli.ts`
**Action:** Change the `toSlug` function's return to:

```typescript
function toSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || 'custom_provider';
}
```

**Estimate:** 2 min.

---

## NEW Tier 3 / Future Flightplan items

These are captured for the record but not on the 0.1.0 path. See `PROJECT_PLAN.md` Bucket 3 for the full list with provenance and "why it's parked" notes.

- [ ] **3.8** Browser extension + `flightplan serve` subcommand (TBD; security review required)
- [ ] **3.9** Bilingual init wizard + i18n (Gemini)
- [ ] **3.10** `flightplan export --mode=llm` (ChatGPT)
- [ ] **3.11** ASCII progress bar in `flightplan status` (Copilot)
- [ ] **3.12** "Dead Reckoning unlocks in N sessions" messaging in `record_session` response (Copilot)
- [ ] **3.13** `flightplan purge` for outlier sessions (Gemini; Phase 2.5)
- [ ] **3.14** Pattern Libraries — task-type-aware burn estimates (Gemini; Phase 4)
- [ ] **3.15** Vertex AI Extension / Cloud Run sidecar / BigQuery export (Gemini; demand-driven)
