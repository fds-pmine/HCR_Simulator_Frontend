import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import {
  findRobotHeadCollision,
  measureRobotHeadClearance,
} from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { minimumNormalizedJointLimitMargin, normalizedJointDistance } from './ik';
import {
  CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS,
  type CutterGridCoord,
  type CutterGridPlanningErrorCodeV4,
  type CutterGridPlanningStageV4,
  type CutterGridSyncPtpPrimitiveV4,
  type CutterTrajectoryBoundaryStateV4,
} from './types';

export const CUTTER_GRID_COMPACT_PTP_CERTIFICATION_CONFIG = Object.freeze({
  maxJointSampleDeltaDeg: 0.5,
  maxEndEffectorSampleDistanceDivisor: 8,
  maximumSamples: 131_072,
});

/**
 * Structured V4 failure returned by the compact planner Worker. Keeping this
 * separate from V1–V3 errors prevents the active executor from accidentally
 * interpreting a V4 failure as a historical trajectory result.
 */
export class CutterGridCompactPtpV4PlanningError extends Error {
  constructor(
    public readonly code: CutterGridPlanningErrorCodeV4,
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      targetCoord?: CutterGridCoord;
      startCoord?: CutterGridCoord;
      actionIndex?: number;
      stage?: CutterGridPlanningStageV4;
    } = {},
  ) {
    super(message);
    this.name = 'CutterGridCompactPtpV4PlanningError';
  }
}

export interface CutterGridPtpEvaluationV4 extends CutterTrajectoryBoundaryStateV4 {
  endEffector: Vec3Tuple;
}

export type CutterGridPtpCertificationV4 =
  | {
      valid: true;
      minimumHeadClearance: number;
      minimumJointLimitMargin: number;
      maximumNormalizedJointStep: number;
      sampleCount: number;
    }
  | {
      valid: false;
      reason: 'joint-limit' | 'head-collision' | 'sampling-limit';
      sampleProgress: number;
    };

/**
 * Build the same compact five-joint command that the future executor will
 * evaluate. Phase 3 uses zero endpoint derivatives; Phase 4 may create a
 * second primitive with non-zero shared boundary derivatives without changing
 * the representation or evaluator.
 */
export function createCutterGridSyncPtpPrimitiveV4(
  challenge: Challenge,
  startAngles: Readonly<Record<JointId, number>>,
  endAngles: Readonly<Record<JointId, number>>,
  durationMs = CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS,
): CutterGridSyncPtpPrimitiveV4 {
  if (!Number.isFinite(durationMs) || durationMs < CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS) {
    throw new Error(`Cutter Grid V4 PTP duration must be at least ${CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS}ms.`);
  }
  return {
    kind: 'sync-ptp',
    interpolation: 'synchronized-quintic',
    durationMs,
    start: boundaryState(challenge, startAngles),
    end: boundaryState(challenge, endAngles),
  };
}

/** Evaluate the serialized V4 quintic without a render delta or mutable state. */
export function evaluateCutterGridSyncPtpV4(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
  timeMs: number,
): CutterGridPtpEvaluationV4 {
  if (timeMs <= 0) return evaluateBoundary(challenge, primitive.start);
  if (timeMs >= primitive.durationMs) return evaluateBoundary(challenge, primitive.end);
  const durationSeconds = primitive.durationMs / 1_000;
  const timeSeconds = clamp(timeMs, 0, primitive.durationMs) / 1_000;
  const jointAngles = {} as Record<JointId, number>;
  const jointVelocitiesDegPerSec = {} as Record<JointId, number>;
  const jointAccelerationsDegPerSec2 = {} as Record<JointId, number>;
  for (const joint of challenge.robotConfig.joints) {
    const curve = quinticBoundaryCurve(
      primitive.start.jointAngles[joint.id],
      primitive.start.jointVelocitiesDegPerSec[joint.id],
      primitive.start.jointAccelerationsDegPerSec2[joint.id],
      primitive.end.jointAngles[joint.id],
      primitive.end.jointVelocitiesDegPerSec[joint.id],
      primitive.end.jointAccelerationsDegPerSec2[joint.id],
      durationSeconds,
      timeSeconds,
    );
    jointAngles[joint.id] = normalizeSignedZero(curve.position);
    jointVelocitiesDegPerSec[joint.id] = normalizeSignedZero(curve.velocity);
    jointAccelerationsDegPerSec2[joint.id] = normalizeSignedZero(curve.acceleration);
  }
  return {
    jointAngles,
    jointVelocitiesDegPerSec,
    jointAccelerationsDegPerSec2,
    endEffector: computeRobotPose(challenge.robotConfig, jointAngles).endEffector,
  };
}

/**
 * Phase 3's internal geometric certificate. Its samples are never attached to
 * the plan; Phase 4 replaces this fixed grid with adaptive clearance bounds.
 */
