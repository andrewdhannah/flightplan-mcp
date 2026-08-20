/**
 * src/observations/lifecycle.ts — RuntimeLifecycleEvent types and builder
 *
 * Event class answering: "What happened to the session?"
 *
 * Lifecycle events are independent facts about session state transitions.
 * They do NOT carry token counts (that's RuntimeResourceObservation's job).
 * They do NOT carry tool activity (that's RuntimeActionEvent's job).
 *
 * Design constraints:
 *   - Pure builder: constructs event from input parameters
 *   - Does NOT persist (Librarian's job)
 *   - Does NOT make policy decisions
 *   - Deterministic: same inputs → same event
 *
 * Contract: AGENT-RUNTIME-EVIDENCE-CONTRACT-001.md §4
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle event classification.
 * Four terminal-ish states. The evidence store must distinguish all four.
 */
export type LifecycleEvent = 'started' | 'completed' | 'failed' | 'owner_forced_stop';

/**
 * Failure reason for `failed` lifecycle events.
 * Nullable — `completed` and `owner_forced_stop` do not carry failure reasons.
 */
export type FailureReason = 'stale' | 'blocked' | 'error' | 'timeout';

/**
 * Who caused the state change.
 */
export type Actor = 'owner' | 'agent' | 'runtime' | 'system';

/**
 * RuntimeLifecycleEvent — structured event answering "what happened to the session?"
 * Schema: runtime-lifecycle-event-v1.schema.json
 */
export interface RuntimeLifecycleEvent {
  event_id: string;
  event_type: 'runtime_lifecycle';
  session_id: string;
  timestamp: string;

  lifecycle_event: LifecycleEvent;

  /** Why the session failed. Null for completed and owner_forced_stop. */
  failure_reason: FailureReason | null;

  /** Who caused the state change. */
  actor: Actor;

  /** Optional work tags — omit entirely if not present */
  work_packet_id?: string;
  work_order_id?: string;
}

/**
 * Input for building a RuntimeLifecycleEvent.
 */
export interface EmitLifecycleEventInput {
  session_id: string;
  lifecycle_event: LifecycleEvent;
  failure_reason?: FailureReason;
  actor: Actor;
  work_packet_id?: string;
  work_order_id?: string;
}

// ─── Event builder ─────────────────────────────────────────────────────────────

/**
 * Generate a unique event ID.
 * Format: RLE-<timestamp>-<random 6 hex chars>
 */
function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 8);
  return `RLE-${ts}-${rand}`;
}

/**
 * Build a RuntimeLifecycleEvent from input parameters.
 *
 * Validates:
 *   - `failed` events must carry a `failure_reason`
 *   - `completed` and `owner_forced_stop` must NOT carry a `failure_reason`
 *   - `started` must NOT carry a `failure_reason`
 *
 * @param input - Event parameters
 * @returns RuntimeLifecycleEvent ready for evidence envelope
 */
export function emitLifecycleEvent(input: EmitLifecycleEventInput): RuntimeLifecycleEvent {
  // Validate failure_reason semantics
  let failureReason: FailureReason | null = input.failure_reason ?? null;

  if (input.lifecycle_event === 'failed') {
    if (!failureReason) {
      throw new Error('failed lifecycle_event requires a failure_reason');
    }
  } else {
    // completed, owner_forced_stop, started — no failure reason
    if (failureReason) {
      throw new Error(`${input.lifecycle_event} lifecycle_event must not carry a failure_reason`);
    }
  }

  const event: RuntimeLifecycleEvent = {
    event_id: generateEventId(),
    event_type: 'runtime_lifecycle',
    session_id: input.session_id,
    timestamp: new Date().toISOString(),
    lifecycle_event: input.lifecycle_event,
    failure_reason: failureReason,
    actor: input.actor,
  };

  // Optional work tags — omit entirely if not present
  if (input.work_packet_id) {
    event.work_packet_id = input.work_packet_id;
  }
  if (input.work_order_id) {
    event.work_order_id = input.work_order_id;
  }

  return event;
}
