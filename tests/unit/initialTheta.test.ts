import { describe, expect, it } from 'vitest';
import {
  THETA_LIMIT,
  initialThetaFrom,
} from '../../src/features/practice/initialTheta';

describe('seeding the ability estimate', () => {
  it('puts a mid-range score at the item difficulty', () => {
    // p = 0.5 means the learner is exactly at the item's level, which is what
    // θ = b encodes in the 1PL model. Shrinkage pulls toward 0, so a non-zero
    // difficulty lands proportionally short of itself.
    expect(initialThetaFrom(50)).toBeCloseTo(0, 6);
    expect(initialThetaFrom(50, 1.2)).toBeCloseTo(0.6, 6);
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
      expect(Math.abs(initialThetaFrom(score, 2))).toBeLessThanOrEqual(
        THETA_LIMIT,
      );
    }
  });

  /**
   * The regression this file exists for.
   *
   * Completion used to compare the hair left standing, so an empty program
   * scored 95.02 on the shipped opener and the whole achievable range mapped to
   * θ ∈ [2.949, 3.000] — every learner pinned at the top of the bank and served
   * its hardest items. This function carried a `baselineScore` parameter to
   * subtract that floor back out. Scoring the cut made the floor a real zero, so
   * the seed is now just an honest reading of the score it is handed.
   */
  it('spreads the achievable range across a usable band', () => {
    const doingNothing = initialThetaFrom(0);
    const halfway = initialThetaFrom(50);
    const perfect = initialThetaFrom(100);

    expect(doingNothing).toBeLessThan(-1);
    expect(halfway).toBeCloseTo(0, 6);
    expect(perfect).toBeGreaterThan(1);
    expect(perfect - doingNothing).toBeGreaterThan(3);
    // Neither end may sit on the rail, which is what sent the selector to the
    // edge of the bank.
    expect(Math.abs(perfect)).toBeLessThan(THETA_LIMIT);
    expect(Math.abs(doingNothing)).toBeLessThan(THETA_LIMIT);
  });
});
