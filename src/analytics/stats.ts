/**
 * src/analytics/stats.ts — Usage statistics over usage_snapshots
 *
 * Aggregates historical session data into typed UsageStats.
 * Read-only — does not mutate the database.
 *
 * All functions accept a Database instance so they are testable
 * with in-memory fixture DBs (never touch the live DB).
 */

import type { Database } from 'better-sqlite3';
import type { SnapshotRow, UsageStats, TokenBuckets } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads all usage_snapshots rows from the database.
 * Includes FP-1 migration columns if they exist (checked at runtime).
 */
export function getAllSnapshots(db: Database): SnapshotRow[] {
  // Check if FP-1 migration columns exist
  const cols = db.prepare(`PRAGMA table_info(usage_snapshots)`).all() as { name: string }[];
  const hasPlanId = cols.some(c => c.name === 'plan_id');

  if (!hasPlanId) {
    // Base schema only (pre-FP-1 migration)
    return db.prepare(`
      SELECT id, session_id, started_at, ended_at, duration_minutes,
             tokens_total, goose_level_final, provider, model, project_id,
             baseline_at_time, baseline_source_at_time, notes,
             excluded_from_calibration, tags
      FROM usage_snapshots
      ORDER BY started_at ASC
    `).all() as SnapshotRow[];
  }

  // Full schema with FP-1 migration columns
  return db.prepare(`
    SELECT id, session_id, started_at, ended_at, duration_minutes,
           tokens_total, goose_level_final, provider, model, project_id,
           baseline_at_time, baseline_source_at_time, notes,
           excluded_from_calibration, tags,
           plan_id, work_order_id, work_session_id, agent, outcome
    FROM usage_snapshots
    ORDER BY started_at ASC
  `).all() as SnapshotRow[];
}

/**
 * Build token bucket counts from an array of token totals.
 */
function buildTokenBuckets(tokensArray: number[]): TokenBuckets {
  const buckets: TokenBuckets = {
    '0': 0,
    '1-10000': 0,
    '10001-50000': 0,
    '50001-100000': 0,
    '100001-200000': 0,
    '200001+': 0,
  };

  for (const t of tokensArray) {
    if (t === 0) buckets['0']++;
    else if (t <= 10000) buckets['1-10000']++;
    else if (t <= 50000) buckets['10001-50000']++;
    else if (t <= 100000) buckets['50001-100000']++;
    else if (t <= 200000) buckets['100001-200000']++;
    else buckets['200001+']++;
  }

  return buckets;
}

/**
 * Count occurrences of a field in snapshot rows.
 */
function countByField(
  rows: SnapshotRow[],
  fieldFn: (row: SnapshotRow) => string | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = fieldFn(row) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ─── Stats calculation ────────────────────────────────────────────────────────

/**
 * Calculate aggregate usage statistics from usage_snapshots.
 *
 * Read-only — does not mutate the database.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns UsageStats with aggregated session data
 */
export function calculateStats(db: Database): UsageStats {
  const snapshots = getAllSnapshots(db);

  if (snapshots.length === 0) {
    return {
      total_sessions: 0,
      nonzero_sessions: 0,
      total_tokens: 0,
      average_tokens_per_nonzero_session: 0,
      min_tokens: 0,
      max_tokens: 0,
      sessions_by_model: {},
      sessions_by_provider: {},
      sessions_by_project: {},
      sessions_by_goose_level: {},
      token_buckets: buildTokenBuckets([]),
      has_data: false,
    };
  }

  const tokensTotals = snapshots.map(r => r.tokens_total);
  const nonzeroTokens = tokensTotals.filter(t => t > 0);
  const totalTokens = tokensTotals.reduce((sum, t) => sum + t, 0);
  const minTokens = Math.min(...tokensTotals);
  const maxTokens = Math.max(...tokensTotals);
  const avgNonzero = nonzeroTokens.length > 0
    ? Math.round(nonzeroTokens.reduce((s, t) => s + t, 0) / nonzeroTokens.length)
    : 0;

  return {
    total_sessions: snapshots.length,
    nonzero_sessions: nonzeroTokens.length,
    total_tokens: totalTokens,
    average_tokens_per_nonzero_session: avgNonzero,
    min_tokens: minTokens,
    max_tokens: maxTokens,
    sessions_by_model: countByField(snapshots, r => r.model),
    sessions_by_provider: countByField(snapshots, r => r.provider),
    sessions_by_project: countByField(snapshots, r => r.project_id),
    sessions_by_goose_level: countByField(snapshots, r => r.goose_level_final),
    token_buckets: buildTokenBuckets(tokensTotals),
    has_data: true,
  };
}
