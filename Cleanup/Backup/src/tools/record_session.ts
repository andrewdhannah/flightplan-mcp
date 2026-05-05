/**
 * src/tools/record_session.ts — record_session() MCP tool
 *
 * Called by the agent at the end of a working session.
 * Archives session data to usage_snapshots and closes active_session.
 *
 * What it does:
 *   1. Reads the current active session
 *   2. Validates that a session is actually open
 *   3. Calculates duration from started_at to now
 *   4. Writes a snapshot to usage_snapshots
 *   5. Clears active_session back to PREFLIGHT state
 *   6. Returns a summary of what was archived
 *
 * After calling this, get_runway() returns PREFLIGHT until session_start()
 * is called again.
 *
 * Parameters:
 *   tokens_total  — REQUIRED. Final token count for the session.
 *                   This is the ground truth that Dead Reckoning (Phase 2)
 *                   will use to calibrate future baseline estimates.
 *   notes         — Optional. Freeform notes about the session.
 *                   Useful for tagging unusual sessions ("refactoring sprint",
 *                   "debugging session") for Phase 2 pattern analysis.
 *
 * Mechanism A reminder:
 *   The agent self-reports tokens at session end. There is no continuous
 *   per-turn tracking — that would cost too many tokens to track tokens.
 *   The agent is trusted to report honestly. Dead Reckoning improves accuracy
 *   over multiple sessions regardless of individual report quality.
 */

import { openDb } from '../db/connection.js';
import { calculateGooseLevel, getSessionBaseline } from '../state/goose_scale.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

/**
 * Parameters the agent passes to record_session().
 */
export interface RecordSessionParams {
  /**
   * Total tokens consumed in this session.
   * Required — this is the core data point Flightplan collects.
   * Check your AI tool's usage display or API response for this number.
   */
  tokens_total: number;

  /**
   * Optional freeform notes about the session.
   * Examples: "refactoring sprint", "debugging auth flow", "writing tests"
   * Used in Phase 2 for pattern classification.
   */
  notes?: string;
}

// ─── Response shape ───────────────────────────────────────────────────────────

/**
 * What record_session() returns to the agent.
 */
export interface RecordSessionResponse {
  /** The session ID that was archived. */
  session_id: string;
  /** Total tokens recorded for this session. */
  tokens_total: number;
  /** How long the session ran in minutes. */
  duration_minutes: number;
  /** Goose level at session end — useful for trend awareness. */
  final_level: string;
  /** How many sessions are now archived (Phase 2 unlocks at 5). */
  sessions_archived: number;
  /** Human-readable summary. */
  message: string;
}

// ─── Active session row shape ─────────────────────────────────────────────────

/**
 * Shape of the row we read from active_session before archiving.
 */
interface ActiveSessionRow {
  session_id:      string | null;
  started_at:      string | null;
  goose_level:     string | null;
  tokens_observed: number;
  provider:        string | null;
  model:           string | null;
  project_id:      string | null;
}

// ─── Tool implementation ──────────────────────────────────────────────────────

/**
 * Archives the current session and resets active_session to PREFLIGHT.
 *
 * Flow:
 *   1. Read active_session
 *   2. Validate session is open (session_id not null)
 *   3. Calculate duration
 *   4. Determine final goose level from tokens_total vs baseline
 *   5. Write to usage_snapshots
 *   6. Clear active_session
 *   7. Return summary
 *
 * @param params - Must include tokens_total. Notes optional.
 * @returns RecordSessionResponse with archive confirmation
 * @throws If no session is active or tokens_total is invalid
 */
export function recordSession(params: RecordSessionParams): RecordSessionResponse {
  const db = openDb();

  // ── Step 1: Validate input ─────────────────────────────────────────────────
  if (
    typeof params.tokens_total !== 'number' ||
    isNaN(params.tokens_total) ||
    params.tokens_total < 0
  ) {
    throw new Error(
      `record_session: tokens_total must be a non-negative number. ` +
      `Got: ${params.tokens_total}`
    );
  }

  // ── Step 2: Read active session ────────────────────────────────────────────
  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  // Guard: no session active
  if (!active?.session_id) {
    throw new Error(
      `record_session: no active session found. ` +
      `Call session_start() before record_session().`
    );
  }

  const sessionId = active.session_id;
  const startedAt = active.started_at ?? new Date().toISOString();
  const endedAt   = new Date().toISOString();

  // ── Step 3: Calculate duration ─────────────────────────────────────────────
  // Parse ISO strings to Date objects, get difference in minutes.
  // toFixed(1) gives one decimal place — "47.3 minutes" is more useful than "47".
  const durationMs      = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const durationMinutes = parseFloat((durationMs / 60_000).toFixed(1));

  // ── Step 4: Calculate final goose level ────────────────────────────────────
  // Use tokens_total (what the agent reports) not tokens_observed (what was
  // written mid-session). tokens_total is the ground truth.
  const baseline   = getSessionBaseline(db);
  const finalLevel = calculateGooseLevel(params.tokens_total, baseline, true);

  // ── Step 5: Archive + clear in a single transaction ────────────────────────
  // Both operations must succeed together — we never want a session archived
  // but active_session not cleared, or vice versa.
  const archiveTransaction = db.transaction(() => {

    // Write to usage_snapshots.
    // ON CONFLICT DO NOTHING: if this session_id was already archived
    // (e.g. record_session called twice), silently skip the second insert.
    db.prepare(`
      INSERT INTO usage_snapshots
        (session_id, started_at, ended_at, duration_minutes,
         tokens_total, goose_level_final, provider, model,
         project_id, baseline_at_time, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO NOTHING
    `).run(
      sessionId,
      startedAt,
      endedAt,
      durationMinutes,
      params.tokens_total,
      finalLevel,
      active.provider,
      active.model,
      active.project_id,
      baseline,
      params.notes ?? null
    );

    // Clear active_session back to PREFLIGHT state.
    // Reset all fields to null except id — the row stays, just emptied.
    db.prepare(`
      UPDATE active_session
      SET session_id      = NULL,
          started_at      = NULL,
          goose_level     = NULL,
          tokens_observed = 0,
          provider        = NULL,
          model           = NULL,
          project_id      = NULL
      WHERE id = 'current'
    `).run();
  });

  archiveTransaction();

  // ── Step 6: Count archived sessions ────────────────────────────────────────
  // Phase 2 Dead Reckoning unlocks after 5 sessions.
  // Surface the count so the agent (and user) can see progress.
  const countRow = db.prepare(
    `SELECT COUNT(*) as n FROM usage_snapshots`
  ).get() as { n: number };

  const sessionsArchived = countRow.n;
  const phase2Remaining  = Math.max(0, 5 - sessionsArchived);

  // ── Step 7: Build response ─────────────────────────────────────────────────
  let message =
    `Session archived. ${params.tokens_total.toLocaleString()} tokens over ` +
    `${durationMinutes} minutes. Final level: ${finalLevel}.`;

  if (phase2Remaining > 0) {
    message += ` Dead Reckoning unlocks in ${phase2Remaining} more session${phase2Remaining === 1 ? '' : 's'}.`;
  } else {
    message += ` Dead Reckoning active — baseline improving automatically.`;
  }

  return {
    session_id:        sessionId,
    tokens_total:      params.tokens_total,
    duration_minutes:  durationMinutes,
    final_level:       finalLevel,
    sessions_archived: sessionsArchived,
    message,
  };
}
