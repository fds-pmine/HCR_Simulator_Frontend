import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { createInitialJointAngles } from '../../src/features/robot/kinematics';
import { cutterGridCoordToWorld } from '../../src/features/cutter-grid/grid';
import {
  CUTTER_GRID_IK_CONFIG,
  solveCutterGridIk,
} from '../../src/features/cutter-grid/ik';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('deterministic Cutter Grid IK', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('uses the fixed v1 numerical parameters', () => {
    expect(CUTTER_GRID_IK_CONFIG).toEqual({
      maxIterations: 80,
      jacobianStepDeg: 0.1,
      damping: 0.05,
      maxUpdateDeg: 2,
      angleQuantumDeg: 0.1,
    });
  });

  it('finds the certified origin candidate deterministically within voxelSize/16', () => {
    const initial = createInitialJointAngles(challenge.robotConfig);
    const target = cutterGridCoordToWorld(
      [0, 0, 0],
      [0, -5, 8],
      challenge.voxelConfig,
    );
    const first = solveCutterGridIk(challenge, target, initial, {
      maxError: challenge.voxelConfig.size / 16,
    });
    const second = solveCutterGridIk(challenge, target, initial, {
      maxError: challenge.voxelConfig.size / 16,
    });

    expect(first).toBeDefined();
    expect(first).toEqual(second);
    expect(first?.error).toBeLessThanOrEqual(challenge.voxelConfig.size / 16);
    for (const joint of challenge.robotConfig.joints) {
      expect(first?.jointAngles[joint.id]).toBeGreaterThanOrEqual(joint.minAngleDeg);
      expect(first?.jointAngles[joint.id]).toBeLessThanOrEqual(joint.maxAngleDeg);
      expect((first?.jointAngles[joint.id] ?? 0) * 10).toBeCloseTo(
        Math.round((first?.jointAngles[joint.id] ?? 0) * 10),
      );
    }
  });

  it('solves representative crown lattice points from a stable global seed', () => {
    const initial = createInitialJointAngles(challenge.robotConfig);
    for (const coord of [
      [-2, 9, -4],
      [-3, 9, -3],
      [-3, 10, -3],
      [-2, 10, -3],
    ] as const) {
      const target = cutterGridCoordToWorld(
        coord,
        [0, -5, 8],
        challenge.voxelConfig,
      );
      const solution = solveCutterGridIk(challenge, target, initial, {
        maxError: challenge.voxelConfig.size / 16,
      });
      expect(
        solution,
        `Expected ${coord.join(',')} to have a canonical IK solution`,
      ).toBeDefined();
    }
  });

  it('stays on a continuous quantized branch along one grid edge', () => {
    let previous = solveCutterGridIk(
      challenge,
      [1.35, 0.7, 1.28],
      createInitialJointAngles(challenge.robotConfig),
      { maxError: challenge.voxelConfig.size / 16 },
    );
    expect(previous).toBeDefined();
    let largestDelta = 0;
    const deltas: number[] = [];
    for (let index = 1; index <= 8; index += 1) {
      const target = [
        1.35 - (challenge.voxelConfig.size * index) / 8,
        0.7,
        1.28,
      ] as const;
      const next = solveCutterGridIk(
        challenge,
        target,
        previous?.jointAngles ?? {},
        {
          maxError: challenge.voxelConfig.size / 32,
          maxNormalizedChange: 0.1,
        },
      );
      expect(next).toBeDefined();
      const stepDelta = Math.max(
        ...challenge.robotConfig.joints.map((joint) =>
          Math.abs(
            (next?.jointAngles[joint.id] ?? 0) -
              (previous?.jointAngles[joint.id] ?? 0),
          ),
        ),
      );
      deltas.push(stepDelta);
      largestDelta = Math.max(largestDelta, stepDelta);
      previous = next;
    }
    expect(largestDelta, `joint deltas: ${deltas.join(',')}`).toBeLessThan(5);
  });
});