export function certifyCutterGridSyncPtpV4(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
): CutterGridPtpCertificationV4 {
  let sampleCount = Math.max(1, Math.ceil(Math.max(...challenge.robotConfig.joints.map((joint) =>
    Math.abs(primitive.end.jointAngles[joint.id] - primitive.start.jointAngles[joint.id]) /
      CUTTER_GRID_COMPACT_PTP_CERTIFICATION_CONFIG.maxJointSampleDeltaDeg,
  ))));
  while (sampleCount <= CUTTER_GRID_COMPACT_PTP_CERTIFICATION_CONFIG.maximumSamples) {
    const samples = Array.from({ length: sampleCount + 1 }, (_, index) =>
      evaluateCutterGridSyncPtpV4(challenge, primitive, (primitive.durationMs * index) / sampleCount),
    );
    let minimumHeadClearance = Number.POSITIVE_INFINITY;
    let minimumJointLimitMargin = Number.POSITIVE_INFINITY;
    let maximumNormalizedJointStep = 0;
    for (const [index, sample] of samples.entries()) {
      if (!withinJointLimits(challenge, sample.jointAngles)) {
        return { valid: false, reason: 'joint-limit', sampleProgress: index / sampleCount };
      }
      const pose = computeRobotPose(challenge.robotConfig, sample.jointAngles);
      if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
        return { valid: false, reason: 'head-collision', sampleProgress: index / sampleCount };
      }
      minimumHeadClearance = Math.min(
        minimumHeadClearance,
        measureRobotHeadClearance(pose, challenge.voxelConfig, challenge.robotConfig.geometry),
      );
      minimumJointLimitMargin = Math.min(
        minimumJointLimitMargin,
        minimumNormalizedJointLimitMargin(sample.jointAngles, challenge.robotConfig.joints),
      );
      if (index === 0) continue;
      maximumNormalizedJointStep = Math.max(
        maximumNormalizedJointStep,
        normalizedJointDistance(
          samples[index - 1].jointAngles,
          sample.jointAngles,
          challenge.robotConfig.joints,
        ),
      );
    }
    const respectsEndEffectorSampling = samples.every((sample, index) =>
      index === 0 || distance(sample.endEffector, samples[index - 1].endEffector) <=
        challenge.voxelConfig.size / CUTTER_GRID_COMPACT_PTP_CERTIFICATION_CONFIG.maxEndEffectorSampleDistanceDivisor + 1e-12,
    );
    if (respectsEndEffectorSampling) {
      return {
        valid: true,
        minimumHeadClearance,
        minimumJointLimitMargin,
        maximumNormalizedJointStep,
        sampleCount: samples.length,
      };
    }
    sampleCount *= 2;
  }
  return { valid: false, reason: 'sampling-limit', sampleProgress: 0.5 };
}

function boundaryState(
  challenge: Challenge,
  jointAngles: Readonly<Record<JointId, number>>,
): CutterTrajectoryBoundaryStateV4 {
  const zero = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [joint.id, 0])) as Record<JointId, number>;
  return {
    jointAngles: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      jointAngles[joint.id],
    ])) as Record<JointId, number>,
    jointVelocitiesDegPerSec: { ...zero },
    jointAccelerationsDegPerSec2: { ...zero },
  };
}

function evaluateBoundary(
  challenge: Challenge,
  state: CutterTrajectoryBoundaryStateV4,
): CutterGridPtpEvaluationV4 {
  return {
    jointAngles: { ...state.jointAngles },
    jointVelocitiesDegPerSec: { ...state.jointVelocitiesDegPerSec },
    jointAccelerationsDegPerSec2: { ...state.jointAccelerationsDegPerSec2 },
    endEffector: computeRobotPose(challenge.robotConfig, state.jointAngles).endEffector,
  };
}

function quinticBoundaryCurve(
  startPosition: number,
  startVelocity: number,
  startAcceleration: number,
  endPosition: number,
  endVelocity: number,
  endAcceleration: number,
  durationSeconds: number,
  timeSeconds: number,
): { position: number; velocity: number; acceleration: number } {
  const a0 = startPosition;
  const a1 = startVelocity;
  const a2 = startAcceleration / 2;
  const duration2 = durationSeconds ** 2;
  const duration3 = durationSeconds ** 3;
  const duration4 = durationSeconds ** 4;
  const duration5 = durationSeconds ** 5;
  const a3 = (
    20 * (endPosition - startPosition) -
    (8 * endVelocity + 12 * startVelocity) * durationSeconds -
    (3 * startAcceleration - endAcceleration) * duration2
  ) / (2 * duration3);
  const a4 = (
    30 * (startPosition - endPosition) +
    (14 * endVelocity + 16 * startVelocity) * durationSeconds +
    (3 * startAcceleration - 2 * endAcceleration) * duration2
  ) / (2 * duration4);
  const a5 = (
    12 * (endPosition - startPosition) -
    (6 * endVelocity + 6 * startVelocity) * durationSeconds -
    (startAcceleration - endAcceleration) * duration2
  ) / (2 * duration5);
  const t2 = timeSeconds ** 2;
  const t3 = timeSeconds ** 3;
  const t4 = timeSeconds ** 4;
  const t5 = timeSeconds ** 5;
  return {
    position: a0 + a1 * timeSeconds + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5,
    velocity: a1 + 2 * a2 * timeSeconds + 3 * a3 * t2 + 4 * a4 * t3 + 5 * a5 * t4,
    acceleration: 2 * a2 + 6 * a3 * timeSeconds + 12 * a4 * t2 + 20 * a5 * t3,
  };
}

function withinJointLimits(
  challenge: Challenge,
  jointAngles: Readonly<Record<JointId, number>>,
): boolean {
  return challenge.robotConfig.joints.every((joint) =>
    Number.isFinite(jointAngles[joint.id]) &&
    jointAngles[joint.id] >= joint.minAngleDeg - 1e-9 &&
    jointAngles[joint.id] <= joint.maxAngleDeg + 1e-9,
  );
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSignedZero(value: number): number {
  return value === 0 ? 0 : value;
}
