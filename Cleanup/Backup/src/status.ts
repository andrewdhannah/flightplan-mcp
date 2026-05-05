/**
 * src/status.ts — flightplan status CLI
 *
 * Human-facing runway display. Run this to see your current token runway
 * in a readable format. This is NOT the MCP server — it's a separate
 * binary for the person sitting at the keyboard.
 *
 * Usage:
 *   flightplan status          — show current runway
 *   flightplan status --json   — machine-readable output (for scripts/agents
 *                                that don't use MCP, e.g. Augere, Codex CLI)
 *
 * Two binaries, two jobs:
 *   flightplan-mcp   — MCP server, called by AI agents (src/index.ts)
 *   flightplan       — status CLI, called by humans (this file)
 *
 * Design goals:
 *   - Glanceable: most important info at the top
 *   - No scrolling required for the happy path
 *   - Goose emoji because this is Flightplan and the 🪿 stays
 *   - --json flag makes it useful for non-MCP agents (Augere, shell scripts)
 */

import { openDb } from './db/connection.js';
import {
  getSessionBaseline,
  getWarnThreshold,
  getProviderName,
  calculateGooseLevel,
  getRunwayPercent,
  GOOSE_LEVEL_DESCRIPTIONS,
} from './state/goose_scale.js';

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

// ─── Active session row ───────────────────────────────────────────────────────

interface ActiveSessionRow {
  session_id:      string | null;
  started_at:      string | null;
  goose_level:     string | null;
  tokens_observed: number;
  provider:        string | null;
  model:           string | null;
  project_id:      string | null;
}

// ─── Status display ───────────────────────────────────────────────────────────

/**
 * Reads the DB and prints a human-readable status display.
 *
 * Output sections:
 *   1. Header — goose emoji, level, provider
 *   2. Progress bar — visual runway remaining
 *   3. Session details — tokens, baseline, duration if active
 *   4. Recommended action — what to do right now
 *   5. Formation Trust countdown — sessions until Phase 2 unlocks
 *   6. Footer — db path, how to get help
 */
function printStatus(): void {
  const db = openDb();

  // Read config
  const baseline      = getSessionBaseline(db);
  const warnThreshold = getWarnThreshold(db);
  const providerName  = getProviderName(db);

  // Read active session
  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  const sessionActive  = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;

  // Calculate level and runway
  const level      = calculateGooseLevel(tokensObserved, baseline, sessionActive);
  const runwayPct  = sessionActive ? getRunwayPercent(tokensObserved, baseline) : 100;
  const runwayToks = Math.max(0, baseline - tokensObserved);

  // Session count for Phase 2 countdown
  const countRow = db.prepare(
    `SELECT COUNT(*) as n FROM usage_snapshots`
  ).get() as { n: number };
  const sessionsArchived = countRow.n;
  const phase2Remaining  = Math.max(0, 5 - sessionsArchived);

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
    const startedAt      = active?.started_at ?? '';
    const durationMs     = startedAt
      ? new Date().getTime() - new Date(startedAt).getTime()
      : 0;
    const durationMins   = Math.round(durationMs / 60_000);

    console.log(c.dim('  Session'));
    console.log(
      `    Tokens observed   ` +
      c.bold(tokensObserved.toLocaleString()) +
      c.dim(` / ${baseline.toLocaleString()} baseline`)
    );
    console.log(
      `    Runway remaining  ` +
      levelColour(level, c.bold(runwayToks.toLocaleString())) +
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

  // ── Formation Trust / Phase 2 countdown ───────────────────────────────────
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
  console.log('');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

/**
 * Prints machine-readable JSON status.
 * Used by non-MCP agents (Augere, Codex CLI, shell scripts).
 *
 * This is the same data as the human display, just structured.
 * Agents that can't use MCP can call: flightplan status --json
 * and parse the output to get runway awareness.
 */
function printJson(): void {
  const db = openDb();

  const baseline      = getSessionBaseline(db);
  const warnThreshold = getWarnThreshold(db);
  const providerName  = getProviderName(db);

  const active = db.prepare(`
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id
    FROM active_session
    WHERE id = 'current'
  `).get() as ActiveSessionRow | undefined;

  const sessionActive  = !!(active?.session_id);
  const tokensObserved = active?.tokens_observed ?? 0;
  const level          = calculateGooseLevel(tokensObserved, baseline, sessionActive);
  const runwayPct      = sessionActive ? getRunwayPercent(tokensObserved, baseline) : 100;
  const runwayTokens   = Math.max(0, baseline - tokensObserved);

  const countRow = db.prepare(
    `SELECT COUNT(*) as n FROM usage_snapshots`
  ).get() as { n: number };

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
    sessions_archived:       countRow.n,
    description:             GOOSE_LEVEL_DESCRIPTIONS[level] ?? '',
  };

  console.log(JSON.stringify(output, null, 2));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Main entry point.
 * Checks for --json flag and routes to the appropriate output function.
 * Errors are caught and printed cleanly — no raw stack traces for the user.
 */
function main(): void {
  const args    = process.argv.slice(2);
  const useJson = args.includes('--json');

  try {
    if (useJson) {
      printJson();
    } else {
      printStatus();
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
