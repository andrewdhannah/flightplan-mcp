/**
 * tests/analytics-receipts.test.ts — Session receipt tests
 *
 * Tests receipt generation against fixture data.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import { generateReceipt, generateLastReceipt } from '../src/analytics/receipts.js';

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
    started_at: '2026-06-28T10:00:00.000Z',
    ended_at: '2026-06-28T10:45:00.000Z',
    duration_minutes: 45.0,
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

describe('generateReceipt', () => {
  it('generates a receipt for a specific session', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-001',
      tokens_total: 28500,
      provider: 'OpenWork',
      model: 'deepseek-v4-flash',
      goose_level_final: 'HEADWIND',
      outcome: 'completed',
      duration_minutes: 47.3,
      started_at: '2026-06-28T10:00:00.000Z',
      ended_at: '2026-06-28T10:47:18.000Z',
    });

    const receipt = generateReceipt(db, 'sess-001');

    expect(receipt.receipt_type).toBe('flightplan-session-receipt');
    expect(receipt.schema_version).toBe(1);
    expect(receipt.session_id).toBe('sess-001');
    expect(receipt.provider).toBe('OpenWork');
    expect(receipt.model).toBe('deepseek-v4-flash');
    expect(receipt.tokens_total_reported).toBe(28500);
    expect(receipt.duration_minutes).toBe(47.3);
    expect(receipt.goose_level_final).toBe('HEADWIND');
    expect(receipt.outcome).toBe('completed');
    expect(receipt.generated_at).toBeTruthy();
  });

  it('includes calibration eligibility', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-eligible',
      tokens_total: 25000,
      duration_minutes: 45,
      provider: 'OpenAI',
      model: 'gpt-4',
    });

    const receipt = generateReceipt(db, 'sess-eligible');
    expect(receipt.calibration_eligible).toBe(true);
    expect(receipt.calibration_exclusion_reasons).toEqual([]);
  });

  it('marks calibration-ineligible sessions', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-ineligible',
      tokens_total: 0,
      duration_minutes: 5,
      provider: 'OpenAI',
      model: 'gpt-4',
    });

    const receipt = generateReceipt(db, 'sess-ineligible');
    expect(receipt.calibration_eligible).toBe(false);
    expect(receipt.calibration_exclusion_reasons.length).toBeGreaterThan(0);
  });

  it('excludes notes from receipt', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-notes',
      tokens_total: 15000,
      notes: 'This is a private note about the session',
    });

    const receipt = generateReceipt(db, 'sess-notes');
    // notes should not appear in the receipt
    expect((receipt as any).notes).toBeUndefined();
  });

  it('includes work tags when present', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-tags',
      tokens_total: 20000,
      plan_id: 'Sprint-E',
      work_order_id: 'A1',
      work_session_id: 'sess_A1_001',
      agent: 'OpenWork-Claude',
      project_id: 'TheLibrarian',
    });

    const receipt = generateReceipt(db, 'sess-tags');
    expect(receipt.plan_id).toBe('Sprint-E');
    expect(receipt.work_order_id).toBe('A1');
    expect(receipt.agent).toBe('OpenWork-Claude');
    expect(receipt.project_id).toBe('TheLibrarian');
  });

  it('throws for non-existent session', () => {
    const db = createTestDb();
    seedConfig(db);

    expect(() => generateReceipt(db, 'nonexistent')).toThrow('Session not found');
  });

  it('has all required schema fields', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-schema',
      tokens_total: 30000,
    });

    const receipt = generateReceipt(db, 'sess-schema');

    const requiredFields = [
      'receipt_type',
      'schema_version',
      'session_id',
      'started_at',
      'ended_at',
      'duration_minutes',
      'tokens_total_reported',
      'goose_level_final',
      'calibration_eligible',
      'calibration_exclusion_reasons',
      'baseline_at_time',
      'baseline_source_at_time',
      'generated_at',
    ];

    for (const field of requiredFields) {
      expect(receipt).toHaveProperty(field);
    }
  });

  it('is deterministic for same session (generated_at is valid ISO)', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-det',
      tokens_total: 25000,
    });

    const a = generateReceipt(db, 'sess-det');
    const b = generateReceipt(db, 'sess-det');

    expect(a.session_id).toBe(b.session_id);
    expect(a.tokens_total_reported).toBe(b.tokens_total_reported);
    expect(a.duration_minutes).toBe(b.duration_minutes);
    // generated_at should be a valid ISO timestamp
    expect(a.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(b.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('generateLastReceipt', () => {
  it('generates receipt for the last session', () => {
    const db = createTestDb();
    seedConfig(db);

    insertSnapshot(db, {
      session_id: 'sess-old',
      started_at: '2026-06-27T10:00:00.000Z',
      ended_at: '2026-06-27T10:30:00.000Z',
      tokens_total: 10000,
    });

    insertSnapshot(db, {
      session_id: 'sess-new',
      started_at: '2026-06-28T10:00:00.000Z',
      ended_at: '2026-06-28T10:45:00.000Z',
      tokens_total: 25000,
    });

    const receipt = generateLastReceipt(db);
    expect(receipt.session_id).toBe('sess-new');
    expect(receipt.tokens_total_reported).toBe(25000);
  });

  it('throws when no sessions exist', () => {
    const db = createTestDb();
    seedConfig(db);

    expect(() => generateLastReceipt(db)).toThrow('No sessions found');
  });
});
