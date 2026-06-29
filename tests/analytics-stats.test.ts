/**
 * tests/analytics-stats.test.ts — Stats calculation tests
 *
 * Tests aggregate usage statistics against fixture data.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import { calculateStats } from '../src/analytics/stats.js';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const applySchema = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  });
  applySchema();
  // Apply FP-1 migration so plan_id, outcome, etc. columns exist
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calculateStats', () => {
  it('returns empty stats when no sessions exist', () => {
    const db = createTestDb();
    const stats = calculateStats(db);
    expect(stats.total_sessions).toBe(0);
    expect(stats.has_data).toBe(false);
  });

  it('correctly aggregates single session', () => {
    const db = createTestDb();
    insertSnapshot(db, {
      session_id: 's1',
      tokens_total: 25000,
      provider: 'OpenAI',
      model: 'gpt-4',
      goose_level_final: 'CRUISING',
    });

    const stats = calculateStats(db);
    expect(stats.total_sessions).toBe(1);
    expect(stats.nonzero_sessions).toBe(1);
    expect(stats.total_tokens).toBe(25000);
    expect(stats.min_tokens).toBe(25000);
    expect(stats.max_tokens).toBe(25000);
    expect(stats.average_tokens_per_nonzero_session).toBe(25000);
    expect(stats.sessions_by_model['gpt-4']).toBe(1);
    expect(stats.sessions_by_provider['OpenAI']).toBe(1);
    expect(stats.has_data).toBe(true);
  });

  it('correctly aggregates multiple sessions', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 's1', tokens_total: 10000, provider: 'OpenAI', model: 'gpt-4', goose_level_final: 'CRUISING' });
    insertSnapshot(db, { session_id: 's2', tokens_total: 20000, provider: 'OpenAI', model: 'gpt-4', goose_level_final: 'HEADWIND' });
    insertSnapshot(db, { session_id: 's3', tokens_total: 50000, provider: 'Anthropic', model: 'claude-3', goose_level_final: 'CRUISING' });

    const stats = calculateStats(db);
    expect(stats.total_sessions).toBe(3);
    expect(stats.nonzero_sessions).toBe(3);
    expect(stats.total_tokens).toBe(80000);
    expect(stats.average_tokens_per_nonzero_session).toBe(26667); // 80000/3 rounded
    expect(stats.min_tokens).toBe(10000);
    expect(stats.max_tokens).toBe(50000);
    expect(stats.sessions_by_model['gpt-4']).toBe(2);
    expect(stats.sessions_by_model['claude-3']).toBe(1);
    expect(stats.sessions_by_provider['OpenAI']).toBe(2);
    expect(stats.sessions_by_provider['Anthropic']).toBe(1);
    expect(stats.sessions_by_goose_level['CRUISING']).toBe(2);
    expect(stats.sessions_by_goose_level['HEADWIND']).toBe(1);
  });

  it('handles zero-token sessions correctly', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 's1', tokens_total: 0, provider: 'P', model: 'M' });
    insertSnapshot(db, { session_id: 's2', tokens_total: 15000, provider: 'P', model: 'M' });

    const stats = calculateStats(db);
    expect(stats.total_sessions).toBe(2);
    expect(stats.nonzero_sessions).toBe(1);
    expect(stats.total_tokens).toBe(15000);
    expect(stats.average_tokens_per_nonzero_session).toBe(15000);
  });

  it('handles multiple providers and projects', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 's1', tokens_total: 10000, provider: 'OpenAI', model: 'gpt-4', project_id: 'proj-a' });
    insertSnapshot(db, { session_id: 's2', tokens_total: 20000, provider: 'OpenAI', model: 'gpt-4', project_id: 'proj-b' });
    insertSnapshot(db, { session_id: 's3', tokens_total: 30000, provider: 'Anthropic', model: 'claude-3', project_id: 'proj-a' });

    const stats = calculateStats(db);
    expect(stats.sessions_by_project['proj-a']).toBe(2);
    expect(stats.sessions_by_project['proj-b']).toBe(1);
  });

  it('handles multiple goose levels', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 's1', tokens_total: 10000, provider: 'P', model: 'M', goose_level_final: 'CRUISING' });
    insertSnapshot(db, { session_id: 's2', tokens_total: 30000, provider: 'P', model: 'M', goose_level_final: 'HEADWIND' });
    insertSnapshot(db, { session_id: 's3', tokens_total: 50000, provider: 'P', model: 'M', goose_level_final: 'TURBULENCE' });
    insertSnapshot(db, { session_id: 's4', tokens_total: 70000, provider: 'P', model: 'M', goose_level_final: 'HONK' });

    const stats = calculateStats(db);
    expect(stats.sessions_by_goose_level['CRUISING']).toBe(1);
    expect(stats.sessions_by_goose_level['HEADWIND']).toBe(1);
    expect(stats.sessions_by_goose_level['TURBULENCE']).toBe(1);
    expect(stats.sessions_by_goose_level['HONK']).toBe(1);
  });

  it('token buckets are correctly populated', () => {
    const db = createTestDb();

    insertSnapshot(db, { session_id: 's0', tokens_total: 0 });
    insertSnapshot(db, { session_id: 's1', tokens_total: 5000 });
    insertSnapshot(db, { session_id: 's2', tokens_total: 25000 });
    insertSnapshot(db, { session_id: 's3', tokens_total: 75000 });
    insertSnapshot(db, { session_id: 's4', tokens_total: 150000 });
    insertSnapshot(db, { session_id: 's5', tokens_total: 300000 });

    const stats = calculateStats(db);
    expect(stats.token_buckets['0']).toBe(1);
    expect(stats.token_buckets['1-10000']).toBe(1);
    expect(stats.token_buckets['10001-50000']).toBe(1);
    expect(stats.token_buckets['50001-100000']).toBe(1);
    expect(stats.token_buckets['100001-200000']).toBe(1);
    expect(stats.token_buckets['200001+']).toBe(1);
  });

  it('does not mutate the database', () => {
    const db = createTestDb();
    insertSnapshot(db, { session_id: 's1', tokens_total: 10000 });

    const beforeCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;
    calculateStats(db);
    const afterCount = (db.prepare('SELECT COUNT(*) as n FROM usage_snapshots').get() as { n: number }).n;

    expect(afterCount).toBe(beforeCount);
  });
});
