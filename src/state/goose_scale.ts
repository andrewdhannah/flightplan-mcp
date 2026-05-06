/**
 * src/state/goose_scale.ts — The Goose Scale + session baseline resolution
 *
 * Two jobs in one file:
 *   1. Define the eight Goose Scale levels (flight states).
 *   2. Resolve the session token baseline for get_runway().
 *
 * Baseline resolution order (most trusted → least trusted):
 *   1. User's observed average from usage_snapshots  (Phase 2 — Dead Reckoning)
 *   2. User's manually set session_baseline from config  (set at init)
 *   3. CONSERVATIVE_FALLBACK  (last resort — no config found)
 *
 * Design decision (May 2, 2026 — Andrew + Ash):
 *   We deliberately removed plan-type magic numbers (pro=44k, max=220k etc).
 *   Providers don't publish hard limits. Those numbers were community estimates
 *   that would silently go stale. The user's own baseline is always more
 *   accurate than anything we could hardcode.
 *
 *   CONSERVATIVE_FALLBACK exists only for the case where init hasn't been run.
 *   It should be rare in practice — init is the first thing the docs tell you to do.
 */

import type { Database } from 'better-sqlite3';

// ─── The Goose Scale ──────────────────────────────────────────────────────────

/**
 * Eight states covering the full flight lifecycle.
 *
 * ┌──────────── PHASE 1 ACTIVE (5) ────────────┐
 *   These five are returned by calculateGooseLevel() today, based on
 *   tokens_observed vs baseline. They drive get_runway()'s `level` field.
 *
 *     PREFLIGHT  — emitted when no session is active
 *     CRUISING   — 0–50% consumed
 *     HEADWIND   — 50–75% consumed
 *     TURBULENCE — 75–85% consumed
 *     HONK       — 85%+ consumed (fires early on purpose; see threshold note below)
 *
 * ┌──────────── PHASE 2/3 RESERVED (3) ────────┐
 *   Defined now so the GooseLevel type is complete and we never have to
 *   widen the union later (which would force a schema/API migration).
 *   These are referenced in RECOMMENDED_ACTIONS and GOOSE_LEVEL_DESCRIPTIONS
 *   but are NEVER returned by calculateGooseLevel() in Phase 1.
 *
 *     LANDING    — Phase 2: emitted by record_session() on graceful close
 *     REFUELLED  — Phase 2: emitted by session_start() on fresh open
 *     WAYWARD    — Phase 2: Dead Reckoning drift detector (>40% over 3+ sessions)
 *
 *   (HONK already lives in the active set — Phase 3 only adds auto-generated
 *   HONK *notes*, not the level itself.)
 *
 * Why all 8 ship in Phase 1:
 *   GooseLevel is exported and consumed by RunwayResponse. Adding levels
 *   later would be a breaking type change for any agent that pattern-matches
 *   on the union. Define once, activate gradually.
 *
 * 'as const' makes TypeScript treat this as a tuple of string literals,
 * not just string[]. Means GooseLevel below is a union of the exact strings,
 * not just 'string'. Catches typos at compile time.
 */
export const GOOSE_LEVELS = [
  // ── Phase 1 active ──
  'PREFLIGHT',   // No session data yet. Cold start. Observation mode.
  'CRUISING',    // Nominal burn. Estimates reliable.
  'HEADWIND',    // Burning faster than baseline. Still on course.
  'TURBULENCE',  // High burn. Significant adjustment needed.
  'HONK',        // Runway exhausted. Time to land. (Phase 3 adds auto-generated notes.)

  // ── Phase 2/3 reserved (defined for type completeness; not yet emitted) ──
  'WAYWARD',     // Phase 2: Dead Reckoning drifted >40% over 3+ sessions.
  'LANDING',     // Phase 2: Session ended gracefully. Data archived.
  'REFUELLED',   // Phase 2: New session started. Runway restored. History intact.
] as const;

/**
 * The union type of all valid Goose Scale values.
 *
 * Derived from GOOSE_LEVELS so the type and the constant can never
 * diverge — adding a level to the array automatically widens this union.
 *
 * Use this as the type for any variable, parameter, or field that holds
 * a Goose Scale level. TypeScript will catch any string that isn't one
 * of the eight defined values at compile time.
 *
 * @example
 * const level: GooseLevel = 'CRUISING';  // ✓
 * const level: GooseLevel = 'FLYING';    // ✗ compile error
 *
 * @see GOOSE_LEVELS for the full ordered array
 * @see calculateGooseLevel for the function that produces active-session values
 */
