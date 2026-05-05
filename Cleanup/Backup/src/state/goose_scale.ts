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
 * Phase 1 only actively uses PREFLIGHT and CRUISING.
 * The rest are defined now so the type is complete — Phase 2/3 won't
 * need to widen it and cause a migration headache.
 *
 * 'as const' makes TypeScript treat this as a tuple of string literals,
 * not just string[]. Means GooseLevel below is a union of the exact strings,
 * not just 'string'. Catches typos at compile time.
 */
export const GOOSE_LEVELS = [
  'PREFLIGHT',   // No session data yet. Cold start. Observation mode.
  'CRUISING',    // Nominal burn. Estimates reliable.
  'HEADWIND',    // Burning faster than baseline. Still on course.
  'TURBULENCE',  // High burn. Significant adjustment needed.
  'WAYWARD',     // Dead Reckoning drifted >40% over 3+ sessions. (Phase 2)
  'HONK',        // Runway exhausted. HONK note generated. (Phase 3)
  'LANDING',     // Session ended gracefully. Data archived.
  'REFUELLED',   // New session started. Runway restored. History intact.
] as const;

/**
 * The union type of all valid Goose Scale values.
 * Use this as the type for any variable that holds a level.
 *
 * Example: const level: GooseLevel = 'CRUISING';  ✓
 *          const level: GooseLevel = 'FLYING';     ✗ (compile error)
 */
export type GooseLevel = typeof GOOSE_LEVELS[number];

/**
 * Human-readable descriptions for each level.
 * Used in status output and future HONK note generation.
 * Not used in Phase 1 DB schema — stored as the string key only.
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
 * Returns 0 if warnings are disabled, DEFAULT_WARN_THRESHOLD if not set.
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Threshold as a percentage integer (0 = disabled)
 */
export function getWarnThreshold(db: Database): number {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'warn_threshold'`
  ).get() as { value: string } | undefined;

  if (!row) return DEFAULT_WARN_THRESHOLD;

  const parsed = parseInt(row.value, 10);
  if (isNaN(parsed) || parsed < 0) return DEFAULT_WARN_THRESHOLD;

  return Math.min(parsed, 99); // 100% warning is meaningless
}

/**
 * Reads the provider name from config for display purposes.
 * Returns 'unknown' if init hasn't been run.
 *
 * @param db - An open better-sqlite3 Database instance
 * @returns Human-readable provider name (e.g. "Claude Code")
 */
export function getProviderName(db: Database): string {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'provider_name'`
  ).get() as { value: string } | undefined;

  return row?.value ?? 'unknown';
}

// ─── Goose level calculation ───────────────────────────────────────────────────

/**
 * Calculates the current Goose Level based on tokens observed vs baseline.
 *
 * Phase 1: simple percentage thresholds against the user's baseline.
 * Phase 2: Dead Reckoning will replace this with velocity-weighted scoring.
 *
 * Thresholds (percentage of baseline consumed):
 *   0–50%   → CRUISING   (plenty of runway)
 *   50–75%  → HEADWIND   (burning through it)
 *   75–90%  → TURBULENCE (getting tight)
 *   90%+    → HONK       (runway exhausted)
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

  // Guard: avoid divide-by-zero if baseline is somehow 0.
  if (baseline <= 0) return 'PREFLIGHT';

  const pctConsumed = tokensObserved / baseline;

  if (pctConsumed >= 0.90) return 'HONK';
  if (pctConsumed >= 0.75) return 'TURBULENCE';
  if (pctConsumed >= 0.50) return 'HEADWIND';
  return 'CRUISING';
}

/**
 * Returns a runway percentage (0–100) representing how much is left.
 * Clamped to 0 — never returns negative even if tokens exceed baseline.
 *
 * @param tokensObserved - Tokens reported so far
 * @param baseline - Session token baseline
 * @returns Percentage remaining as an integer (0–100)
 */
export function getRunwayPercent(tokensObserved: number, baseline: number): number {
  if (baseline <= 0) return 100;
  const remaining = 1 - (tokensObserved / baseline);
  return Math.max(0, Math.round(remaining * 100));
}
