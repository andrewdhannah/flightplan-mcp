/**
 * src/analytics/percentiles.ts — Deterministic percentile calculation
 *
 * Pure functions for calculating p50, p80, p95 from a sorted array of numbers.
 * No DB access, no side effects.
 *
 * Algorithm: nearest-rank method (also called "closest rank").
 * This is deterministic and well-defined for any array length >= 1.
 */

import type { PercentileResult } from './types.js';

/**
 * Sorts a copy of the input array in ascending order.
 * Pure function — does not mutate the input.
 */
export function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Calculates the k-th percentile from a sorted array using nearest-rank method.
 *
 * nearest-rank: index = ceil(k/100 * N), then return sorted[index - 1].
 * This matches the Excel PERCENTILE.INC behaviour for most data sizes.
 *
 * @param sorted - Pre-sorted ascending array of numbers (will NOT be sorted internally)
 * @param k - Percentile to calculate (0-100), e.g. 50 for median
 * @returns The k-th percentile value
 * @throws If array is empty
 */
export function percentile(sorted: number[], k: number): number {
  if (sorted.length === 0) {
    throw new Error(`Cannot calculate ${k}th percentile of empty array`);
  }

  const n = sorted.length;
  const rank = Math.ceil((k / 100) * n);
  const index = Math.min(Math.max(rank - 1, 0), n - 1);

  // noUncheckedIndexedAccess — safe guard after clamp
  const value = sorted[index];
  return value ?? sorted[n - 1] ?? 0;
}

/**
 * Calculate p50, p80, p95 from a numeric array.
 * Sorts a copy internally — input is not mutated.
 *
 * @param values - Array of numbers (may be unsorted)
 * @returns PercentileResult with p50, p80, p95
 * @throws If array is empty
 */
export function calculatePercentiles(values: number[]): PercentileResult {
  if (values.length === 0) {
    throw new Error('Cannot calculate percentiles of empty array');
  }

  const sorted = sortedCopy(values);

  return {
    p50: percentile(sorted, 50),
    p80: percentile(sorted, 80),
    p95: percentile(sorted, 95),
  };
}
