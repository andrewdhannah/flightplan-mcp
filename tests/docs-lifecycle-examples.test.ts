/**
 * tests/docs-lifecycle-examples.test.ts — Lifecycle doc command name validation
 *
 * Lightweight test that checks documented CLI command names and flags
 * are present in the actual CLI routing code. Prevents doc drift from
 * implementation.
 *
 * This does not execute commands against a real DB — it only checks
 * that the command names and flag patterns referenced in lifecycle docs
 * are handled by the CLI router.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─── Docs paths ───────────────────────────────────────────────────────────────

const LIFECYCLE_DOC = new URL('../docs/AGENT-LIFECYCLE-INTEGRATION.md', import.meta.url).pathname;
const TEMPLATE_DOC = new URL('../docs/AGENT-PACKET-FLIGHTPLAN-TEMPLATE.md', import.meta.url).pathname;
const CLI_ROUTER = new URL('../src/status.ts', import.meta.url).pathname;
const COMMANDS_MODULE = new URL('../src/commands.ts', import.meta.url).pathname;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function fileContains(path: string, patterns: string[]): string[] {
  const content = readFile(path);
  return patterns.filter(p => !content.includes(p));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Lifecycle document CLI command alignment', () => {
  const routerSource = readFile(CLI_ROUTER);

  // Commands documented in lifecycle docs that should be routed in status.ts
  const expectedCommands = [
    'flightplan status',
    'flightplan stats',
    'flightplan calibration report',
    'flightplan calibration candidates',
    'flightplan anomalies',
    'flightplan estimate',
    'flightplan gate',
    'flightplan receipt',
    'flightplan land',
    'flightplan export',
  ];

  for (const cmd of expectedCommands) {
    // Derive the command key from the pattern (e.g. "stats" from "flightplan stats")
    const cmdKey = cmd.replace('flightplan ', '');
    const cmdPart = cmdKey.split(' ')[0] ?? cmdKey;

    it(`documented command "${cmd}" should be routed in status.ts`, () => {
      // Check that the command key appears as a string literal in the router
      // (e.g., command === "stats" or command === "calibration")
      expect(routerSource).toContain(`"${cmdPart}`);
    });
  }

  // Flags used in lifecycle doc command examples
  const expectedFlags = [
    '--json',
    '--model',
    '--provider',
    '--project',
    '--work-type',
    '--session',
    '--last',
    '--tokens-total',
    '--outcome',
  ];

  for (const flag of expectedFlags) {
    it(`documented flag "${flag}" should be referenced in CLI routing`, () => {
      expect(routerSource).toContain(flag);
    });
  }
});

describe('Command module exports', () => {
  const commandsSource = readFile(COMMANDS_MODULE);

  const expectedExports = [
    'cmdStats',
    'cmdCalibrationReport',
    'cmdCalibrationCandidates',
    'cmdAnomalies',
    'cmdEstimate',
    'cmdGate',
    'cmdReceipt',
    'cmdLand',
  ];

  for (const exportName of expectedExports) {
    it(`function "${exportName}" should be defined in commands.ts`, () => {
      expect(commandsSource).toContain(`export function ${exportName}`);
    });
  }
});

describe('Lifecycle doc references correct command names', () => {
  const lifecycle = readFile(LIFECYCLE_DOC);
  const template = readFile(TEMPLATE_DOC);

  it('lifecycle doc references "flightplan status --json"', () => {
    expect(lifecycle).toContain('flightplan status --json');
  });

  it('lifecycle doc references "flightplan gate --json"', () => {
    expect(lifecycle).toContain('flightplan gate --json');
  });

  it('lifecycle doc references "flightplan estimate --json"', () => {
    expect(lifecycle).toContain('flightplan estimate --json');
  });

  it('lifecycle doc references "flightplan stats --json"', () => {
    expect(lifecycle).toContain('flightplan stats --json');
  });

  it('lifecycle doc references "flightplan land --json"', () => {
    expect(lifecycle).toContain('flightplan land --json');
  });

  it('lifecycle doc references "flightplan receipt --last --json"', () => {
    expect(lifecycle).toContain('flightplan receipt --last --json');
  });

  it('lifecycle doc references "flightplan calibration report --json"', () => {
    expect(lifecycle).toContain('flightplan calibration report --json');
  });

  it('agent template references "session_start"', () => {
    expect(template).toContain('session_start');
  });

  it('agent template references "record_session"', () => {
    expect(template).toContain('record_session');
  });

  it('agent template references gate decision meanings', () => {
    expect(template).toContain('proceed');
    expect(template).toContain('proceed_with_checkpoint');
    expect(template).toContain('split');
    expect(template).toContain('land_first');
    expect(template).toContain('refuse');
  });
});
