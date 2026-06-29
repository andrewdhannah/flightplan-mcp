/**
 * src/analytics/dead_reckoning.ts — Historical usage estimator
 *
 * Dead Reckoning turns historical usage_snapshots data into token burn
 * predictions for model/provider/project combinations.
 *
 * This is the "reckoning" part — we look at where we've been to estimate
 * how much runway we need going forward.
 *
 * Matching hierarchy (broadest match first):
 *   1. Exact project + provider + model
 *   2. Provider + model
 *   3. Model only
 *   4. Provider only
 *   5. Project only
 *   6. Global eligible sessions (any model/provider/project)
 *   7. Static configured baseline (fallback)
 *
 * Confidence is based on matching eligible session count:
 *   high:   >= 20
 *   medium: >= 8
 *   low:    >= 3
 *   wayward: < 3
 */

import type { Database } from 'better-sqlite3';
import { getAllSnapshots } from './stats.js';
import { isCalibrationEligible } from './calibration.js';
import { calculatePercentiles } from './percentiles.js';
import type { PercentileResult } from './types.js';
import { getSessionBaseline } from '../state/goose_scale.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'wayward';

export type MatchScope =
  | 'model_provider_project'
  | 'provider_model'
  | 'model_only'
  | 'provider_only'
  | 'project_only'
  | 'global'
  | 'fallback_baseline';

export interface DeadReckoningEstimate {
  estimated_tokens: PercentileResult;
  confidence: ConfidenceLevel;
  historical_basis: {
    matching_sessions: number;
    scope: MatchScope;
  };
  baseline_source: string;
  fallback_used: boolean;
}

export interface EstimateInput {
  model?: string;
  provider?: string;
  project?: string;
  baseline?: number; // Optional override for static baseline
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLDS = {
  high: 20,
  medium: 8,
  low: 3,
} as const;

const STATIC_FALLBACK_TOKENS = 40_000;

// ─── Confidence helper ────────────────────────────────────────────────────────

/**
 * Determine confidence level from matching session count.
 */
function confidenceFromCount(count: number): ConfidenceLevel {
  if (count >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (count >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  if (count >= CONFIDENCE_THRESHOLDS.low) return 'low';
  return 'wayward';
}

// ─── Matching logic ────────────────────────────────────────────────────────────

/**
 * Try to match sessions by exact project + provider + model.
 * Returns [matchingRows, scopeLabel].
 */
function matchExact(
  eligible: EligibleRow[],
  model: string,
  provider: string,
  project?: string,
): { rows: EligibleRow[]; scope: MatchScope } {
  if (project) {
    const rows = eligible.filter(
      r =>
        r.model === model &&
        r.provider === provider &&
        r.project_id === project,
    );
    if (rows.length >= CONFIDENCE_THRESHOLDS.low) {
      return { rows, scope: 'model_provider_project' };
    }
  }

  // Provider + model
  const pmRows = eligible.filter(
    r => r.model === model && r.provider === provider,
  );
  if (pmRows.length >= CONFIDENCE_THRESHOLDS.low) {
    return { rows: pmRows, scope: 'provider_model' };
  }

  // Model only
  const mRows = eligible.filter(r => r.model === model);
  if (mRows.length >= CONFIDENCE_THRESHOLDS.low) {
    return { rows: mRows, scope: 'model_only' };
  }

  // Provider only
  const pRows = eligible.filter(r => r.provider === provider);
  if (pRows.length >= CONFIDENCE_THRESHOLDS.low) {
    return { rows: pRows, scope: 'provider_only' };
  }

  // Project only
  if (project) {
    const jRows = eligible.filter(r => r.project_id === project);
    if (jRows.length >= CONFIDENCE_THRESHOLDS.low) {
      return { rows: jRows, scope: 'project_only' };
    }
  }

  return { rows: [], scope: 'provider_model' };
}

interface EligibleRow {
  model: string;
  provider: string;
  project_id: string | null;
  tokens_total: number;
}

// ─── Estimator ─────────────────────────────────────────────────────────────────

/**
 * Estimate token burn for a given model/provider/project combination.
 *
 * Uses progressive matching hierarchy to find the best historical baseline.
 *
 * @param db - Open better-sqlite3 Database instance
 * @param input - Model, provider, project, and optional baseline params
 * @returns DeadReckoningEstimate with percentiles and confidence
 */
export function estimateTokens(
  db: Database,
  input: EstimateInput,
): DeadReckoningEstimate {
  const { model, provider, project } = input;

  // Get all calibration-eligible sessions
  const snapshots = getAllSnapshots(db);
  const eligible: EligibleRow[] = snapshots
    .filter(r => isCalibrationEligible(r as any)) // outcome is optional
    .map(r => ({
      model: r.model ?? '',
      provider: r.provider ?? '',
      project_id: r.project_id ?? null,
      tokens_total: r.tokens_total,
    }))
    .filter(r => r.tokens_total > 0);

  // Try matching with provided params
  if (model && provider) {
    const match = matchExact(eligible, model, provider, project);
    if (match.rows.length > 0) {
      return buildEstimate(match.rows.map(r => r.tokens_total), match.scope, db);
    }
  }

  // Fallback to global eligible sessions
  if (eligible.length >= CONFIDENCE_THRESHOLDS.low) {
    return buildEstimate(
      eligible.map(r => r.tokens_total),
      'global',
      db,
    );
  }

  // Last resort: static configured baseline
  return fallbackEstimate(db);
}

// ─── Response builder ─────────────────────────────────────────────────────────

/**
 * Build a DeadReckoningEstimate from a set of token values.
 */
function buildEstimate(
  values: number[],
  scope: MatchScope,
  db: Database,
): DeadReckoningEstimate {
  if (values.length === 0) {
    return fallbackEstimate(db);
  }

  const count = values.length;
  const percentiles = calculatePercentiles(values);
  const confidence = confidenceFromCount(count);

  return {
    estimated_tokens: percentiles,
    confidence,
    historical_basis: {
      matching_sessions: count,
      scope,
    },
    baseline_source: 'calibrated',
    fallback_used: false,
  };
}

/**
 * Return WAYWARD fallback estimate using the configured baseline.
 */
function fallbackEstimate(db: Database): DeadReckoningEstimate {
  const baseline = getSessionBaseline(db) ?? STATIC_FALLBACK_TOKENS;
  const safeBaseline = baseline > 0 ? baseline : STATIC_FALLBACK_TOKENS;

  return {
    estimated_tokens: {
      p50: safeBaseline,
      p80: Math.round(safeBaseline * 1.3),
      p95: Math.round(safeBaseline * 1.5),
    },
    confidence: 'wayward',
    historical_basis: {
      matching_sessions: 0,
      scope: 'fallback_baseline',
    },
    baseline_source: 'configured',
    fallback_used: true,
  };
}
