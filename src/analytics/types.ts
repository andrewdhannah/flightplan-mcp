/**
 * src/analytics/types.ts — Analytics type definitions
 *
 * Shared types for the Flightplan analytics layer:
 * stats, calibration, anomaly detection, and Dead Reckoning.
 *
 * All types here are pure-data interfaces — no logic, no DB access.
 */

// ─── Usage snapshot row (from usage_snapshots table) ─────────────────────────

/**
 * Minimal shape of a usage_snapshots row for analytics.
 * Only fields needed for stats/calibration/anomaly detection.
 */
export interface SnapshotRow {
  id: number;
  session_id: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number | null;
  tokens_total: number;
  goose_level_final: string | null;
  provider: string | null;
  model: string | null;
  project_id: string | null;
  baseline_at_time: number | null;
  baseline_source_at_time: string | null;
  notes: string | null;
  excluded_from_calibration: number; // 0 or 1
  tags: string | null;

  // FP-1 work tags
  plan_id: string | null;
  work_order_id: string | null;
  work_session_id: string | null;
  agent: string | null;
  outcome: string | null;
}

// ─── Stats output ───────────────────────────────────────────────────────────

/**
 * Aggregated usage statistics over usage_snapshots.
 */
export interface UsageStats {
  total_sessions: number;
  nonzero_sessions: number;
  total_tokens: number;
  average_tokens_per_nonzero_session: number;
  min_tokens: number;
  max_tokens: number;
  sessions_by_model: Record<string, number>;
  sessions_by_provider: Record<string, number>;
  sessions_by_project: Record<string, number>;
  sessions_by_goose_level: Record<string, number>;
  token_buckets: TokenBuckets;
  has_data: boolean;
}

/**
 * Token bucket distribution.
 */
export interface TokenBuckets {
  '0': number;
  '1-10000': number;
  '10001-50000': number;
  '50001-100000': number;
  '100001-200000': number;
  '200001+': number;
}

// ─── Calibration eligibility ────────────────────────────────────────────────

/**
 * Reason a session was excluded from calibration.
 */
export interface ExclusionReason {
  session_id: string;
  reasons: string[];
}

/**
 * Calibration report — overview of data quality for calibration.
 */
export interface CalibrationReport {
  total_sessions: number;
  eligible_sessions: number;
  excluded_sessions: number;
  exclusions: ExclusionReason[];
  token_baseline_stats: {
    p50: number;
    p80: number;
    p95: number;
  } | null;
  summary: string;
}

/**
 * Calibration-eligible session (minimal data).
 */
export interface EligibleSession {
  session_id: string;
  tokens_total: number;
  duration_minutes: number;
  provider: string;
  model: string;
  goose_level_final: string | null;
  outcome: string | null;
}

// ─── Anomaly types ──────────────────────────────────────────────────────────

/**
 * An anomalous session with reason(s).
 */
export interface AnomalousSession {
  session_id: string;
  tokens_total: number;
  duration_minutes: number | null;
  provider: string | null;
  model: string | null;
  anomalies: string[];
}

/**
 * Anomaly report.
 */
export interface AnomalyReport {
  total_sessions: number;
  anomalous_sessions: number;
  sessions: AnomalousSession[];
  anomaly_type_counts: Record<string, number>;
}

// ─── Percentile result ──────────────────────────────────────────────────────

/**
 * Deterministic percentile calculation result.
 */
export interface PercentileResult {
  p50: number;
  p80: number;
  p95: number;
}

// ─── Idle skew detection ────────────────────────────────────────────────────

/**
 * Idle skew detection result.
 */
export interface IdleSkewResult {
  has_idle_skew: boolean;
  anomalous_duration_minutes: number;
  expected_max_duration_minutes: number;
  details: string;
}
