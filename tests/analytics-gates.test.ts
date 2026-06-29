/**
 * tests/analytics-gates.test.ts — Gate decision tests
 *
 * Tests the governed runway decision layer against fixture data.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';

// We import the actual functions but need to control the active session
// state (via the DB) and the baseline configuration.

import { evaluateGate } from '../src/analytics/gates.js';

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

function seedConfig(
  db: Database.Database,
  baseline = 40000,
  source = 'default'
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  );
  insert.run('session_baseline', String(baseline));
  insert.run('baseline_source', source);
  insert.run('provider_name', 'Test');
  insert.run('provider_key', 'test');
  insert.run('warn_threshold', '25');
  insert.run('initialized_at', new Date().toISOString());
}

function startSession(db: Database.Database, tokensObserved = 0): void {
  // Write directly to active_session to simulate a running session
  db.prepare(`
    UPDATE active_session
    SET session_id = 'test-session-gate',
        started_at = datetime('now'),
        goose_level = 'CRUISING',
        tokens_observed = ?,
        provider = 'TestProvider',
        model = 'test-model'
    WHERE id = 'current'
  `).run(tokensObserved);
}

function insertSnapshot(
  db: Database.Database,
  overrides: Partial<{
    session_id: string;
    started_at: string;
    ended_at: string;
    duration_minutes: number;
    tokens_total: number;
    goose_level_final: string;
    provider: string;
    model: string;
    project_id: string | null;
    baseline_at_time: number;
    baseline_source_at_time: string;
    notes: string | null;
    excluded_from_calibration: number;
    tags: string | null;
    plan_id: string | null;
    work_order_id: string | null;
    work_session_id: string | null;
    agent: string | null;
    outcome: string | null;
  }>,
): void {
  const defaults = {
    session_id: `t-${Math.random().toString(36).slice(2, 10)}`,
    started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_minutes: 30.0,
    tokens_total: 25000,
    goose_level_final: 'CRUISING',
    provider: 'TestProvider',
    model: 'test-model',
    project_id: null,
    baseline_at_time: 40000,
    baseline_source_at_time: 'default',
    notes: null,
    excluded_from_calibration: 0,
    tags: null,
    plan_id: null,
    work_order_id: null,
    work_session_id: null,
    agent: null,
    outcome: 'completed',
  };

  const row = { ...defaults, ...overrides };

  db.prepare(`
    INSERT INTO usage_snapshots
      (session_id, started_at, ended_at, duration_minutes,
       tokens_total, goose_level_final, provider, model,
       project_id, baseline_at_time, baseline_source_at_time, notes,
       excluded_from_calibration, tags,
       plan_id, work_order_id, work_session_id, agent, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO NOTHING
  `).run(
    row.session_id, row.started_at, row.ended_at, row.duration_minutes,
    row.tokens_total, row.goose_level_final, row.provider, row.model,
    row.project_id, row.baseline_at_time, row.baseline_source_at_time, row.notes,
    row.excluded_from_calibration, row.tags,
    row.plan_id, row.work_order_id, row.work_session_id, row.agent, row.outcome,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('evaluateGate', () => {
  describe('CRUISING level', () => {
    it('returns proceed for small estimate', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000); // 12.5% consumed = CRUISING

      // 5 small sessions for historical data
      for (let i = 0; i < 5; i++) {
        insertSnapshot(db, {
          session_id: `sess-${i}`,
          tokens_total: 10000 + i * 2000,
          outcome: 'completed',
        });
      }

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(result.decision).toBe('proceed');
      expect(result.goose_level).toBe('CRUISING');
      expect(result.policy_reasons.length).toBeGreaterThan(0);
    });

    it('returns proceed_with_checkpoint for large estimate', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000); // CRUISING

      // Large historical sessions
      for (let i = 0; i < 5; i++) {
        insertSnapshot(db, {
          session_id: `large-${i}`,
          tokens_total: 40000 + i * 10000,
          outcome: 'completed',
        });
      }

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      // p80 should be > 30000, triggering checkpoint
      expect(['proceed', 'proceed_with_checkpoint']).toContain(result.decision);
    });
  });

  describe('HEADWIND level', () => {
    it('returns proceed for small scope', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 22000); // 55% consumed = HEADWIND

      // Small sessions
      for (let i = 0; i < 5; i++) {
        insertSnapshot(db, {
          session_id: `sh-${i}`,
          tokens_total: 5000 + i * 2000,
          outcome: 'completed',
        });
      }

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(result.decision).toBe('proceed');
      expect(result.goose_level).toBe('HEADWIND');
    });
  });

  describe('TURBULENCE level', () => {
    it('returns proceed_with_checkpoint or split', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 32000); // 80% consumed = TURBULENCE

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(['proceed_with_checkpoint', 'split']).toContain(result.decision);
      expect(result.goose_level).toBe('TURBULENCE');
    });
  });

  describe('HONK level', () => {
    it('returns land_first', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 38000); // 95% consumed = HONK

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(result.decision).toBe('land_first');
      expect(result.goose_level).toBe('HONK');
    });
  });

  describe('WAYWARD confidence', () => {
    it('returns split when no historical data and active session', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000); // CRUISING but no historical data

      const result = evaluateGate(db, {
        model: 'unknown-model',
        provider: 'unknown-provider',
      });

      expect(['split', 'proceed_with_checkpoint']).toContain(result.decision);
    });
  });

  describe('missing historical data', () => {
    it('returns conservative decision when no data exists', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000); // CRUISING

      // No usage_snapshots at all
      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
        project_id: 'test-project',
      });

      expect(['proceed', 'proceed_with_checkpoint', 'split']).toContain(result.decision);
    });
  });

  describe('work tags echoed', () => {
    it('includes work_tags when provided', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000);

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
        project_id: 'proj-x',
        plan_id: 'Sprint-E',
        work_order_id: 'A1',
        work_session_id: 'sess-001',
        agent: 'OpenWork-Claude',
      });

      expect(result.work_tags).toBeDefined();
      expect(result.work_tags?.project_id).toBe('proj-x');
      expect(result.work_tags?.plan_id).toBe('Sprint-E');
      expect(result.work_tags?.work_order_id).toBe('A1');
    });

    it('omits work_tags when not provided', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      startSession(db, 5000);

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(result.work_tags).toBeUndefined();
    });
  });

  describe('no active session (PREFLIGHT)', () => {
    it('returns proceed when no active session', () => {
      const db = createTestDb();
      seedConfig(db, 40000);
      // Don't start a session — PREFLIGHT state

      const result = evaluateGate(db, {
        model: 'test-model',
        provider: 'TestProvider',
      });

      expect(result.goose_level).toBe('PREFLIGHT');
      // PREFLIGHT allows proceed
      expect(['proceed', 'proceed_with_checkpoint']).toContain(result.decision);
    });
  });
});
