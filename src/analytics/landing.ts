/**
 * src/analytics/landing.ts — Session landing workflow
 *
 * Provides a first-class landing path for agents when runway is unsafe.
 * The landing workflow:
 *   1. Inspects current session and Goose level
 *   2. Generates landing recommendation
 *   3. Optionally records session if tokens_total is supplied
 *   4. Emits handoff instructions
 *   5. Never invents token totals
 */

import type { Database } from 'better-sqlite3';
import { calculateGooseLevel, getSessionBaseline, getBaselineSource } from '../state/goose_scale.js';
import type { GooseLevel } from '../state/goose_scale.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LandingInput {
  tokens_total?: number;
  outcome?: string;
  notes?: string;
}

export interface LandingResult {
  level: GooseLevel | string;
  landing_required: boolean;
  can_record: boolean;
  missing: string[];
  recommended_action: string;
  handoff_template: HandoffTemplate;
  session_recorded?: boolean;
}

export interface HandoffTemplate {
  summary: string;
  completed: string[];
  modified_files: string[];
  tests_run: string[];
  known_risks: string[];
  next_safe_action: string;
}

// ─── Landing assessment ────────────────────────────────────────────────────────

/**
 * Assess landing requirements for the current session.
 *
 * @param db - Open better-sqlite3 Database instance
 * @param input - Optional tokens_total, outcome, notes
 * @returns LandingResult with assessment and recommendations
 */
export function assessLanding(
  db: Database,
  input: LandingInput = {},
): LandingResult {
  // Read active session state
  const baseline = getSessionBaseline(db);
  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id,
           plan_id, work_order_id, work_session_id, agent
    FROM active_session WHERE id = 'current'
  `).get() as {
    session_id: string | null;
    started_at: string | null;
    goose_level: string | null;
    tokens_observed: number;
    provider: string | null;
    model: string | null;
    project_id: string | null;
    plan_id: string | null;
    work_order_id: string | null;
    work_session_id: string | null;
    agent: string | null;
  } | undefined;

  const sessionActive = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;
  const level: GooseLevel = sessionActive
    ? calculateGooseLevel(tokensObserved, baseline, true)
    : 'PREFLIGHT';

  // Check what's missing
  const missing: string[] = [];
  if (!input.tokens_total && input.tokens_total !== 0) {
    missing.push('tokens_total');
  }
  if (!sessionActive) {
    missing.push('active_session');
  }

  // Determine landing requirements
  let landingRequired = false;
  let canRecord = false;
  let recommendedAction: string;

  if (level === 'HONK') {
    landingRequired = true;
    if (input.tokens_total != null && sessionActive) {
      canRecord = true;
      recommendedAction =
        'HONK level detected. Tokens provided; call record_session() to archive.';
    } else if (sessionActive && input.tokens_total == null) {
      recommendedAction =
        'HONK level detected. Provide tokens_total to record the session, ' +
        'or use dry-run handoff without recording.';
    } else {
      recommendedAction =
        'No active session. Nothing to land.';
    }
  } else if (level === 'TURBULENCE') {
    landingRequired = false;
    canRecord = !!input.tokens_total;
    recommendedAction =
      'TURBULENCE level — consider landing soon. ' +
      (input.tokens_total
        ? 'Tokens provided; can record session.'
        : 'Provide tokens_total to record when ready.');
  } else if (sessionActive && input.tokens_total != null) {
    canRecord = true;
    landingRequired = false;
    recommendedAction =
      `Session at ${level}. Tokens provided; call record_session() to archive.`;
  } else if (!sessionActive) {
    recommendedAction =
      'No active session. Nothing to land. Call session_start() to begin work.';
  } else {
    landingRequired = false;
    recommendedAction =
      `Session at ${level}. No tokens provided yet. ` +
      'Call get_runway() to check status. Provide tokens_total when ready to land.';
  }

  // Generate handoff template
  const handoffTemplate: HandoffTemplate = {
    summary: '',
    completed: [],
    modified_files: [],
    tests_run: [],
    known_risks: [],
    next_safe_action: '',
  };

  return {
    level,
    landing_required: landingRequired,
    can_record: canRecord,
    missing,
    recommended_action: recommendedAction,
    handoff_template: handoffTemplate,
  };
}
