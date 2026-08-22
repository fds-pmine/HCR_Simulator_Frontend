import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import type { CutterGridCoord } from './types';
import type { RuckigLocalTrajectorySample } from './ruckigLocalWasm';

/** These are certification limits, not render-quality preferences. */
export const CUTTER_GRID_RUCKIG_SPATIAL_LIMITS_V3 = Object.freeze({
  maxJointSampleDeltaDeg: 0.5,
  maxEndEffectorSampleDeltaInVoxels: 1 / 16,
  maxCartesianPipeDeviationInVoxels: 1 / 16,
});

export type CutterGridRuckigSpatialFailureCodeV3 =
  | 'joint-limit'
  | 'head-collision'
  | 'cartesian-pipe'
  | 'sample-resolution'
  | 'unexpected-hair-contact';

export interface CutterGridRuckigSpatialValidationContextV3 {
  /** The complete player-requested axis segment, rather than a local Ruckig chord. */
  fixedAxisLine: {
    start: Vec3Tuple;
    end: Vec3Tuple;
  };
  /** Hair still present before this atomic player move starts. */
  hairVoxels: ReadonlySet<VoxelKey>;
  /** A subset is permitted while validating one local segment; omitted permits all hits. */
  permittedCutVoxels?: ReadonlySet<VoxelKey>;
  /** System positioning must never touch hair. */
  requireZeroHairContact?: boolean;
  sourceBlockId?: string;
  targetCoord?: CutterGridCoord;
  actionIndex?: number;
}

export interface CutterGridRuckigSpatialValidationSummaryV3 {
  maximumJointSampleDeltaDeg: number;
  maximumEndEffectorSampleDelta: number;
  maximumCartesianDeviation: number;
  cutVoxels: VoxelKey[];
}

/**
 * Fails closed when an otherwise dynamically valid Ruckig sample stream does
 * not preserve Cutter Grid's geometric safety contract.  It is deliberately
 * pure and Worker-safe: callers retain ownership of entry/player hair state
 * and aggregate the returned cut sets across local Ruckig segments.
 */
export function validateCutterGridRuckigSpatialSamplesV3(
  challenge: Challenge,
  samples: readonly RuckigLocalTrajectorySample[],
  context: CutterGridRuckigSpatialValidationContextV3,
): CutterGridRuckigSpatialValidationSummaryV3 {
  if (samples.length < 2) {
    throw failure('sample-resolution', 'Local Ruckig returned fewer than two spatial samples.', context);
  }

  const endEffectors: Vec3Tuple[] = [];
  let maximumCartesianDeviation = 0;
  let maximumJointSampleDeltaDeg = 0;
  let maximumEndEffectorSampleDelta = 0;
  const cutVoxels = new Set<VoxelKey>();

  for (const sample of samples) {
    const jointAngles = jointAnglesFromSample(challenge, sample, context);
    const pose = computeRobotPose(challenge.robotConfig, jointAngles);
    const collision = findRobotHeadCollision(
      pose,
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    );
    if (collision) {
      throw failure(
        'head-collision',
        `${collision.partLabel} collides with the head during local Ruckig retiming.`,
        context,
      );
    }
    const deviation = pointSegmentDistance(
      pose.endEffector,
      context.fixedAxisLine.start,
      context.fixedAxisLine.end,
    );
    maximumCartesianDeviation = Math.max(maximumCartesianDeviation, deviation);
    if (
      deviation >
      challenge.voxelConfig.size * CUTTER_GRID_RUCKIG_SPATIAL_LIMITS_V3.maxCartesianPipeDeviationInVoxels +
        1e-9
    ) {
      throw failure(
        'cartesian-pipe',
        'Local Ruckig leaves the player-requested fixed-axis Cartesian path.',
        context,
      );
    }
    endEffectors.push(pose.endEffector);
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const jointDelta = Math.max(
      ...challenge.robotConfig.joints.map((_, jointIndex) =>
        Math.abs(current.position[jointIndex] - previous.position[jointIndex]),
      ),
    );
    const endEffectorDelta = distance(endEffectors[index - 1], endEffectors[index]);
    maximumJointSampleDeltaDeg = Math.max(maximumJointSampleDeltaDeg, jointDelta);
    maximumEndEffectorSampleDelta = Math.max(maximumEndEffectorSampleDelta, endEffectorDelta);
    if (
      jointDelta > CUTTER_GRID_RUCKIG_SPATIAL_LIMITS_V3.maxJointSampleDeltaDeg + 1e-9 ||
      endEffectorDelta >
        challenge.voxelConfig.size * CUTTER_GRID_RUCKIG_SPATIAL_LIMITS_V3.maxEndEffectorSampleDeltaInVoxels +
          1e-9
    ) {
      throw failure(
        'sample-resolution',
        'Local Ruckig samples exceed the certified joint or end-effector spacing.',
        context,
      );
    }
    const hits = findSweptVoxelHits(
      endEffectors[index - 1],
      endEffectors[index],
      context.hairVoxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    );
    for (const key of hits) {
      if (context.requireZeroHairContact) {
        throw failure(
          'unexpected-hair-contact',
          'System positioning would contact hair during local Ruckig retiming.',
          context,
        );
      }
      if (context.permittedCutVoxels && !context.permittedCutVoxels.has(key)) {
        throw failure(
          'unexpected-hair-contact',
          `Local Ruckig would cut unplanned hair voxel ${key}.`,
          context,
        );
      }
      cutVoxels.add(key);
    }
  }

  return {
    maximumJointSampleDeltaDeg,
    maximumEndEffectorSampleDelta,
    maximumCartesianDeviation,
    cutVoxels: [...cutVoxels].sort(),
  };
}

