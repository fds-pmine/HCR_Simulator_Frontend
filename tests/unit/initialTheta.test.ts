import { describe, expect, it } from 'vitest';
import {
  THETA_LIMIT,
  initialThetaFrom,
} from '../../src/features/practice/initialTheta';

describe('seeding the ability estimate', () => {
  it('puts an average score at the item difficulty', () => {
    // p = 0.5 means the learner is exactly at the item's level, which is what
    // θ = b encodes in the 1PL model.
    expect(initialThetaFrom(50, 0)).toBeCloseTo(0, 6);
    expect(initialThetaFrom(50, 1.2)).toBeCloseTo(1.2, 6);
  });

  it('moves the estimate in the direction of the evidence', () => {
    expect(initialThetaFrom(90)).toBeGreaterThan(0);
    expect(initialThetaFrom(20)).toBeLessThan(0);
    expect(initialThetaFrom(90)).toBeGreaterThan(initialThetaFrom(70));
  });

  it('never returns an infinite ability for a perfect or zero score', () => {
    // The 1PL inversion sends p = 1 to +infinity, which would poison every
    // subsequent selection.
    expect(Number.isFinite(initialThetaFrom(100))).toBe(true);
    expect(Number.isFinite(initialThetaFrom(0))).toBe(true);
    expect(Math.abs(initialThetaFrom(100))).toBeLessThanOrEqual(THETA_LIMIT);
    expect(Math.abs(initialThetaFrom(0))).toBeLessThanOrEqual(THETA_LIMIT);
  });

  it('stays inside the range the bank spans', () => {
    for (const score of [0, 1, 25, 50, 75, 99, 100]) {
      expect(Math.abs(initialThetaFrom(score, 2))).toBeLessThanOrEqual(THETA_LIMIT);
    }
  });
});
