import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  assertCutterGridRuckigExpectedCutVoxelsV3,
  createCutterGridRuckigMoveSpatialValidatorV3,
  CutterGridRuckigSpatialValidationError,
  type CutterGridRuckigTimedSpatialSampleV3,
  validateCutterGridRuckigSpatialSamplesV3,
} from '../../src/features/cutter-grid/ruckigSpatialValidationV3';
import type { RuckigLocalFiveAxisVector } from '../../src/features/cutter-grid/ruckigLocalWasm';
import { computeRobotPose, createInitialJointAngles } from '../../src/features/robot/kinematics';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge, JointId } from '../../src/types/domain';

describe('Cutter Grid local Ruckig spatial certification', () => {
  let challenge: Challenge;
  let initialAngles: Record<JointId, number>;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    initialAngles = createInitialJointAngles(challenge.robotConfig);
  });

  it('certifies a zero-motion safe sample stream and keeps its contact set explicit', () => {
    const samples = [sample(challenge, initialAngles), sample(challenge, initialAngles)];
    const endEffector = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    const result = validateCutterGridRuckigSpatialSamplesV3(challenge, samples, {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(),
      sourceBlockId: 'move-1',
      targetCoord: [0, 0, 0],
      actionIndex: 0,
    });

    expect(result.maximumJointSampleDeltaDeg).toBe(0);
    expect(result.maximumEndEffectorSampleDelta).toBe(0);
    expect(result.maximumCartesianDeviation).toBe(0);
    expect(result.cutVoxels).toEqual([]);
    expect(() => assertCutterGridRuckigExpectedCutVoxelsV3([], [])).not.toThrow();
  });

  it('rejects a local joint-space chord that leaves the frozen Cartesian pipe', () => {
    const endEffector = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    const deviating = { ...initialAngles, wrist: initialAngles.wrist + 10 };

    expectSpatialFailure(() => validateCutterGridRuckigSpatialSamplesV3(challenge, [
      sample(challenge, initialAngles),
      sample(challenge, deviating),
      sample(challenge, initialAngles),
    ], {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(),
    }), 'cartesian-pipe');
  });

  it('rejects samples that are too sparse to certify a physical sweep', () => {
    const shifted = { ...initialAngles, wrist: initialAngles.wrist + 1 };
    const start = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    const end = computeRobotPose(challenge.robotConfig, shifted).endEffector;

    expectSpatialFailure(() => validateCutterGridRuckigSpatialSamplesV3(challenge, [
      sample(challenge, initialAngles),
      sample(challenge, shifted),
    ], {
      fixedAxisLine: { start, end },
      hairVoxels: new Set(),
    }), 'sample-resolution');
  });

  it('rejects out-of-range and head-colliding local Ruckig poses before replay', () => {
    const endEffector = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    expectSpatialFailure(() => validateCutterGridRuckigSpatialSamplesV3(challenge, [
      sample(challenge, { ...initialAngles, baseYaw: 29 }),
      sample(challenge, { ...initialAngles, baseYaw: 29 }),
    ], {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(),
    }), 'joint-limit');

    const colliding = {
      baseYaw: 30,
      shoulderRoll: -45,
      shoulder: 90,
      elbow: 17.5,
      wrist: 0,
    };
    const collidingEndEffector = computeRobotPose(challenge.robotConfig, colliding).endEffector;
    expectSpatialFailure(() => validateCutterGridRuckigSpatialSamplesV3(challenge, [
      sample(challenge, colliding),
      sample(challenge, colliding),
    ], {
      fixedAxisLine: { start: collidingEndEffector, end: collidingEndEffector },
      hairVoxels: new Set(),
    }), 'head-collision');
  });

  it('rejects zero-contact positioning that intersects hair and reports contact-set mismatches', () => {
    const endEffector = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    const contactChallenge: Challenge = {
      ...challenge,
      voxelConfig: {
        ...challenge.voxelConfig,
        origin: [...endEffector] as [number, number, number],
      },
    };
    const samples = [sample(contactChallenge, initialAngles), sample(contactChallenge, initialAngles)];

    expectSpatialFailure(() => validateCutterGridRuckigSpatialSamplesV3(contactChallenge, samples, {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(['0,0,0']),
      requireZeroHairContact: true,
    }), 'unexpected-hair-contact');
    expectSpatialFailure(
      () => assertCutterGridRuckigExpectedCutVoxelsV3(['0,0,0'], ['0,0,1']),
      'unexpected-hair-contact',
    );
  });

  it('aggregates all local segments before comparing the frozen Move contact set', () => {
    const endEffector = computeRobotPose(challenge.robotConfig, initialAngles).endEffector;
    const contactChallenge: Challenge = {
      ...challenge,
      voxelConfig: {
        ...challenge.voxelConfig,
        origin: [...endEffector] as [number, number, number],
      },
    };
    const validator = createCutterGridRuckigMoveSpatialValidatorV3(contactChallenge, {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(['0,0,0']),
      expectedCutVoxels: ['0,0,0'],
      sourceBlockId: 'move-1',
      targetCoord: [0, 0, 0],
      actionIndex: 0,
    });
    const segment = [sample(contactChallenge, initialAngles, 0), sample(contactChallenge, initialAngles, 0.005)];
    validator.validateSegment(segment);
    // Re-observing the shared segment endpoint cannot create a duplicate cut.
    validator.validateSegment(segment);

    const summary = validator.finalize();
    expect(summary.cutVoxels).toEqual(['0,0,0']);
    expect(summary.contactEvents).toEqual([{ timeSeconds: 0.005, voxelKeys: ['0,0,0'] }]);

    const missingContact = createCutterGridRuckigMoveSpatialValidatorV3(contactChallenge, {
      fixedAxisLine: { start: endEffector, end: endEffector },
      hairVoxels: new Set(['0,0,0']),
      expectedCutVoxels: ['0,0,0'],
    });
    expectSpatialFailure(() => missingContact.finalize(), 'unexpected-hair-contact');
  });
});

function sample(
  challenge: Challenge,
  angles: Readonly<Record<JointId, number>>,
  timeSeconds?: number,
): CutterGridRuckigTimedSpatialSampleV3 {
  const position = challenge.robotConfig.joints.map((joint) => angles[joint.id]) as unknown as RuckigLocalFiveAxisVector;
  const zero = [0, 0, 0, 0, 0] as const;
  return {
    position,
    velocity: zero,
    acceleration: zero,
    jerk: zero,
    ...(timeSeconds === undefined ? {} : { timeSeconds }),
  };
}

function expectSpatialFailure(
  operation: () => unknown,
  code: CutterGridRuckigSpatialValidationError['code'],
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(CutterGridRuckigSpatialValidationError);
    expect((error as CutterGridRuckigSpatialValidationError).code).toBe(code);
    return;
  }
  throw new Error(`Expected local Ruckig spatial validation to fail with ${code}.`);
}
