import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
  regressionProgramSweptVoxelHits,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { cutterGridCoordToWorld, moveCutterGridCoord } from '../../src/features/cutter-grid/grid';
import { solveCutterGridIk } from '../../src/features/cutter-grid/ik';
import type { CutterGridCoord } from '../../src/features/cutter-grid/types';
import { computeRobotPose } from '../../src/features/robot/kinematics';
import { findRobotHeadCollision } from '../../src/features/robot/headCollision';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);
const originHairCoord = [0, -5, 8] as const;

describe('Cutter Grid global IK repair — Phase 0 diagnostic contract', () => {
  it('locks the player program, failure sample and fixed-axis endpoint', () => {
    expect(CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM.nodes).toEqual([
      { type: 'move', direction: 'up', distance: 6, sourceBlockId: 'regression-up' },
      { type: 'move', direction: 'left', distance: 2, sourceBlockId: 'regression-left' },
      {
        type: 'move',
        direction: 'forward',
        distance: 3,
        sourceBlockId: 'regression-forward',
      },
    ]);
    expect(regressionProgramRuntimeActions()).toHaveLength(11);
    expect(CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE).toMatchObject({
      actionIndex: 10,
      subdivisionIndex: 3,
      subdivisions: 4,
      targetCoord: CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
      targetWorld: [1.03, 1.66, 0.84],
    });

    let coord: CutterGridCoord = [0, 0, 0];
    for (const action of regressionProgramRuntimeActions()) {
      if (action.type !== 'move-cell') continue;
      coord = moveCutterGridCoord(coord, action.direction);
    }
    expect(coord).toEqual(CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD);
  });

  it('preserves the real 0.12-radius sweep baseline, including its extra cut', () => {
    expect(regressionProgramSweptVoxelHits(challenge, originHairCoord)).toEqual(
      CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS,
    );
    expect(CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS).toContain('-2,1,4');
    // The Crown Trim redesign moved this voxel into the kept set, so the
    // baseline now records a contact the challenge actively does not want —
    // which is the point: the sweep is never filtered by target membership.
    expect(challenge.targetHair.voxels.has('-2,1,4')).toBe(true);
  });

  it('proves that the alleged failure sample has a low-Wrist, collision-free static IK branch', () => {
    const solution = solveCutterGridIk(
      challenge,
      CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE.targetWorld,
      CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED,
      {
        maxError: challenge.voxelConfig.size / 32,
        quantizeOutput: false,
      },
    );

    expect(solution).toBeDefined();
    expect(solution?.error).toBeLessThanOrEqual(challenge.voxelConfig.size / 32);
    expect(solution?.jointAngles.wrist).toBeLessThan(90);
    if (!solution) return;
    expect(
      findRobotHeadCollision(
        computeRobotPose(challenge.robotConfig, solution.jointAngles),
        challenge.voxelConfig,
        challenge.robotConfig.geometry,
      ),
    ).toBeUndefined();
  });

  it('keeps a reverse, low-Wrist continuation from the terminal coordinate back to origin', () => {
    const terminal = cutterGridCoordToWorld(
      CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
      originHairCoord,
      challenge.voxelConfig,
    );
    let solution = solveCutterGridIk(
      challenge,
      terminal,
      CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED,
      { maxError: challenge.voxelConfig.size / 32, quantizeOutput: false },
    );
    expect(solution).toBeDefined();
    if (!solution) return;

    const inverseDirections = [
      ...Array.from({ length: 3 }, () => 'backward' as const),
      ...Array.from({ length: 2 }, () => 'right' as const),
      ...Array.from({ length: 6 }, () => 'down' as const),
    ];
    let coord = CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD;
    for (const direction of inverseDirections) {
      const next = moveCutterGridCoord(coord, direction);
      const start = cutterGridCoordToWorld(coord, originHairCoord, challenge.voxelConfig);
      const end = cutterGridCoordToWorld(next, originHairCoord, challenge.voxelConfig);
      for (let subdivision = 1; subdivision <= 4; subdivision += 1) {
        const t = subdivision / 4;
        const target = [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
          start[2] + (end[2] - start[2]) * t,
        ] as const;
        solution = solveCutterGridIk(challenge, target, solution.jointAngles, {
          maxError: challenge.voxelConfig.size / 32,
          quantizeOutput: false,
        });
        expect(solution, `${direction} ${subdivision}/4`).toBeDefined();
        if (!solution) return;
        expect(
          findRobotHeadCollision(
            computeRobotPose(challenge.robotConfig, solution.jointAngles),
            challenge.voxelConfig,
            challenge.robotConfig.geometry,
          ),
        ).toBeUndefined();
      }
      coord = next;
    }

    expect(coord).toEqual([0, 0, 0]);
    expect(solution.jointAngles.wrist).toBeLessThan(100);
  }, 30_000);
});
