/**
 * src/observations/emission.ts — RuntimeResourceObservation builder
 *
 * Builds a structured observation from current FlightPlan session state
 * and Dead Reckoning estimate. This is the sensor side of the
 * sensor→authority bridge.
 *
 * FlightPlan produces this. Librarian decides what to do with it.
 *
 * Design constraints:
 *   - Pure builder: reads DB state, calls classifyVariance(), returns object
 *   - Does NOT persist to evidence store (that's Librarian's job in item 2)
 *   - Does NOT make policy decisions (that's gates.ts's job)
 *   - Deterministic: same DB state + same estimate → same observation
 *   - Missing fields are omitted, never fabricated
 *
 * Calling code:
 *   - New MCP tool `emit_observation` (item 1 deliverable)
 *   - Optionally called from `get_runway` to attach observation to runway response
 *   - Called from heartbeat path (item 2) to feed evidence store
 */

import type { Database } from 'better-sqlite3';
import { getSessionBaseline, calculateGooseLevel } from '../state/goose_scale.js';
import type { GooseLevel } from '../state/goose_scale.js';
import { estimateTokens, type DeadReckoningEstimate } from '../analytics/dead_reckoning.js';
import { classifyVariance, type VarianceClassification } from '../analytics/variance.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * RuntimeResourceObservation — the structured observation object.
 * Schema: runtime-resource-observation-v1.schema.json
 */
export interface RuntimeResourceObservation {
  observation_id: string;
  observation_type: 'runtime_resource';
  session_id: string;
  timestamp: string;

  /** Optional for backward compatibility with pre-WO-1 evidence rows. */
  model_identity?: {
    provider: string;
    model: string;
    version?: string;
  };

  consumed: {
    tokens_observed: number;
    goose_level: GooseLevel;
    elapsed_minutes: number;
    burn_rate_per_hour?: number;
  };

  estimate: {
    estimator_id: string;
    confidence: DeadReckoningEstimate['confidence'];
    percentiles: {
      p50: number;
      p80: number;
      p95: number;
    };
    sample_count: number;
    match_scope: string;
  };

  variance: VarianceClassification;

  recommended_action: string;

  // Optional work tags — omit entirely if not present (do not send null)
  work_packet_id?: string;
  work_order_id?: string;
}

export interface EmitObservationInput {
  /** Override session ID. If omitted, reads from active_session. */
  session_id?: string;
  /** Override work_packet_id. Omit for ungoverned sessions. */
  work_packet_id?: string;
  /** Override work_order_id. Omit if not applicable. */
  work_order_id?: string;
  /** Override estimate input. If omitted, uses session's provider/model/project. */
  estimate_input?: {
    model?: string;
    provider?: string;
    project?: string;
  };
}

// ─── Observation builder ───────────────────────────────────────────────────────

/**
 * Generate a unique observation ID.
 * Format: OBS-<timestamp>-<random 6 hex chars>
 */
function generateObservationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 8);
  return `OBS-${ts}-${rand}`;
}

/**
 * Compute elapsed minutes from session start.
 */
function computeElapsedMinutes(startedAt: string | null): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((now - start) / 60000 * 10) / 10);
}

/**
 * Generate a human-readable recommended action from variance state and Goose Scale.
 *
 * Synthesizes both signals — variance.state (consumption vs. estimate) and
 * goose_level (consumption vs. session baseline). These are different questions
 * about the same session, and the recommendation must reflect both.
 *
 * IMPLEMENTATION: Explicit lookup table, not nested conditionals.
 * Every (variance_state, goose_level) combination is a deliberate row.
 * If a new Goose Scale level is added, this table must be updated —
 * that's the point. No silent fallthrough, no default that nobody chose.
 *
 * Goose Scale states (8):
 *   PREFLIGHT  — no session active
 *   CRUISING   — 0-50% consumed (nominal)
 *   HEADWIND   — 50-75% consumed (elevated caution)
 *   TURBULENCE — 75-85% consumed (high)
 *   HONK       — 85%+ consumed (exhausted)
 *   WAYWARD    — Dead Reckoning drift detected
 *   LANDING    — session ending gracefully
 *   REFUELLED  — new session started, runway restored
 *
 * Variance states (4):
 *   NOMINAL    — within estimate range
 *   ELEVATED   — above p50
 *   AT_RISK    — above 90% of p80
 *   EXCEEDED   — above 100% of p80
 *
 * This function is the single source of truth for recommended_action.
 * Do not add a second recommendation path elsewhere.
 */
