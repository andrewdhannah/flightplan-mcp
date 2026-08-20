/**
 * src/analytics/variance.ts — Variance classification for RuntimeResourceObservation
 *
 * Classifies how actual token consumption tracks against a CostEstimate.
 * This is a retrospective observation: "how did we do?" not "what should we do?"
 *
 * Single source of truth for variance.state. Both the emission path
 * (RuntimeResourceObservation) and the policy path (gates.ts) should
 * consume this function to prevent classification drift.
 *
 * Thresholds (checked in priority order — highest severity first):
 *   EXCEEDED : consumed_pct_of_p80 > 100
 *   AT_RISK  : consumed_pct_of_p80 > 90
 *   ELEVATED : consumed_pct_of_p50 > 75
 *   NOMINAL  : everything else
 *
 * Why priority order matters:
 *   p50 < p80 always, so consumed_pct_of_p50 > 75 does NOT imply
 *   consumed_pct_of_p80 > 90. But consumed_pct_of_p80 > 100 DOES
 *   imply consumed_pct_of_p50 > 75. Checking highest severity first
 *   ensures a session can only land in one bucket.
 *
 * Design decision (2026-08-16):
 *   variance.state is a pure observation. It does not make policy decisions.
 *   applyPolicy() in gates.ts consumes Goose Scale for forward-looking decisions
 *   (proceed/checkpoint/split/land_first). variance.state answers a different
 *   question: "given what was consumed and what was estimated, how should this
 *   observation be classified for the evidence store?"
 *
 *   Both functions share DeadReckoningEstimate as input but produce different
 *   outputs for different consumers. This is intentional, not duplication.
 */

import type { DeadReckoningEstimate } from './dead_reckoning.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type VarianceState = 'NOMINAL' | 'ELEVATED' | 'AT_RISK' | 'EXCEEDED';

export interface VarianceClassification {
  /** Variance state. Checked in priority order: EXCEEDED > AT_RISK > ELEVATED > NOMINAL. */
  state: VarianceState;

  /** tokens_observed / estimate.percentiles.p50 * 100 */
  consumed_pct_of_p50: number;

  /** tokens_observed / estimate.percentiles.p80 * 100 */
  consumed_pct_of_p80: number;

  /** Estimated tokens remaining (p80 - tokens_observed). null if estimate unavailable. */
  remaining_tokens: number | null;
}

// ─── Thresholds ────────────────────────────────────────────────────────────────

/**
 * Variance thresholds as named constants.
 * Exported for testability — tests can assert against these directly
 * instead of magic numbers.
 */
export const VARIANCE_THRESHOLDS = {
  /** consumed_pct_of_p50 above this → ELEVATED */
  elevated_p50_pct: 75,
  /** consumed_pct_of_p80 above this → AT_RISK */
  at_risk_p80_pct: 90,
  /** consumed_pct_of_p80 above this → EXCEEDED */
  exceeded_p80_pct: 100,
} as const;

// ─── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify variance between actual consumption and estimated cost.
 *
 * Pure function — no DB access, no side effects. Deterministic for
 * the same inputs.
 *
 * @param tokensObserved - Tokens consumed so far in this session
 * @param estimate - Dead Reckoning estimate that informed the budget
 * @returns VarianceClassification with state, percentages, and remaining tokens
 */
export function classifyVariance(
  tokensObserved: number,
  estimate: DeadReckoningEstimate,
): VarianceClassification {
  const p50 = estimate.estimated_tokens.p50;
  const p80 = estimate.estimated_tokens.p80;

  // Guard: avoid divide-by-zero if percentiles are somehow 0.
  // Treat as NOMINAL with 0% consumed — the observation is valid,
  // we just can't compute ratios.
  const consumed_pct_of_p50 = p50 > 0
    ? (tokensObserved / p50) * 100
    : 0;
  const consumed_pct_of_p80 = p80 > 0
    ? (tokensObserved / p80) * 100
    : 0;

  // Remaining tokens based on p80 (conservative estimate).
  // null if p80 is 0 (degenerate case).
  const remaining_tokens = p80 > 0
    ? Math.max(0, p80 - tokensObserved)
    : null;

  // Classify in priority order: highest severity first.
  // This ensures a session can only land in one bucket, because
  // the thresholds are not naturally mutually exclusive
  // (p50 < p80 always, so ELEVATED can co-occur with AT_RISK/EXCEEDED).
  let state: VarianceState;
  if (consumed_pct_of_p80 > VARIANCE_THRESHOLDS.exceeded_p80_pct) {
    state = 'EXCEEDED';
  } else if (consumed_pct_of_p80 > VARIANCE_THRESHOLDS.at_risk_p80_pct) {
    state = 'AT_RISK';
  } else if (consumed_pct_of_p50 > VARIANCE_THRESHOLDS.elevated_p50_pct) {
    state = 'ELEVATED';
  } else {
    state = 'NOMINAL';
  }

  return {
    state,
    consumed_pct_of_p50: Math.round(consumed_pct_of_p50 * 100) / 100,
    consumed_pct_of_p80: Math.round(consumed_pct_of_p80 * 100) / 100,
    remaining_tokens,
  };
}
