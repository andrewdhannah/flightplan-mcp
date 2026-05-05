/**
 * src/types.ts — Shared TypeScript types
 *
 * Single source of truth for interfaces used across multiple modules.
 * Import from here rather than re-declaring types in each file.
 *
 * Current exports:
 *   RunwayResponse — the object returned by get_runway()
 *
 * Phase 2 will add:
 *   VelocityProfile  — Dead Reckoning computed velocity data
 *   SessionSnapshot  — what gets written to usage_snapshots
 *
 * Phase 3 will add:
 *   FlockProfile     — community Formation Trust data shape
 */

import type { GooseLevel } from './state/goose_scale.js';

// ─── RunwayResponse ────────────────────────────────────────────────────────────

/**
 * The response object returned by the get_runway() MCP tool.
 *
 * This is what the AI agent reads to decide whether to proceed with a
 * high-cost operation. Keep field names stable — agents may pattern-match
 * on them in Formation Trust logic (Phase 3).
 *
 * Field-by-field:
 *
 *   level
 *     The current Goose Scale state. The most important field.
 *     Agent should check this first. PREFLIGHT and HONK require action.
 *
 *   window_remaining_pct
 *     How much runway is left as a percentage (0–100).
 *     100 when no session active (PREFLIGHT).
 *
 *   window_remaining_tokens
 *     Approximate tokens remaining before runway exhausted.
 *     Same caveat as above — rough estimate in Phase 1.
 *
 *   token_range
 *     Low/high bounds on the token estimate.
 *     Phase 1: tight band (low === high === window_remaining_tokens).
 *     Phase 2: Dead Reckoning widens this into a real confidence interval.
 *
 *   burn_rate_per_hour
 *     Tokens consumed per hour, estimated from session history.
 *     Phase 1: always 0 (no velocity data yet).
 *     Phase 2: calculated from usage_snapshots.
 *
 *   time_remaining_minutes
 *     Estimated minutes until runway exhausted at current burn rate.
 *     Phase 1: always 0.
 *     Phase 2: derived from burn_rate_per_hour and window_remaining_tokens.
 *
 *   data_source
 *     How was this data produced?
 *     'agent_report' — tokens_observed came from session_start/record_session.
 *     'plan_default' — no active session, showing baseline only.
 *     'dead_reckoning' — Phase 2: velocity-weighted estimate.
 *     'flock_file'    — Phase 3: community profile active.
 *
 *   formation_trust
 *     Whether Formation Trust (community calibration) is active.
 *     Phase 1: always 'observer' (watching, not yet contributing).
 *     Phase 3: 'active' when community profiles are in use.
 *
 *   recommended_action
 *     Human-readable string telling the agent what to do.
 *     Keep reading these — they get more specific as phases progress.
 */
export interface RunwayResponse {
  /** Current Goose Scale level. Check this first. */
  level: GooseLevel;

  /** Runway remaining as 0–100 percentage. */
  window_remaining_pct: number;

  /** Approximate tokens remaining. */
  window_remaining_tokens: number;

  /** Low/high token estimate band. Tight in Phase 1, wider in Phase 2. */
  token_range: {
    low: number;
    high: number;
  };

  /** Tokens per hour. 0 in Phase 1. */
  burn_rate_per_hour: number;

  /** Minutes until empty at current burn rate. 0 in Phase 1. */
  time_remaining_minutes: number;

  /** How the data was produced. */
  data_source: 'agent_report' | 'plan_default' | 'dead_reckoning' | 'flock_file';

  /** Formation Trust participation state. */
  formation_trust: 'observer' | 'active' | 'suspended';

  /** What the agent should do right now. */
  recommended_action: string;
}