function getRecommendedAction(
  varianceState: string,
  gooseLevel: string,
): string {
  // Explicit lookup table. 4 variance states × 8 goose levels = 32 rows.
  // Each row is a deliberate decision, not a fallthrough.
  // biome-ignore lint/suspicious/noExplicitAny: lookup table value type
  const RECOMMENDATIONS: Record<string, Record<string, string>> = {
    EXCEEDED: {
      // EXCEEDED overrides everything — estimate was wrong or scope expanded.
      PREFLIGHT:   'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      CRUISING:    'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      HEADWIND:    'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      TURBULENCE:  'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      HONK:        'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      WAYWARD:     'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      LANDING:     'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
      REFUELLED:   'Consumption has exceeded the 80th percentile estimate. Checkpoint required — stop and emit evidence.',
    },
    AT_RISK: {
      // AT_RISK: approaching p80. Goose level determines urgency.
      PREFLIGHT:   'Consumption is approaching the 80th percentile. Monitor closely.',
      CRUISING:    'Consumption is approaching the 80th percentile. Monitor closely. Prepare to checkpoint if trend continues.',
      HEADWIND:    'Consumption is approaching the 80th percentile and burn rate is elevated. Checkpoint now — do not continue.',
      TURBULENCE:  'Consumption is approaching the 80th percentile and burn rate is elevated. Checkpoint now — do not continue.',
      HONK:        'Consumption is approaching the 80th percentile and runway is exhausted. Checkpoint now — do not continue.',
      WAYWARD:     'Consumption is approaching the 80th percentile and Dead Reckoning is unstable. Checkpoint now.',
      LANDING:     'Consumption is approaching the 80th percentile. Session is landing — allow it to complete.',
      REFUELLED:   'Consumption is approaching the 80th percentile. New session — reassess estimate before continuing.',
    },
    ELEVATED: {
      // ELEVATED: above p50. Goose level determines awareness.
      PREFLIGHT:   'Consumption is above the median estimate. Re-evaluate before major operations.',
      CRUISING:    'Consumption is above the median estimate. Normal variance, but re-evaluate before major operations.',
      HEADWIND:    'Consumption is above the median estimate and burn rate is elevated. Re-evaluate scope before continuing.',
      TURBULENCE:  'Consumption is above the median estimate and burn rate is high. Re-evaluate scope — consider checkpoint.',
      HONK:        'Consumption is above the median estimate and runway is exhausted. Checkpoint recommended.',
      WAYWARD:     'Consumption is above the median estimate and Dead Reckoning is unstable. Re-evaluate with caution.',
      LANDING:     'Consumption is above the median estimate. Session is landing — allow it to complete.',
      REFUELLED:   'Consumption is above the median estimate. New session — reassess estimate before continuing.',
    },
    NOMINAL: {
      // NOMINAL: within estimate range. Goose level determines awareness.
      PREFLIGHT:   'No active session. Observation recorded.',
      CRUISING:    'Consumption is within expected range. Proceed normally.',
      HEADWIND:    'Consumption is within the estimate range, but burn rate is elevated relative to session baseline. Proceed with caution.',
      TURBULENCE:  'Consumption is within the estimate range, but burn rate is high. Proceed with caution — consider checkpoint.',
      HONK:        'Consumption is within the estimate range, but runway is exhausted. Checkpoint and land.',
      WAYWARD:     'Consumption is within the estimate range, but Dead Reckoning is unstable. Proceed with caution.',
      LANDING:     'Consumption is within the estimate range. Session is landing.',
      REFUELLED:   'Consumption is within the estimate range. New session started.',
    },
  };

  const varianceRow = RECOMMENDATIONS[varianceState];
  if (varianceRow) {
    return varianceRow[gooseLevel]
      ?? `Observation recorded. Variance: ${varianceState}, Goose: ${gooseLevel}. Review recommended action.`;
  }
  return `Observation recorded. Unknown variance state: ${varianceState}. Review recommended action.`;
}

