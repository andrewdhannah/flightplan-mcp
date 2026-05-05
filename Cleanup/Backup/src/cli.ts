/**
 * src/cli.ts — flightplan-mcp init
 *
 * The setup command a user runs once after installing Flightplan.
 * Writes provider, session baseline, and warning threshold to flightplan.db.
 *
 * Design decisions (decided May 2, 2026 — Andrew + Ash):
 *   - Provider-agnostic: no hardcoded plan types. User names their tool.
 *   - User sets their own session baseline: no magic numbers from marketing copy.
 *   - Optional calibration from a pasted transcript: opt-in, costs are disclosed.
 *   - Dead Reckoning (Phase 2) will improve the baseline automatically over time.
 *   - Single flightplan.db output — no separate config file.
 *
 * Usage:
 *   npx flightplan-mcp init
 *   npx flightplan-mcp init --non-interactive  (future: accept env vars)
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { openDb } from './db/connection.js';
import { ensureFlightplanDir } from './db/paths.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The structured result of the init interview.
 * Written to the `config` table as individual key/value rows.
 */
interface InitConfig {
  provider_name: string;      // e.g. "Claude Code", "Codex", "Gemini CLI"
  provider_key: string;       // normalized slug, e.g. "claude_code"
  session_baseline: number;   // token budget per session (user-supplied or default)
  baseline_source: string;    // "default" | "manual" | "calibrated"
  warn_threshold: number;     // 0–100, percentage of runway remaining
  initialized_at: string;     // ISO timestamp
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Conservative token default. Used when user picks "I don't know yet."
 * Named clearly so it's obvious this is a placeholder, not a real limit.
 *
 * Why 40k: sits below every known provider's actual floor so we never
 * overpromise runway. Phase 2 Dead Reckoning will replace this with
 * the user's real observed burn rate.
 */
const CONSERVATIVE_DEFAULT_TOKENS = 40_000;

/**
 * Known providers for the menu. "Other" is always available as a fallback.
 * Add new providers here as they become relevant — keep the list short.
 */
const KNOWN_PROVIDERS = [
  { label: 'Claude Code',  key: 'claude_code' },
  { label: 'Codex (OpenAI)',  key: 'codex' },
  { label: 'Gemini CLI',   key: 'gemini_cli' },
  { label: 'Other',        key: 'other' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes a provider name to a lowercase slug for use as a DB key.
 * "Claude Code" → "claude_code", "My Custom Tool" → "my_custom_tool"
 */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Prints a horizontal rule to visually separate sections.
 */
function rule(): void {
  console.log('─'.repeat(52));
}

/**
 * Prompts the user with a numbered menu and returns the chosen index (1-based).
 * Re-prompts if the input is invalid.
 */
async function pickFromMenu(
  rl: readline.Interface,
  options: readonly string[],
  prompt: string = '> '
): Promise<number> {
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    const n = parseInt(answer, 10);
    if (!isNaN(n) && n >= 1 && n <= options.length) return n;
    console.log(`  Please enter a number between 1 and ${options.length}.`);
  }
}

/**
 * Prompts for a positive integer. Re-prompts if invalid.
 */
async function pickInteger(
  rl: readline.Interface,
  prompt: string,
  min = 1
): Promise<number> {
  while (true) {
    const answer = (await rl.question(prompt)).trim().replace(/[,_]/g, '');
    const n = parseInt(answer, 10);
    if (!isNaN(n) && n >= min) return n;
    console.log(`  Please enter a number greater than or equal to ${min}.`);
  }
}

/**
 * Estimates a token count from a pasted transcript string.
 *
 * This is a rough heuristic — not a real tokenizer. Real tokenizers are
 * model-specific and require the provider's library. This estimate uses
 * word count × 1.35, which approximates GPT/Claude tokenization for
 * English prose to within ~15%. Good enough for a starting baseline.
 *
 * The user is told upfront this is an estimate, and that Dead Reckoning
 * will improve it from real session data.
 */
function estimateTokensFromTranscript(transcript: string): number {
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  // 1.35 tokens per word is a reasonable average for English + code.
  return Math.round(wordCount * 1.35);
}

// ─── Init interview ────────────────────────────────────────────────────────────

/**
 * Runs the three-question init interview and returns a completed InitConfig.
 * This is the human-readable part of init — no DB writes here.
 *
 * Separated from writeConfig() so it can be tested without a real DB,
 * and so the questions can be called from a future --non-interactive path.
 */
async function runInterview(rl: readline.Interface): Promise<InitConfig> {

  // ── Q1: Which AI tool? ────────────────────────────────────────────────────

  console.log('');
  rule();
  console.log('Q1  Which AI tool are you tracking?');
  console.log('');
  KNOWN_PROVIDERS.forEach((p, i) => {
    console.log(`  ${i + 1}  ${p.label}`);
  });
  console.log('');

  const providerChoice = await pickFromMenu(rl, KNOWN_PROVIDERS.map(p => p.label));
  const chosen = KNOWN_PROVIDERS[providerChoice - 1];

  // pickFromMenu guarantees providerChoice is within range, but TypeScript
  // doesn't know that — array access always returns T | undefined with
  // noUncheckedIndexedAccess enabled. This guard satisfies the type checker
  // and protects against any future refactor that breaks that guarantee.
  if (!chosen) {
    throw new Error(`Invalid provider selection: ${providerChoice}`);
  }

  let providerName: string;
  let providerKey: string;

  if (chosen.key === 'other') {
    // Let them name their tool — keeps Flightplan open to any provider.
    providerName = (await rl.question('\n  What should we call it? ')).trim() || 'Other';
    providerKey = toSlug(providerName);
  } else {
    providerName = chosen.label;
    providerKey = chosen.key;
  }

  // ── Q2: Session token budget ───────────────────────────────────────────────

  console.log('');
  rule();
  console.log('Q2  What\'s your rough session token budget?');
  console.log('');
  console.log('  Flightplan watches your real burn rate and improves over time.');
  console.log('  This is just a starting point — you can update it anytime.');
  console.log('');
  console.log(`  1  Use a conservative default (${CONSERVATIVE_DEFAULT_TOKENS.toLocaleString()} tokens)`);
  console.log('  2  Enter a number manually');
  console.log('  3  I\'m on API — I\'ll manage my budget myself');
  console.log('');

  const budgetChoice = await pickFromMenu(rl, ['default', 'manual', 'api']);

  let sessionBaseline: number;
  let baselineSource: string;

  if (budgetChoice === 1) {
    sessionBaseline = CONSERVATIVE_DEFAULT_TOKENS;
    baselineSource = 'default';
    console.log(`\n  ✓ Using ${CONSERVATIVE_DEFAULT_TOKENS.toLocaleString()} tokens as your starting baseline.`);

  } else if (budgetChoice === 2) {
    console.log('');
    sessionBaseline = await pickInteger(rl, '  Enter token budget (e.g. 80000): ', 1_000);
    baselineSource = 'manual';
    console.log(`\n  ✓ Got it — ${sessionBaseline.toLocaleString()} tokens per session.`);

  } else {
    // API mode: use a generous default but flag it as API-managed.
    // The user is responsible for their own budget; Flightplan just tracks burn.
    sessionBaseline = 200_000;
    baselineSource = 'api';
    console.log('\n  ✓ API mode — Flightplan will track burn rate. You manage the budget.');
  }

  // ── Q3: Warning threshold ──────────────────────────────────────────────────

  console.log('');
  rule();
  console.log('Q3  Warn me when my runway drops below:');
  console.log('');
  console.log('  1  25%  (recommended — gives you time to wrap up cleanly)');
  console.log('  2  10%  (minimal — you like to push it)');
  console.log('  3  Custom percentage');
  console.log('  4  No warnings');
  console.log('');

  const warnChoice = await pickFromMenu(rl, ['25', '10', 'custom', 'none']);

  let warnThreshold: number;

  if (warnChoice === 1) {
    warnThreshold = 25;
  } else if (warnChoice === 2) {
    warnThreshold = 10;
  } else if (warnChoice === 3) {
    const pct = await pickInteger(rl, '\n  Warn at what percentage? (1–99): ', 1);
    // Cap at 99 — warning at 100% is meaningless (already full runway).
    warnThreshold = Math.min(pct, 99);
  } else {
    warnThreshold = 0; // 0 = disabled
  }

  if (warnThreshold > 0) {
    console.log(`\n  ✓ Warning at ${warnThreshold}%.`);
  } else {
    console.log('\n  ✓ Warnings disabled.');
  }

  // ── Optional calibration ───────────────────────────────────────────────────

  console.log('');
  rule();
  console.log('Optional  Want a more accurate baseline?');
  console.log('');
  console.log('  Paste a recent session transcript and Flightplan will estimate');
  console.log('  your real burn rate. This costs a small number of tokens to process.');
  console.log('');
  console.log('  Press Enter to skip, or paste your transcript now:');
  console.log('  (When done pasting, press Enter twice on a blank line)');
  console.log('');

  // Collect multi-line paste: read until two consecutive blank lines.
  // This is the standard convention for "done pasting" in CLIs.
  let transcript = '';
  let blankCount = 0;

  while (blankCount < 2) {
    const line = await rl.question('');
    if (line.trim() === '') {
      blankCount++;
    } else {
      blankCount = 0;
      transcript += line + '\n';
    }
  }

  if (transcript.trim().length > 0) {
    const estimated = estimateTokensFromTranscript(transcript);
    console.log(`\n  Estimated burn rate from transcript: ~${estimated.toLocaleString()} tokens`);
    console.log('  (Rough heuristic — Dead Reckoning will refine this from real sessions.)');

    // Only override if the estimate is meaningfully different from current baseline.
    // A transcript-based estimate is more trustworthy than the default, but less
    // trustworthy than manual entry. We accept it if the user had been on default.
    if (baselineSource === 'default') {
      sessionBaseline = estimated;
      baselineSource = 'calibrated';
      console.log(`  ✓ Baseline updated to ${sessionBaseline.toLocaleString()} tokens.`);
    } else {
      console.log(`  ✓ Noted. Your manual baseline (${sessionBaseline.toLocaleString()}) is kept.`);
    }
  }

  return {
    provider_name: providerName,
    provider_key: providerKey,
    session_baseline: sessionBaseline,
    baseline_source: baselineSource,
    warn_threshold: warnThreshold,
    initialized_at: new Date().toISOString(),
  };
}

// ─── DB write ─────────────────────────────────────────────────────────────────

/**
 * Writes the completed InitConfig to the `config` table.
 * Uses INSERT OR REPLACE so re-running init is safe — it updates, never duplicates.
 *
 * Config keys written:
 *   provider_name      — human-readable name ("Claude Code")
 *   provider_key       — slug used by MCP tools ("claude_code")
 *   session_baseline   — token budget as integer string
 *   baseline_source    — how the baseline was set ("default"|"manual"|"calibrated"|"api")
 *   warn_threshold     — percentage as integer string (0 = disabled)
 *   initialized_at     — ISO timestamp of first init
 */
function writeConfig(config: InitConfig): void {
  const db = openDb();

  // Wrap in a transaction so all keys land atomically.
  // If any write fails, none of them land — DB stays consistent.
  const write = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `);

    upsert.run('provider_name',    config.provider_name);
    upsert.run('provider_key',     config.provider_key);
    upsert.run('session_baseline', config.session_baseline.toString());
    upsert.run('baseline_source',  config.baseline_source);
    upsert.run('warn_threshold',   config.warn_threshold.toString());
    upsert.run('initialized_at',   config.initialized_at);
  });

  write();
}

// ─── MCP registration snippet ─────────────────────────────────────────────────

/**
 * Prints the Claude Code config snippet the user needs to paste.
 * We print it rather than auto-writing it because:
 *   1. We don't know where their claude_desktop_config.json lives on all platforms.
 *   2. Auto-writing another tool's config file is rude.
 *   3. The user should see what's being added to their agent's config.
 */
function printRegistrationSnippet(): void {
  console.log('');
  rule();
  console.log('Next step: register Flightplan with your AI tool.');
  console.log('');
  console.log('For Claude Code, add this to claude_desktop_config.json');
  console.log('(usually at ~/Library/Application Support/Claude/claude_desktop_config.json):');
  console.log('');
  console.log('  "mcpServers": {');
  console.log('    "flightplan": {');
  console.log('      "command": "npx",');
  console.log('      "args": ["flightplan-mcp"]');
  console.log('    }');
  console.log('  }');
  console.log('');
  console.log('For other tools, point them at:');
  console.log('  npx flightplan-mcp');
  console.log('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Main init flow. Called when user runs `npx flightplan-mcp init`.
 *
 * Flow:
 *   1. Ensure ~/.flightplan/ exists (idempotent).
 *   2. Run the three-question interview.
 *   3. Write config to flightplan.db.
 *   4. Print success + MCP registration snippet.
 *
 * Errors: if the DB write fails, we catch and print a friendly message.
 * The user can re-run init safely — it's idempotent.
 */
async function main(): Promise<void> {
  console.log('');
  console.log('🪿 Flightplan — Token runway awareness for AI coding sessions');
  console.log('');
  console.log('Welcome. Let\'s get you set up in about 30 seconds.');

  // Ensure the directory exists before we try to open the DB.
  ensureFlightplanDir();

  const rl = readline.createInterface({ input, output, terminal: false });

  try {
    const config = await runInterview(rl);

    console.log('');
    rule();
    console.log('Writing config...');

    writeConfig(config);

    // Confirm what landed.
    console.log('');
    console.log(`✓  flightplan.db ready`);
    console.log(`✓  Provider:          ${config.provider_name}`);
    console.log(`✓  Session baseline:  ${config.session_baseline.toLocaleString()} tokens (${config.baseline_source})`);
    if (config.warn_threshold > 0) {
      console.log(`✓  Warning threshold: ${config.warn_threshold}%`);
    } else {
      console.log(`✓  Warnings:          disabled`);
    }
    console.log('');
    console.log('   Run `flightplan status` to check your runway.');
    console.log('   Your baseline improves automatically after each session.');

    printRegistrationSnippet();

    console.log('🪿 Ready for takeoff.');
    console.log('');

  } catch (err) {
    // Catch Ctrl+C and other readline errors gracefully.
    if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      console.log('\n\n  Init cancelled.');
    } else {
      console.error('\n  Init failed:', err instanceof Error ? err.message : err);
      console.error('  Re-run `npx flightplan-mcp init` to try again.');
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

// Only run if this file is the entry point (not imported as a module).
// `import.meta.url` check is the ESM equivalent of `if __name__ == '__main__'`.
const isMain = process.argv[1]?.endsWith('cli.js') ||
               process.argv[1]?.endsWith('cli.ts');

if (isMain) {
  main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}

export { main as initCommand, runInterview, writeConfig };
