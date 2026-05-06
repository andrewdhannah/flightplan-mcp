/**
 * tests/state_generator.test.ts — Unit tests for generateMarkdown()
 *
 * Tests the pure generateMarkdown(data: StatusData) → string function.
 * No DB, no file I/O — just construct a StatusData object and assert on
 * the returned Markdown string.
 *
 * Coverage:
 *  1.  All six required section headers are present
 *  2.  Agent Contract table contains a row for every GooseLevel
 *  3.  Compass shows the correct level, runway %, and token counts
 *  4.  Compass shows the correct warning threshold (enabled / disabled)
 *  5.  Flight Log renders a data table when a session is active
 *  6.  Flight Log renders the PREFLIGHT message when no session is active
 *  7.  Flight Log falls back to '*(not set)*' for null model / project_id
 *  8.  Dead Reckoning countdown = 5 − sessionsArchived
 *  9.  Dead Reckoning shows "Active" when sessionsArchived ≥ 5
 * 10.  Timestamp appears in both header and footer (same ISO string)
 * 11.  Staleness / re-export warning appears in footer
 * 12.  Edge case: 0 tokens observed
 * 13.  Edge case: 100 % runway consumed (HONK)
 * 14.  Edge case: null model and project_id in active session
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateMarkdown } from '../src/state/state_generator.js';
import type { StatusData } from '../src/status.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * A minimal active_session row shape mirroring the interface in status.ts.
 * Fields are nullable exactly as the real DB row would be.
 */
interface ActiveSessionRow {
  session_id:      string | null;
  started_at:      string | null;
  goose_level:     string | null;
  tokens_observed: number;
  provider:        string | null;
  model:           string | null;
  project_id:      string | null;
}

/**
 * Builds a StatusData fixture with sensible defaults.
 * Override individual fields via the partial argument.
 *
 * Defaults represent a healthy CRUISING session at 25 % consumed:
 *   baseline = 40 000, tokensObserved = 10 000, runwayPct = 75
 */
function makeData(overrides: Partial<StatusData> = {}): StatusData {
  const baseline       = 40_000;
  const tokensObserved = 10_000;
  const runwayTokens   = baseline - tokensObserved;
  const runwayPct      = 75;

  const defaultActive: ActiveSessionRow = {
    session_id:      'test-session-001',
    started_at:      new Date(Date.now() - 30 * 60_000).toISOString(), // 30 min ago
    goose_level:     'CRUISING',
    tokens_observed: tokensObserved,
    provider:        'Test Provider',
    model:           'test-model-3',
    project_id:      'proj-alpha',
  };

  return {
    level:            'CRUISING',
    sessionActive:    true,
    runwayPct,
    runwayTokens,
    tokensObserved,
    baseline,
    warnThreshold:    25,
    providerName:     'Test Provider',
    active:           defaultActive,
    sessionsArchived: 2,
    phase2Remaining:  3,
    ...overrides,
  };
}

// ─── Timestamp control ────────────────────────────────────────────────────────

