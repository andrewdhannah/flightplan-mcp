/**
 * src/status.ts — flightplan status CLI
 *
 * Human-facing runway display. Run this to see your current token runway
 * in a readable format. This is NOT the MCP server — it's a separate
 * binary for the person sitting at the keyboard.
 *
 * Usage:
 *   flightplan status          — show current runway (human-readable)
 *   flightplan status --json   — machine-readable JSON (for non-MCP agents)
 *   flightplan export          — write RUNWAY_STATE.md for any LLM to read
 *
 * Two binaries, two jobs:
 *   flightplan-mcp   — MCP server, called by AI agents (src/index.ts)
 *   flightplan       — status CLI, called by humans (this file)
 *
 * Design goals:
 *   - Glanceable: most important info at the top
 *   - No scrolling required for the happy path
 *   - Goose emoji because this is Flightplan and the 🪿 stays
 *   - --json flag makes it useful for non-MCP agents (shell scripts, Codex CLI)
 *   - export command makes it useful for any LLM regardless of MCP support
 *
 * Changed (Tier 2.6 — May 5, 2026):
 *   Extracted gatherStatusData() so printStatus() and printJson() share one
 *   set of DB reads instead of duplicating ~20 lines each.
 *
 * Added (StateGenerator — May 5, 2026):
 *   flightplan export command writes RUNWAY_STATE.md via generateMarkdown().
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb } from './db/connection.js';
import {
  getSessionBaseline,
  getWarnThreshold,
  getProviderName,
  calculateGooseLevel,
  getRunwayPercent,
  GOOSE_LEVEL_DESCRIPTIONS,
  type GooseLevel,
} from './state/goose_scale.js';
import { generateMarkdown } from './state/state_generator.js';

// ─── ANSI colour helpers ──────────────────────────────────────────────────────

/**
 * Minimal ANSI colour wrappers.
 * No external library — just the escape codes we need.
 * These make the terminal output readable at a glance.
 *
 * Auto-disabled if stdout is not a TTY (e.g. when piping to a file).
 * This ensures --json output stays clean even without the flag.
 */
const isTTY = process.stdout.isTTY;

