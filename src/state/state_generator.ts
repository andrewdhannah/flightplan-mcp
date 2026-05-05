/**
 * src/state/state_generator.ts — Markdown snapshot generator
 *
 * Converts a StatusData object into a structured RUNWAY_STATE.md file.
 * This file is Flightplan's carrier-agnostic bridge:
 *
 *   Any LLM that can read a file or accept pasted text can consume this
 *   snapshot and behave as if it has MCP access to Flightplan's state.
 *
 * Usage (via CLI):
 *   flightplan export              → writes ./RUNWAY_STATE.md
 *   flightplan export --out <path> → writes to a custom path
 *
 * Why Markdown (not JSON)?
 *   JSON is machine-readable. Markdown is both machine-readable AND
 *   human-readable, with semantic structure (## headers, tables, checkboxes)
 *   that RAG systems chunk correctly. An LLM reading this file will correctly
 *   distinguish "High-Level Metadata" from "Active Tasks" without needing
 *   a schema definition.
 *
 * Design principles (from Augure session, May 5, 2026):
 *   1. Semantic headers (##, ###) — RAG systems chunk on these boundaries
 *   2. Key-value pairs for scalar data — unambiguous for LLM parsing
 *   3. Tables for list data — easier for token math than prose lists
 *   4. ISO-8601 timestamps — LLMs can detect staleness against chat history
 *   5. Explicit "Deliberately Deferred" section — prevents scope creep
 *      when an LLM tries to "help" with Phase 2/3 features
 *
 * Consumption modes:
 *   MCP path (Claude Code):  agent calls get_runway() directly — no file needed
 *   JSON path (any CLI):     flightplan status --json → pipe to agent
 *   MD path (any LLM):       flightplan export → paste/upload RUNWAY_STATE.md
 *
 * This module exports one function: generateMarkdown(data: StatusData): string
 * It is pure — no DB access, no file I/O. The caller (status.ts) handles writing.
 */

import type { StatusData } from '../status.js';

// ─── Markdown generation ──────────────────────────────────────────────────────

/**
 * Generates the full RUNWAY_STATE.md content from a StatusData snapshot.
 *
 * Pure function — takes data, returns a string. No side effects.
 * status.ts is responsible for writing the string to disk.
 *
 * Sections produced:
 *   1. Document header — timestamp, source, staleness warning
 *   2. High-Level Metadata — the "Compass" (level, runway, baseline)
 *   3. Active Session — the "Flight Log" (tokens, duration, model)
 *   4. Dead Reckoning Status — Phase 2 progress
 *   5. How to use this file — instructions for the receiving LLM
 *   6. Deliberately Deferred — what NOT to act on yet
 *
 * @param data - StatusData gathered by gatherStatusData() in status.ts
 * @returns Complete Markdown string ready to write to disk
 */
