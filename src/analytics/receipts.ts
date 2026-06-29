/**
 * src/analytics/receipts.ts — Session receipt generation
 *
 * Produces governed session receipts for Librarian ingestion.
 * Receipts are deterministic, exclude notes by default, and
 * never include secrets, file paths, raw prompts, or conversation content.
 *
 * Receipt schema:
 *   receipt_type: "flightplan-session-receipt"
 *   schema_version: 1
 *   session_id, project/plan/work tags, agent, provider, model
 *   started_at, ended_at, duration_minutes
 *   tokens_total_reported
 *   goose_level_final, outcome
 *   calibration_eligible, calibration_exclusion_reasons
 *   baseline_at_time, baseline_source_at_time
 *   generated_at
 */

import type { Database } from 'better-sqlite3';
import { getAllSnapshots } from './stats.js';
import { getCalibrationExclusionReasons } from './calibration.js';
import { getSessionBaseline, getBaselineSource } from '../state/goose_scale.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SessionReceipt {
  receipt_type: 'flightplan-session-receipt';
  schema_version: 1;
  session_id: string;
  project_id?: string;
  plan_id?: string;
  work_order_id?: string;
  work_session_id?: string;
  agent?: string;
  provider?: string;
  model?: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  tokens_total_reported: number;
  goose_level_final: string;
  outcome?: string;
  calibration_eligible: boolean;
  calibration_exclusion_reasons: string[];
  baseline_at_time: number;
  baseline_source_at_time: string;
  generated_at: string;
}

export interface ReceiptInput {
  session_id: string;
  include_notes?: boolean; // not implemented — notes are excluded by default
}

// ─── Receipt generation ────────────────────────────────────────────────────────

/**
 * Generate a session receipt for a specific session.
 *
 * @param db - Open better-sqlite3 Database instance
 * @param sessionId - The session ID to generate a receipt for
 * @returns SessionReceipt
 * @throws If the session is not found
 */
export function generateReceipt(
  db: Database,
  sessionId: string,
): SessionReceipt {
  const allSnapshots = getAllSnapshots(db);
  const snapshot = allSnapshots.find(r => r.session_id === sessionId);

  if (!snapshot) {
    throw new Error(
      `Session not found: ${sessionId}. ` +
      `No usage_snapshot with this session_id exists.`,
    );
  }

  // Determine calibration eligibility
  const exclusionReasons = getCalibrationExclusionReasons(snapshot as any);
  const calibrationEligible = exclusionReasons.length === 0;

  // Build receipt
  const receipt: SessionReceipt = {
    receipt_type: 'flightplan-session-receipt',
    schema_version: 1,
    session_id: snapshot.session_id,
    provider: snapshot.provider ?? undefined,
    model: snapshot.model ?? undefined,
    started_at: snapshot.started_at,
    ended_at: snapshot.ended_at,
    duration_minutes: snapshot.duration_minutes ?? 0,
    tokens_total_reported: snapshot.tokens_total,
    goose_level_final: snapshot.goose_level_final ?? 'unknown',
    outcome: (snapshot as any).outcome ?? undefined,
    calibration_eligible: calibrationEligible,
    calibration_exclusion_reasons: exclusionReasons,
    baseline_at_time: snapshot.baseline_at_time ?? getSessionBaseline(db),
    baseline_source_at_time: snapshot.baseline_source_at_time ?? getBaselineSource(db),
    generated_at: new Date().toISOString(),
  };

  // Include tags if present
  const snapshotAny = snapshot as any;
  if (snapshotAny.plan_id) receipt.plan_id = snapshotAny.plan_id;
  if (snapshotAny.work_order_id) receipt.work_order_id = snapshotAny.work_order_id;
  if (snapshotAny.work_session_id) receipt.work_session_id = snapshotAny.work_session_id;
  if (snapshotAny.agent) receipt.agent = snapshotAny.agent;
  if (snapshotAny.project_id) receipt.project_id = snapshotAny.project_id;

  return receipt;
}

/**
 * Generate a receipt for the most recent session.
 *
 * @param db - Open better-sqlite3 Database instance
 * @returns SessionReceipt
 * @throws If no sessions exist
 */
export function generateLastReceipt(db: Database): SessionReceipt {
  const allSnapshots = getAllSnapshots(db);

  if (allSnapshots.length === 0) {
    throw new Error('No sessions found. Cannot generate receipt.');
  }

  // Last session = highest id (auto-increment) or latest ended_at
  const last = allSnapshots.reduce((latest, current) => {
    return current.ended_at > latest.ended_at ? current : latest;
  });

  return generateReceipt(db, last.session_id);
}
