/**
 * src/analytics/calibration.ts — Calibration eligibility and reporting
 *
 * Determines which usage_snapshots sessions are safe to use for
 * Dead Reckoning calibration. Derived views only — does not mutate
 * the database or add columns.
 *
 * Calibration eligibility rules:
 *   tokens_total > 0
 *   duration_minutes >= 1
 *   duration_minutes <= 720 (12 hours — anything longer is idle)
 *   model is not null / not blank
 *   provider is not null / not blank
 *   excluded_from_calibration is not true (≠ 1)
 *   outcome is not 'aborted' or 'stale' or 'honk'
 *     (unless explicitly included for failure analysis)
 */

import type { Database } from 'better-sqlite3';
import type { SnapshotRow, ExclusionReason, CalibrationReport, EligibleSession } from './types.js';
import { getAllSnapshots } from './stats.js';
import { calculatePercentiles } from './percentiles.js';

// ─── Eligibility check ────────────────────────────────────────────────────────

/**
 * Check whether a single session is calibration-eligible.
 * Returns an array of reasons it is excluded; empty array = eligible.
 */
export function getCalibrationExclusionReasons(row: SnapshotRow): string[] {
  const reasons: string[] = [];

  if (row.tokens_total <= 0) {
    reasons.push('tokens_total is zero or negative');
  }

  if (row.duration_minutes == null) {
    reasons.push('duration_minutes is null');
  } else if (row.duration_minutes < 1) {
    reasons.push(`duration_minutes (${row.duration_minutes}) is less than 1`);
  } else if (row.duration_minutes > 720) {
    reasons.push(`duration_minutes (${row.duration_minutes}) exceeds 720 (possible idle)`);
  }

  if (!row.model || row.model.trim() === '') {
    reasons.push('model is missing or blank');
  }

  if (!row.provider || row.provider.trim() === '') {
    reasons.push('provider is missing or blank');
  }

  if (row.excluded_from_calibration === 1) {
    reasons.push('explicitly excluded from calibration');
  }

  if (row.outcome === 'aborted' || row.outcome === 'stale' || row.outcome === 'honk') {
    reasons.push(`outcome is '${row.outcome}' (excluded unless failure analysis)`);
  }

  // Ensure tokens_total is a reasonable positive integer (within 2^53 safe integer range)
  if (!Number.isFinite(row.tokens_total) || row.tokens_total > Number.MAX_SAFE_INTEGER) {
    reasons.push('tokens_total is not a finite safe integer');
  }

  return reasons;
}

/**
 * Returns whether a session is calibration-eligible.
 */
export function isCalibrationEligible(row: SnapshotRow): boolean {
  return getCalibrationExclusionReasons(row).length === 0;
}

// ─── Calibration report ──────────────────────────────────────────────────────

/**
 * Generate a calibration report over all usage_snapshots.
 *
 * Read-only — does not mutate the database.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns CalibrationReport with eligibility breakdown
 */
export function generateCalibrationReport(db: Database): CalibrationReport {
  const snapshots = getAllSnapshots(db);

  if (snapshots.length === 0) {
    return {
      total_sessions: 0,
      eligible_sessions: 0,
      excluded_sessions: 0,
      exclusions: [],
      token_baseline_stats: null,
      summary: 'No session data available for calibration.',
    };
  }

  const exclusions: ExclusionReason[] = [];

  for (const row of snapshots) {
    const reasons = getCalibrationExclusionReasons(row);
    if (reasons.length > 0) {
      exclusions.push({ session_id: row.session_id, reasons });
    }
  }

  const eligible = snapshots.filter(r => isCalibrationEligible(r));
  const excludedCount = snapshots.length - eligible.length;

  let tokenBaselineStats = null;
  if (eligible.length >= 3) {
    const values = eligible.map(r => r.tokens_total);
    tokenBaselineStats = calculatePercentiles(values);
  }

  const eligiblePct = snapshots.length > 0
    ? Math.round((eligible.length / snapshots.length) * 100)
    : 0;

  let summary: string;
  if (eligible.length === 0) {
    summary = 'No sessions are calibration-eligible. Review exclusions for data quality issues.';
  } else if (eligible.length < 3) {
    summary =
      `${eligible.length} session${eligible.length === 1 ? ' is' : 's are'} eligible for calibration ` +
      `(${eligiblePct}% of ${snapshots.length} total). Need at least 3 for percentile baselines.`;
  } else {
    summary =
      `${eligible.length} of ${snapshots.length} sessions are calibration-eligible (${eligiblePct}%). ` +
      `Token baseline: p50=${tokenBaselineStats?.p50.toLocaleString()}, ` +
      `p80=${tokenBaselineStats?.p80.toLocaleString()}, ` +
      `p95=${tokenBaselineStats?.p95.toLocaleString()}.`;
  }

  return {
    total_sessions: snapshots.length,
    eligible_sessions: eligible.length,
    excluded_sessions: excludedCount,
    exclusions,
    token_baseline_stats: tokenBaselineStats,
    summary,
  };
}

/**
 * Return the list of calibration-eligible sessions with minimal data.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns Array of EligibleSession objects
 */
export function getCalibrationCandidates(db: Database): EligibleSession[] {
  const snapshots = getAllSnapshots(db);

  return snapshots
    .filter(r => isCalibrationEligible(r))
    .map(r => ({
      session_id: r.session_id,
      tokens_total: r.tokens_total,
      duration_minutes: r.duration_minutes ?? 0,
      provider: r.provider ?? 'unknown',
      model: r.model ?? 'unknown',
      goose_level_final: r.goose_level_final,
      outcome: r.outcome,
    }));
}