/** Compare the aggregate per-segment contact set after all segments are validated. */
export function assertCutterGridRuckigExpectedCutVoxelsV3(
  actual: readonly VoxelKey[],
  expected: readonly VoxelKey[],
  context: Pick<CutterGridRuckigSpatialValidationContextV3, 'sourceBlockId' | 'targetCoord' | 'actionIndex'> = {},
): void {
  const normalizedActual = [...new Set(actual)].sort();
  const normalizedExpected = [...new Set(expected)].sort();
  if (
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((key, index) => key !== normalizedExpected[index])
  ) {
    throw failure(
      'unexpected-hair-contact',
      `Local Ruckig contact set differs from the frozen plan (actual: ${normalizedActual.join(',') || 'none'}; expected: ${normalizedExpected.join(',') || 'none'}).`,
      context,
    );
  }
}

export class CutterGridRuckigSpatialValidationError extends Error {
  constructor(
    public readonly code: CutterGridRuckigSpatialFailureCodeV3,
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      targetCoord?: CutterGridCoord;
      actionIndex?: number;
    },
  ) {
    super(message);
    this.name = 'CutterGridRuckigSpatialValidationError';
  }
}

function jointAnglesFromSample(
  challenge: Challenge,
  sample: RuckigLocalTrajectorySample,
  context: CutterGridRuckigSpatialValidationContextV3,
): Record<JointId, number> {
  if (sample.position.length !== challenge.robotConfig.joints.length) {
    throw failure('joint-limit', 'Local Ruckig returned the wrong number of joint positions.', context);
  }
  return Object.fromEntries(challenge.robotConfig.joints.map((joint, index) => {
    const angle = sample.position[index];
    if (
      !Number.isFinite(angle) ||
      angle < joint.minAngleDeg - 1e-9 ||
      angle > joint.maxAngleDeg + 1e-9
    ) {
      throw failure(
        'joint-limit',
        `${joint.name} leaves its configured range during local Ruckig retiming.`,
        context,
      );
    }
    return [joint.id, snapJointLimitNoise(angle, joint.minAngleDeg, joint.maxAngleDeg)];
  })) as Record<JointId, number>;
}

function snapJointLimitNoise(angle: number, minimum: number, maximum: number): number {
  if (angle < minimum) return minimum;
  if (angle > maximum) return maximum;
  return angle;
}

function failure(
  code: CutterGridRuckigSpatialFailureCodeV3,
  message: string,
  context: Pick<CutterGridRuckigSpatialValidationContextV3, 'sourceBlockId' | 'targetCoord' | 'actionIndex'>,
): CutterGridRuckigSpatialValidationError {
  return new CutterGridRuckigSpatialValidationError(code, message, {
    ...(context.sourceBlockId === undefined ? {} : { sourceBlockId: context.sourceBlockId }),
    ...(context.targetCoord === undefined ? {} : { targetCoord: context.targetCoord }),
    ...(context.actionIndex === undefined ? {} : { actionIndex: context.actionIndex }),
  });
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction: Vec3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, (
      (point[0] - start[0]) * direction[0] +
      (point[1] - start[1]) * direction[1] +
      (point[2] - start[2]) * direction[2]
    ) / lengthSquared));
  return distance(point, [
    start[0] + direction[0] * progress,
    start[1] + direction[1] * progress,
    start[2] + direction[2] * progress,
  ]);
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
