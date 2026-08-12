import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  deriveCutterGridBounds,
  hairBoundsToLogicalBounds,
} from '../../src/features/cutter-grid/grid';
import { solveCutterGridIk } from '../../src/features/cutter-grid/ik';
import { expandCutterGridProgram } from '../../src/features/cutter-grid/programCompiler';
import { findCutterGridReferenceProgram } from '../../src/features/cutter-grid/referenceProgram';
import { cutterGridChallengeSignature } from '../../src/features/cutter-grid/signature';
import {
  CUTTER_GRID_TRAJECTORY_CONFIG,
  planCutterGridEntryTrajectory,
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from '../../src/features/cutter-grid/trajectory';
import { computeRobotPose, createInitialJointAngles } from '../../src/features/robot/kinematics';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid trajectory planning', () => {
  let challenge: Challenge;
  const originHairCoord = [0, -5, 8] as const;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('certifies a zero-contact entry trajectory', () => {
    const originWorld = [1.35, 0.7, 1.28] as const;
    const trajectory = planCutterGridEntryTrajectory(challenge, originWorld);

    expect(trajectory.length).toBeGreaterThan(1);
    expect(trajectory[0].jointAngles).toEqual(
      createInitialJointAngles(challenge.robotConfig),
    );
    expect(trajectory.at(-1)?.endEffector).toEqual(
      computeRobotPose(
        challenge.robotConfig,
        trajectory.at(-1)?.jointAngles ?? {},
      ).endEffector,
    );
  });

  it('plans the geometric reference program as one frozen deterministic trajectory', () => {
    const reference = findCutterGridReferenceProgram(challenge, originHairCoord);
    expect(reference).toBeDefined();
    if (!reference) return;
    const initial = createInitialJointAngles(challenge.robotConfig);
    const originSolution = solveCutterGridIk(
      challenge,
      [1.35, 0.7, 1.28],
      initial,
      { maxError: challenge.voxelConfig.size / 16 },
    );
    expect(originSolution).toBeDefined();
    if (!originSolution) return;
    const runtimeActions = expandCutterGridProgram(reference.program);
    const compiled = {
      program: reference.program,
      runtimeActions,
      executedCommandCount: runtimeActions.length,
    };
    const bounds = hairBoundsToLogicalBounds(
      deriveCutterGridBounds(challenge, originHairCoord),
      originHairCoord,
    );
    const context = {
      challengeSignature: cutterGridChallengeSignature(challenge),
      originHairCoord,
      bounds,
      startJointAngles: originSolution.jointAngles,
    };

    const first = planCutterGridTrajectory(challenge, compiled, context);
    const second = planCutterGridTrajectory(challenge, compiled, context);

    expect(first.trajectorySignature).toBe(second.trajectorySignature);
    const serialized = serializeCutterTrajectoryPlan(first);
    expect(serializeCutterTrajectoryPlan(first)).toEqual(serialized);
    for (const waypoint of serialized.steps.flatMap((step) => step.waypoints)) {
      expect(Number.isInteger(waypoint.timeMs)).toBe(true);
      for (const angle of Object.values(waypoint.jointAngles)) {
        expect(angle * 10).toBeCloseTo(Math.round(angle * 10));
      }
    }
    expect(first.steps).toHaveLength(runtimeActions.length);
    expect(first.expectedResultVoxels).toEqual(
      [...challenge.targetHair.voxels].sort(),
    );
    expect(first.steps.flatMap((step) => step.expectedCutVoxels).sort()).toEqual(
      reference.expectedCutVoxels,
    );
    for (const step of first.steps) {
      for (let index = 1; index < step.waypoints.length; index += 1) {
        const jointDelta = Math.max(
          ...challenge.robotConfig.joints.map((joint) =>
            Math.abs(
              step.waypoints[index].jointAngles[joint.id] -
                step.waypoints[index - 1].jointAngles[joint.id],
            ),
          ),
        );
        expect(jointDelta).toBeLessThanOrEqual(
          CUTTER_GRID_TRAJECTORY_CONFIG.maxJointSampleDeltaDeg + 1e-9,
        );
      }
    }
  }, 120_000);
});
