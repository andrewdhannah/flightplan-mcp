/**
 * src/commands.ts — New CLI command handlers
 *
 * Handles the analytics, gate, estimate, receipt, and landing CLI commands.
 * All commands support --json output for machine consumption.
 *
 * Usage:
 *   flightplan stats                           — human-readable stats
 *   flightplan stats --json                    — machine-readable
 *   flightplan calibration report              — calibration report
 *   flightplan calibration report --json
 *   flightplan calibration candidates          — list candidates
 *   flightplan calibration candidates --json
 *   flightplan anomalies                       — anomaly report
 *   flightplan anomalies --json
 *   flightplan estimate --model M --provider P [--project X]
 *   flightplan estimate --model M --provider P --json
 *   flightplan gate --model M --provider P [--project X] [--work-type W]
 *   flightplan gate --json
 *   flightplan receipt --last
 *   flightplan receipt --last --json
 *   flightplan receipt --session S --json
 *   flightplan land [--tokens-total N] [--outcome O] [--json]
 */

import { openDb } from './db/connection.js';
import { calculateStats } from './analytics/stats.js';
import { generateCalibrationReport, getCalibrationCandidates } from './analytics/calibration.js';
import { detectAllAnomalies } from './analytics/anomalies.js';
import { estimateTokens } from './analytics/dead_reckoning.js';
import { evaluateGate } from './analytics/gates.js';
import { generateLastReceipt, generateReceipt } from './analytics/receipts.js';
import { assessLanding } from './analytics/landing.js';

// ─── Stats command ───────────────────────────────────────────────────────────

export function cmdStats(useJson: boolean): void {
  const db = openDb();
  const stats = calculateStats(db);

  if (useJson) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Usage Statistics\n`);
  console.log(`  Total sessions:       ${stats.total_sessions}`);
  console.log(`  Nonzero sessions:     ${stats.nonzero_sessions}`);
  console.log(`  Total tokens:         ${stats.total_tokens.toLocaleString()}`);
  console.log(`  Average (nonzero):    ${stats.average_tokens_per_nonzero_session.toLocaleString()}`);
  console.log(`  Min tokens:           ${stats.min_tokens.toLocaleString()}`);
  console.log(`  Max tokens:           ${stats.max_tokens.toLocaleString()}`);
  console.log(`\n  Sessions by model:`);
  for (const [model, count] of Object.entries(stats.sessions_by_model)) {
    console.log(`    ${model}: ${count}`);
  }
  console.log(`\n  Sessions by provider:`);
  for (const [provider, count] of Object.entries(stats.sessions_by_provider)) {
    console.log(`    ${provider}: ${count}`);
  }
  console.log(`\n  Sessions by project:`);
  for (const [project, count] of Object.entries(stats.sessions_by_project)) {
    console.log(`    ${project}: ${count}`);
  }
  console.log(`\n  Token buckets:`);
  for (const [bucket, count] of Object.entries(stats.token_buckets)) {
    if (count > 0) console.log(`    ${bucket}: ${count}`);
  }
  console.log('');
}

// ─── Calibration commands ────────────────────────────────────────────────────

export function cmdCalibrationReport(useJson: boolean): void {
  const db = openDb();
  const report = generateCalibrationReport(db);

  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Calibration Report\n`);
  console.log(`  Total sessions:     ${report.total_sessions}`);
  console.log(`  Eligible:           ${report.eligible_sessions}`);
  console.log(`  Excluded:           ${report.excluded_sessions}`);
  if (report.token_baseline_stats) {
    console.log(`\n  Token baselines (eligible):`);
    console.log(`    p50:  ${report.token_baseline_stats.p50.toLocaleString()}`);
    console.log(`    p80:  ${report.token_baseline_stats.p80.toLocaleString()}`);
    console.log(`    p95:  ${report.token_baseline_stats.p95.toLocaleString()}`);
  }
  console.log(`\n  ${report.summary}`);

  if (report.exclusions.length > 0) {
    console.log(`\n  Exclusions:`);
    for (const ex of report.exclusions) {
      console.log(`    ${ex.session_id}:`);
      for (const reason of ex.reasons) {
        console.log(`      - ${reason}`);
      }
    }
  }
  console.log('');
}

export function cmdCalibrationCandidates(useJson: boolean): void {
  const db = openDb();
  const candidates = getCalibrationCandidates(db);

  if (useJson) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Calibration Candidates\n`);
  if (candidates.length === 0) {
    console.log('  No calibration-eligible sessions found.\n');
    return;
  }
  console.log(`  ${candidates.length} candidate(s):\n`);
  for (const c of candidates) {
    console.log(`    ${c.session_id}`);
    console.log(`      Tokens: ${c.tokens_total.toLocaleString()}`);
    console.log(`      Duration: ${c.duration_minutes} min`);
    console.log(`      Provider: ${c.provider}`);
    console.log(`      Model: ${c.model}`);
    if (c.outcome) console.log(`      Outcome: ${c.outcome}`);
    console.log('');
  }
}

// ─── Anomalies command ──────────────────────────────────────────────────────

export function cmdAnomalies(useJson: boolean): void {
  const db = openDb();
  const report = detectAllAnomalies(db);

  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Anomaly Detection\n`);
  console.log(`  Total sessions:     ${report.total_sessions}`);
  console.log(`  Anomalous sessions: ${report.anomalous_sessions}`);

  if (report.sessions.length > 0) {
    console.log('');
    for (const s of report.sessions) {
      console.log(`  ${s.session_id}:`);
      for (const a of s.anomalies) {
        console.log(`    ⚠️  ${a}`);
      }
      console.log('');
    }
  } else {
    console.log('  No anomalies detected.\n');
  }
}