const FIXED_ISO = '2026-05-06T10:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateMarkdown', () => {

  // ── 1. Section headers ──────────────────────────────────────────────────────

  describe('section headers', () => {
    it('contains the document title', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('# FlightPlan Runway State');
    });

    it('contains the Agent Contract header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## Agent Contract');
    });

    it('contains the Compass header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## 1. High-Level Metadata (The "Compass")');
    });

    it('contains the Flight Log header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## 2. Active Session (The "Flight Log")');
    });

    it('contains the Dead Reckoning header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## 3. Dead Reckoning Status');
    });

    it('contains the Instructions header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## 4. How To Use This File');
    });

    it('contains the Deferred section header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('## 5. Deliberately Deferred');
    });
  });

  // ── 2. Agent Contract table ─────────────────────────────────────────────────

  describe('Agent Contract table', () => {
    it('contains a HONK row', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('HONK');
      expect(md).toContain('Runway exhausted');
    });

    it('contains a TURBULENCE row', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('TURBULENCE');
      expect(md).toContain('Runway tight');
    });

    it('contains a HEADWIND row', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('HEADWIND');
      expect(md).toContain('Burning fast');
    });

    it('contains a CRUISING row', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('CRUISING');
      expect(md).toContain('Healthy');
    });

    it('contains a PREFLIGHT row', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('PREFLIGHT');
      expect(md).toContain('No session');
    });

    it('has a table header row with Level, State, and Action columns', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('| Level | State | Action |');
    });
  });

  // ── 3. Compass section ──────────────────────────────────────────────────────

  describe('Compass section', () => {
    it('shows the current GooseLevel', () => {
      const md = generateMarkdown(makeData({ level: 'HEADWIND' }));
      expect(md).toContain('**Goose Scale Level:** HEADWIND');
    });

    it('shows runway percent', () => {
      const md = generateMarkdown(makeData({ runwayPct: 75, runwayTokens: 30_000 }));
      expect(md).toContain('75%');
    });

    it('shows runway token count', () => {
      const md = generateMarkdown(makeData({ runwayPct: 75, runwayTokens: 30_000 }));
      expect(md).toContain('30,000 tokens');
    });

    it('shows tokens observed', () => {
      const md = generateMarkdown(makeData({ tokensObserved: 10_000, baseline: 40_000 }));
      expect(md).toContain('10,000');
    });

    it('shows baseline', () => {
      const md = generateMarkdown(makeData({ baseline: 40_000 }));
      expect(md).toContain('40,000 baseline');
    });

    it('shows warning threshold when enabled', () => {
      const md = generateMarkdown(makeData({ warnThreshold: 25 }));
      expect(md).toContain('25% (warnings enabled)');
    });

    it('shows Disabled when warn threshold is 0', () => {
      const md = generateMarkdown(makeData({ warnThreshold: 0 }));
      expect(md).toContain('Disabled');
    });

    it('shows Session Active: Yes when session is active', () => {
      const md = generateMarkdown(makeData({ sessionActive: true }));
      expect(md).toContain('**Session Active:** Yes');
    });

    it('shows Session Active: No when no session', () => {
      const md = generateMarkdown(makeData({ sessionActive: false }));
      expect(md).toContain('**Session Active:** No');
    });

    it('shows the correct health label for CRUISING', () => {
      const md = generateMarkdown(makeData({ level: 'CRUISING' }));
      expect(md).toContain('🟢 Healthy — proceed normally');
    });

    it('shows the correct health label for HONK', () => {
      const md = generateMarkdown(makeData({ level: 'HONK' }));
      expect(md).toContain('🔴 Critical');
    });

    it('shows the correct health label for TURBULENCE', () => {
      const md = generateMarkdown(makeData({ level: 'TURBULENCE' }));
      expect(md).toContain('🟠 Warning');
    });

    it('shows the correct health label for HEADWIND', () => {
      const md = generateMarkdown(makeData({ level: 'HEADWIND' }));
      expect(md).toContain('🟡 Caution');
    });

    it('shows the correct health label for PREFLIGHT', () => {
      const md = generateMarkdown(makeData({ level: 'PREFLIGHT' }));
      expect(md).toContain('Standby — no session active');
    });

    it('includes Goose level guidance subsection', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('### What the Goose Scale level means right now');
    });
  });

  // ── 4 & 5. Flight Log — active session ─────────────────────────────────────

  describe('Flight Log — active session', () => {
    it('renders a table when session is active', () => {
      const md = generateMarkdown(makeData({ sessionActive: true }));
      expect(md).toContain('| Session ID |');
      expect(md).toContain('| Started At |');
      expect(md).toContain('| Duration |');
      expect(md).toContain('| Tokens Observed |');
      expect(md).toContain('| Tokens Remaining |');
      expect(md).toContain('| Model |');
      expect(md).toContain('| Project |');
    });

    it('shows the session_id in the table', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('test-session-001');
    });

    it('shows the model in the table', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('test-model-3');
    });

    it('shows the project_id in the table', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('proj-alpha');
    });

    it('shows a duration in minutes', () => {
      const md = generateMarkdown(makeData());
      // ~30 min session — just check "min" appears in the Flight Log section
      expect(md).toMatch(/\d+ min/);
    });
  });

  // ── 6. Flight Log — no active session ──────────────────────────────────────

  describe('Flight Log — PREFLIGHT (no active session)', () => {
    function preflightData(): StatusData {
      return makeData({
        level:         'PREFLIGHT',
        sessionActive: false,
        active:        undefined,
      });
    }

    it('shows the PREFLIGHT message', () => {
      const md = generateMarkdown(preflightData());
      expect(md).toContain('No session is currently active (PREFLIGHT state).');
    });

    it('does not render a session table', () => {
      const md = generateMarkdown(preflightData());
      expect(md).not.toContain('| Session ID |');
    });

    it('tells the user to call session_start()', () => {
      const md = generateMarkdown(preflightData());
      expect(md).toContain('session_start()');
    });
  });

  // ── 7. Null model / project_id fallbacks ────────────────────────────────────

  describe('Flight Log — null model and project_id', () => {
    it('renders *(not set)* for null model', () => {
      const data = makeData({
        active: {
          session_id:      'sess-null-fields',
          started_at:      new Date(Date.now() - 10 * 60_000).toISOString(),
          goose_level:     'CRUISING',
          tokens_observed: 5_000,
          provider:        'Test',
          model:           null,
          project_id:      null,
        },
      });
      const md = generateMarkdown(data);
      expect(md).toContain('*(not set)*');
    });

    it('renders *(not set)* for null project_id', () => {
      const data = makeData({
        active: {
          session_id:      'sess-null-fields-2',
          started_at:      new Date(Date.now() - 10 * 60_000).toISOString(),
          goose_level:     'CRUISING',
          tokens_observed: 5_000,
          provider:        'Test',
          model:           null,
          project_id:      null,
        },
      });
      const md = generateMarkdown(data);
      // Two *(not set)* entries — one for model, one for project_id
      const matches = md.match(/\*\(not set\)\*/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 8. Dead Reckoning countdown ─────────────────────────────────────────────

  describe('Dead Reckoning countdown', () => {
    it('shows 3 sessions remaining when sessionsArchived = 2', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 2, phase2Remaining: 3 }));
      expect(md).toContain('Unlocks in 3 more sessions');
    });

    it('shows 1 session remaining (singular) when phase2Remaining = 1', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 4, phase2Remaining: 1 }));
      expect(md).toContain('Unlocks in 1 more session');
      // must be singular, not "sessions"
      expect(md).not.toContain('Unlocks in 1 more sessions');
    });

    it('shows correct sessions archived count', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 3, phase2Remaining: 2 }));
      expect(md).toContain('**Sessions Archived:** 3');
    });

    it('footer countdown matches phase2Remaining', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 1, phase2Remaining: 4 }));
      // Footer line: "These fields activate automatically after N more completed session(s)."
      expect(md).toContain('after 4 more completed session');
    });
  });

  // ── 9. Dead Reckoning active (sessionsArchived ≥ 5) ────────────────────────

  describe('Dead Reckoning active', () => {
    it('shows Active status when sessionsArchived = 5', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 5, phase2Remaining: 0 }));
      expect(md).toContain('✅ Active — baseline is auto-calibrating from real session data');
    });

    it('shows Active status when sessionsArchived > 5', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 12, phase2Remaining: 0 }));
      expect(md).toContain('✅ Active');
    });

    it('does NOT show "Unlocks in" when phase2Remaining = 0', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 5, phase2Remaining: 0 }));
      expect(md).not.toContain('Unlocks in');
    });

    it('footer shows 0 more sessions needed', () => {
      const md = generateMarkdown(makeData({ sessionsArchived: 5, phase2Remaining: 0 }));
      expect(md).toContain('after 0 more completed session');
    });
  });

  // ── 10. Timestamp in header and footer ──────────────────────────────────────

  describe('timestamp', () => {
    it('appears in the document header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain(`**Generated:** ${FIXED_ISO}`);
    });

    it('appears in the footer (Snapshot taken at)', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain(`Snapshot taken at ${FIXED_ISO}`);
    });

    it('header and footer share the same timestamp', () => {
      const md = generateMarkdown(makeData());
      // Both references use the same ISO string — count occurrences
      const occurrences = (md.match(new RegExp(FIXED_ISO, 'g')) ?? []).length;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 11. Staleness warning ────────────────────────────────────────────────────

  describe('staleness warning', () => {
    it('contains the snapshot re-export instruction in the footer', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('Re-export before long tasks');
    });

    it('contains the flightplan export command reminder in footer', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('flightplan export');
    });

    it('contains the point-in-time snapshot warning in header', () => {
      const md = generateMarkdown(makeData());
      expect(md).toContain('point-in-time snapshot');
    });
  });

  // ── 12. Edge case: 0 tokens observed ────────────────────────────────────────

  describe('edge case — 0 tokens observed', () => {
    it('renders without error', () => {
      const data = makeData({
        tokensObserved: 0,
        runwayPct:      100,
        runwayTokens:   40_000,
        level:          'CRUISING',
      });
      expect(() => generateMarkdown(data)).not.toThrow();
    });

    it('shows 0 tokens observed in the Compass', () => {
      const data = makeData({
        tokensObserved: 0,
        runwayPct:      100,
        runwayTokens:   40_000,
      });
      const md = generateMarkdown(data);
      expect(md).toContain('0 / 40,000 baseline');
    });

    it('shows 100% runway remaining', () => {
      const data = makeData({
        tokensObserved: 0,
        runwayPct:      100,
        runwayTokens:   40_000,
      });
      const md = generateMarkdown(data);
      expect(md).toContain('100%');
    });
  });

  // ── 13. Edge case: 100 % runway consumed (HONK) ─────────────────────────────

  describe('edge case — 100% runway consumed (HONK)', () => {
    it('renders without error', () => {
      const data = makeData({
        level:          'HONK',
        runwayPct:      0,
        runwayTokens:   0,
        tokensObserved: 40_000,
        baseline:       40_000,
      });
      expect(() => generateMarkdown(data)).not.toThrow();
    });

    it('shows HONK level in Compass', () => {
      const data = makeData({
        level:          'HONK',
        runwayPct:      0,
        runwayTokens:   0,
        tokensObserved: 40_000,
        baseline:       40_000,
      });
      const md = generateMarkdown(data);
      expect(md).toContain('**Goose Scale Level:** HONK');
    });

    it('shows 0% runway remaining', () => {
      const data = makeData({
        level:          'HONK',
        runwayPct:      0,
        runwayTokens:   0,
        tokensObserved: 40_000,
        baseline:       40_000,
      });
      const md = generateMarkdown(data);
      expect(md).toContain('0% (0 tokens)');
    });

    it('shows HONK guidance in the Compass', () => {
      const data = makeData({
        level:          'HONK',
        runwayPct:      0,
        runwayTokens:   0,
        tokensObserved: 40_000,
        baseline:       40_000,
      });
      const md = generateMarkdown(data);
      expect(md).toContain('Runway is exhausted');
    });
  });

  // ── Provider name in header ──────────────────────────────────────────────────

  describe('provider name', () => {
    it('appears in the document header', () => {
      const md = generateMarkdown(makeData({ providerName: 'Augure' }));
      expect(md).toContain('**Provider:** Augure');
    });
  });

  // ── Return type ──────────────────────────────────────────────────────────────

  describe('return type', () => {
    it('returns a non-empty string', () => {
      const md = generateMarkdown(makeData());
      expect(typeof md).toBe('string');
      expect(md.length).toBeGreaterThan(0);
    });

    it('is a single concatenated string (no accidental array)', () => {
      const md = generateMarkdown(makeData());
      expect(Array.isArray(md)).toBe(false);
    });
  });
});
