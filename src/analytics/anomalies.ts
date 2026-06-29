/**
 * src/analytics/anomalies.ts — Anomaly detection over usage_snapshots
 *
 * Identifies suspicious sessions that may indicate:
 *   - Zero-token sessions (agent forgot to record)
 *   - Idle/forgotten sessions (long duration, low burn)
 *   - Missing metadata (model, provider)
 *   - Extreme token-per-minute rates
 *
 * Read-only analysis — does not mutate the database.
 */

import type { Database } from 'better-sqlite3';
import type { SnapshotRow, AnomalyReport, AnomalousSession, IdleSkewResult } from './types.js';
import { getAllSnapshots } from './stats.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum reasonable session duration in minutes (12 hours).
 * Anything longer is likely an idle/forgotten session.
 */
export const MAX_REASONABLE_DURATION_MINUTES = 720;

/**
 * Minimum tokens per minute for a session to be considered "active".
 * 10 tokens/min = 600 tokens/hour = extremely low activity.
 * Below this suggests the session was idle for most of its duration.
 */
export const MIN_TOKENS_PER_MINUTE = 10;

/**
 * Maximum tokens per minute — beyond this suggests a data entry error
 * or an unusually dense transcript.
 * 10,000 tokens/min = 600k tokens/hour — far beyond normal LLM generation.
 */
export const MAX_TOKENS_PER_MINUTE = 10_000;

// ─── Anomaly detection ────────────────────────────────────────────────────────

/**
 * Detect anomalies in a single session row.
 * Returns an array of anomaly descriptions; empty = clean.
 */
export function detectAnomalies(row: SnapshotRow): string[] {
  const anomalies: string[] = [];

  // Zero-token session
  if (row.tokens_total === 0) {
    anomalies.push('tokens_total is zero');
  }

  // Invalid or missing duration
  if (row.duration_minutes == null) {
    anomalies.push('duration_minutes is null');
  } else if (row.duration_minutes <= 0) {
    anomalies.push(`duration_minutes (${row.duration_minutes}) is zero or negative`);
  }

  // Idle session (overly long)
  if (row.duration_minutes != null && row.duration_minutes > MAX_REASONABLE_DURATION_MINUTES) {
    anomalies.push(
      `duration_minutes (${row.duration_minutes}) exceeds ${MAX_REASONABLE_DURATION_MINUTES} — possible idle session`,
    );
  }

  // Missing model
  if (!row.model || row.model.trim() === '') {
    anomalies.push('model is missing');
  }

  // Missing provider
  if (!row.provider || row.provider.trim() === '') {
    anomalies.push('provider is missing');
  }

  // Extreme token-per-minute rate
  if (row.duration_minutes != null && row.duration_minutes > 0 && row.tokens_total > 0) {
    const tpm = row.tokens_total / row.duration_minutes;

    if (tpm < MIN_TOKENS_PER_MINUTE) {
      anomalies.push(
        `extremely low tokens_per_minute (${tpm.toFixed(1)}) — possible idle session`,
      );
    }

    if (tpm > MAX_TOKENS_PER_MINUTE) {
      anomalies.push(
        `extremely high tokens_per_minute (${tpm.toFixed(1)}) — possible data entry error`,
      );
    }
  }

  return anomalies;
}

/**
 * Run anomaly detection over all usage_snapshots.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns AnomalyReport with all anomalous sessions
 */
export function detectAllAnomalies(db: Database): AnomalyReport {
  const snapshots = getAllSnapshots(db);

  const sessions: AnomalousSession[] = [];

  for (const row of snapshots) {
    const anomalies = detectAnomalies(row);
    if (anomalies.length > 0) {
      sessions.push({
        session_id: row.session_id,
        tokens_total: row.tokens_total,
        duration_minutes: row.duration_minutes,
        provider: row.provider,
        model: row.model,
        anomalies,
      });
    }
  }

  // Count anomaly types
  const anomalyTypeCounts: Record<string, number> = {};
  for (const s of sessions) {
    for (const a of s.anomalies) {
      // Categorize by prefix
      const category = a.includes('tokens_total')
        ? 'zero_tokens'
        : a.includes('duration_minutes') && a.includes('null')
          ? 'null_duration'
          : a.includes('duration_minutes') && a.includes('exceeds')
            ? 'excessive_duration'
            : a.includes('duration_minutes')
              ? 'invalid_duration'
              : a.includes('model')
                ? 'missing_model'
                : a.includes('provider')
                  ? 'missing_provider'
                  : a.includes('low')
                    ? 'low_tokens_per_minute'
                    : a.includes('high')
                      ? 'high_tokens_per_minute'
                      : 'other';
      anomalyTypeCounts[category] = (anomalyTypeCounts[category] ?? 0) + 1;
    }
  }

  return {
    total_sessions: snapshots.length,
    anomalous_sessions: sessions.length,
    sessions,
    anomaly_type_counts: anomalyTypeCounts,
  };
}

/**
 * Detect idle skew: sessions with very long durations relative to token counts.
 *
 * An idle-skewed session is one where duration > 720 minutes OR
 * tokens_per_minute < 10 (very low activity rate).
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns IdleSkewResult
 */
export function detectIdleSkew(db: Database): IdleSkewResult {
  const snapshots = getAllSnapshots(db);

  if (snapshots.length === 0) {
    return {
      has_idle_skew: false,
      anomalous_duration_minutes: 0,
      expected_max_duration_minutes: MAX_REASONABLE_DURATION_MINUTES,
      details: 'No sessions to analyze.',
    };
  }

  // Find the session with the longest duration that also has low activity
  const candidates = snapshots
    .filter(r => r.duration_minutes != null && r.duration_minutes > 0)
    .map(r => {
      const tpm = r.tokens_total / (r.duration_minutes ?? 1);
      return { ...r, tokens_per_minute: tpm };
    })
    .sort((a, b) => (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0));

  const worst = candidates[0];

  if (!worst) {
    return {
      has_idle_skew: false,
      anomalous_duration_minutes: 0,
      expected_max_duration_minutes: MAX_REASONABLE_DURATION_MINUTES,
      details: 'No sessions with duration data.',
    };
  }

  const worstDuration = worst.duration_minutes ?? 0;
  const isIdle = worstDuration > MAX_REASONABLE_DURATION_MINUTES ||
    (worst.tokens_per_minute < MIN_TOKENS_PER_MINUTE && worstDuration > 120);

  return {
    has_idle_skew: isIdle,
    anomalous_duration_minutes: worstDuration,
    expected_max_duration_minutes: MAX_REASONABLE_DURATION_MINUTES,
    details: isIdle
      ? `Session ${worst.session_id}: ${worstDuration.toFixed(1)} min, ` +
        `${worst.tokens_per_minute.toFixed(1)} tokens/min — likely idle/forgotten session.`
      : 'No significant idle skew detected.',
  };
}
