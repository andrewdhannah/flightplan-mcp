/**
 * tests/analytics-landing.test.ts — Landing workflow tests
 *
 * Tests session landing assessment against fixture data.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import { assessLanding } from '../src/analytics/landing.js';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const applySchema = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  });
  applySchema();
  migrateV1toV2(db);
  return db;
}

function seedConfig(db: Database.Database, baseline = 40000): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  );
  insert.run('session_baseline', String(baseline));
  insert.run('baseline_source', 'default');
  insert.run('provider_name', 'Test');
  insert.run('provider_key', 'test');
  insert.run('warn_threshold', '25');
  insert.run('initialized_at', new Date().toISOString());
}

function startSession(db: Database.Database, tokensObserved = 0): void {
  db.prepare(`
    UPDATE active_session
    SET session_id = 'test-session-landing',
        started_at = datetime('now'),
        goose_level = 'CRUISING',
        tokens_observed = ?,
        provider = 'TestProvider',
        model = 'test-model'
    WHERE id = 'current'
  `).run(tokensObserved);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('assessLanding', () => {
  it('returns PREFLIGHT when no active session', () => {
    const db = createTestDb();
    seedConfig(db);

    const result = assessLanding(db, {});
    expect(result.level).toBe('PREFLIGHT');
    expect(result.landing_required).toBe(false);
    expect(result.missing).toContain('active_session');
  });

  it('returns CRUISING assessment for active session with few tokens', () => {
    const db = createTestDb();
    seedConfig(db, 40000);
    startSession(db, 5000); // 12.5% — CRUISING

    const result = assessLanding(db, {});
    expect(result.level).toBe('CRUISING');
    expect(result.landing_required).toBe(false);
    expect(result.can_record).toBe(false);
    expect(result.missing).toContain('tokens_total');
  });

  it('reports can_record when tokens_total supplied for CRUISING', () => {
    const db = createTestDb();
    seedConfig(db, 40000);
    startSession(db, 5000);

    const result = assessLanding(db, { tokens_total: 5000 });
    expect(result.can_record).toBe(true);
    expect(result.landing_required).toBe(false);
  });

  it('returns HONK assessment with landing_required', () => {
    const db = createTestDb();
    seedConfig(db, 40000);
    startSession(db, 36000); // 90% — HONK

    const result = assessLanding(db, {});
    expect(result.level).toBe('HONK');
    expect(result.landing_required).toBe(true);
    expect(result.can_record).toBe(false);
    expect(result.missing).toContain('tokens_total');
  });

  it('HONK with tokens_total reports can_record', () => {
    const db = createTestDb();
    seedConfig(db, 40000);
    startSession(db, 36000);

    const result = assessLanding(db, { tokens_total: 36000 });
    expect(result.level).toBe('HONK');
    expect(result.landing_required).toBe(true);
    expect(result.can_record).toBe(true);
  });

  it('TURBULENCE recommends landing soon', () => {
    const db = createTestDb();
    seedConfig(db, 40000);
    startSession(db, 32000); // 80% — TURBULENCE

    const result = assessLanding(db, {});
    expect(result.level).toBe('TURBULENCE');
    expect(result.recommended_action).toContain('consider landing soon');
  });

  it('generates handoff template', () => {
    const db = createTestDb();
    seedConfig(db);
    startSession(db, 5000);

    const result = assessLanding(db, { tokens_total: 5000 });

    expect(result.handoff_template).toBeDefined();
    expect(result.handoff_template.summary).toBe('');
    expect(Array.isArray(result.handoff_template.completed)).toBe(true);
    expect(Array.isArray(result.handoff_template.modified_files)).toBe(true);
    expect(Array.isArray(result.handoff_template.tests_run)).toBe(true);
    expect(Array.isArray(result.handoff_template.known_risks)).toBe(true);
  });
});
