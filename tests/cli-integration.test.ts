/**
 * tests/cli-integration.test.ts — CLI integration tests
 *
 * Tests the flightplan CLI commands end-to-end against temp DB files.
 * Uses FLIGHTPLAN_DB_PATH env var to keep tests isolated from the live DB.
 * Each test file is cleaned up after the test run.
 *
 * Test coverage:
 *   - stats --json
 *   - calibration report --json
 *   - calibration candidates --json
 *   - anomalies --json
 *   - estimate --json
 *   - gate --json
 *   - receipt --last --json
 *   - land --json
 *   - missing required args
 *   - unknown command
 *   - help output
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS, migrateV1toV2 } from '../src/db/schema.js';

// ─── Test helpers ──────────────────────────────────────────────────────────────

let tempDir: string;
let dbPath: string;
let cliPath: string;

function seedTestDb(db: Database.Database): void {
  // Config
  const insertConfig = db.prepare(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  );
  insertConfig.run('session_baseline', '40000');
  insertConfig.run('baseline_source', 'default');
  insertConfig.run('provider_name', 'TestProvider');
  insertConfig.run('provider_key', 'test-key');
  insertConfig.run('warn_threshold', '25');
  insertConfig.run('initialized_at', new Date().toISOString());

  // Seed usage_snapshots
  const insertSnapshot = db.prepare(`
    INSERT INTO usage_snapshots (
      session_id, started_at, ended_at, duration_minutes, tokens_total,
      goose_level_final, provider, model, project_id, baseline_at_time,
      baseline_source_at_time, excluded_from_calibration, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const snapshots = [
    { tokens: 15000, model: 'model-a', provider: 'prov-x', project: 'proj-1', outcome: 'completed' },
    { tokens: 25000, model: 'model-a', provider: 'prov-x', project: 'proj-1', outcome: 'completed' },
    { tokens: 35000, model: 'model-a', provider: 'prov-x', project: 'proj-1', outcome: 'completed' },
    { tokens: 50000, model: 'model-a', provider: 'prov-x', project: 'proj-1', outcome: 'completed' },
    { tokens: 100000, model: 'model-a', provider: 'prov-x', project: 'proj-1', outcome: 'completed' },
    { tokens: 8000, model: 'model-b', provider: 'prov-y', project: 'proj-2', outcome: 'checkpointed' },
    { tokens: 12000, model: 'model-b', provider: 'prov-y', project: 'proj-2', outcome: 'completed' },
    { tokens: 0, model: 'model-b', provider: 'prov-y', project: 'proj-2', outcome: 'aborted' },
    { tokens: 30000, model: 'model-b', provider: 'prov-y', project: 'proj-2', outcome: 'completed' },
    { tokens: 0, model: 'model-c', provider: 'prov-z', project: null, outcome: null },
  ];

  const insertSnapshots = db.transaction(() => {
    for (const s of snapshots) {
      const sessionId = `test-session-${Math.random().toString(36).slice(2, 10)}`;
      insertSnapshot.run(
        sessionId,
        new Date(Date.now() - 60 * 60_000).toISOString(),
        new Date().toISOString(),
        30.0,
        s.tokens,
        s.tokens > 30000 ? 'HEADWIND' : 'CRUISING',
        s.provider,
        s.model,
        s.project,
        40000,
        'default',
        s.tokens === 0 ? 1 : 0,
        s.outcome,
      );
    }
  });
  insertSnapshots();
}

function runCli(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; status: number } {
  const opts: ExecSyncOptions = {
    encoding: 'utf8',
    env: {
      ...process.env,
      FLIGHTPLAN_DB_PATH: dbPath,
      NODE_PATH: path.resolve('node_modules'),
      ...env,
    },
    cwd: path.resolve('.'),
  };

  try {
    const stdout = execSync(`node ${cliPath} ${args.join(' ')}`, opts);
    return { stdout: stdout.toString().trim(), stderr: '', status: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
      status: err.status ?? 1,
    };
  }
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flightplan-cli-test-'));
  dbPath = path.join(tempDir, 'test.db');
  cliPath = path.resolve('dist/status.js');

  // Seed the test DB
  const db = new Database(dbPath);
  const applySchema = db.transaction(() => {
    for (const sql of SCHEMA_STATEMENTS) {
      db.exec(sql);
    }
  });
  applySchema();
  migrateV1toV2(db);
  seedTestDb(db);
  db.close();
});

afterAll(() => {
  // Clean up temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ─── Help tests ────────────────────────────────────────────────────────────────

describe('CLI --help', () => {
  const commands = ['stats', 'calibration', 'anomalies', 'estimate', 'gate', 'receipt', 'land', 'status', 'export'];
  for (const cmd of commands) {
    it(`shows help for ${cmd}`, () => {
      const { stdout, status } = runCli([cmd, '--help']);
      expect(status).toBe(0);
      expect(stdout).toContain('Usage:');
    });
  }

  it('shows general help', () => {
    const { stdout, status } = runCli(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('Flightplan MCP');
    expect(stdout).toContain('Commands:');
  });
});

// ─── Stats ─────────────────────────────────────────────────────────────────────

describe('flightplan stats', () => {
  it('returns stats as JSON with --json', () => {
    const { stdout, status } = runCli(['stats', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('total_sessions');
    expect(parsed).toHaveProperty('nonzero_sessions');
    expect(parsed).toHaveProperty('total_tokens');
    expect(parsed.total_sessions).toBe(10);
    expect(parsed.nonzero_sessions).toBe(8);
  });

  it('returns human-readable output without --json', () => {
    const { stdout, status } = runCli(['stats']);
    expect(status).toBe(0);
    expect(stdout).toContain('Flightplan');
    expect(stdout).toContain('Total sessions:');
  });
});

// ─── Calibration ───────────────────────────────────────────────────────────────

describe('flightplan calibration', () => {
  it('returns calibration report as JSON', () => {
    const { stdout, status } = runCli(['calibration', 'report', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('total_sessions');
    expect(parsed).toHaveProperty('eligible_sessions');
    expect(parsed).toHaveProperty('excluded_sessions');
    expect(parsed.eligible_sessions).toBeGreaterThanOrEqual(0);
  });

  it('returns calibration candidates as JSON', () => {
    const { stdout, status } = runCli(['calibration', 'candidates', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// ─── Anomalies ─────────────────────────────────────────────────────────────────

describe('flightplan anomalies', () => {
  it('returns anomaly report as JSON', () => {
    const { stdout, status } = runCli(['anomalies', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('total_sessions');
    expect(parsed).toHaveProperty('anomalous_sessions');
    expect(parsed).toHaveProperty('sessions');
    // Our seed has 2 zero-token sessions
    expect(parsed.anomalous_sessions).toBeGreaterThanOrEqual(2);
  });
});

// ─── Estimate ──────────────────────────────────────────────────────────────────

describe('flightplan estimate', () => {
  it('returns estimate as JSON with required args', () => {
    const { stdout, status } = runCli(['estimate', '--model', 'model-a', '--provider', 'prov-x', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('estimated_tokens');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).toHaveProperty('historical_basis');
    expect(parsed.estimated_tokens).toHaveProperty('p50');
  });

  it('returns error JSON when --model is missing', () => {
    const { stdout, status } = runCli(['estimate', '--provider', 'prov-x', '--json']);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ok', false);
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toHaveProperty('code', 'MISSING_REQUIRED_ARGUMENT');
  });

  it('returns error JSON when --provider is missing', () => {
    const { stdout, status } = runCli(['estimate', '--model', 'model-a', '--json']);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ok', false);
    expect(parsed.error).toHaveProperty('code', 'MISSING_REQUIRED_ARGUMENT');
  });

  it('works with --project flag', () => {
    const { stdout, status } = runCli(['estimate', '--model', 'model-a', '--provider', 'prov-x', '--project', 'proj-1', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.historical_basis.matching_sessions).toBeGreaterThanOrEqual(3);
  });
});

// ─── Gate ──────────────────────────────────────────────────────────────────────

describe('flightplan gate', () => {
  it('returns gate decision as JSON with required args', () => {
    const { stdout, status } = runCli(['gate', '--model', 'model-a', '--provider', 'prov-x', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('decision');
    expect(parsed).toHaveProperty('goose_level');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).toHaveProperty('policy_reasons');
    expect(['proceed', 'proceed_with_checkpoint', 'split', 'land_first', 'refuse']).toContain(parsed.decision);
  });

  it('returns error JSON when args are missing', () => {
    const { stdout, status } = runCli(['gate', '--json']);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ok', false);
    expect(parsed.error).toHaveProperty('code', 'MISSING_REQUIRED_ARGUMENT');
  });

  it('works with --work-type flag', () => {
    const { stdout, status } = runCli(['gate', '--model', 'model-a', '--provider', 'prov-x', '--work-type', 'sprint', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('decision');
  });
});

// ─── Receipt ───────────────────────────────────────────────────────────────────

describe('flightplan receipt', () => {
  it('returns last session receipt as JSON', () => {
    const { stdout, status } = runCli(['receipt', '--last', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('receipt_type', 'flightplan-session-receipt');
    expect(parsed).toHaveProperty('session_id');
    expect(parsed).toHaveProperty('tokens_total_reported');
  });

  it('returns error JSON when neither --last nor --session is given', () => {
    const { stdout, status } = runCli(['receipt', '--json']);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ok', false);
    expect(parsed.error).toHaveProperty('code', 'MISSING_REQUIRED_ARGUMENT');
  });

  it('writes receipt to file with --out', () => {
    const outFile = path.join(tempDir, 'test-receipt.json');
    const { status } = runCli(['receipt', '--last', '--out', outFile]);
    expect(status).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(content).toHaveProperty('receipt_type', 'flightplan-session-receipt');
  });
});

// ─── Land ──────────────────────────────────────────────────────────────────────

describe('flightplan land', () => {
  it('returns landing assessment as JSON', () => {
    const { stdout, status } = runCli(['land', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('level');
    expect(parsed).toHaveProperty('landing_required');
    expect(parsed).toHaveProperty('can_record');
  });

  it('works with --tokens-total and --outcome', () => {
    const { stdout, status } = runCli(['land', '--tokens-total', '50000', '--outcome', 'completed', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('level');
  });
});

// ─── Error handling ────────────────────────────────────────────────────────────

describe('CLI error handling', () => {
  it('returns error JSON for unknown command with --json', () => {
    const { stdout, status } = runCli(['nonexistent', '--json']);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ok', false);
    expect(parsed.error).toHaveProperty('code', 'UNKNOWN_COMMAND');
  });

  it('returns error for unknown command without --json', () => {
    const { stderr, status } = runCli(['nonexistent']);
    expect(status).toBe(1);
    // Error message goes to stderr, stdout may be empty
    const combined = stderr;
    expect(combined).toContain('Unknown command');
  });
});
