/**
 * tests/analytics-anomalies.test.ts — Anomaly detection tests
 *
 * Tests anomaly detection against fixture rows.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import {
  detectAnomalies,
  detectAllAnomalies,
  detectIdleSkew,
} from '../src/analytics/anomalies.js';

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
  return db.prepare(`SELECT * FROM usage_snapshots WHERE session_id = ?`).get(sessionId) as Record<string, unknown>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  it('returns empty array for a clean session', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'clean', tokens_total: 25000, duration_minutes: 45, provider: 'OpenAI', model: 'gpt-4' });
    const row = snapshotRow(db, 'clean') as any;
    expect(detectAnomalies(row)).toEqual([]);
  });

  it('flags zero-token sessions', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'zero', tokens_total: 0, duration_minutes: 10, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'zero') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('tokens_total is zero'))).toBe(true);
  });

  it('flags null duration', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'null-dur', tokens_total: 1000, duration_minutes: null as any, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'null-dur') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('duration_minutes is null'))).toBe(true);
  });

  it('flags excessively long sessions', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'long', tokens_total: 50000, duration_minutes: 1440, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'long') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('exceeds 720'))).toBe(true);
  });

  it('flags missing model', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'no-model', tokens_total: 1000, duration_minutes: 10, provider: 'P', model: '' });
    const row = snapshotRow(db, 'no-model') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('model is missing'))).toBe(true);
  });

  it('flags missing provider', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'no-provider', tokens_total: 1000, duration_minutes: 10, provider: '', model: 'M' });
    const row = snapshotRow(db, 'no-provider') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('provider is missing'))).toBe(true);
  });

  it('flags extremely low tokens_per_minute', () => {
    const db = createTestDb();
    // 100 tokens over 60 minutes = 1.67 tokens/min
    insertSnapshot(db, { session_id: 'low-tpm', tokens_total: 100, duration_minutes: 60, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'low-tpm') as any;
    const anomalies = detectAnomalies(row);
    // This should also flag idle duration since 100/60 = 1.67 which is < 10
    expect(anomalies.some(a => a.includes('extremely low'))).toBe(true);
  });

  it('flags extremely high tokens_per_minute', () => {
    const db = createTestDb();
    // 500000 tokens over 1 minute = 500000 tpm
    insertSnapshot(db, { session_id: 'high-tpm', tokens_total: 500000, duration_minutes: 1, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'high-tpm') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('extremely high'))).toBe(true);
  });

  it('flags zero duration', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 'zero-dur', tokens_total: 1000, duration_minutes: 0, provider: 'P', model: 'M' });
    const row = snapshotRow(db, 'zero-dur') as any;
    const anomalies = detectAnomalies(row);
    expect(anomalies.some(a => a.includes('zero or negative'))).toBe(true);
  });
});

describe('detectAllAnomalies', () => {
  it('returns empty report when no sessions exist', () => {
    const db = createTestDb();
    const report = detectAllAnomalies(db);
    expect(report.total_sessions).toBe(0);
    expect(report.anomalous_sessions).toBe(0);
    expect(report.sessions).toEqual([]);
  });

  it('finds anomalies among multiple sessions', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 'clean', tokens_total: 25000, duration_minutes: 45, provider: 'OpenAI', model: 'gpt-4' });
    insertSnapshot(db, { session_id: 'zero', tokens_total: 0, duration_minutes: 10, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 'no-model', tokens_total: 5000, duration_minutes: 20, provider: 'P', model: '' });

    const report = detectAllAnomalies(db);
    expect(report.total_sessions).toBe(3);
    expect(report.anomalous_sessions).toBe(2);
    expect(report.sessions.length).toBe(2);
  });

  it('does not mutate the database', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 's1', tokens_total: 0 });

    const beforeCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;
    detectAllAnomalies(db);
    const afterCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;

    expect(afterCount).toBe(beforeCount);
  });
});

describe('detectIdleSkew', () => {
  it('returns no skew when no sessions exist', () => {
    const db = createTestDb();
    const result = detectIdleSkew(db);
    expect(result.has_idle_skew).toBe(false);
  });

  it('detects no skew for normal sessions', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 's1', tokens_total: 25000, duration_minutes: 45, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 's2', tokens_total: 50000, duration_minutes: 60, provider: 'P', model: 'M' });

    const result = detectIdleSkew(db);
    expect(result.has_idle_skew).toBe(false);
  });

  it('detects skew for very long session', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 's1', tokens_total: 25000, duration_minutes: 45, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 'long', tokens_total: 50000, duration_minutes: 1440, provider: 'P', model: 'M' });

    const result = detectIdleSkew(db);
    expect(result.has_idle_skew).toBe(true);
  });
});
