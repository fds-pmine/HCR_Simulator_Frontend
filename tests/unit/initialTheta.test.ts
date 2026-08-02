import { describe, expect, it } from 'vitest';
import {
  THETA_LIMIT,
  initialThetaFrom,
} from '../../src/features/practice/initialTheta';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import { calculateVoxelIoU } from '../../src/features/voxel/similarity';

/** A scale with a zero floor, for the arithmetic-only cases. */
const fromZero = { baselineScore: 0 };

describe('seeding the ability estimate', () => {
  it('puts a mid-range score at the item difficulty', () => {
    // Halfway up the achievable range means p = 0.5, which is what θ = b
    // encodes in the 1PL model. Shrinkage pulls toward 0, so a non-zero
    // difficulty lands proportionally short of itself.
    expect(initialThetaFrom(50, fromZero)).toBeCloseTo(0, 6);
    expect(initialThetaFrom(50, { baselineScore: 0, difficulty: 1.2 }))
      .toBeCloseTo(0.6, 6);
  });

  it('moves the estimate in the direction of the evidence', () => {
    expect(initialThetaFrom(90, fromZero)).toBeGreaterThan(0);
    expect(initialThetaFrom(20, fromZero)).toBeLessThan(0);
    expect(initialThetaFrom(90, fromZero)).toBeGreaterThan(
      initialThetaFrom(70, fromZero),
    );
  });

  it('never returns an infinite ability for a perfect or zero score', () => {
    // The 1PL inversion sends p = 1 to +infinity, which would poison every
    // subsequent selection.
    expect(Number.isFinite(initialThetaFrom(100, fromZero))).toBe(true);
    expect(Number.isFinite(initialThetaFrom(0, fromZero))).toBe(true);
    expect(Math.abs(initialThetaFrom(100, fromZero))).toBeLessThanOrEqual(
      THETA_LIMIT,
    );
    expect(Math.abs(initialThetaFrom(0, fromZero))).toBeLessThanOrEqual(
      THETA_LIMIT,
    );
  });

  it('stays inside the range the bank spans', () => {
    for (const score of [0, 1, 25, 50, 75, 99, 100]) {
      expect(
        Math.abs(initialThetaFrom(score, { baselineScore: 0, difficulty: 2 })),
      ).toBeLessThanOrEqual(THETA_LIMIT);
    }
  });

  it('measures against the baseline rather than against zero', () => {
    // Matching the score an empty program earns is no evidence of ability, so
    // it must not read as a high one.
    expect(initialThetaFrom(95, { baselineScore: 95 })).toBeLessThan(0);
    // The same raw score means opposite things on different scales.
    expect(initialThetaFrom(96, { baselineScore: 95 })).toBeLessThan(
      initialThetaFrom(96, { baselineScore: 0 }),
    );
  });

  it('treats a challenge with no headroom as no evidence', () => {
    expect(initialThetaFrom(100, { baselineScore: 100 })).toBe(0);
    expect(initialThetaFrom(100, { baselineScore: 100, difficulty: 1 })).toBe(1);
  });

  /**
   * The regression this file exists for.
   *
   * Seeded from the raw completion score, the shipped opener mapped its whole
   * achievable range — an empty program included — to θ ∈ [2.949, 3.000]. Every
   * learner was pinned at the top of the bank and served its hardest items.
   */
  it('spreads the shipped opener across a usable range', () => {
    const challenge = normalizeChallenge(defaultChallengeDefinition);
    const baselineScore = calculateVoxelIoU(
      challenge.targetHair.voxels,
      challenge.initialHair.voxels,
    );

    // Doing nothing still scores 95 on the raw scale; it must not read as
    // ability.
    expect(baselineScore).toBeGreaterThan(90);
    const doingNothing = initialThetaFrom(baselineScore, { baselineScore });
    const perfect = initialThetaFrom(100, { baselineScore });

    expect(doingNothing).toBeLessThan(-1);
    expect(perfect).toBeGreaterThan(1);
    expect(perfect - doingNothing).toBeGreaterThan(3);
    // Neither end may sit on the rail, which is what sent the selector to the
    // edge of the bank.
    expect(Math.abs(perfect)).toBeLessThan(THETA_LIMIT);
    expect(Math.abs(doingNothing)).toBeLessThan(THETA_LIMIT);
  });
});
