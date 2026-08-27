import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  deriveCutterGridBounds,
  cutterGridCoordToWorld,
  hairBoundsToLogicalBounds,
} from '../../src/features/cutter-grid/grid';
import { solveCutterGridIk } from '../../src/features/cutter-grid/ik';
import { expandCutterGridProgram } from '../../src/features/cutter-grid/programCompiler';
import {
  createCutterGridReferenceReachability,
  findCutterGridReferenceProgram,
} from '../../src/features/cutter-grid/referenceProgram';
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
    // Same kinematic filter the Profile generators apply: an unfiltered route
    // can climb past the reachable envelope, which no trajectory planner can
    // follow.
    const reference = findCutterGridReferenceProgram(challenge, originHairCoord, {
      isReachable: createCutterGridReferenceReachability(challenge),
    });
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
    const serialized = serializeCutterTrajectoryPlan(
      challenge,
      originHairCoord,
      first,
    );
    expect(
      serializeCutterTrajectoryPlan(challenge, originHairCoord, first),
    ).toEqual(serialized);
    for (const waypoint of serialized.steps.flatMap((step) => step.waypoints)) {
      expect(Number.isInteger(waypoint.timeMs)).toBe(true);
      for (const angle of Object.values(waypoint.jointAngles)) {
        expect(angle * 10).toBeCloseTo(Math.round(angle * 10));
      }
      for (const joint of challenge.robotConfig.joints) {
        expect(
          Math.abs(waypoint.jointVelocitiesDegPerSec[joint.id]),
        ).toBeLessThanOrEqual(joint.speedDegPerSec + 1e-6);
      }
    }
    for (const step of serialized.steps) {
      expect(Number.isInteger(step.durationMs)).toBe(true);
    }
    expect(first.steps).toHaveLength(runtimeActions.length);
    expect(first.expectedResultVoxels).toEqual(
      [...challenge.targetHair.voxels].sort(),
    );
    expect(first.steps.flatMap((step) => step.expectedCutVoxels).sort()).toEqual(
      reference.expectedCutVoxels,
    );
    for (const step of serialized.steps) {
      const expectedStart = cutterGridCoordToWorld(
        step.startCoord,
        originHairCoord,
        challenge.voxelConfig,
      );
      const expectedEnd = cutterGridCoordToWorld(
        step.endCoord,
        originHairCoord,
        challenge.voxelConfig,
      );
      const finalWaypoint = step.waypoints.at(-1);
      expect(finalWaypoint).toBeDefined();
      if (finalWaypoint) {
        expect(distance(finalWaypoint.endEffector, expectedEnd)).toBeLessThanOrEqual(
          challenge.voxelConfig.size / 16 + 1e-9,
        );
      }
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
        expect(
          pointSegmentDistance(
            step.waypoints[index].endEffector,
            expectedStart,
            expectedEnd,
          ),
        ).toBeLessThanOrEqual(challenge.voxelConfig.size / 16 + 1e-9);
        const deltaTimeMs =
          step.waypoints[index].timeMs - step.waypoints[index - 1].timeMs;
        for (const joint of challenge.robotConfig.joints) {
          const speed =
            (Math.abs(
              step.waypoints[index].jointAngles[joint.id] -
                step.waypoints[index - 1].jointAngles[joint.id],
            ) /
              deltaTimeMs) *
            1000;
          expect(speed).toBeLessThanOrEqual(joint.speedDegPerSec + 1e-6);
        }
      }
    }

    const firstMovingStep = serialized.steps.find(
      (step) =>
        step.kind === 'move-cell' &&
        step.waypoints.some((waypoint, index) =>
          index > 0 &&
          challenge.robotConfig.joints.filter(
            (joint) =>
              Math.abs(
                waypoint.jointAngles[joint.id] -
                  step.waypoints[index - 1].jointAngles[joint.id],
              ) > 1e-6,
          ).length >= 2,
        ),
    );
    expect(firstMovingStep).toBeDefined();

    for (let index = 1; index < serialized.steps.length; index += 1) {
      const previous = serialized.steps[index - 1];
      const current = serialized.steps[index];
      const before = previous.waypoints;
      const after = current.waypoints;
      if (before.length < 1 || after.length < 1) continue;
      const sameDirection = movementAxis(previous) === movementAxis(current);
      const leftVelocity = before.at(-1)!.jointVelocitiesDegPerSec;
      const rightVelocity = after[0].jointVelocitiesDegPerSec;
      if (sameDirection) {
        for (const joint of challenge.robotConfig.joints) {
          expect(leftVelocity[joint.id]).toBeCloseTo(rightVelocity[joint.id], 9);
        }
      } else {
        expect(
          Math.max(...Object.values(leftVelocity).map(Math.abs)),
        ).toBeLessThan(1e-9);
        expect(
          Math.max(...Object.values(rightVelocity).map(Math.abs)),
        ).toBeLessThan(1e-9);
      }
    }
  }, 120_000);
});

function movementAxis(step: { startCoord: readonly number[]; endCoord: readonly number[] }): number {
  return step.endCoord.findIndex((value, index) => value !== step.startCoord[index]);
}

function pointSegmentDistance(
  point: readonly number[],
  start: readonly number[],
  end: readonly number[],
): number {
  const segment = end.map((value, index) => value - start[index]);
  const lengthSquared = segment.reduce((sum, value) => sum + value * value, 0);
  const projection = lengthSquared === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          point.reduce(
            (sum, value, index) =>
              sum + (value - start[index]) * segment[index],
            0,
          ) / lengthSquared,
        ),
      );
  return Math.sqrt(
    point.reduce((sum, value, index) => {
      const closest = start[index] + segment[index] * projection;
      return sum + (value - closest) ** 2;
    }, 0),
  );
}

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0),
  );
}
