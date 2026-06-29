/**
 * tests/analytics-calibration.test.ts — Calibration eligibility tests
 *
 * Tests calibration eligibility logic against fixture rows.
 * Uses in-memory SQLite databases so no ~/.flightplan/ side effects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import {
  isCalibrationEligible,
  getCalibrationExclusionReasons,
  generateCalibrationReport,
  getCalibrationCandidates,
} from '../src/analytics/calibration.js';

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

type InsertOverrides = Partial<{
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
}>;

function insertSnapshot(
  db: Database.Database,
  overrides: InsertOverrides = {},
): void {
  const defaults = {
    session_id: `test-${Math.random().toString(36).slice(2, 10)}`,
    started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_minutes: 30.0,
    tokens_total: 25000,
    goose_level_final: 'CRUISING',
    provider: 'TestProvider',
    model: 'test-model-v1',
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
    outcome: null,
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

function snapshotRow(db: Database.Database, sessionId: string) {
  const row = db.prepare(`SELECT * FROM usage_snapshots WHERE session_id = ?`).get(sessionId) as Record<string, unknown>;
  return row;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isCalibrationEligible', () => {
  it('returns true for a valid completed session', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'valid-001',
      tokens_total: 25000,
      duration_minutes: 45.0,
      provider: 'OpenAI',
      model: 'gpt-4',
      outcome: 'completed',
    });
    const row = snapshotRow(db, 'valid-001') as any;
    expect(isCalibrationEligible(row)).toBe(true);
  });

  it('returns false for zero-token session', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'zero-001',
      tokens_total: 0,
      duration_minutes: 10.0,
      provider: 'OpenAI',
      model: 'gpt-4',
    });
    const row = snapshotRow(db, 'zero-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
    expect(getCalibrationExclusionReasons(row)).toContain('tokens_total is zero or negative');
  });

  it('returns false for session with duration < 1 minute', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'short-001',
      tokens_total: 500,
      duration_minutes: 0.5,
      provider: 'OpenAI',
      model: 'gpt-4',
    });
    const row = snapshotRow(db, 'short-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns false for session with duration > 720 minutes', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'long-001',
      tokens_total: 50000,
      duration_minutes: 1440,
      provider: 'OpenAI',
      model: 'gpt-4',
    });
    const row = snapshotRow(db, 'long-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
    const reasons = getCalibrationExclusionReasons(row);
    expect(reasons.some(r => r.includes('exceeds 720'))).toBe(true);
  });

  it('returns false when model is missing', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'no-model',
      tokens_total: 10000,
      duration_minutes: 30.0,
      provider: 'OpenAI',
      model: '',
    });
    const row = snapshotRow(db, 'no-model') as any;
    expect(isCalibrationEligible(row)).toBe(false);
    expect(getCalibrationExclusionReasons(row)).toContain('model is missing or blank');
  });

  it('returns false when provider is missing', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'no-provider',
      tokens_total: 10000,
      duration_minutes: 30.0,
      provider: '',
      model: 'gpt-4',
    });
    const row = snapshotRow(db, 'no-provider') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns false when excluded_from_calibration is true', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'excluded-001',
      tokens_total: 25000,
      duration_minutes: 45.0,
      provider: 'OpenAI',
      model: 'gpt-4',
      excluded_from_calibration: 1,
    });
    const row = snapshotRow(db, 'excluded-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns false for aborted outcome', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'aborted-001',
      tokens_total: 5000,
      duration_minutes: 15.0,
      provider: 'OpenAI',
      model: 'gpt-4',
      outcome: 'aborted',
    });
    const row = snapshotRow(db, 'aborted-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns false for stale outcome', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'stale-001',
      tokens_total: 10000,
      duration_minutes: 30.0,
      provider: 'OpenAI',
      model: 'gpt-4',
      outcome: 'stale',
    });
    const row = snapshotRow(db, 'stale-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns false for honk outcome', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'honk-001',
      tokens_total: 10000,
      duration_minutes: 30.0,
      provider: 'OpenAI',
      model: 'gpt-4',
      outcome: 'honk',
    });
    const row = snapshotRow(db, 'honk-001') as any;
    expect(isCalibrationEligible(row)).toBe(false);
  });

  it('returns true for completed session with valid data', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'completed-001',
      outcome: 'completed',
    });
    const row = snapshotRow(db, 'completed-001') as any;
    expect(isCalibrationEligible(row)).toBe(true);
  });

  it('returns true for checkpointed session outcome', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 'cp-001',
      outcome: 'checkpointed',
    });
    const row = snapshotRow(db, 'cp-001') as any;
    expect(isCalibrationEligible(row)).toBe(true);
  });
});

describe('generateCalibrationReport', () => {
  it('returns empty report when no sessions exist', () => {
    const db = createTestDb();
    const report = generateCalibrationReport(db);
    expect(report.total_sessions).toBe(0);
    expect(report.eligible_sessions).toBe(0);
    expect(report.token_baseline_stats).toBeNull();
  });

  it('correctly categorizes eligible vs excluded', () => {
    const db = createTestDb();

    // 3 valid sessions
    insertSnapshot(db, { session_id: 'v1', tokens_total: 20000, duration_minutes: 30, provider: 'P', model: 'M', outcome: 'completed' });
    insertSnapshot(db, { session_id: 'v2', tokens_total: 35000, duration_minutes: 45, provider: 'P', model: 'M', outcome: 'completed' });
    insertSnapshot(db, { session_id: 'v3', tokens_total: 50000, duration_minutes: 60, provider: 'P', model: 'M', outcome: 'completed' });

    // 2 excluded sessions
    insertSnapshot(db, { session_id: 'x1', tokens_total: 0, duration_minutes: 10, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 'x2', tokens_total: 1000, duration_minutes: 0.1, provider: 'P', model: 'M' });

    const report = generateCalibrationReport(db);
    expect(report.total_sessions).toBe(5);
    expect(report.eligible_sessions).toBe(3);
    expect(report.excluded_sessions).toBe(2);
    expect(report.exclusions.length).toBe(2);
    expect(report.token_baseline_stats).not.toBeNull();
  });

  it('does not mutate the database', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'v1', tokens_total: 20000, duration_minutes: 30, provider: 'P', model: 'M' });

    const beforeCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;

    generateCalibrationReport(db);
    getCalibrationCandidates(db);

    const afterCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('getCalibrationCandidates', () => {
  it('returns only eligible sessions', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 'v1', tokens_total: 20000, duration_minutes: 30, provider: 'P', model: 'M', outcome: 'completed' });
    insertSnapshot(db, { session_id: 'x1', tokens_total: 0, duration_minutes: 10, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 'v2', tokens_total: 30000, duration_minutes: 45, provider: 'P', model: 'M', outcome: 'completed' });

    const candidates = getCalibrationCandidates(db);
    expect(candidates.length).toBe(2);
    expect(candidates.every(c => c.tokens_total > 0)).toBe(true);
  });

  it('returns empty array when no eligible sessions', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'x1', tokens_total: 0, duration_minutes: 0, provider: '', model: '' });
    const candidates = getCalibrationCandidates(db);
    expect(candidates).toEqual([]);
  });
});
