/**
 * scripts/smoke-test.js — Flightplan smoke test
 *
 * Verifies that the core dependencies load and work correctly.
 * Run this after `npm install` to confirm your environment is ready.
 *
 * Usage:
 *   npm run smoke
 *   node scripts/smoke-test.js
 *
 * What it checks:
 *   1. better-sqlite3 loads and can open an in-memory database.
 *   2. sqlite-vec extension loads without errors.
 *   3. A basic SQL query executes and returns the expected result.
 *   4. Flightplan schema applies cleanly to an in-memory database.
 *
 * Why ESM (import) not CommonJS (require):
 *   package.json has "type": "module" which makes Node treat all .js
 *   files as ESM. require() is not available in ESM — use import instead.
 *   Updated May 4, 2026 after smoke test hit "require is not defined".
 *
 * Why in-memory database (:memory:):
 *   We don't want to create or modify ~/.flightplan/flightplan.db
 *   during testing. :memory: gives us a clean slate every run.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (details printed to stderr)
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─── Run checks ───────────────────────────────────────────────────────────────

console.log('');
console.log('🪿 Flightplan — Smoke Test');
console.log('');

let db;

check('better-sqlite3 loads', () => {
  if (typeof Database !== 'function') {
    throw new Error('better-sqlite3 did not export a constructor');
  }
});

check('Can open in-memory SQLite database', () => {
  db = new Database(':memory:');
  if (!db) throw new Error('Database constructor returned null');
});

check('Basic SQL query executes correctly', () => {
  if (!db) throw new Error('Database not open — see previous failure');
  const result = db.prepare('SELECT 42 AS answer').get();
  if (result.answer !== 42) throw new Error(`Expected 42, got ${result.answer}`);
});

check('sqlite-vec extension loads', () => {
  if (!db) throw new Error('Database not open — see previous failure');
  if (typeof sqliteVec.load !== 'function') {
    throw new Error('sqlite-vec does not export a load() function');
  }
  sqliteVec.load(db);
  const versionRow = db.prepare('SELECT vec_version() AS v').get();
  if (!versionRow || !versionRow.v) {
    throw new Error('sqlite-vec loaded but vec_version() returned nothing');
  }
  console.log(`     sqlite-vec version: ${versionRow.v}`);
});

check('Flightplan schema applies without errors', () => {
  if (!db) throw new Error('Database not open — see previous failure');
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS active_session (
      id TEXT PRIMARY KEY DEFAULT 'current', session_id TEXT,
      started_at TEXT, goose_level TEXT,
      tokens_observed INTEGER NOT NULL DEFAULT 0,
      provider TEXT, model TEXT, project_id TEXT
    );
    INSERT OR IGNORE INTO active_session (id) VALUES ('current');
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
      duration_minutes REAL, tokens_total INTEGER NOT NULL,
      goose_level_final TEXT, provider TEXT, model TEXT,
      project_id TEXT, baseline_at_time INTEGER, notes TEXT
    );
  `);
  const row = db.prepare("SELECT id FROM active_session WHERE id = 'current'").get();
  if (!row) throw new Error('active_session seed row not found after schema apply');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log('');

if (failed === 0) {
  console.log('🪿 Ready for takeoff. Run `npm run build` next.');
  console.log('');
  process.exit(0);
} else {
  console.error('🪿 Grounded. Fix the failures above before proceeding.');
  console.error('');
  process.exit(1);
}
