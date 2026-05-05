/**
 * src/tools/session_start.ts — session_start() MCP tool
 *
 * Called by the agent at the beginning of a working session.
 * Opens a new tracking session in the active_session table.
 *
 * What it does:
 *   1. Checks whether a session is already active (refuses to clobber — Tier 1.7)
 *   2. Generates a unique session ID (UUID v4)
 *   3. Sanitizes and caps string inputs (Tier 1.6)
 *   4. Writes session metadata to active_session
 *   5. Returns the session ID so the agent can reference it later
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
 *
 * Changed (Audit Tier 1.6, May 5 2026):
 *   Added MAX_FIELD_LENGTH cap on provider, model, project_id inputs.
 *
 * Changed (Audit Tier 1.7, May 5 2026):
 *   session_start() now refuses to overwrite an active session. Previously it
 *   silently clobbered the existing session (no archive, no warning). Now it
 *   returns the existing session_id and a clear message telling the agent to
 *   call record_session() first. This protects users whose agent restarts
 *   mid-task from losing their session data.
 */

import { openDb } from '../db/connection.js';
import { getProviderName } from '../state/goose_scale.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum character length for agent-supplied string fields.
 *
 * Applies to: provider, model, project_id.
 * 256 characters is generous for any real provider name or model slug
 * while preventing unbounded input from a misbehaving agent.
 *
 * Added: Audit Tier 1.6, May 5, 2026.
 */
const MAX_FIELD_LENGTH = 256;

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
  /**
   * Optional project tag for grouping sessions.
   *
   * PHASE 3 PRIVACY CONSTRAINT: project_id MUST be stripped or hashed before
   * any data leaves the local machine via Flock File / community sharing.
   * This is a freeform user-supplied string that may contain client or
   * project names.
   */
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
  /** Current goose level. */
  level: string;
  /** Human-readable confirmation message. */
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Caps a string to MAX_FIELD_LENGTH. Returns undefined unchanged.
 * Named helper so the truncation intent is visible at each call site.
 *
 * @param s - Agent-supplied string (or undefined if not passed)
 * @returns Truncated string, or undefined
 */
function truncate(s: string | undefined): string | undefined {
  return s ? s.slice(0, MAX_FIELD_LENGTH) : undefined;
}

// ─── Active session row shape ─────────────────────────────────────────────────

/**
 * The columns we need from active_session when checking for an existing session.
 */
interface ActiveSessionRow {
  session_id:      string | null;
  started_at:      string | null;
  tokens_observed: number;
}

// ─── Tool implementation ──────────────────────────────────────────────────────

/**
 * Opens a new tracking session.
 *
 * CHANGED (Tier 1.7): Now refuses to overwrite an active session.
 * If a session is already open, returns the existing session_id and instructs
 * the agent to call record_session() first to close it cleanly.
 *
 * Flow:
 *   1. Open DB
 *   2. Check for an existing active session — refuse and return early if found
 *   3. Read provider name from config (used as default if not passed by agent)
 *   4. Cap string inputs to MAX_FIELD_LENGTH (Tier 1.6)
 *   5. Generate session ID
 *   6. Write to active_session via UPSERT
 *   7. Return confirmation
 *
 * @param params - Optional session metadata
 * @returns SessionStartResponse with session ID and confirmation
 */
export function sessionStart(params: SessionStartParams = {}): SessionStartResponse {
  const db = openDb();

  // ── Step 1: Refuse to clobber an existing session (Tier 1.7) ──────────────
  // Previously this was a silent overwrite — the previous session was destroyed
  // with no archive and no warning. Now we check first and return the existing
  // session_id so the agent can close it cleanly with record_session().
  //
  // Why return rather than throw: the agent can recover from this. Throwing
  // would look like a hard error; returning with a clear message lets the
  // agent decide what to do (call record_session first, or report to the user).
  const existing = db.prepare(`
    SELECT session_id, started_at, tokens_observed
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  if (existing?.session_id) {
    return {
      session_id: existing.session_id,   // return the EXISTING id, not a new one
      started_at: existing.started_at ?? '',
      level:      'CRUISING',            // best-guess; agent can call get_runway() for truth
      message:
        `A session is already active (${existing.session_id}). ` +
        `Call record_session() with your token count to close it before starting a new one. ` +
        `Tokens observed so far: ${existing.tokens_observed.toLocaleString()}.`,
    };
  }

  // ── Step 2: Read provider from config ──────────────────────────────────────
  const configProvider = getProviderName(db);

  // ── Step 3: Sanitize string inputs (Tier 1.6) ──────────────────────────────
  // Cap all agent-supplied strings to MAX_FIELD_LENGTH.
  // provider falls back to config value if not passed; model and project_id
  // default to null (stored as NULL in DB).
  const provider  = truncate(params.provider) ?? configProvider;
  const model     = truncate(params.model)     ?? null;
  const projectId = truncate(params.project_id) ?? null;

  // ── Step 4: Generate session ID and timestamp ──────────────────────────────
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();

  // ── Step 5: Write to active_session ───────────────────────────────────────
  // UPSERT on id = 'current' — single-row table.
  // We only reach here if no session was active (guard above), so this
  // is effectively always an INSERT in practice.
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