export type GooseLevel = typeof GOOSE_LEVELS[number];

/**
 * Human-readable descriptions for each Goose Scale level.
 *
 * Used in status output (get_runway response) and future HONK note
 * generation (Phase 3). Not persisted to the database — sessions store
 * only the level string key; descriptions are resolved at read time.
 *
 * Keyed by GooseLevel so TypeScript enforces exhaustiveness: every level
 * must have an entry or the compiler will flag the gap.
 */
export const GOOSE_LEVEL_DESCRIPTIONS: Record<GooseLevel, string> = {
  PREFLIGHT:   'No session data yet — observation mode active.',
  CRUISING:    'Nominal burn rate. Runway estimate is reliable.',
  HEADWIND:    'Burning faster than baseline. Still on course.',
  TURBULENCE:  'High burn rate. Consider wrapping up soon.',
  WAYWARD:     'Dead Reckoning has drifted significantly. Review patterns.',
  HONK:        'Runway exhausted. Time to land.',
  LANDING:     'Session ended. Data archived.',
  REFUELLED:   'New session. Runway restored.',
};

// ─── Baseline resolution ──────────────────────────────────────────────────────

/**
 * Last-resort fallback when no config exists (init hasn't been run).
 *
 * Conservative by design — better to underestimate runway than to
 * tell the agent it has more tokens than it does.
 *
 * This is NOT a provider-specific number. It's a safe floor that works
 * regardless of which tool or plan the user is on.
 *
 * Named clearly so any future reader knows exactly what this is.
 */
export const CONSERVATIVE_FALLBACK_TOKENS = 40_000;

/**
 * Warning threshold fallback (percentage, 0–100).
 * Used when warn_threshold isn't in config.
 * 25% gives the agent time to wrap up a thought before runway expires.
 */
export const DEFAULT_WARN_THRESHOLD = 25;

/**
 * Reads the user's session baseline from the config table.
 *
 * Returns the value the user set at init, or CONSERVATIVE_FALLBACK_TOKENS
 * if init hasn't been run yet.
 *
 * Why accept `db` as a parameter rather than calling openDb() internally:
 *   - Avoids circular imports (connection.ts imports schema.ts, etc.)
 *   - Makes the function testable without a real DB file
 *   - Caller already has a DB connection open — no reason to open another
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Token baseline as a number
 */
export function getSessionBaseline(db: Database): number {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'session_baseline'`
  ).get() as { value: string } | undefined;

  if (!row) return CONSERVATIVE_FALLBACK_TOKENS;

  const parsed = parseInt(row.value, 10);

  // Guard against corrupt config values.
  if (isNaN(parsed) || parsed < 1) {
    console.warn(
      '[flightplan] Warning: session_baseline in config is invalid. ' +
      `Using fallback (${CONSERVATIVE_FALLBACK_TOKENS.toLocaleString()}).`
    );
    return CONSERVATIVE_FALLBACK_TOKENS;
  }

  return parsed;
}

/**
 * Reads the warning threshold from config.
 *
 * The warn_threshold is the percentage of runway remaining at which
 * get_runway() should start flagging the HONK level proactively.
 * A value of 0 means the user has disabled early warnings; they will
 * still see HONK when the level is calculated, but no pre-emptive alerts.
 *
 * Falls back to DEFAULT_WARN_THRESHOLD when the key is absent (init not
 * yet run) or corrupt (non-numeric, negative).
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Warning threshold as a percentage integer (0–99).
 *   0 means warnings are disabled.
 *   DEFAULT_WARN_THRESHOLD is returned when config is absent or invalid.
 */
export function getWarnThreshold(db: Database): number {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'warn_threshold'`
  ).get() as { value: string } | undefined;

  if (!row) return DEFAULT_WARN_THRESHOLD;

  const parsed = parseInt(row.value, 10);
  if (isNaN(parsed) || parsed < 0) return DEFAULT_WARN_THRESHOLD;

  // Cap at 99 — a 100% threshold fires only when the runway is already gone,
  // which makes it indistinguishable from HONK itself and gives no lead time.
  return Math.min(parsed, 99);
}