// ─── Estimate command ────────────────────────────────────────────────────────

export function cmdEstimate(
  model: string,
  provider: string,
  project: string | undefined,
  useJson: boolean,
): void {
  const db = openDb();
  const result = estimateTokens(db, { model, provider, project });

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Token Estimate\n`);
  console.log(`  Model:    ${model}`);
  console.log(`  Provider: ${provider}`);
  if (project) console.log(`  Project:  ${project}`);
  console.log('');
  console.log(`  Estimated tokens:`);
  console.log(`    p50: ${result.estimated_tokens.p50.toLocaleString()}`);
  console.log(`    p80: ${result.estimated_tokens.p80.toLocaleString()}`);
  console.log(`    p95: ${result.estimated_tokens.p95.toLocaleString()}`);
  console.log(`\n  Confidence: ${result.confidence}`);
  console.log(`  Matching sessions: ${result.historical_basis.matching_sessions}`);
  console.log(`  Match scope: ${result.historical_basis.scope}`);
  if (result.fallback_used) console.log(`  ⚠️  Fallback baseline used`);
  console.log('');
}

// ─── Gate command ────────────────────────────────────────────────────────────

export function cmdGate(
  model: string,
  provider: string,
  project: string | undefined,
  workType: string | undefined,
  useJson: boolean,
): void {
  const db = openDb();
  const result = evaluateGate(db, {
    model,
    provider,
    project_id: project,
    work_type: workType,
  });

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Runway Gate\n`);
  console.log(`  Decision:     ${result.decision.toUpperCase()}`);
  console.log(`  Goose Level:  ${result.goose_level}`);
  console.log(`  Confidence:   ${result.confidence}`);
  console.log('');
  console.log(`  ${result.recommended_action}`);
  console.log('');
  console.log(`  Policy reasons:`);
  for (const r of result.policy_reasons) {
    console.log(`    • ${r}`);
  }
  if (result.work_tags) {
    console.log(`\n  Work tags:`);
    for (const [k, v] of Object.entries(result.work_tags)) {
      console.log(`    ${k}: ${v}`);
    }
  }
  console.log('');
}

// ─── Receipt command ─────────────────────────────────────────────────────────

import * as fs from 'node:fs';

export function cmdReceipt(
  sessionId: string | undefined,
  outPath: string | undefined,
  useJson: boolean,
): void {
  const db = openDb();

  let receipt;
  if (sessionId) {
    receipt = generateReceipt(db, sessionId);
  } else {
    receipt = generateLastReceipt(db);
  }

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`\n  ✓  Receipt written to: ${outPath}\n`);
    return;
  }

  if (useJson) {
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Session Receipt\n`);
  console.log(`  Session:          ${receipt.session_id}`);
  console.log(`  Provider:         ${receipt.provider ?? '—'}`);
  console.log(`  Model:            ${receipt.model ?? '—'}`);
  if (receipt.project_id) console.log(`  Project:          ${receipt.project_id}`);
  if (receipt.plan_id) console.log(`  Plan:             ${receipt.plan_id}`);
  if (receipt.work_order_id) console.log(`  Work Order:       ${receipt.work_order_id}`);
  if (receipt.agent) console.log(`  Agent:            ${receipt.agent}`);
  console.log(`  Started:          ${receipt.started_at}`);
  console.log(`  Ended:            ${receipt.ended_at}`);
  console.log(`  Duration:         ${receipt.duration_minutes} min`);
  console.log(`  Tokens:           ${receipt.tokens_total_reported.toLocaleString()}`);
  console.log(`  Goose Level:      ${receipt.goose_level_final}`);
  if (receipt.outcome) console.log(`  Outcome:          ${receipt.outcome}`);
  console.log(`  Calibration:      ${receipt.calibration_eligible ? 'Eligible' : 'Excluded'}`);
  console.log(`\n  Receipt type:     ${receipt.receipt_type}`);
  console.log(`  Schema version:   ${receipt.schema_version}`);
  console.log('');
}

// ─── Land command ────────────────────────────────────────────────────────────

export function cmdLand(
  tokensTotal: number | undefined,
  outcome: string | undefined,
  useJson: boolean,
): void {
  const db = openDb();
  const result = assessLanding(db, {
    tokens_total: tokensTotal,
    outcome,
  });

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n🪿 Flightplan — Landing Assessment\n`);
  console.log(`  Level:            ${result.level}`);
  console.log(`  Landing required: ${result.landing_required ? 'YES' : 'No'}`);
  console.log(`  Can record:       ${result.can_record ? 'Yes' : 'No'}`);
  if (result.missing.length > 0) {
    console.log(`  Missing:          ${result.missing.join(', ')}`);
  }
  console.log(`\n  ${result.recommended_action}\n`);
}