const c = {
  reset:  (s: string) => isTTY ? `\x1b[0m${s}\x1b[0m`  : s,
  bold:   (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
  green:  (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  orange: (s: string) => isTTY ? `\x1b[38;5;208m${s}\x1b[0m` : s,
  red:    (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  blue:   (s: string) => isTTY ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:   (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
};

// ─── Level colours ────────────────────────────────────────────────────────────

/**
 * Maps each Goose Level to a colour function.
 * HONK is red because it needs to be unmissable.
 * PREFLIGHT is blue — calm, informational.
 */
function levelColour(level: string, text: string): string {
  switch (level) {
    case 'PREFLIGHT':  return c.blue(text);
    case 'CRUISING':   return c.green(text);
    case 'HEADWIND':   return c.yellow(text);
    case 'TURBULENCE': return c.orange(text);
    case 'HONK':       return c.red(text);
    case 'LANDING':    return c.dim(text);
    case 'REFUELLED':  return c.green(text);
    case 'WAYWARD':    return c.cyan(text);
    default:           return text;
  }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

/**
 * Renders a simple ASCII progress bar showing runway consumed.
 *
 * Example (50% consumed):
 *   [████████████░░░░░░░░░░░░] 50% remaining
 *
 * The bar fills from left as tokens are consumed.
 * Colour matches the current Goose Level.
 *
 * @param pctRemaining - 0 to 100
 * @param level - current GooseLevel for colour
 * @param width - total bar width in characters (default 24)
 */
function renderBar(pctRemaining: number, level: string, width = 24): string {
  const filled  = Math.round((1 - pctRemaining / 100) * width);
  const empty   = width - filled;
  const bar     = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${levelColour(level, bar)}]`;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

/**
 * Shape of one active_session row read from the DB.
 * Used by gatherStatusData() and passed into rendering functions.
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

/**
 * All data needed to render any output format (human, JSON, or Markdown).
 * Gathered once by gatherStatusData() and passed to printStatus(),
 * printJson(), or generateMarkdown().
 *
 * Having a single typed object means:
 *   - DB is read exactly once per command invocation
 *   - All output functions are pure: data in, formatted string out
 *   - Easy to test: just construct a StatusData object, no DB needed
 */
export interface StatusData {
  /** Current Goose Scale level. */
  level:             GooseLevel;
  /** Whether a session is currently open. */
  sessionActive:     boolean;
  /** Runway remaining as a percentage (0–100). */
  runwayPct:         number;
  /** Runway remaining in tokens. */
  runwayTokens:      number;
  /** Tokens observed so far in this session. */
  tokensObserved:    number;
  /** User's session token baseline (from config). */
  baseline:          number;
  /** Warning threshold percentage (0 = disabled). */
  warnThreshold:     number;
  /** Human-readable provider name from config. */
  providerName:      string;
  /** Raw active_session row — null fields mean no session is open. */
  active:            ActiveSessionRow | undefined;
  /** Total sessions archived in usage_snapshots. */
  sessionsArchived:  number;
  /** Sessions remaining until Phase 2 Dead Reckoning unlocks (0 = active). */
  phase2Remaining:   number;
}

// ─── Data gathering (Tier 2.6) ────────────────────────────────────────────────

/**
 * Reads all status data from the DB and returns a typed StatusData object.
 *
 * This is the single source of truth for all three output formats:
 *   printStatus()     — human terminal display
 *   printJson()       — machine-readable JSON
 *   generateMarkdown() — portable Markdown for non-MCP LLMs
 *
 * Previously this logic was duplicated in printStatus() and printJson().
 * Extracting it here (Tier 2.6) means:
 *   - One DB connection opened per command (not two)
 *   - One place to fix if the schema changes
 *   - Output functions are simpler and testable without a real DB
 *
 * @returns StatusData — everything needed to render any output format
 */
export function gatherStatusData(): StatusData {
  const db = openDb();

  // Config reads
  const baseline      = getSessionBaseline(db);
  const warnThreshold = getWarnThreshold(db);
  const providerName  = getProviderName(db);

  // Active session read
  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  // Derived values
  const sessionActive  = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;
  const level          = calculateGooseLevel(tokensObserved, baseline, sessionActive);
  const runwayPct      = sessionActive ? getRunwayPercent(tokensObserved, baseline) : 100;
  const runwayTokens   = Math.max(0, baseline - tokensObserved);

  // Session archive count
  const countRow = db.prepare(
    `SELECT COUNT(*) as n FROM usage_snapshots`
  ).get() as { n: number };

  const sessionsArchived = countRow.n;
  const phase2Remaining  = Math.max(0, 5 - sessionsArchived);

  return {
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
  };
}

// ─── Human display ────────────────────────────────────────────────────────────

/**
 * Prints a human-readable status display to stdout.
 *
 * Output sections:
 *   1. Header — goose emoji, level, provider
 *   2. Progress bar — visual runway remaining
 *   3. Session details — tokens, baseline, duration if active
 *   4. Recommended action — what to do right now
 *   5. Formation Trust countdown — sessions until Phase 2 unlocks
 *   6. Footer — how to get help
 *
 * @param data - StatusData from gatherStatusData()
 */
function printStatus(data: StatusData): void {
  const { level, sessionActive, runwayPct, runwayTokens, tokensObserved,
          baseline, warnThreshold, providerName, active,
          sessionsArchived, phase2Remaining } = data;

  // ── Header ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log(
    c.bold('🪿 Flightplan') +
    c.dim('  ·  ') +
    levelColour(level, c.bold(level)) +
    c.dim('  ·  ') +
    c.dim(providerName)
  );
  console.log('');

  // ── Progress bar ───────────────────────────────────────────────────────────
  if (sessionActive) {
    const bar = renderBar(runwayPct, level);
    console.log(
      `  ${bar}  ` +
      levelColour(level, c.bold(`${runwayPct}%`)) +
      c.dim(' remaining')
    );
    console.log('');
  }

  // ── Session details ────────────────────────────────────────────────────────
  if (sessionActive) {
    const startedAt    = active?.started_at ?? '';
    const durationMs   = startedAt
      ? new Date().getTime() - new Date(startedAt).getTime()
      : 0;
    const durationMins = Math.round(durationMs / 60000);

    console.log(c.dim('  Session'));
    console.log(
      `    Tokens observed   ` +
      c.bold(tokensObserved.toLocaleString()) +
      c.dim(` / ${baseline.toLocaleString()} baseline`)
    );
    console.log(
      `    Runway remaining  ` +
      levelColour(level, c.bold(runwayTokens.toLocaleString())) +
      c.dim(' tokens')
    );
    console.log(
      `    Duration          ` +
      c.bold(`${durationMins} min`)
    );
    if (active?.model) {
      console.log(`    Model             ${c.dim(active.model)}`);
    }
    if (active?.project_id) {
      console.log(`    Project           ${c.dim(active.project_id)}`);
    }
    console.log('');

    // Warning threshold alert
    if (warnThreshold > 0 && runwayPct <= warnThreshold && level !== 'HONK') {
      console.log(
        c.yellow(`  ⚠️  Runway at ${runwayPct}% — below your ${warnThreshold}% warning threshold.`)
      );
      console.log('');
    }

  } else {
    // No active session
    console.log(c.dim('  No active session.'));
    console.log(c.dim('  Run session_start() in your AI tool to begin tracking.'));
    console.log('');
    console.log(
      `  Baseline  ` +
      c.bold(baseline.toLocaleString()) +
      c.dim(' tokens  (set at init)')
    );
    console.log('');
  }

  // ── Recommended action ─────────────────────────────────────────────────────
  const description = GOOSE_LEVEL_DESCRIPTIONS[level] ?? 'Unknown level.';
  console.log(c.dim('  Status'));
  console.log(`    ${levelColour(level, description)}`);
  console.log('');

  // ── Dead Reckoning countdown ───────────────────────────────────────────────
  console.log(c.dim('  Dead Reckoning'));
  if (phase2Remaining > 0) {
    console.log(
      `    ${c.dim(`${sessionsArchived} session${sessionsArchived === 1 ? '' : 's'} archived  ·  `)}` +
      c.bold(`${phase2Remaining} more`) +
      c.dim(` until baseline auto-calibrates`)
    );
  } else {
    console.log(
      `    ${c.green('✓')}  ${c.bold(`${sessionsArchived} sessions`)} archived  ·  ` +
      c.green('Dead Reckoning active')
    );
  }
  console.log('');

  // ── Footer ─────────────────────────────────────────────────────────────────
  console.log(c.dim('  ─────────────────────────────────────────────'));
  console.log(c.dim('  flightplan-mcp init   — reconfigure'));
  console.log(c.dim('  flightplan status     — this screen'));
  console.log(c.dim('  flightplan export     — write RUNWAY_STATE.md'));
  console.log('');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

/**
 * Prints machine-readable JSON to stdout.
 * Used by non-MCP agents (Codex CLI, shell scripts, Augure).
 *
 * Agents that can't use MCP call:
 *   flightplan status --json
 * and parse stdout to get runway awareness without installing anything extra.
 *
 * @param data - StatusData from gatherStatusData()
 */
function printJson(data: StatusData): void {
  const { level, sessionActive, runwayPct, runwayTokens, tokensObserved,
          baseline, warnThreshold, providerName, active,
          sessionsArchived } = data;

  const output = {
    level,
    session_active:          sessionActive,
    window_remaining_pct:    runwayPct,
    window_remaining_tokens: runwayTokens,
    tokens_observed:         tokensObserved,
    baseline_tokens:         baseline,
    warn_threshold_pct:      warnThreshold,
    provider:                active?.provider ?? providerName,
    model:                   active?.model ?? null,
    project_id:              active?.project_id ?? null,
    sessions_archived:       sessionsArchived,
    description:             GOOSE_LEVEL_DESCRIPTIONS[level] ?? '',
  };

  console.log(JSON.stringify(output, null, 2));
}

// ─── Markdown export ──────────────────────────────────────────────────────────

/**
 * Writes RUNWAY_STATE.md to the current working directory.
 *
 * This is the carrier-agnostic bridge — any LLM that can read a file
 * or accept pasted text can consume this snapshot and behave like it
 * has MCP access to Flightplan's state.
 *
 * Usage:
 *   flightplan export                     — writes ./RUNWAY_STATE.md
 *   flightplan export --out ~/docs/state  — writes to a custom path
 *
 * After writing, the user pastes or uploads the file to their LLM of
 * choice (ChatGPT, Gemini, Augure, etc.) and that LLM has full context.
 *
 * @param data - StatusData from gatherStatusData()
 * @param outPath - Where to write the file (default: ./RUNWAY_STATE.md)
 */
function printExport(data: StatusData, outPath: string): void {
  const markdown = generateMarkdown(data);
  fs.writeFileSync(outPath, markdown, 'utf8');

  console.log('');
  console.log(`🪿 Flightplan — Export`);
  console.log('');
  console.log(`  ✓  Written to: ${outPath}`);
  console.log('');
  console.log(`  Paste or upload this file to any LLM for full runway context.`);
  console.log(`  Works with ChatGPT, Gemini, Augure, or any model that reads text.`);
  console.log('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Main entry point. Parses args and routes to the right output function.
 *
 * Commands:
 *   flightplan status           — human display (default)
 *   flightplan status --json    — JSON output
 *   flightplan export           — write RUNWAY_STATE.md
 *   flightplan export --out X   — write to custom path X
 *
 * Errors are caught and printed cleanly — no raw stack traces for the user.
 * The DB-not-found error gets a specific "run init" message.
 */
function main(): void {
  const args    = process.argv.slice(2);
  const command = args[0] ?? 'status';   // default to 'status' if no arg given
  const useJson = args.includes('--json');

  // --out flag: flightplan export --out /some/path/RUNWAY_STATE.md
  // Extract into a named variable first so TypeScript can narrow the type.
  // The ternary condition alone isn't enough — TS still sees string | undefined
  // at the call site even when the condition guards it.
  const outFlagIndex = args.indexOf('--out');
  const outFlagValue = outFlagIndex !== -1 ? args[outFlagIndex + 1] : undefined;
  const outPath = outFlagValue
    ? path.resolve(outFlagValue)
    : path.resolve('RUNWAY_STATE.md');   // default: current working directory

  try {
    // Gather data once — all three output paths consume the same object.
    // This replaces the duplicated DB reads that previously lived in
    // printStatus() and printJson() separately (Tier 2.6).
    const data = gatherStatusData();

    if (command === 'export') {
      printExport(data, outPath);
    } else if (useJson) {
      printJson(data);
    } else {
      printStatus(data);
    }

  } catch (err) {
    if (err instanceof Error && err.message.includes('no such table')) {
      console.error(
        '\n🪿 Flightplan database not found.\n' +
        '   Run: npx flightplan-mcp init\n'
      );
    } else {
      console.error(
        '\n🪿 Status check failed:',
        err instanceof Error ? err.message : err
      );
    }
    process.exit(1);
  }
}

main();
