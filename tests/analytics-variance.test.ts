/**
 * tests/analytics-variance.test.ts — Variance classification tests
 *
 * Tests the single-source-of-truth classifier for RuntimeResourceObservation.
 * Proves:
 *   - Priority ordering (EXCEEDED > AT_RISK > ELEVATED > NOMINAL)
 *   - Determinism (same inputs → same output)
 *   - Threshold boundary behavior
 *   - Guard against divide-by-zero
 */

import { describe, it, expect } from 'vitest';
import {
  classifyVariance,
  VARIANCE_THRESHOLDS,
  type VarianceClassification,
} from '../src/analytics/variance.js';
import type { DeadReckoningEstimate } from '../src/analytics/dead_reckoning.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makeEstimate(
  p50: number,
  p80: number,
  p95: number,
  overrides: Partial<DeadReckoningEstimate> = {},
): DeadReckoningEstimate {
  return {
    estimated_tokens: { p50, p80, p95 },
    confidence: 'medium',
    historical_basis: { matching_sessions: 10, scope: 'provider_model' },
    baseline_source: 'calibrated',
    fallback_used: false,
    ...overrides,
  };
}

// ─── Priority ordering tests ───────────────────────────────────────────────────

describe('classifyVariance', () => {
  describe('priority ordering', () => {
    it('classifies EXCEEDED when p80 > 100% even if p50 is also high', () => {
      // p50=10000, p80=20000, tokens=21000
      // consumed_pct_of_p50 = 210%, consumed_pct_of_p80 = 105%
      // Without priority ordering, could match ELEVATED first (p50 > 75%)
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(21000, estimate);

      expect(result.state).toBe('EXCEEDED');
      expect(result.consumed_pct_of_p50).toBe(210);
      expect(result.consumed_pct_of_p80).toBe(105);
    });

    it('classifies AT_RISK when p80 is 91% but p50 would also trigger ELEVATED', () => {
      // p50=10000, p80=20000, tokens=18500
      // consumed_pct_of_p50 = 185%, consumed_pct_of_p80 = 92.5%
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(18500, estimate);

      expect(result.state).toBe('AT_RISK');
    });

    it('classifies ELEVATED when p50 > 75% but p80 <= 90%', () => {
      // p50=10000, p80=20000, tokens=8000
      // consumed_pct_of_p50 = 80%, consumed_pct_of_p80 = 40%
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(8000, estimate);

      expect(result.state).toBe('ELEVATED');
    });

    it('classifies NOMINAL when both thresholds are below', () => {
      // p50=10000, p80=20000, tokens=5000
      // consumed_pct_of_p50 = 50%, consumed_pct_of_p80 = 25%
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(5000, estimate);

      expect(result.state).toBe('NOMINAL');
    });
  });

  // ─── Threshold boundary tests ──────────────────────────────────────────────

  describe('threshold boundaries', () => {
    it('NOMINAL at exactly 75% of p50', () => {
      // p50=10000, tokens=7500 → 75% exactly (not > 75)
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(7500, estimate);

      expect(result.state).toBe('NOMINAL');
    });

    it('ELEVATED at 75.01% of p50', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(7501, estimate);

      expect(result.state).toBe('ELEVATED');
    });

    it('ELEVATED at exactly 90% of p80 (AT_RISK requires > 90)', () => {
      // p80=20000, tokens=18000 → 90% exactly (not > 90)
      // consumed_pct_of_p50 = 180%, consumed_pct_of_p80 = 90%
      // EXCEEDED: 90 > 100? No
      // AT_RISK: 90 > 90? No (strictly greater)
      // ELEVATED: 180 > 75? Yes → ELEVATED
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(18000, estimate);

      expect(result.state).toBe('ELEVATED');
    });

    it('AT_RISK at 90.01% of p80', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(18001, estimate);

      expect(result.state).toBe('AT_RISK');
    });

    it('AT_RISK at exactly 100% of p80 (EXCEEDED requires > 100)', () => {
      // consumed_pct_of_p80 = 100, not > 100
      // AT_RISK: 100 > 90? Yes → AT_RISK
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(20000, estimate);

      expect(result.state).toBe('AT_RISK');
    });

    it('EXCEEDED at 100.01% of p80', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(20001, estimate);

      expect(result.state).toBe('EXCEEDED');
    });
  });

  // ─── Determinism tests ─────────────────────────────────────────────────────

  describe('determinism', () => {
    it('same inputs produce same output', () => {
      const estimate = makeEstimate(15000, 25000, 40000);
      const r1 = classifyVariance(12000, estimate);
      const r2 = classifyVariance(12000, estimate);

      expect(r1).toEqual(r2);
    });

    it('different inputs produce different outputs', () => {
      const estimate = makeEstimate(15000, 25000, 40000);
      const r1 = classifyVariance(5000, estimate);
      const r2 = classifyVariance(20000, estimate);

      expect(r1.state).not.toBe(r2.state);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('zero tokens consumed → NOMINAL', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(0, estimate);

      expect(result.state).toBe('NOMINAL');
      expect(result.consumed_pct_of_p50).toBe(0);
      expect(result.consumed_pct_of_p80).toBe(0);
    });

    it('zero p50 and p80 → NOMINAL with 0% (guard against divide-by-zero)', () => {
      const estimate = makeEstimate(0, 0, 0);
      const result = classifyVariance(5000, estimate);

      expect(result.state).toBe('NOMINAL');
      expect(result.consumed_pct_of_p50).toBe(0);
      expect(result.consumed_pct_of_p80).toBe(0);
      expect(result.remaining_tokens).toBeNull();
    });

    it('remaining_tokens is null when p80 is 0', () => {
      const estimate = makeEstimate(0, 0, 0);
      const result = classifyVariance(5000, estimate);

      expect(result.remaining_tokens).toBeNull();
    });

    it('remaining_tokens is 0 when consumption exceeds p80', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(25000, estimate);

      expect(result.remaining_tokens).toBe(0);
    });

    it('remaining_tokens is positive when under p80', () => {
      const estimate = makeEstimate(10000, 20000, 30000);
      const result = classifyVariance(5000, estimate);

      expect(result.remaining_tokens).toBe(15000);
    });
  });

  // ─── Threshold constants ──────────────────────────────────────────────────

  describe('threshold constants', () => {
    it('exposes thresholds for external testability', () => {
      expect(VARIANCE_THRESHOLDS.elevated_p50_pct).toBe(75);
      expect(VARIANCE_THRESHOLDS.at_risk_p80_pct).toBe(90);
      expect(VARIANCE_THRESHOLDS.exceeded_p80_pct).toBe(100);
    });
  });
});
