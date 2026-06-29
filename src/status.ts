#!/usr/bin/env node
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

import * as fs from "node:fs";
import * as path from "node:path";
import { openDb } from "./db/connection.js";
import {
  getSessionBaseline,
  getWarnThreshold,
  getProviderName,
  calculateGooseLevel,
  getRunwayPercent,
  GOOSE_LEVEL_DESCRIPTIONS,
  type GooseLevel,
} from "./state/goose_scale.js";
import { generateMarkdown } from "./state/state_generator.js";
import {
  cmdStats,
  cmdCalibrationReport,
  cmdCalibrationCandidates,
  cmdAnomalies,
  cmdEstimate,
  cmdGate,
  cmdReceipt,
  cmdLand,
} from "./commands.js";

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
  reset: (s: string) => (isTTY ? `\x1b[0m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  orange: (s: string) => (isTTY ? `\x1b[38;5;208m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  blue: (s: string) => (isTTY ? `\x1b[34m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

// ─── Level colours ────────────────────────────────────────────────────────────

/**
 * Maps each Goose Level to a colour function.
 * HONK is red because it needs to be unmissable.
 * PREFLIGHT is blue — calm, informational.
 */
function levelColour(level: string, text: string): string {
  switch (level) {
    case "PREFLIGHT":
      return c.blue(text);
    case "CRUISING":
      return c.green(text);
    case "HEADWIND":
      return c.yellow(text);
    case "TURBULENCE":
      return c.orange(text);
    case "HONK":
      return c.red(text);
    case "LANDING":
      return c.dim(text);
    case "REFUELLED":
      return c.green(text);
    case "WAYWARD":
      return c.cyan(text);
    default:
      return text;
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
  const filled = Math.round((1 - pctRemaining / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${levelColour(level, bar)}]`;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

/**
 * Shape of one active_session row read from the DB.
 * Used by gatherStatusData() and passed into rendering functions.
 */
interface ActiveSessionRow {
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
  level: GooseLevel;
  /** Whether a session is currently open. */
  sessionActive: boolean;
  /** Runway remaining as a percentage (0–100). */
  runwayPct: number;
  /** Runway remaining in tokens. */
  runwayTokens: number;
  /** Tokens observed so far in this session. */
  tokensObserved: number;
  /** User's session token baseline (from config). */
  baseline: number;
  /** Warning threshold percentage (0 = disabled). */
  warnThreshold: number;
  /** Human-readable provider name from config. */
  providerName: string;
  /** Raw active_session row — null fields mean no session is open. */
  active: ActiveSessionRow | undefined;
  /** Total sessions archived in usage_snapshots. */
  sessionsArchived: number;
  /** Sessions remaining until Phase 2 Dead Reckoning unlocks (0 = active). */
  phase2Remaining: number;
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
  const baseline = getSessionBaseline(db);
  const warnThreshold = getWarnThreshold(db);
  const providerName = getProviderName(db);

  // Active session read
  const active = db
    .prepare(
      `
    SELECT session_id, started_at, goose_level, tokens_observed,
           provider, model, project_id,
           plan_id, work_order_id, work_session_id, agent
    FROM active_session
    WHERE id = 'current'
  `,
    )
    .get() as ActiveSessionRow | undefined;

  // Derived values
  const sessionActive = !!active?.session_id;
  const tokensObserved = active?.tokens_observed ?? 0;
  const level = calculateGooseLevel(tokensObserved, baseline, sessionActive);
  const runwayPct = sessionActive
    ? getRunwayPercent(tokensObserved, baseline)
    : 100;
  const runwayTokens = Math.max(0, baseline - tokensObserved);

  // Session archive count
  const countRow = db
    .prepare(`SELECT COUNT(*) as n FROM usage_snapshots`)
    .get() as { n: number };

  const sessionsArchived = countRow.n;
  const phase2Remaining = Math.max(0, 5 - sessionsArchived);

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

  // ── Header ─────────────────────────────────────────────────────────────────
  console.log("");
  console.log(
    c.bold("🪿 Flightplan") +
      c.dim("  ·  ") +
      levelColour(level, c.bold(level)) +
      c.dim("  ·  ") +
      c.dim(providerName),
  );
  console.log("");

  // ── Progress bar ───────────────────────────────────────────────────────────
  if (sessionActive) {
    const bar = renderBar(runwayPct, level);
    console.log(
      `  ${bar}  ` +
        levelColour(level, c.bold(`${runwayPct}%`)) +
        c.dim(" remaining"),
    );
    console.log("");
  }

  // ── Session details ────────────────────────────────────────────────────────
  if (sessionActive) {
    const startedAt = active?.started_at ?? "";
    const durationMs = startedAt
      ? new Date().getTime() - new Date(startedAt).getTime()
      : 0;
    const durationMins = Math.round(durationMs / 60000);

    console.log(c.dim("  Session"));
    console.log(
      `    Tokens observed   ` +
        c.bold(tokensObserved.toLocaleString()) +
        c.dim(` / ${baseline.toLocaleString()} baseline`),
    );
    console.log(
      `    Runway remaining  ` +
        levelColour(level, c.bold(runwayTokens.toLocaleString())) +
        c.dim(" tokens"),
    );
    console.log(`    Duration          ` + c.bold(`${durationMins} min`));
    if (active?.model) {
      console.log(`    Model             ${c.dim(active.model)}`);
    }
    if (active?.project_id) {
      console.log(`    Project           ${c.dim(active.project_id)}`);
    }
    if (active?.plan_id) {
      console.log(`    Plan              ${c.dim(active.plan_id)}`);
    }
    if (active?.work_order_id) {
      console.log(`    Work Order        ${c.dim(active.work_order_id)}`);
    }
    if (active?.work_session_id) {
      console.log(`    Work Session      ${c.dim(active.work_session_id)}`);
    }
    if (active?.agent) {
      console.log(`    Agent             ${c.dim(active.agent)}`);
    }
    console.log("");

    // Warning threshold alert
    if (warnThreshold > 0 && runwayPct <= warnThreshold && level !== "HONK") {
      console.log(
        c.yellow(
          `  ⚠️  Runway at ${runwayPct}% — below your ${warnThreshold}% warning threshold.`,
        ),
      );
      console.log("");
    }
  } else {
    // No active session — but differentiate between brand new and experienced user.
    // A new install has 0 archived sessions. An experienced user has sessions banked.
    // Showing the same message for both is confusing — fix that here.
    if (sessionsArchived === 0) {
      // Genuinely new — no history at all
      console.log(c.dim("  No session data yet — observation mode active."));
      console.log(
        c.dim("  Run session_start() in your AI tool to begin tracking."),
      );
    } else {
      // Has history — just not currently active
      console.log(
        `  ${c.dim(`${sessionsArchived} session${sessionsArchived === 1 ? "" : "s"} archived.`)}` +
          c.dim("  No session currently active."),
      );
      console.log(
        c.dim("  Run session_start() in your AI tool to begin a new session."),
      );
    }
    console.log("");
    console.log(
      `  Baseline  ` +
        c.bold(baseline.toLocaleString()) +
        c.dim(" tokens  (set at init)"),
    );
    console.log("");
  }

  // ── Recommended action ─────────────────────────────────────────────────────
  // For PREFLIGHT, we build a context-aware message instead of using the
  // static description — because the static version always says "No session
  // data yet" even when the user has archived sessions.
  const description =
    level === "PREFLIGHT" && sessionsArchived > 0
      ? `${sessionsArchived} session${sessionsArchived === 1 ? "" : "s"} archived. Call session_start() to begin tracking.`
      : (GOOSE_LEVEL_DESCRIPTIONS[level] ?? "Unknown level.");
  console.log(c.dim("  Status"));
  console.log(`    ${levelColour(level, description)}`);
  console.log("");

  // ── Dead Reckoning countdown ───────────────────────────────────────────────
  console.log(c.dim("  Dead Reckoning"));
  if (phase2Remaining > 0) {
    console.log(
      `    ${c.dim(`${sessionsArchived} session${sessionsArchived === 1 ? "" : "s"} archived  ·  `)}` +
        c.bold(`${phase2Remaining} more`) +
        c.dim(` until baseline auto-calibrates`),
    );
  } else {
    console.log(
      `    ${c.green("✓")}  ${c.bold(`${sessionsArchived} sessions`)} archived  ·  ` +
        c.green("Dead Reckoning active"),
    );
  }
  console.log("");

  // ── Footer ─────────────────────────────────────────────────────────────────
  console.log(c.dim("  ─────────────────────────────────────────────"));
  console.log(c.dim("  flightplan-mcp init   — reconfigure"));
  console.log(c.dim("  flightplan status     — this screen"));
  console.log(c.dim("  flightplan export     — write RUNWAY_STATE.md"));
  console.log("");
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
  } = data;

  const output = {
    level,
    session_active: sessionActive,
    window_remaining_pct: runwayPct,
    window_remaining_tokens: runwayTokens,
    tokens_observed: tokensObserved,
    baseline_tokens: baseline,
    warn_threshold_pct: warnThreshold,
    provider: active?.provider ?? providerName,
    model: active?.model ?? null,
    project_id: active?.project_id ?? null,
    sessions_archived: sessionsArchived,
    description: GOOSE_LEVEL_DESCRIPTIONS[level] ?? "",
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
  fs.writeFileSync(outPath, markdown, "utf8");

  console.log("");
  console.log(`🪿 Flightplan — Export`);
  console.log("");
  console.log(`  ✓  Written to: ${outPath}`);
  console.log("");
  console.log(
    `  Paste or upload this file to any LLM for full runway context.`,
  );
  console.log(
    `  Works with ChatGPT, Gemini, Augure, or any model that reads text.`,
  );
  console.log("");
}

// ─── Help system ───────────────────────────────────────────────────────────────

/**
 * Exit codes:
 *   0 = success
 *   1 = user/input/runtime error (missing args, invalid input, runtime failure)
 *   2 = validation/configuration error (DB schema, config issues)
 */

const HELP_TEXTS: Record<string, string> = {
  status: `Usage: flightplan status [--json]

Show current token runway state.

Options:
  --json     Machine-readable JSON output

Examples:
  flightplan status          Human-readable status display
  flightplan status --json   JSON for non-MCP agents

Exit codes:
  0  Success
  1  Runtime error (DB not found, etc.)`,
  export: `Usage: flightplan export [--out <path>]

Write current runway state as Markdown for any LLM to read.

Options:
  --out <path>  Custom output path (default: ./RUNWAY_STATE.md)

Examples:
  flightplan export                Write to ./RUNWAY_STATE.md
  flightplan export --out /tmp/    Write to /tmp/RUNWAY_STATE.md

Exit codes:
  0  Success
  1  Runtime error`,
  stats: `Usage: flightplan stats [--json]

Show aggregate usage statistics across all sessions.

Options:
  --json     Machine-readable JSON output

Examples:
  flightplan stats            Human-readable stats summary
  flightplan stats --json     JSON for programmatic use

Exit codes:
  0  Success
  1  Runtime error`,
  calibration: `Usage: flightplan calibration <subcommand> [--json]

Calibration eligibility management for Dead Reckoning.

Subcommands:
  report       Show calibration eligibility report (default)
  candidates   List calibration-eligible sessions

Options:
  --json     Machine-readable JSON output

Examples:
  flightplan calibration report          Human-readable report
  flightplan calibration candidates      List eligible sessions
  flightplan calibration report --json

Exit codes:
  0  Success
  1  Runtime error`,
  anomalies: `Usage: flightplan anomalies [--json]

Detect anomalous sessions (idle skew, zero-token, missing metadata).

Options:
  --json     Machine-readable JSON output

Examples:
  flightplan anomalies             Human-readable anomaly report
  flightplan anomalies --json      JSON for programmatic use

Exit codes:
  0  Success
  1  Runtime error`,
  estimate: `Usage: flightplan estimate --model <model> --provider <provider> [--project <project>] [--json]

Estimate token runway needed for a proposed task using historical data.

Required:
  --model <model>         Model name (e.g. deepseek-v4-flash)
  --provider <provider>   AI provider (e.g. OpenWork)

Options:
  --project <project>     Project name for scoped estimate
  --json                  Machine-readable JSON output

Examples:
  flightplan estimate --model deepseek-v4-flash --provider OpenWork
  flightplan estimate --model gpt-4 --provider OpenAI --project MyApp --json

Error behavior:
  Missing --model or --provider exits with code 1.
  If no historical data, falls back to configured baseline (WAYWARD confidence).

Exit codes:
  0  Success
  1  Missing required arguments or runtime error`,
  gate: `Usage: flightplan gate --model <model> --provider <provider> [--project <project>] [--work-type <type>] [--json]

Check governed runway decision before starting work.

Required:
  --model <model>         Model name (e.g. deepseek-v4-flash)
  --provider <provider>   AI provider (e.g. OpenWork)

Options:
  --project <project>     Project name for scoped estimate
  --work-type <type>      Type of work (e.g. sprint, refactor)
  --json                  Machine-readable JSON output

Decisions:
  proceed                  Normal work allowed
  proceed_with_checkpoint  Work allowed, checkpoint first
  split                    Split into smaller units
  land_first               Land before starting new work
  refuse                   Cannot proceed

Examples:
  flightplan gate --model deepseek-v4-flash --provider OpenWork --work-type sprint
  flightplan gate --model gpt-4 --provider OpenAI --json

Exit codes:
  0  Success
  1  Missing required arguments or runtime error`,
  receipt: `Usage: flightplan receipt (--last | --session <id>) [--json] [--out <path>]

Export a deterministic session receipt.

Options:
  --last                 Get the most recent session receipt
  --session <id>         Get receipt for a specific session ID
  --json                 Machine-readable JSON output (to stdout)
  --out <path>           Write receipt to file (always JSON)

Examples:
  flightplan receipt --last                  Show most recent receipt
  flightplan receipt --last --json           JSON to stdout
  flightplan receipt --session <id> --json
  flightplan receipt --last --out receipt.json

Exit codes:
  0  Success
  1  Missing required arguments or runtime error`,
  land: `Usage: flightplan land [--tokens-total <n>] [--outcome <o>] [--json]

Assess whether the current session needs to land.

Options:
  --tokens-total <n>     Optional token total for landing assessment
  --outcome <o>          Session outcome (completed|checkpointed|stale|blocked|aborted|honk)
  --json                 Machine-readable JSON output

Examples:
  flightplan land                    Check if landing is needed
  flightplan land --json             JSON output
  flightplan land --tokens-total 50000 --outcome completed --json

Exit codes:
  0  Success
  1  Runtime error`,
};

function showHelp(command: string): void {
  const help = HELP_TEXTS[command];
  if (help) {
    console.log(help);
    return;
  }

  // Default: show general help
  console.log(`🪿 Flightplan MCP — Token Runway Governor

Usage:
  flightplan <command> [options]

Commands:
  status                        Show current runway state
  stats                         Show aggregate usage statistics
  calibration                   Calibration eligibility management
  anomalies                     Detect anomalous sessions
  estimate                      Estimate token runway for a task
  gate                          Check governed runway decision
  receipt                       Export session receipt
  land                          Assess landing status
  export                        Write RUNWAY_STATE.md for any LLM

Global options:
  --json                        Machine-readable JSON output
  --help                        Show help for any command

Run "flightplan <command> --help" for command-specific help.
`);
}

function printJsonError(code: string, message: string): void {
  console.log(JSON.stringify({
    ok: false,
    error: { code, message },
  }, null, 2));
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
  const args = process.argv.slice(2);
  const command = args[0] ?? "status"; // default to 'status' if no arg given
  const useJson = args.includes("--json");
  const wantsHelp = args.includes("--help") || args.includes("-h");

  // --out flag: flightplan export --out /some/path/RUNWAY_STATE.md
  const outFlagIndex = args.indexOf("--out");
  const outFlagValue = outFlagIndex !== -1 ? args[outFlagIndex + 1] : undefined;
  const outPath = outFlagValue
    ? path.resolve(outFlagValue)
    : path.resolve("RUNWAY_STATE.md");

  try {
    // ─── Help routing ───────────────────────────────────────────────────────
    // Every command supports --help. Catch it before any logic runs.
    const helpCommands = new Set([
      "status", "export", "stats", "calibration", "anomalies",
      "estimate", "gate", "receipt", "land",
    ]);

    if (wantsHelp && helpCommands.has(command)) {
      showHelp(command);
      return;
    }

    if (command === "--help" || command === "-h") {
      showHelp("");
      return;
    }

    // ─── Route to commands ──────────────────────────────────────────────────
    if (command === "stats") {
      cmdStats(useJson);
      return;
    }

    if (command === "calibration") {
      const sub = args[1];
      // Subcommand help: flightplan calibration --help
      if (wantsHelp || sub === "--help" || sub === "-h") {
        showHelp("calibration");
        return;
      }
      if (sub === "report") {
        cmdCalibrationReport(useJson);
      } else if (sub === "candidates") {
        cmdCalibrationCandidates(useJson);
      } else {
        cmdCalibrationReport(useJson);
      }
      return;
    }

    if (command === "anomalies") {
      cmdAnomalies(useJson);
      return;
    }

    if (command === "estimate") {
      const modelIdx = args.indexOf("--model");
      const providerIdx = args.indexOf("--provider");
      const projectIdx = args.indexOf("--project");
      const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
      const provider = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
      const project = projectIdx !== -1 ? args[projectIdx + 1] : undefined;

      if (!model || !provider) {
        if (useJson) {
          printJsonError("MISSING_REQUIRED_ARGUMENT", "Missing required argument: --model and --provider are required");
        } else {
          console.error("Usage: flightplan estimate --model <model> --provider <provider> [--project <project>]");
        }
        process.exit(1);
      }
      cmdEstimate(model, provider, project, useJson);
      return;
    }

    if (command === "gate") {
      const modelIdx = args.indexOf("--model");
      const providerIdx = args.indexOf("--provider");
      const projectIdx = args.indexOf("--project");
      const workTypeIdx = args.indexOf("--work-type");
      const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
      const provider = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
      const project = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
      const workType = workTypeIdx !== -1 ? args[workTypeIdx + 1] : undefined;

      if (!model || !provider) {
        if (useJson) {
          printJsonError("MISSING_REQUIRED_ARGUMENT", "Missing required argument: --model and --provider are required");
        } else {
          console.error("Usage: flightplan gate --model <model> --provider <provider> [--project <project>] [--work-type <type>]");
        }
        process.exit(1);
      }
      cmdGate(model, provider, project, workType, useJson);
      return;
    }

    if (command === "receipt") {
      const sessionIdx = args.indexOf("--session");
      const hasLast = args.includes("--last");
      const sessionId = sessionIdx !== -1 ? args[sessionIdx + 1] : undefined;
      const outPathReceipt = outFlagValue ? path.resolve(outFlagValue) : undefined;

      if (!sessionId && !hasLast) {
        if (useJson) {
          printJsonError("MISSING_REQUIRED_ARGUMENT", "Missing required argument: use --last or --session <id>");
        } else {
          console.error("Usage: flightplan receipt --last [--json] [--out <path>]");
          console.error("       flightplan receipt --session <session_id> [--json]");
        }
        process.exit(1);
      }
      cmdReceipt(sessionId, outPathReceipt, useJson);
      return;
    }

    if (command === "land") {
      const tokensIdx = args.indexOf("--tokens-total");
      const outcomeIdx = args.indexOf("--outcome");
      const tokensTotal = tokensIdx !== -1 ? parseInt(args[tokensIdx + 1] ?? '', 10) : undefined;
      const outcome = outcomeIdx !== -1 ? args[outcomeIdx + 1] : undefined;

      cmdLand(
        isNaN(tokensTotal as number) ? undefined : tokensTotal,
        outcome,
        useJson,
      );
      return;
    }

    // ─── Legacy commands ────────────────────────────────────────────────────
    const data = gatherStatusData();

    if (command === "export") {
      printExport(data, outPath);
    } else if (command === "status" || command === "") {
      if (useJson) {
        printJson(data);
      } else {
        printStatus(data);
      }
    } else {
      // Unknown command
      if (useJson) {
        printJsonError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
      } else {
        console.error(`🪿 Unknown command: ${command}`);
        console.error(`Run "flightplan --help" to see available commands.`);
      }
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("no such table")) {
      const msg = "\n🪿 Flightplan database not found.\n  Run: npx flightplan-mcp init\n";
      if (useJson) {
        printJsonError("DATABASE_NOT_FOUND", "Flightplan database not found. Run: npx flightplan-mcp init");
      } else {
        console.error(msg);
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      if (useJson) {
        printJsonError("RUNTIME_ERROR", msg);
      } else {
        console.error("\n🪿 Status check failed:", msg);
      }
    }
    process.exit(1);
  }
}

main();
