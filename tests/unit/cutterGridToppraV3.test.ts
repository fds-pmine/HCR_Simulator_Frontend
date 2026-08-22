import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import { retimeCutterGridTrajectoryV3 } from '../../src/features/cutter-grid/motionV3';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { frontendTrialMotionLimitsV3 } from '../../src/features/cutter-grid/profileV3';
import {
  computeCutterGridReachabilityV3,
  CutterGridReachabilityError,
  type CutterGridReachabilityLimitsV3,
} from '../../src/features/cutter-grid/toppraV3';
import { CUTTER_GRID_LADDER_PLANNER_VERSION } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid V3 TOPP-RA-style reachability', () => {
  let challenge: Challenge;
  let limits: CutterGridReachabilityLimitsV3;
  let geometry: NonNullable<ReturnType<typeof retimeCutterGridTrajectoryV3>['steps'][number]['motion']['geometry']>;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    const v2Plan = planCutterGridLadderTrajectory(challenge, {
      program: {
        ...CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
        plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
      },
      runtimeActions: regressionProgramRuntimeActions(),
      executedCommandCount: regressionProgramRuntimeActions().length,
    }, profile);
    const v3Plan = retimeCutterGridTrajectoryV3(challenge, v2Plan, frontendTrialMotionLimitsV3(challenge));
    const firstMove = v3Plan.steps.find((step) => step.kind === 'move-cell');
    if (!firstMove?.motion.geometry) {
      throw new Error('Expected the V3 regression plan to contain move geometry.');
    }
    geometry = firstMove.motion.geometry;
    const motionLimits = frontendTrialMotionLimitsV3(challenge);
    limits = Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
      const source = motionLimits.joints[joint.id];
      return [joint.id, {
        velocityDegPerSec: Math.min(
          source.maxVelocityDegPerSec,
          source.nominalVelocityDegPerSec * motionLimits.requestedSpeedScale,
        ),
        accelerationDegPerSec2: Math.min(
          source.maxAccelerationDegPerSec2,
          source.nominalAccelerationDegPerSec2 * motionLimits.requestedSpeedScale ** 2,
        ),
      }];
    })) as CutterGridReachabilityLimitsV3;
  }, 240_000);

  it('deterministically propagates a pause-safe q/v/a boundary profile within limits', () => {
    const first = computeCutterGridReachabilityV3(challenge, geometry, limits, 96);
    const second = computeCutterGridReachabilityV3(challenge, geometry, limits, 96);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('toppra-style-conservative-v1');
    expect(first.nodes).toHaveLength(97);
    expect(first.minimumDurationSeconds).toBeGreaterThan(0);
    expect(first.maximumVelocityRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(first.maximumAccelerationRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(first.iterations).toBeLessThanOrEqual(64);

    const start = first.nodes[0];
    const end = first.nodes.at(-1);
    expect(start?.parameter).toBe(0);
    expect(end?.parameter).toBe(1);
    expect(start?.pathVelocityPerSec).toBe(0);
    expect(end?.pathVelocityPerSec).toBe(0);
    expect(start?.pathAccelerationPerSec2).toBe(0);
    expect(end?.pathAccelerationPerSec2).toBe(0);
    for (const joint of challenge.robotConfig.joints) {
      expect(start?.jointVelocitiesDegPerSec[joint.id]).toBe(0);
      expect(end?.jointVelocitiesDegPerSec[joint.id]).toBe(0);
      expect(start?.jointAccelerationsDegPerSec2[joint.id]).toBe(0);
      expect(end?.jointAccelerationsDegPerSec2[joint.id]).toBe(0);
    }
    for (const [index, node] of first.nodes.entries()) {
      if (index === 0) continue;
      const previous = first.nodes[index - 1];
      expect(node.parameter).toBeGreaterThan(previous.parameter);
      expect(node.timeSeconds).toBeGreaterThan(previous.timeSeconds);
    }
  }, 60_000);

  it('fails closed when a configured joint velocity or acceleration limit is absent', () => {
    const missing = { ...limits } as Partial<CutterGridReachabilityLimitsV3>;
    delete missing[challenge.robotConfig.joints[0]?.id ?? 'base'];
    expect(() => computeCutterGridReachabilityV3(
      challenge,
      geometry,
      missing as CutterGridReachabilityLimitsV3,
    )).toThrow(CutterGridReachabilityError);
  });
});
