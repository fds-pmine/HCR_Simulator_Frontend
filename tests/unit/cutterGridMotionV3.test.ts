import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import {
  CutterGridMotionV3Error,
  evaluateCutterGridPositioningV3At,
  evaluateCutterTrajectoryGeometryV3AtParameter,
  evaluateCutterTrajectoryStepV3At,
  retimeCutterGridTrajectoryV3,
} from '../../src/features/cutter-grid/motionV3';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { frontendTrialMotionLimitsV3 } from '../../src/features/cutter-grid/profileV3';
import { cutterGridMotionLimitsSignatureV3 } from '../../src/features/cutter-grid/motionLimitsV3';
import {
  CUTTER_GRID_LADDER_PLANNER_VERSION,
  type CutterGridMotionLimitsV3,
} from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid V3 jerk-limited retiming', () => {
  let challenge: Challenge;
  let v2Plan: ReturnType<typeof planCutterGridLadderTrajectory>;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    v2Plan = planCutterGridLadderTrajectory(challenge, regressionCompiled(), profile);
  }, 240_000);

  it('rejects incomplete explicit dynamic limits', () => {
    expect(() => retimeCutterGridTrajectoryV3(challenge, v2Plan, {
      requestedSpeedScale: 1.25,
      joints: {},
    } as CutterGridMotionLimitsV3)).toThrow(CutterGridMotionV3Error);
  });

  it('preserves the selected global branch and emits deterministic pause-safe motion', () => {
    const first = retimeCutterGridTrajectoryV3(challenge, v2Plan, frontendTrialMotionLimitsV3(challenge));
    const second = retimeCutterGridTrajectoryV3(challenge, v2Plan, frontendTrialMotionLimitsV3(challenge));

    expect(first.trajectorySignature).toBe(second.trajectorySignature);
    expect(first.geometrySignature).toBe(second.geometrySignature);
    expect(first.motionLimitsSignature).toBe(
      cutterGridMotionLimitsSignatureV3(challenge, first.motionLimits),
    );
    // Cross-language fixture value: the future Rust implementation must emit
    // this digest for the registered Neat Short Haircut V3 profile.
    expect(first.motionLimitsSignature).toBe('f22c09b1ef4fbcbb');
    expect(first.endCoord).toEqual(v2Plan.endCoord);
    expect(first.entryOptionId).toBe(v2Plan.entryOptionId);
    expect(first.expectedResultVoxels).toEqual(v2Plan.expectedResultVoxels);
    expect(first.estimatedDurationMs).toBeLessThan(v2Plan.estimatedDurationMs * 0.85);
    expect(first.diagnostics.maximumVelocityRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(first.diagnostics.maximumAccelerationRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(first.diagnostics.maximumJerkRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(first.diagnostics.maximumCartesianDeviation).toBeLessThanOrEqual(
      challenge.voxelConfig.size / 16 + 1e-9,
    );

    const entryStart = evaluateCutterGridPositioningV3At(
      challenge,
      first.positioningMotion,
      0,
    );
    const entryEnd = evaluateCutterGridPositioningV3At(
      challenge,
      first.positioningMotion,
      first.positioningMotion.durationMs,
    );
    expect(entryStart.jointAngles).toEqual(first.positioningMotion.waypoints[0]?.jointAngles);
    expect(entryEnd.jointAngles).toEqual(first.positioningMotion.waypoints.at(-1)?.jointAngles);
    for (const joint of challenge.robotConfig.joints) {
      expect(entryStart.jointVelocitiesDegPerSec[joint.id]).toBeCloseTo(0, 9);
      expect(entryEnd.jointVelocitiesDegPerSec[joint.id]).toBeCloseTo(0, 9);
      expect(entryStart.jointAccelerationsDegPerSec2[joint.id]).toBeCloseTo(0, 9);
      expect(entryEnd.jointAccelerationsDegPerSec2[joint.id]).toBeCloseTo(0, 9);
    }

    for (const step of first.steps) {
      if (step.kind === 'wait') continue;
      expect(step.motion.interpolation).toBe('global-c2-quintic-time-law');
      expect(step.motion.geometry?.interpolation).toBe('global-c2-quintic-spline');
      const geometry = step.motion.geometry;
      if (!geometry) throw new Error('Expected V3 move to include C2 geometry.');
      const knots = geometry.knots;
      expect(knots.length).toBeGreaterThanOrEqual(2);
      expect(knots[0]?.parameter).toBe(0);
      expect(knots.at(-1)?.parameter).toBe(1);
      for (const [index, knot] of knots.entries()) {
        if (index > 0) expect(knot.parameter).toBeGreaterThan(knots[index - 1].parameter);
        const evaluated = evaluateCutterTrajectoryGeometryV3AtParameter(
          challenge,
          geometry,
          knot.parameter,
        );
        for (const joint of challenge.robotConfig.joints) {
          expect(Number.isFinite(knot.jointVelocitiesPerParameter[joint.id])).toBe(true);
          expect(Number.isFinite(knot.jointAccelerationsPerParameter2[joint.id])).toBe(true);
          expect(evaluated[joint.id].angle).toBeCloseTo(knot.jointAngles[joint.id], 7);
          expect(evaluated[joint.id].velocityPerParameter).toBeCloseTo(
            knot.jointVelocitiesPerParameter[joint.id],
            6,
          );
          expect(evaluated[joint.id].accelerationPerParameter2).toBeCloseTo(
            knot.jointAccelerationsPerParameter2[joint.id],
            5,
          );
        }
      }
      const start = evaluateCutterTrajectoryStepV3At(challenge, step, 0);
      const end = evaluateCutterTrajectoryStepV3At(challenge, step, step.durationMs);
      for (const joint of challenge.robotConfig.joints) {
        expect(start.jointVelocitiesDegPerSec[joint.id]).toBeCloseTo(0, 9);
        expect(end.jointVelocitiesDegPerSec[joint.id]).toBeCloseTo(0, 9);
        expect(start.jointAccelerationsDegPerSec2[joint.id]).toBeCloseTo(0, 9);
        expect(end.jointAccelerationsDegPerSec2[joint.id]).toBeCloseTo(0, 9);
      }
      // Arbitrary render timestamps must not turn an exact certified boundary
      // (for example shoulderRoll=45) into a tiny numerical overrun that the
      // runtime controller rejects.
      for (let sample = 0; sample <= 100; sample += 1) {
        const waypoint = evaluateCutterTrajectoryStepV3At(
          challenge,
          step,
          (step.durationMs * sample) / 100,
        );
        for (const joint of challenge.robotConfig.joints) {
          expect(waypoint.jointAngles[joint.id]).toBeGreaterThanOrEqual(joint.minAngleDeg);
          expect(waypoint.jointAngles[joint.id]).toBeLessThanOrEqual(joint.maxAngleDeg);
        }
      }
      expect(end.jointAngles).toEqual(step.waypoints.at(-1)?.jointAngles);
    }
  }, 60_000);

  it('changes the portable dynamic signature when one joint limit changes', () => {
    const limits = frontendTrialMotionLimitsV3(challenge);
    const jointId = challenge.robotConfig.joints[0]?.id;
    if (!jointId) throw new Error('Expected a configured joint.');
    const changed = {
      ...limits,
      joints: {
        ...limits.joints,
        [jointId]: {
          ...limits.joints[jointId],
          maxJerkDegPerSec3: limits.joints[jointId].maxJerkDegPerSec3 + 1,
        },
      },
    };
    expect(cutterGridMotionLimitsSignatureV3(challenge, changed)).not.toBe(
      cutterGridMotionLimitsSignatureV3(challenge, limits),
    );
  });

  it('keeps the two-cell Right program enabled by the Practice workbench inside the fixed path tube', () => {
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    const runtimeActions = [
      { type: 'move-cell' as const, direction: 'right' as const, sourceBlockId: 'right-two' },
      { type: 'move-cell' as const, direction: 'right' as const, sourceBlockId: 'right-two' },
    ];
    const plan = planCutterGridLadderTrajectory(challenge, {
      program: {
        kind: 'cutter-grid',
        version: 1,
        plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
        nodes: [{ type: 'move', direction: 'right', distance: 2, sourceBlockId: 'right-two' }],
        sourceBlockCount: 1,
      },
      runtimeActions,
      executedCommandCount: runtimeActions.length,
    }, profile);

    const retimed = retimeCutterGridTrajectoryV3(
      challenge,
      plan,
      frontendTrialMotionLimitsV3(challenge),
    );
    expect(retimed.steps.some((step) =>
      step.kind === 'move-cell' && step.motion.geometry?.constraintResolution === 'monotone-c2-fallback',
    )).toBe(true);
    expect(retimed.endCoord).toEqual([2, 0, 0]);
  }, 60_000);
});

function regressionCompiled() {
  const runtimeActions = regressionProgramRuntimeActions();
  return {
    program: {
      ...CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
      plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
    },
    runtimeActions,
    executedCommandCount: runtimeActions.length,
  };
}
