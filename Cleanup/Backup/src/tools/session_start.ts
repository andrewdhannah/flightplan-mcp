/**
 * src/tools/session_start.ts — session_start() MCP tool
 *
 * Called by the agent at the beginning of a working session.
 * Opens a new tracking session in the active_session table.
 *
 * What it does:
 *   1. Generates a unique session ID (UUID v4)
 *   2. Writes session metadata to active_session
 *   3. Sets goose_level to REFUELLED (fresh runway)
 *   4. Returns the session ID so the agent can reference it later
 *
 * After calling this, get_runway() will return CRUISING instead of PREFLIGHT.
 * At session end, the agent calls record_session() to archive the data.
 *
 * Parameters (all optional):
 *   provider   — which AI tool is running (e.g. "claude-code")
 *   model      — specific model if known (e.g. "claude-sonnet-4-6")
 *   project_id — optional project tag for per-project velocity tracking (Phase 2)
 *
 * Design note:
 *   session_start() is intentionally lightweight — it just opens the session.
 *   Token counting happens via record_session() at the end.
 *   This keeps the per-turn cost of Mechanism A as low as possible.
 */

import { openDb } from '../db/connection.js';
import { getProviderName } from '../state/goose_scale.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

/**
 * Parameters the agent can pass to session_start().
 * All optional — the tool works with zero arguments.
 */
export interface SessionStartParams {
  /** Which AI tool is running this session. Defaults to config value. */
  provider?: string;
  /** Specific model name if known. */
  model?: string;
  /** Optional project tag for grouping sessions. */
  project_id?: string;
}

// ─── Response shape ───────────────────────────────────────────────────────────

/**
 * What session_start() returns to the agent.
 */
export interface SessionStartResponse {
  /** Unique ID for this session — pass to record_session() at end. */
  session_id: string;
  /** ISO timestamp of when the session started. */
  started_at: string;
  /** Current goose level — always REFUELLED on fresh start. */
  level: string;
  /** Human-readable confirmation message. */
  message: string;
}

// ─── UUID generation ──────────────────────────────────────────────────────────

/**
 * Generates a UUID v4 using Node's built-in crypto module.
 *
 * Why not a library: Node 14.17+ includes crypto.randomUUID() natively.
 * No dependency needed. We're on Node 18+ (enforced by index.ts), so this
 * is always available.
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

// ─── Tool implementation ──────────────────────────────────────────────────────

/**
 * Opens a new tracking session.
 *
 * Safe to call when a session is already active — it will close the previous
 * session implicitly (overwrites the active_session row). If you want to
 * preserve the previous session's data, call record_session() first.
 *
 * Flow:
 *   1. Open DB
 *   2. Read provider name from config (used as default if not passed)
 *   3. Generate session ID
 *   4. Write to active_session via UPSERT
 *   5. Return confirmation
 *
 * @param params - Optional session metadata
 * @returns SessionStartResponse with session ID and confirmation
 */
export function sessionStart(params: SessionStartParams = {}): SessionStartResponse {
  const db = openDb();

  // Read provider name from config as fallback if not passed by agent.
  const configProvider = getProviderName(db);

  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();

  const provider = params.provider ?? configProvider;
  const model     = params.model ?? null;
  const projectId = params.project_id ?? null;

  // UPSERT into active_session.
  // id = 'current' always — single-row table.
  // If a previous session is active, this overwrites it.
  // Call record_session() first if you want to preserve the previous session.
  db.prepare(`
    INSERT INTO active_session
      (id, session_id, started_at, goose_level, tokens_observed,
       provider, model, project_id)
    VALUES
      ('current', ?, ?, 'REFUELLED', 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_id       = excluded.session_id,
      started_at       = excluded.started_at,
      goose_level      = excluded.goose_level,
      tokens_observed  = excluded.tokens_observed,
      provider         = excluded.provider,
      model            = excluded.model,
      project_id       = excluded.project_id
  `).run(sessionId, startedAt, provider, model, projectId);

  return {
    session_id: sessionId,
    started_at: startedAt,
    level:      'REFUELLED',
    message:
      `Session started. Runway restored. ` +
      `Call get_runway() to check status. ` +
      `Call record_session() with your final token count when done.`,
  };
}