export function generateMarkdown(data: StatusData): string {
  const {
    level,
    sessionActive,
    runwayPct,
    runwayTokens,
    tokensObserved,
    baseline,
    warnThreshold,
    providerName,
    active,
    sessionsArchived,
    phase2Remaining,
  } = data;

  // ISO-8601 timestamp so the receiving LLM can detect stale snapshots.
  // If the LLM's conversation history has a more recent timestamp, it should
  // ask the user to run `flightplan export` again.
  const timestamp = new Date().toISOString();

  // ── Section 1: Document header ─────────────────────────────────────────────
  const header = `# FlightPlan Runway State
**Generated:** ${timestamp}
**Source:** \`flightplan export\` (Flightplan v0.1.0)
**Provider:** ${providerName}

> ⚠️ This is a point-in-time snapshot. If significant time has passed since
> this timestamp, ask the user to run \`flightplan export\` again for fresh data.
> Token counts change as the session progresses — treat old snapshots as estimates.

`;

  // ── Section 1.5: Agent Contract ───────────────────────────────────────────
  // Mandatory operating rules for the receiving LLM.
  //
  // DEVELOPER NOTE — tone calibration:
  //   The current language is direct and scannable. If you want stricter
  //   enforcement, replace the action lines with explicit MUST/STOP imperatives:
  //
  //   HONK:       "You MUST STOP. Do not begin any new work."
  //   TURBULENCE: "You MUST NOT start large tasks."
  //   HEADWIND:   "You MUST limit yourself to small, scoped tasks only."
  //   CRUISING:   "You MAY proceed. Re-evaluate before any major operation."
  //
  //   The softer framing below was chosen because LLMs respond better to
  //   system-level instruction language than to imposed rules. Either works —
  //   the MUST variants are marginally harder for an agent to rationalize away.
  const agentContract = `## Agent Contract

*Read this before doing anything else.*

| Level | State | Action |
| :--- | :--- | :--- |
| 🔴 HONK | Runway exhausted | **Stop.** Finish current sentence. Call \`record_session()\`. Nothing new. |
| 🟠 TURBULENCE | Runway tight | **Do not start large tasks.** Wrap up or checkpoint only. |
| 🟡 HEADWIND | Burning fast | **Small, scoped tasks only.** Finish what's open before starting new work. |
| 🟢 CRUISING | Healthy | Proceed. Re-evaluate runway before any major operation. |
| ⬜ PREFLIGHT | No session | Call \`session_start()\` before beginning work. |

**Before any major task:** check the Goose Scale level in Section 1.
**When uncertain:** default to the more conservative behaviour above.

`;

  // ── Section 2: High-Level Metadata (the "Compass") ────────────────────────
  // This is the first thing an LLM reads. Scalar facts, one per line.
  // "Compass" name from Augure session — it orients the LLM immediately.
  const compass = `## 1. High-Level Metadata (The "Compass")
*Orients the LLM immediately. Read this section first.*

- **Goose Scale Level:** ${level}
- **Session Active:** ${sessionActive ? 'Yes' : 'No'}
- **Runway Remaining:** ${runwayPct}% (${runwayTokens.toLocaleString()} tokens)
- **Tokens Observed:** ${tokensObserved.toLocaleString()} / ${baseline.toLocaleString()} baseline
- **Warning Threshold:** ${warnThreshold > 0 ? `${warnThreshold}% (warnings enabled)` : 'Disabled'}
- **Project Health:** ${healthLabel(level)}

### What the Goose Scale level means right now
${gooseGuidance(level)}

`;

  // ── Section 3: Active Session (the "Flight Log") ──────────────────────────
  // Only populated when a session is open. Null fields shown explicitly
  // so the LLM doesn't hallucinate values.
  let flightLog: string;

  if (sessionActive && active?.started_at) {
    const durationMs   = new Date().getTime() - new Date(active.started_at).getTime();
    const durationMins = Math.round(durationMs / 60000);

    flightLog = `## 2. Active Session (The "Flight Log")

| Field | Value |
| :--- | :--- |
| Session ID | \`${active.session_id ?? 'unknown'}\` |
| Started At | ${active.started_at} |
| Duration | ${durationMins} min |
| Tokens Observed | ${tokensObserved.toLocaleString()} |
| Tokens Remaining | ${runwayTokens.toLocaleString()} |
| Model | ${active.model ?? '*(not set)*'} |
| Project | ${active.project_id ?? '*(not set)*'} |

`;
  } else {
    flightLog = `## 2. Active Session (The "Flight Log")

No session is currently active (PREFLIGHT state).

The user has not called \`session_start()\` yet, or the previous session
was closed with \`record_session()\`. Token counts are not being tracked.

To begin tracking: call \`session_start()\` in your AI tool.

`;
  }

  // ── Section 4: Dead Reckoning Status ──────────────────────────────────────
  // Shows Phase 2 progress. Explicit about what is and isn't available yet.
  const deadReckoning = `## 3. Dead Reckoning Status

- **Sessions Archived:** ${sessionsArchived}
- **Phase 2 Status:** ${phase2Remaining === 0
    ? '✅ Active — baseline is auto-calibrating from real session data'
    : `⏳ Unlocks in ${phase2Remaining} more session${phase2Remaining === 1 ? '' : 's'}`}

**Currently unavailable (Phase 1 — returns null):**
- \`burn_rate_per_hour\` — requires 5+ archived sessions
- \`time_remaining_minutes\` — derived from burn rate
- \`token_range\` — confidence interval from session variance

These fields activate automatically after ${Math.max(0, 5 - sessionsArchived)} more completed session${Math.max(0, 5 - sessionsArchived) === 1 ? '' : 's'}.

`;

  // ── Section 5: Instructions for the receiving LLM ─────────────────────────
  // Explicit guidance prevents the LLM from misusing or misreading the data.
  const instructions = `## 4. How To Use This File

You are reading a Flightplan runway state snapshot. Here is how to use it:

1. **Check staleness first.** Compare the \`Generated\` timestamp above against
   the current time. If it is more than 30 minutes old, ask the user to run
   \`flightplan export\` again before making decisions based on token counts.

2. **Use the Goose Scale level.** The level in Section 1 is your primary signal.
   CRUISING = proceed normally. HEADWIND = start wrapping up soon.
   TURBULENCE = prioritize finishing current task. HONK = land now.

3. **Do not estimate what is null.** Fields marked as unavailable in Section 3
   are genuinely unknown — do not substitute 0 or invent estimates. Say so.

4. **This replaces \`get_runway()\`.** If you cannot call MCP tools, this file
   gives you the same data. Treat it as equivalent to a \`get_runway()\` response.

`;

  // ── Section 6: Deliberately Deferred ──────────────────────────────────────
  // Prevents an LLM from trying to "help" with Phase 2/3 features that
  // don't exist yet. Explicit scope boundary for the receiving model.
  const deferred = `## 5. Deliberately Deferred (Do Not Act On These Yet)

The following features are planned but not yet built. Do not suggest
implementations or ask about them unless the user raises them first:

- **Dead Reckoning (Phase 2):** Auto-calibrating baseline, velocity calculation,
  confidence intervals. Unlocks after 5 sessions.
- **Formation Trust (Phase 3):** Community velocity profiles, Flock File,
  opt-in anonymous session sharing.
- **Flightplan Lite:** Prompt-only version for LLMs without file upload.

---

> **Snapshot taken at ${timestamp}.**
> Re-export before long tasks, refactors, or multi-step operations.
> Run \`flightplan export\` to get fresh data.
`;

  // Concatenate all sections
  return header + agentContract + compass + flightLog + deadReckoning + instructions + deferred;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a health label string for the current Goose Level.
 * Used in the Compass section to give the LLM an instant read.
 *
 * @param level - Current GooseLevel
 * @returns Short health string
 */
function healthLabel(level: string): string {
  switch (level) {
    case 'PREFLIGHT':  return 'Standby — no session active';
    case 'CRUISING':   return '🟢 Healthy — proceed normally';
    case 'HEADWIND':   return '🟡 Caution — burning faster than baseline';
    case 'TURBULENCE': return '🟠 Warning — wrap up current task soon';
    case 'HONK':       return '🔴 Critical — call record_session() now';
    case 'REFUELLED':  return '🟢 Fresh — new session just started';
    case 'LANDING':    return '⬜ Landed — session closed';
    case 'WAYWARD':    return '🔵 Drifting — Dead Reckoning review needed';
    default:           return 'Unknown';
  }
}

/**
 * Returns actionable guidance for the current Goose Level.
 * Written for an LLM audience — specific, not vague.
 *
 * @param level - Current GooseLevel
 * @returns Markdown string with guidance for this level
 */
function gooseGuidance(level: string): string {
  switch (level) {
    case 'PREFLIGHT':
      return `No session is active. Call \`session_start()\` before beginning work.
Token tracking will not function until a session is open.`;

    case 'CRUISING':
      return `Runway is healthy. Proceed with planned work.
No special action required — you have plenty of tokens remaining.`;

    case 'HEADWIND':
      return `Burning faster than your baseline. Still on course, but worth noting.
Begin scoping tasks so they can be completed before runway runs low.
Avoid starting large, open-ended tasks that can't be interrupted cleanly.`;

    case 'TURBULENCE':
      return `Runway is tight. Prioritize finishing your current task cleanly.
Do not start new large tasks. Begin preparing a session summary.
When the current task is done, call \`record_session()\` and land.`;

    case 'HONK':
      return `Runway is exhausted. Stop new work immediately.
Finish the current sentence/thought, then call \`record_session()\` now.
Do not start anything new. The session needs to land.`;

    case 'REFUELLED':
      return `Fresh session. Full runway available.
Proceed with planned work. Call \`get_runway()\` for live token data.`;

    case 'LANDING':
      return `Session has ended gracefully. Data has been archived.
Call \`session_start()\` to begin a new session.`;

    case 'WAYWARD':
      return `Dead Reckoning has drifted significantly from observed reality.
Review your session patterns — your baseline may need recalibration.
Run \`flightplan-mcp init\` to reset your baseline if needed.`;

    default:
      return `Unknown level. Run \`flightplan status\` for current state.`;
  }
}
