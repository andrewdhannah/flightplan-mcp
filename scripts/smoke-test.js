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
 *   4. Flightplan schema (imported from dist/) applies cleanly.
 *      Requires `npm run build` to have run first.
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
 * Why import schema from dist/ (not inline):
 *   The previous version inlined a copy of the DDL that drifted from
 *   production — it was missing flightplan_meta and Phase-2 columns.
 *   Importing from dist/ means smoke can never silently test the wrong schema.
 *   Bug caught and fixed May 5, 2026 — Audit Tier 1.4.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (details printed to stderr)
 */

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// ─── Pre-flight: dist/ must exist ─────────────────────────────────────────────

// The schema check imports from dist/. If the build hasn't run, fail loudly
// here rather than letting the import silently fail later with a confusing error.
if (!existsSync('./dist/db/schema.js')) {
  console.error('');
  console.error('🪿 Grounded. dist/db/schema.js not found.');
  console.error('   Run `npm run build` before `npm run smoke`.');
  console.error('');
  process.exit(1);
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Runs a named check. Supports both sync and async functions.
 * Prints ✓ on pass, ✗ + error message on failure.
 */
async function check(name, fn) {
  try {
    await fn();
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

await check('better-sqlite3 loads', () => {
  if (typeof Database !== 'function') {
    throw new Error('better-sqlite3 did not export a constructor');
  }
});

await check('Can open in-memory SQLite database', () => {
  db = new Database(':memory:');
  if (!db) throw new Error('Database constructor returned null');
});

await check('Basic SQL query executes correctly', () => {
  if (!db) throw new Error('Database not open — see previous failure');
  const result = db.prepare('SELECT 42 AS answer').get();
  if (result.answer !== 42) throw new Error(`Expected 42, got ${result.answer}`);
});

await check('sqlite-vec extension loads', () => {
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

// KEY FIX (Tier 1.4): Import the real schema from dist/ instead of inlining
// a copy. This guarantees smoke can never drift from the production DDL.
// The SCHEMA_STATEMENTS export is an array of SQL strings — we exec each one.
await check('Flightplan schema applies without errors (from dist/)', async () => {
  if (!db) throw new Error('Database not open — see previous failure');

  const { SCHEMA_STATEMENTS } = await import('../dist/db/schema.js');

  for (const sql of SCHEMA_STATEMENTS) {
    db.exec(sql);
  }

  // Verify the active_session seed row — schema.ts inserts it.
  const sessionRow = db.prepare(
    "SELECT id FROM active_session WHERE id = 'current'"
  ).get();
  if (!sessionRow) {
    throw new Error('active_session seed row not found after schema apply');
  }

  // Verify flightplan_meta was created and seeded with schema_version.
  // This table was missing from the old inlined schema — this check catches
  // any future drift between smoke and production.
  const metaRow = db.prepare(
    "SELECT value FROM flightplan_meta WHERE key = 'schema_version'"
  ).get();
  if (!metaRow) {
    throw new Error(
      'flightplan_meta seed row not found — schema_version not initialized'
    );
  }
  console.log(`     schema_version: ${metaRow.value}`);

  // Verify Phase-2 columns exist on usage_snapshots.
  // PRAGMA table_info returns one row per column.
  const columns = db.prepare(
    "PRAGMA table_info(usage_snapshots)"
  ).all().map(r => r.name);

  const requiredPhase2Columns = [
    'baseline_source_at_time',
    'excluded_from_calibration',
    'tags',
  ];

  for (const col of requiredPhase2Columns) {
    if (!columns.includes(col)) {
      throw new Error(
        `usage_snapshots is missing Phase-2 column: ${col}. ` +
        `Schema may be out of date.`
      );
    }
  }
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
