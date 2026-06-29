/**
 * tests/analytics-percentiles.test.ts — Percentile calculation tests
 *
 * Tests the pure percentile functions.
 * No DB access — pure computation tests.
 */

import { describe, it, expect } from 'vitest';
import { calculatePercentiles, percentile, sortedCopy } from '../src/analytics/percentiles.js';

describe('sortedCopy', () => {
  it('returns sorted copy without mutating input', () => {
    const input = [3, 1, 2];
    const result = sortedCopy(input);
    expect(result).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]); // original unchanged
  });

  it('handles empty array', () => {
    expect(sortedCopy([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(sortedCopy([42])).toEqual([42]);
  });
});

describe('percentile', () => {
  it('p50 of [1,2,3,4,5] is 3', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('p80 of [1,2,3,4,5] is 4 (nearest-rank)', () => {
    expect(percentile([1, 2, 3, 4, 5], 80)).toBe(4);
  });

  it('p95 of [1,2,3,4,5] is 5', () => {
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
  });

  it('handles single element: p50, p80, p95 all return the same value', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 80)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('returns first element for p0', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
  });

  it('returns last element for p100', () => {
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  it('throws for empty array', () => {
    expect(() => percentile([], 50)).toThrow('empty array');
  });
});

describe('calculatePercentiles', () => {
  it('returns correct p50/p80/p95 for known array', () => {
    const values = [10000, 20000, 30000, 50000, 80000, 100000];
    const result = calculatePercentiles(values);
    expect(result.p50).toBe(30000);
    expect(result.p80).toBe(80000);
    expect(result.p95).toBe(100000);
  });

  it('does not mutate input array', () => {
    const input = [5, 3, 1, 4, 2];
    calculatePercentiles(input);
    expect(input).toEqual([5, 3, 1, 4, 2]);
  });

  it('throws for empty array', () => {
    expect(() => calculatePercentiles([])).toThrow('empty array');
  });

  it('handles single value array', () => {
    const result = calculatePercentiles([50000]);
    expect(result.p50).toBe(50000);
    expect(result.p80).toBe(50000);
    expect(result.p95).toBe(50000);
  });

  it('handles duplicate values', () => {
    const result = calculatePercentiles([100, 100, 100, 200, 200]);
    expect(result.p50).toBe(100);
    expect(result.p80).toBe(200);
    expect(result.p95).toBe(200);
  });

  it('is deterministic (same input = same output)', () => {
    const input = [12000, 45000, 32000, 89000, 15000, 67000, 23000, 55000];
    const a = calculatePercentiles(input);
    const b = calculatePercentiles(input);
    expect(a).toEqual(b);
  });
});
