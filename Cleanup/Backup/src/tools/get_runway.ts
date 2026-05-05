/**
 * src/tools/get_runway.ts — get_runway() MCP tool
 *
 * The core Flightplan tool. Called by the agent at session start and before
 * high-cost operations to check token runway state.
 *
 * Phase 1 behavior:
 *   - Reads session baseline from config (set by user at init)
 *   - Reads active session state from active_session table
 *   - Calculates GooseLevel from tokens_observed vs baseline
 *   - Returns PREFLIGHT if no session is active
 *   - Returns real level (CRUISING/HEADWIND/TURBULENCE/HONK) if session active
 *
 * Phase 2 will add:
 *   - Dead Reckoning velocity from usage_snapshots history
 *   - Confidence scoring from pattern_library
 *   - burn_rate_per_hour and time_remaining_minutes (currently 0)
 *
 * Phase 3 will add:
 *   - Formation Trust active state
 *   - Flock File community velocity profiles
 *
 * Updated from build plan (May 2, 2026):
 *   - Replaced getDefaultWindow(planType) with getSessionBaseline(db)
 *   - Provider-agnostic: no plan-type magic numbers
 *   - calculateGooseLevel() and getRunwayPercent() now imported from goose_scale
 */

import { openDb } from '../db/connection.js';
import {
  getSessionBaseline,
  getWarnThreshold,
  getProviderName,
  calculateGooseLevel,
  getRunwayPercent,
} from '../state/goose_scale.js';
import type { RunwayResponse } from '../types.js';

// ─── Active session row shape ─────────────────────────────────────────────────

/**
 * Shape of the row returned from the active_session table.
 * All fields nullable because the row may exist but be empty
 * (initialized with NULLs before first session_start call).
 */
interface ActiveSessionRow {
  session_id:      string | null;
  started_at:      string | null;
  goose_level:     string | null;
  tokens_observed: number;
  provider:        string | null;
  model:           string | null;
  project_id:      string | null;
}

// ─── Recommended action strings ───────────────────────────────────────────────

/**
 * Human-readable recommended actions keyed by GooseLevel.
 * These are what the agent reads — keep them direct and actionable.
 *
 * Deliberately not using a template literal here — the strings should be
 * stable so agents can pattern-match on them in future Formation Trust logic.
 */
const RECOMMENDED_ACTIONS: Record<string, string> = {
  PREFLIGHT:
    'Flightplan is in PREFLIGHT — no session active. ' +
    'Call session_start to begin tracking.',

  CRUISING:
    'Runway is healthy. Proceed with planned work.',

  HEADWIND:
    'Burning faster than baseline. Finish current task, then reassess scope.',

  TURBULENCE:
    'Runway is tight. Complete critical work only. ' +
    'Consider calling record_session soon to archive progress.',

  HONK:
    'HONK. Runway exhausted. Call record_session now to preserve data. ' +
    'Do not start new tasks.',

  LANDING:
    'Session ended. Call session_start to begin a new session.',

  REFUELLED:
    'New session started. Runway restored.',

  WAYWARD:
    'Dead Reckoning has drifted. Review velocity patterns. (Phase 2)',
};

// ─── Tool implementation ──────────────────────────────────────────────────────

/**
 * Returns the current runway state as a RunwayResponse.
 *
 * No parameters — runway state is derived entirely from the DB.
 * The agent calls this with no arguments: get_runway()
 *
 * Flow:
 *   1. Open DB (idempotent singleton)
 *   2. Read session baseline from config
 *   3. Read active session state
 *   4. Calculate GooseLevel and runway percentage
 *   5. Check warning threshold
 *   6. Return RunwayResponse
 */
export function getRunway(): RunwayResponse {
  const db = openDb();

  // ── Step 1: Read user's session baseline ──────────────────────────────────
  // This is what the user told us at init — their best estimate of their
  // session token budget. No magic numbers from provider marketing.
  const baseline = getSessionBaseline(db);
  const warnThreshold = getWarnThreshold(db);
  const providerName = getProviderName(db);

  // ── Step 2: Read active session ───────────────────────────────────────────
  // Single-row table, id is always 'current'.
  // Returns undefined if the row doesn't exist yet (very first run).
  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  const sessionActive = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;

  // ── Step 3: Calculate level and runway ────────────────────────────────────
  const level = calculateGooseLevel(tokensObserved, baseline, sessionActive);
  const runwayPct = sessionActive ? getRunwayPercent(tokensObserved, baseline) : 100;
  const runwayTokens = Math.max(0, baseline - tokensObserved);

  // ── Step 4: Session count for Formation Trust countdown ───────────────────
  // Observer mode until 5 sessions archived. Formation Trust opt-in in Phase 3.
  const countRow = db.prepare(
    `SELECT COUNT(*) as n FROM usage_snapshots`
  ).get() as { n: number };
  const sessionCount = countRow.n;

  // Formation Trust stays 'observer' in Phase 1.
  // The countdown (5 - sessionCount) is surfaced in flightplan status.
  const formationTrust: 'observer' | 'active' | 'suspended' = 'observer';

  // ── Step 5: Build recommended action ─────────────────────────────────────
  // Append warning if threshold is configured and we're below it.
  // The 'as string' cast is safe here: RECOMMENDED_ACTIONS covers all GooseLevel values.
  // The ?? fallback handles the TypeScript undefined concern from noUncheckedIndexedAccess.
  let recommendedAction: string = RECOMMENDED_ACTIONS[level] ?? RECOMMENDED_ACTIONS['PREFLIGHT'] ?? 'Proceed with caution.';

  if (
    sessionActive &&
    warnThreshold > 0 &&
    runwayPct <= warnThreshold &&
    level !== 'HONK'  // HONK already says this loudly
  ) {
    recommendedAction +=
      ` ⚠️ Runway at ${runwayPct}% — below your ${warnThreshold}% warning threshold.`;
  }

  // ── Step 6: Return RunwayResponse ─────────────────────────────────────────
  const result = {
    level,

    // Runway state
    window_remaining_pct:    runwayPct,
    window_remaining_tokens: runwayTokens,

    // token_range: Phase 1 returns a tight band (same value both ends).
    // Phase 2 Dead Reckoning will widen this into a real confidence interval.
    token_range: {
      low:  runwayTokens,
      high: runwayTokens,
    },

    // Velocity fields: zeroed in Phase 1. Real values in Phase 2.
    burn_rate_per_hour:    0,
    time_remaining_minutes: 0,

    // data_source tells the agent how much to trust the numbers.
    // 'agent_report' = tokens_observed came from session_start/record_session calls.
    // 'plan_default' = no session active, showing baseline only.
    data_source: sessionActive ? 'agent_report' : 'plan_default',

    formation_trust: formationTrust,
    recommended_action: recommendedAction,

    // ── Debug metadata (not in RunwayResponse type — extra fields) ──────────
    // Surfaced here for transparency during Phase 1 testing.
    // Phase 2 will move this into a separate debug_info block in the type.
    // We spread into 'as any' to attach _debug without widening RunwayResponse.
    // This keeps the return type correct while still surfacing diagnostics.
  } as RunwayResponse & { _debug: Record<string, unknown> };

  (result as any)._debug = {
    baseline_tokens:   baseline,
    tokens_observed:   tokensObserved,
    session_active:    sessionActive,
    session_id:        active?.session_id ?? null,
    provider:          active?.provider ?? providerName,
    model:             active?.model ?? null,
    sessions_archived: sessionCount,
    warn_threshold_pct: warnThreshold,
  };

  return result;
}