/**
 * Reads the provider name from config for display purposes.
 *
 * The provider name is set at init time (e.g. "Claude Code", "Cursor") and
 * is included in get_runway() responses so the agent knows which tool's
 * session window is being tracked. It has no effect on calculations.
 *
 * Returns 'unknown' if init hasn't been run yet.
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Human-readable provider name string (e.g. "Claude Code"),
 *   or 'unknown' when the config key is absent
 */
export function getProviderName(db: Database): string {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'provider_name'`
  ).get() as { value: string } | undefined;

  return row?.value ?? 'unknown';
}

/**
 * Returns the baseline_source stored in config.
 * Tells record_session which kind of baseline was in use for this session.
 *
 * Values written by cli.ts at init:
 *   'default'    — user accepted the conservative fallback
 *   'manual'     — user entered a custom number
 *   'calibrated' — Phase 2: Dead Reckoning has tuned the baseline
 *   'api'        — Phase 2: retrieved from provider API
 *
 * Phase 2 calibration uses this to decide which sessions to mix:
 * sessions from 'calibrated' baseline are the most reliable training data.
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Baseline source string, or 'default' if not set
 */
export function getBaselineSource(db: Database): string {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'baseline_source'`
  ).get() as { value: string } | undefined;

  return row?.value ?? 'default';
}

/**
 * Calculates the current Goose Level based on tokens observed vs baseline.
 *
 * Phase 1: simple percentage thresholds against the user's baseline.
 * Phase 2: Dead Reckoning will replace this with velocity-weighted scoring.
 *
 * Thresholds (percentage of baseline consumed):
 *   0–50%    → CRUISING   (plenty of runway)
 *   50–75%   → HEADWIND   (burning through it)
 *   75–85%   → TURBULENCE (getting tight)
 *   85%+     → HONK       (runway exhausted — wrap up now)
 *
 * Why HONK fires at 85% (not 90%):
 *   Flightplan runs against many providers/plans, each with different real
 *   session windows that drift with demand. The user's baseline is their
 *   best estimate — not a hard wall. Firing HONK at 85% leaves ~15% breathing
 *   room: enough for the agent to finish a thought, write the record_session
 *   call, and land cleanly instead of cutting off mid-sentence.
 *   Decided May 5, 2026 — Andrew + Ash, Pass 4.
 *
 * Returns PREFLIGHT if no session is active (tokensObserved = 0 and no start).
 *
 * @param tokensObserved - Tokens reported so far in this session
 * @param baseline - The session token baseline (from getSessionBaseline)
 * @param sessionActive - Whether a session is currently open
 * @returns The current GooseLevel
 */
export function calculateGooseLevel(
  tokensObserved: number,
  baseline: number,
  sessionActive: boolean
): GooseLevel {
  // No active session = PREFLIGHT (waiting for first session_start call).
  if (!sessionActive) return 'PREFLIGHT';

  // Guard: avoid divide-by-zero if baseline is somehow 0 or negative.
  // Returning PREFLIGHT rather than crashing keeps get_runway() safe
  // even with a corrupt config value.
  if (baseline <= 0) return 'PREFLIGHT';

  const pctConsumed = tokensObserved / baseline;

  if (pctConsumed >= 0.85) return 'HONK';        // 85%+ consumed — wrap up now
  if (pctConsumed >= 0.75) return 'TURBULENCE';   // 75–85% — getting tight
  if (pctConsumed >= 0.50) return 'HEADWIND';     // 50–75% — burning faster than nominal
  return 'CRUISING';                              // 0–50%  — plenty of runway
}

/**
 * Returns a runway percentage (0–100) representing how much token budget remains.
 *
 * Used in get_runway() responses to give the agent a concrete sense of progress
 * without exposing raw token counts. The value is always a non-negative integer;
 * it never goes below 0 even when tokens observed exceed the baseline (which can
 * happen if the agent is on a larger plan than the configured baseline assumes).
 *
 * @param tokensObserved - Tokens reported so far in the current session
 * @param baseline - Session token baseline (from getSessionBaseline)
 * @returns Percentage of runway remaining as an integer in [0, 100].
 *   Returns 100 when baseline is 0 or negative (treated as "no data, assume full").
 */
export function getRunwayPercent(tokensObserved: number, baseline: number): number {
  // No valid baseline means we can't calculate consumption — report full runway
  // rather than returning a misleadingly low number or crashing.
  if (baseline <= 0) return 100;
  const remaining = 1 - (tokensObserved / baseline);
  return Math.max(0, Math.round(remaining * 100));
}