/**
 * Build a RuntimeResourceObservation from current FlightPlan state.
 *
 * Reads from the database to get:
 *   - Active session state (tokens_observed, started_at, provider, model, project)
 *   - Dead Reckoning estimate for current context
 *
 * Calls classifyVariance() for the variance classification.
 *
 * @param db - Open better-sqlite3 Database instance
 * @param input - Optional overrides for session, work packet, estimate
 * @returns RuntimeResourceObservation ready for Librarian ingestion
 */
export function emitObservation(
  db: Database,
  input: EmitObservationInput = {},
): RuntimeResourceObservation {
  // ── Read active session state ──────────────────────────────────────────
  const baseline = getSessionBaseline(db);
  const active = db.prepare(`
    SELECT session_id, tokens_observed, started_at, provider, model, project_id
    FROM active_session WHERE id = 'current'
  `).get() as {
    session_id: string | null;
    tokens_observed: number;
    started_at: string | null;
    provider: string | null;
    model: string | null;
    project_id: string | null;
  } | undefined;

  const sessionActive = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;
  const sessionId = input.session_id ?? active?.session_id ?? 'unknown';
  const gooseLevel: GooseLevel = calculateGooseLevel(tokensObserved, baseline, sessionActive);

  // ── Get Dead Reckoning estimate ────────────────────────────────────────
  const estimateInput = {
    model: input.estimate_input?.model ?? active?.model ?? undefined,
    provider: input.estimate_input?.provider ?? active?.provider ?? undefined,
    project: input.estimate_input?.project ?? active?.project_id ?? undefined,
  };
  const estimate: DeadReckoningEstimate = estimateTokens(db, estimateInput);

  // ── Classify variance ──────────────────────────────────────────────────
  // Single source of truth: classifyVariance() in analytics/variance.ts
  // Both this emission path and gates.ts consume this function.
  const variance = classifyVariance(tokensObserved, estimate);

  // ── Build consumed block ───────────────────────────────────────────────
  const elapsedMinutes = computeElapsedMinutes(active?.started_at ?? null);

  // ── Build observation ──────────────────────────────────────────────────
  const observation: RuntimeResourceObservation = {
    observation_id: generateObservationId(),
    observation_type: 'runtime_resource',
    session_id: sessionId,
    timestamp: new Date().toISOString(),

    model_identity: {
      provider: active?.provider ?? 'unknown',
      model: active?.model ?? 'unknown',
    },

    consumed: {
      tokens_observed: tokensObserved,
      goose_level: gooseLevel,
      elapsed_minutes: elapsedMinutes,
    },

    estimate: {
      estimator_id: 'token-cost-estimator-v1',
      confidence: estimate.confidence,
      percentiles: {
        p50: estimate.estimated_tokens.p50,
        p80: estimate.estimated_tokens.p80,
        p95: estimate.estimated_tokens.p95,
      },
      sample_count: estimate.historical_basis.matching_sessions,
      match_scope: estimate.historical_basis.scope,
    },

    variance,

    recommended_action: getRecommendedAction(variance.state, gooseLevel),
  };

  // ── Optional work tags — omit entirely if not present ──────────────────
  if (input.work_packet_id) {
    observation.work_packet_id = input.work_packet_id;
  }
  if (input.work_order_id) {
    observation.work_order_id = input.work_order_id;
  }

  return observation;
}
