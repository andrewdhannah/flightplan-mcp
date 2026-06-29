/**
 * tests/analytics-dead-reckoning.test.ts — Dead Reckoning estimator tests
 *
 * Tests the historical usage estimator against fixture data.
 * Uses in-memory SQLite databases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';
import { estimateTokens } from '../src/analytics/dead_reckoning.js';

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

describe('estimateTokens', () => {
  describe('exact match', () => {
    it('returns estimate when exact project+provider+model matches exist', () => {
      const db = createTestDb();
      seedConfig(db);

      // 3 matching sessions for exact project/prov/model
      for (let i = 0; i < 3; i++) {
        insertSnapshot(db, {
          session_id: `exact-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          project_id: 'proj-a',
          tokens_total: 30000 + i * 5000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
        project: 'proj-a',
      });

      expect(result.fallback_used).toBe(false);
      expect(result.historical_basis.scope).toBe('model_provider_project');
      expect(result.historical_basis.matching_sessions).toBe(3);
      expect(result.confidence).toBe('low');
      expect(result.estimated_tokens.p50).toBeGreaterThan(0);
    });

    it('falls back to provider+model when project match is insufficient', () => {
      const db = createTestDb();
      seedConfig(db);

      // 1 exact match not enough, but 4 provider+model matches
      insertSnapshot(db, {
        session_id: 'exact-1',
        provider: 'OpenAI',
        model: 'gpt-4',
        project_id: 'proj-a',
        tokens_total: 35000,
        outcome: 'completed',
      });

      for (let i = 0; i < 4; i++) {
        insertSnapshot(db, {
          session_id: `pm-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          project_id: 'proj-b',
          tokens_total: 30000 + i * 5000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
        project: 'proj-a',
      });

      // Should match provider+model (4 sessions > 3 threshold)
      expect(result.historical_basis.scope).toBe('provider_model');
      expect(result.historical_basis.matching_sessions).toBe(5);
    });
  });

  describe('model-only fallback', () => {
    it('falls back to model-only when provider is specified', () => {
      const db = createTestDb();
      seedConfig(db);

      // 1 session with the specific provider+model (not enough for PM match)
      insertSnapshot(db, {
        session_id: 'pm-low',
        provider: 'Anthropic',
        model: 'claude-3',
        tokens_total: 45000,
        outcome: 'completed',
      });

      // 4 sessions with the same model but different provider
      for (let i = 0; i < 4; i++) {
        insertSnapshot(db, {
          session_id: `m-only-${i}`,
          provider: 'OtherProvider',
          model: 'claude-3',
          tokens_total: 40000 + i * 3000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'claude-3',
        provider: 'Anthropic',
      });

      expect(result.historical_basis.scope).toBe('model_only');
      expect(result.historical_basis.matching_sessions).toBeGreaterThanOrEqual(4);
    });
  });

  describe('global fallback', () => {
    it('uses global eligible sessions when no specific matches exist', () => {
      const db = createTestDb();
      seedConfig(db);

      // 5 eligible sessions with various models/providers
      for (let i = 0; i < 5; i++) {
        insertSnapshot(db, {
          session_id: `global-${i}`,
          provider: `Provider${i}`,
          model: `Model${i}`,
          tokens_total: 20000 + i * 10000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'UnknownModel',
        provider: 'UnknownProvider',
      });

      expect(result.historical_basis.scope).toBe('global');
      expect(result.fallback_used).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('fallback to configured baseline', () => {
    it('returns WAYWARD with fallback when no historical data exists', () => {
      const db = createTestDb();
      seedConfig(db, 50000);

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.fallback_used).toBe(true);
      expect(result.confidence).toBe('wayward');
      expect(result.historical_basis.scope).toBe('fallback_baseline');
      expect(result.historical_basis.matching_sessions).toBe(0);
      expect(result.estimated_tokens.p50).toBe(50000);
    });
  });

  describe('confidence levels', () => {
    it('returns high confidence with >= 20 matching sessions', () => {
      const db = createTestDb();
      seedConfig(db);

      for (let i = 0; i < 22; i++) {
        insertSnapshot(db, {
          session_id: `high-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 30000 + (i % 5) * 5000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.confidence).toBe('high');
      expect(result.historical_basis.matching_sessions).toBeGreaterThanOrEqual(20);
    });

    it('returns medium confidence with 8-19 matching sessions', () => {
      const db = createTestDb();
      seedConfig(db);

      for (let i = 0; i < 12; i++) {
        insertSnapshot(db, {
          session_id: `med-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 30000 + i * 2000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.confidence).toBe('medium');
      expect(result.historical_basis.matching_sessions).toBeGreaterThanOrEqual(8);
      expect(result.historical_basis.matching_sessions).toBeLessThan(20);
    });

    it('returns low confidence with 3-7 matching sessions', () => {
      const db = createTestDb();
      seedConfig(db);

      for (let i = 0; i < 5; i++) {
        insertSnapshot(db, {
          session_id: `low-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 35000 + i * 3000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.confidence).toBe('low');
    });
  });

  describe('WAYWARD condition', () => {
    it('returns WAYWARD when zero eligible sessions exist', () => {
      const db = createTestDb();
      seedConfig(db);

      // No eligible sessions at all — force wayward fallback
      const result = estimateTokens(db, {
        model: 'UnknownModel',
        provider: 'UnknownProvider',
      });

      expect(result.fallback_used).toBe(true);
      expect(result.confidence).toBe('wayward');
      expect(result.historical_basis.matching_sessions).toBe(0);
    });

    it('returns WAYWARD with only ineligible sessions', () => {
      const db = createTestDb();
      seedConfig(db);

      // 3 sessions, all ineligible (zero tokens)
      for (let i = 0; i < 3; i++) {
        insertSnapshot(db, {
          session_id: `inelig-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 0,
          duration_minutes: 1,
          outcome: 'aborted',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.fallback_used).toBe(true);
      expect(result.confidence).toBe('wayward');
    });

    it('returns WAYWARD when provider+model fails and global is insufficient', () => {
      const db = createTestDb();
      seedConfig(db);

      // 2 sessions with matching provider+model (above 3 threshold? No — 2 < 3)
      insertSnapshot(db, {
        session_id: 'w1',
        provider: 'OpenAI',
        model: 'gpt-4',
        tokens_total: 30000,
        outcome: 'completed',
      });
      insertSnapshot(db, {
        session_id: 'w2',
        provider: 'OpenAI',
        model: 'gpt-4',
        tokens_total: 40000,
        outcome: 'completed',
      });

      // The estimator will try global (2 sessions total) which is < 3
      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.fallback_used).toBe(true);
      expect(result.confidence).toBe('wayward');
    });
  });

  describe('percentile output', () => {
    it('p50 <= p80 <= p95', () => {
      const db = createTestDb();
      seedConfig(db);

      for (let i = 0; i < 10; i++) {
        insertSnapshot(db, {
          session_id: `pct-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 10000 + i * 5000,
          outcome: 'completed',
        });
      }

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.estimated_tokens.p50).toBeLessThanOrEqual(result.estimated_tokens.p80);
      expect(result.estimated_tokens.p80).toBeLessThanOrEqual(result.estimated_tokens.p95);
    });

    it('percentiles are deterministic for same data', () => {
      const db = createTestDb();
      seedConfig(db);

      for (let i = 0; i < 8; i++) {
        insertSnapshot(db, {
          session_id: `det-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 20000 + i * 4000,
          outcome: 'completed',
        });
      }

      const a = estimateTokens(db, { model: 'gpt-4', provider: 'OpenAI' });
      const b = estimateTokens(db, { model: 'gpt-4', provider: 'OpenAI' });

      expect(a.estimated_tokens).toEqual(b.estimated_tokens);
    });
  });

  describe('edge cases', () => {
    it('handles empty DB gracefully', () => {
      const db = createTestDb();
      seedConfig(db, 40000);

      const result = estimateTokens(db, {
        model: 'test-model',
        provider: 'test-provider',
      });

      expect(result.fallback_used).toBe(true);
      expect(result.confidence).toBe('wayward');
    });

    it('filters out calibration-ineligible sessions', () => {
      const db = createTestDb();
      seedConfig(db);

      // 3 eligible sessions
      for (let i = 0; i < 3; i++) {
        insertSnapshot(db, {
          session_id: `valid-${i}`,
          provider: 'OpenAI',
          model: 'gpt-4',
          tokens_total: 30000 + i * 5000,
          duration_minutes: 30,
          outcome: 'completed',
        });
      }

      // 1 ineligible (zero tokens)
      insertSnapshot(db, {
        session_id: 'invalid',
        provider: 'OpenAI',
        model: 'gpt-4',
        tokens_total: 0,
        duration_minutes: 5,
        outcome: 'aborted',
      });

      const result = estimateTokens(db, {
        model: 'gpt-4',
        provider: 'OpenAI',
      });

      expect(result.historical_basis.matching_sessions).toBe(3);
      expect(result.fallback_used).toBe(false);
    });
  });
});
