import { describe, expect, it } from 'vitest';
import {
  calculateScore,
  estimateProgramDuration,
  validateScoringConfig,
} from '../../src/features/scoring/scoring';
import { calculateTrimScore } from '../../src/features/voxel/similarity';
import type {
  JointConfig,
  ScoringConfig,
  VoxelKey,
} from '../../src/types/domain';

const scoring: ScoringConfig = {
  weights: { completion: 0.6, efficiency: 0.25, time: 0.15 },
  referenceProgramCost: 10,
  referenceTimeMs: 5_000,
  commandWeight: 0.25,
};

describe('trim score', () => {
  const hair = (...keys: string[]) => new Set(keys as VoxelKey[]);
  // Four voxels of hair; the challenge asks for the first two off.
  const initial = hair('0,0,0', '1,0,0', '2,0,0', '3,0,0');
  const target = hair('2,0,0', '3,0,0');

  it('scores an untouched head zero, not the size of the hairstyle', () => {
    // The regression this metric exists for. Comparing what was left standing
    // scored this 50 here and 95.02 on the shipped challenge, because most hair
    // is never meant to be cut.
    expect(calculateTrimScore(initial, target, initial)).toBe(0);
  });

  it('scores the asked cut exactly 100', () => {
    expect(calculateTrimScore(initial, target, target)).toBe(100);
  });

  it('scales with how much of the asked cut was made', () => {
    // One of the two asked voxels removed.
    expect(
      calculateTrimScore(initial, target, hair('1,0,0', '2,0,0', '3,0,0')),
    ).toBe(50);
  });

  it('charges hair that should have stayed', () => {
    // Both asked voxels off, but two that should have stayed went too:
    // intersection 2, union 4.
    expect(calculateTrimScore(initial, target, hair())).toBe(50);
    // Cut only hair nobody asked for.
    expect(
      calculateTrimScore(initial, target, hair('0,0,0', '1,0,0')),
    ).toBe(0);
  });

  it('treats a challenge that asks for nothing as satisfied by nothing', () => {
    expect(calculateTrimScore(initial, initial, initial)).toBe(100);
    expect(calculateTrimScore(hair(), hair(), hair())).toBe(100);
  });
});

describe('score calculation', () => {
  it('returns a weighted and clamped breakdown', () => {
    const result = calculateScore({
      // Asked for two voxels off, one of them came off: completion 50.
      initialVoxels: new Set<VoxelKey>(['0,0,0', '1,0,0', '2,0,0']),
      targetVoxels: new Set<VoxelKey>(['2,0,0']),
      resultVoxels: new Set<VoxelKey>(['1,0,0', '2,0,0']),
      programMetrics: {
        sourceBlockCount: 10,
        executedCommandCount: 8,
        estimatedDurationMs: 10_000,
      },
      scoring,
    });

    expect(result.completionScore).toBe(50);
    expect(result.programCost).toBe(12);
    expect(result.efficiencyScore).toBeCloseTo(83.3333);
    expect(result.timeScore).toBe(50);
    expect(result.finalScore).toBeCloseTo(58.3333);
  });

  it('treats zero cost and zero duration as full scores', () => {
    const result = calculateScore({
      initialVoxels: new Set(),
      targetVoxels: new Set(),
      resultVoxels: new Set(),
      programMetrics: {
        sourceBlockCount: 0,
        executedCommandCount: 0,
        estimatedDurationMs: 0,
      },
      scoring,
    });

    expect(result).toMatchObject({
      completionScore: 100,
      efficiencyScore: 100,
      timeScore: 100,
      finalScore: 100,
    });
  });

  it('rejects scoring weights that do not sum to one', () => {
    expect(() =>
      validateScoringConfig({
        ...scoring,
        weights: { completion: 0.5, efficiency: 0.2, time: 0.2 },
      }),
    ).toThrow('must sum to 1');
  });
});

describe('program duration estimation', () => {
  const joints: JointConfig[] = [
    {
      id: 'joint',
      name: 'Joint',
      axis: 'z',
      minAngleDeg: -90,
      maxAngleDeg: 90,
      initialAngleDeg: 0,
      speedDegPerSec: 45,
    },
  ];

  it('updates simulated joint state sequentially', () => {
    const duration = estimateProgramDuration(
      [
        { type: 'set-joint-angle', jointId: 'joint', angleDeg: 45 },
        { type: 'wait', durationMs: 500 },
        { type: 'set-joint-angle', jointId: 'joint', angleDeg: -45 },
      ],
      joints,
    );

    expect(duration).toBe(3_500);
  });

  it('rejects unknown joints and invalid waits', () => {
    expect(() =>
      estimateProgramDuration(
        [{ type: 'set-joint-angle', jointId: 'missing', angleDeg: 0 }],
        joints,
      ),
    ).toThrow('Unknown joint');
    expect(() =>
      estimateProgramDuration(
        [{ type: 'wait', durationMs: -1 }],
        joints,
      ),
    ).toThrow('non-negative');
  });
});
