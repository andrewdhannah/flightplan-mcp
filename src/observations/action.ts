/**
 * src/observations/action.ts — RuntimeActionEvent types and builder
 *
 * Event class answering: "What did the runtime do?"
 *
 * Action events capture atomic runtime actions: tool calls, file modifications,
 * shell commands, and abort requests. Each event captures one action.
 *
 * The abort_requested rule:
 *   - Emitted at the call site the instant session.abort() is invoked
 *   - Records the fact that abort was requested, not whether it succeeded
 *   - If no corresponding RuntimeLifecycleEvent(owner_forced_stop) follows,
 *     that is a queryable state: "abort attempted, outcome unknown"
 *   - The adapter knows what action it initiated. The runtime confirms state.
 *     Those are not equivalent.
 *
 * Design constraints:
 *   - Pure builder: constructs event from input parameters
 *   - Does NOT persist (Librarian's job)
 *   - Does NOT make policy decisions
 *   - Deterministic: same inputs → same event
 *
 * Contract: AGENT-RUNTIME-EVIDENCE-CONTRACT-001.md §5
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Action classification.
 * Four atomic action types.
 */
export type ActionEvent = 'tool_called' | 'file_modified' | 'command_executed' | 'abort_requested';

/**
 * Detail fields for an action event.
 * Fields not relevant to the action type are null.
 */
export interface ActionDetail {
  /** Tool name — populated for tool_called */
  tool_name: string | null;
  /** File path — populated for file_modified */
  file_path: string | null;
  /** Shell command — populated for command_executed */
  command: string | null;
  /** Target session ID — populated for abort_requested */
  target_session_id: string | null;
}

/**
 * RuntimeActionEvent — structured event answering "what did the runtime do?"
 * Schema: runtime-action-event-v1.schema.json
 */
export interface RuntimeActionEvent {
  event_id: string;
  event_type: 'runtime_action';
  session_id: string;
  timestamp: string;

  action: ActionEvent;

  /** Context-specific detail. Null fields are irrelevant to this action type. */
  action_detail: ActionDetail;

  /** Optional work tags — omit entirely if not present */
  work_packet_id?: string;
  work_order_id?: string;
}

/**
 * Input for building a RuntimeActionEvent.
 */
export interface EmitActionEventInput {
  session_id: string;
  action: ActionEvent;
  tool_name?: string;
  file_path?: string;
  command?: string;
  target_session_id?: string;
  work_packet_id?: string;
  work_order_id?: string;
}

// ─── Event builder ─────────────────────────────────────────────────────────────

/**
 * Generate a unique event ID.
 * Format: RAE-<timestamp>-<random 6 hex chars>
 */
function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 8);
  return `RAE-${ts}-${rand}`;
}

/**
 * Build a RuntimeActionEvent from input parameters.
 *
 * Validates:
 *   - Only relevant detail fields are populated per action type
 *   - tool_name is required for tool_called
 *   - file_path is required for file_modified
 *   - command is required for command_executed
 *   - target_session_id is required for abort_requested
 *
 * @param input - Event parameters
 * @returns RuntimeActionEvent ready for evidence envelope
 */
export function emitActionEvent(input: EmitActionEventInput): RuntimeActionEvent {
  // Validate detail fields per action type
  const detail: ActionDetail = {
    tool_name: null,
    file_path: null,
    command: null,
    target_session_id: null,
  };

  switch (input.action) {
    case 'tool_called':
      if (!input.tool_name) {
        throw new Error('tool_called action requires tool_name');
      }
      detail.tool_name = input.tool_name;
      break;
    case 'file_modified':
      if (!input.file_path) {
        throw new Error('file_modified action requires file_path');
      }
      detail.file_path = input.file_path;
      break;
    case 'command_executed':
      if (!input.command) {
        throw new Error('command_executed action requires command');
      }
      detail.command = input.command;
      break;
    case 'abort_requested':
      if (!input.target_session_id) {
        throw new Error('abort_requested action requires target_session_id');
      }
      detail.target_session_id = input.target_session_id;
      break;
  }

  const event: RuntimeActionEvent = {
    event_id: generateEventId(),
    event_type: 'runtime_action',
    session_id: input.session_id,
    timestamp: new Date().toISOString(),
    action: input.action,
    action_detail: detail,
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
