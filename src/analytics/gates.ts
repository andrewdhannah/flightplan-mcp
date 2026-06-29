/**
 * src/analytics/gates.ts — Governed runway decisions for agent work
 *
 * Combines current Goose Scale level with Dead Reckoning estimates
 * to produce governed decisions for agent work.
 *
 * Decision outputs:
 *   proceed                   — normal work allowed
 *   proceed_with_checkpoint   — work allowed, but checkpoint first
 *   split                     — split work into smaller units
 *   land_first                — land before starting new work
 *   refuse                    — refuse the work entirely
 *
 * Policy:
 *   CRUISING   + small estimate   → proceed
 *   CRUISING   + large estimate   → proceed_with_checkpoint
 *   HEADWIND   + small estimate   → proceed
 *   HEADWIND   + medium/large     → proceed_with_checkpoint
 *   TURBULENCE                    → proceed_with_checkpoint or split
 *   HONK                          → land_first
 *   WAYWARD                       → split or conservative proceed_with_checkpoint
 *   No session (PREFLIGHT)        → proceed (with conservative estimate)
 */

import type { Database } from 'better-sqlite3';
import { estimateTokens, type DeadReckoningEstimate, type EstimateInput } from './dead_reckoning.js';
import { calculateGooseLevel, getSessionBaseline } from '../state/goose_scale.js';
import type { GooseLevel } from '../state/goose_scale.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GateDecision = 'proceed' | 'proceed_with_checkpoint' | 'split' | 'land_first' | 'refuse';

export interface GateInput {
  model?: string;
  provider?: string;
  project_id?: string;
  plan_id?: string;
  work_order_id?: string;
  work_session_id?: string;
  agent?: string;
  work_type?: string;
  expected_scope?: string;
}

export interface GateResult {
  decision: GateDecision;
  confidence: string;
  estimated_tokens: {
    p50: number;
    p80: number;
    p95: number;
  };
  historical_basis: {
    matching_sessions: number;
    scope: string;
  };
  goose_level: string;
  recommended_action: string;
  policy_reasons: string[];
  work_tags?: {
    project_id?: string;
    plan_id?: string;
    work_order_id?: string;
    work_session_id?: string;
    agent?: string;
  };
}

// ─── Policy logic ─────────────────────────────────────────────────────────────

/**
 * Threshold for "large" estimate — if p80 exceeds this, treat as large.
 * Set at 75% of a typical conservative baseline.
 */
const LARGE_ESTIMATE_THRESHOLD = 30_000;

/**
 * Apply the gate policy to make a decision.
 */
function applyPolicy(
  gooseLevel: GooseLevel,
  estimate: DeadReckoningEstimate,
): { decision: GateDecision; reasons: string[] } {
  const reasons: string[] = [];
  const p80Tokens = estimate.estimated_tokens.p80;
  const isLarge = p80Tokens > LARGE_ESTIMATE_THRESHOLD;

  switch (gooseLevel) {
    case 'HONK':
      reasons.push('Current level is HONK — runway is exhausted');
      reasons.push('No new work can be started until session lands');
      return { decision: 'land_first', reasons };

    case 'TURBULENCE':
      reasons.push('Current level is TURBULENCE — runway is tight');
      if (isLarge) {
        reasons.push('p80 estimate exceeds conservative threshold — recommend split');
        return { decision: 'split', reasons };
      }
      reasons.push('p80 estimate fits within available runway');
      return { decision: 'proceed_with_checkpoint', reasons };

    case 'HEADWIND':
      reasons.push('Current level is HEADWIND — burning faster than baseline');
      if (isLarge) {
        reasons.push('p80 estimate suggests scope expansion — checkpoint recommended');
        return { decision: 'proceed_with_checkpoint', reasons };
      }
      reasons.push('Small scope — work can proceed');
      return { decision: 'proceed', reasons };

    case 'CRUISING':
      reasons.push('Current level is CRUISING — healthy runway');
      if (isLarge) {
        reasons.push('Large scope — checkpoint before major operations');
        return { decision: 'proceed_with_checkpoint', reasons };
      }
      reasons.push('Normal work allowed');
      return { decision: 'proceed', reasons };

    case 'PREFLIGHT':
      reasons.push('No active session — using conservative estimate');
      return { decision: 'proceed', reasons };

    case 'WAYWARD':
      reasons.push('Dead Reckoning confidence is wayward — using conservative baseline');
      if (estimate.fallback_used) {
        reasons.push('No reliable historical data; recommend splitting work');
        return { decision: 'split', reasons };
      }
      reasons.push('Proceed with checkpoint to verify estimate');
      return { decision: 'proceed_with_checkpoint', reasons };

    case 'LANDING':
    case 'REFUELLED':
      reasons.push(`Current level is ${gooseLevel} — session transition state`);
      return { decision: 'proceed', reasons };

    default:
      reasons.push(`Unknown level ${gooseLevel} — proceeding with caution`);
      return { decision: 'proceed_with_checkpoint', reasons };
  }
}

