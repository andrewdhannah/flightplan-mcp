#!/usr/bin/env node
/**
 * scripts/insert-test-session.js
 *
 * Manually inserts the Claude Code state_generator test session that was
 * lost when flightplan-mcp init cleared the schema on 2026-05-06.
 *
 * Run once: node scripts/insert-test-session.js
 */

import { createRequire } from 'module';
import { homedir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = join(homedir(), '.flightplan', 'flightplan.db');

const SESSION = {
  session_id:              'cc-2026-05-06-state-gen-test',
  provider:                'Claude Code',
  model:                   'claude-sonnet-4-5',
  project_id:              'flightplan-mcp',
  tokens_total:            16000,
  duration_minutes:        60,
  started_at:              '2026-05-06T00:00:00.000Z',
  ended_at:                '2026-05-06T01:00:00.000Z',
  baseline_at_time:        40000,
  baseline_source_at_time: 'default',
  notes:                   'state_generator test suite — 75 Vitest tests, all passing. Session data lost due to schema migration; inserted manually.',
};

const db = new Database(DB_PATH);

const result = db.prepare(`
  INSERT OR IGNORE INTO usage_snapshots (
    session_id, provider, model, project_id,
    tokens_total, duration_minutes, started_at, ended_at,
    baseline_at_time, baseline_source_at_time, notes
  ) VALUES (
    @session_id, @provider, @model, @project_id,
    @tokens_total, @duration_minutes, @started_at, @ended_at,
    @baseline_at_time, @baseline_source_at_time, @notes
  )
`).run(SESSION);

if (result.changes === 1) {
  console.log('✓ Session inserted.');
  console.log(`  tokens: ${SESSION.tokens_total.toLocaleString()}`);
  console.log(`  duration: ${SESSION.duration_minutes} min`);
} else {
  console.log('⚠ No change — session_id may already exist.');
}

db.close();