/**
 * Generate a human-readable recommended action from a decision.
 */
function getRecommendedAction(
  decision: GateDecision,
  gooseLevel: GooseLevel,
): string {
  switch (decision) {
    case 'proceed':
      return 'Normal work allowed. Monitor runway and re-evaluate before major operations.';
    case 'proceed_with_checkpoint':
      return 'Proceed, but create a checkpoint before large edits or full test runs. Re-evaluate runway after checkpoint.';
    case 'split':
      return 'Split work into smaller, independently completable units. Complete one unit, then re-evaluate before the next.';
    case 'land_first':
      return 'Runway is unsafe. Land the current session via record_session() before starting new work.';
    case 'refuse':
      return 'Work cannot proceed under current runway conditions. Land and reassess.';
    default:
      return 'Proceed with caution.';
  }
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate the gate for a proposed work item.
 *
 * Combines current runway state with Dead Reckoning estimate
 * to produce a governed decision.
 *
 * @param db - Open better-sqlite3 Database instance
 * @param input - Work parameters for the proposed work
 * @returns GateResult with decision and policy context
 */
export function evaluateGate(
  db: Database,
  input: GateInput,
): GateResult {
  // Read current session state from the provided DB
  const baseline = getSessionBaseline(db);
  const active = db.prepare(`
    SELECT session_id, tokens_observed, started_at
    FROM active_session WHERE id = 'current'
  `).get() as { session_id: string | null; tokens_observed: number; started_at: string | null } | undefined;

  const sessionActive = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;
  const gooseLevel: GooseLevel = calculateGooseLevel(tokensObserved, baseline, sessionActive);

  // Get Dead Reckoning estimate
  const estimateInput: EstimateInput = {
    model: input.model,
    provider: input.provider,
    project: input.project_id,
  };
  const estimate = estimateTokens(db, estimateInput);

  // Apply policy
  const { decision, reasons } = applyPolicy(gooseLevel, estimate);

  // Build result
  const result: GateResult = {
    decision,
    confidence: estimate.confidence,
    estimated_tokens: {
      p50: estimate.estimated_tokens.p50,
      p80: estimate.estimated_tokens.p80,
      p95: estimate.estimated_tokens.p95,
    },
    historical_basis: {
      matching_sessions: estimate.historical_basis.matching_sessions,
      scope: estimate.historical_basis.scope,
    },
    goose_level: gooseLevel,
    recommended_action: getRecommendedAction(decision, gooseLevel),
    policy_reasons: reasons,
  };

  // Echo work tags if provided
  if (input.project_id || input.plan_id || input.work_order_id || input.work_session_id || input.agent) {
    result.work_tags = {};
    if (input.project_id) result.work_tags.project_id = input.project_id;
    if (input.plan_id) result.work_tags.plan_id = input.plan_id;
    if (input.work_order_id) result.work_tags.work_order_id = input.work_order_id;
    if (input.work_session_id) result.work_tags.work_session_id = input.work_session_id;
    if (input.agent) result.work_tags.agent = input.agent;
  }

  return result;
}
