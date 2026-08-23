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
  type CutterGridMotionLimitsV4,
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

export const CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG = Object.freeze({
  ordinaryMaxJointDeltaDeg: 1,
  ordinaryMaxEndEffectorDistanceDivisor: 8,
  nearHeadMaxJointDeltaDeg: 0.25,
  nearHeadMaxEndEffectorDistanceDivisor: 16,
  nearHeadClearanceDistanceInVoxels: 1,
  minimumSubdivisionDepth: 3,
  maximumSubdivisionDepth: 32,
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
  timeMs: number;
  jointJerksDegPerSec3: Record<JointId, number>;
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

export type CutterGridPtpAdaptiveCertificationV4 =
  | ({
      valid: true;
      samples: CutterGridPtpEvaluationV4[];
      minimumHeadClearance: number;
      minimumJointLimitMargin: number;
      maximumNormalizedJointStep: number;
    })
  | {
      valid: false;
      reason: 'joint-limit' | 'head-collision' | 'sampling-limit';
      sampleProgress: number;
    };

export interface CutterGridPtpDynamicsV4 {
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  valid: boolean;
}

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

export function createCutterGridSyncPtpPrimitiveWithBoundaryStatesV4(
  challenge: Challenge,
  start: CutterTrajectoryBoundaryStateV4,
  end: CutterTrajectoryBoundaryStateV4,
  durationMs = CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS,
): CutterGridSyncPtpPrimitiveV4 {
  if (!Number.isFinite(durationMs) || durationMs < CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS) {
    throw new Error(`Cutter Grid V4 PTP duration must be at least ${CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS}ms.`);
  }
  for (const state of [start, end]) {
    for (const joint of challenge.robotConfig.joints) {
      if (
        !Number.isFinite(state.jointAngles[joint.id]) ||
        !Number.isFinite(state.jointVelocitiesDegPerSec[joint.id]) ||
        !Number.isFinite(state.jointAccelerationsDegPerSec2[joint.id])
      ) throw new Error(`Cutter Grid V4 PTP boundary is incomplete for ${joint.id}.`);
    }
  }
  return {
    kind: 'sync-ptp',
    interpolation: 'synchronized-quintic',
    durationMs,
    start: cloneBoundaryState(challenge, start),
    end: cloneBoundaryState(challenge, end),
  };
}

/** Evaluate the serialized V4 quintic without a render delta or mutable state. */
export function evaluateCutterGridSyncPtpV4(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
  timeMs: number,
): CutterGridPtpEvaluationV4 {
  if (timeMs <= 0) return evaluateBoundary(challenge, primitive.start, 0);
  if (timeMs >= primitive.durationMs) return evaluateBoundary(challenge, primitive.end, primitive.durationMs);
  const durationSeconds = primitive.durationMs / 1_000;
  const timeSeconds = clamp(timeMs, 0, primitive.durationMs) / 1_000;
  const jointAngles = {} as Record<JointId, number>;
  const jointVelocitiesDegPerSec = {} as Record<JointId, number>;
  const jointAccelerationsDegPerSec2 = {} as Record<JointId, number>;
  const jointJerksDegPerSec3 = {} as Record<JointId, number>;
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
    jointJerksDegPerSec3[joint.id] = normalizeSignedZero(curve.jerk);
  }
  return {
    timeMs,
    jointAngles,
    jointVelocitiesDegPerSec,
    jointAccelerationsDegPerSec2,
    jointJerksDegPerSec3,
    endEffector: computeRobotPose(challenge.robotConfig, jointAngles).endEffector,
  };
}

/**
 * Recursively validates a V4 primitive using tighter near-head thresholds and
 * a conservative link displacement bound for every accepted interval. The
 * returned samples are Worker-only evidence; callers serialize only derived
 * metrics and contact events.
 */
export function certifyCutterGridSyncPtpAdaptiveV4(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
): CutterGridPtpAdaptiveCertificationV4 {
  const start = evaluateCutterGridSyncPtpV4(challenge, primitive, 0);
  const end = evaluateCutterGridSyncPtpV4(challenge, primitive, primitive.durationMs);
  const samples = [start];
  let minimumHeadClearance = Number.POSITIVE_INFINITY;
  let minimumJointLimitMargin = Number.POSITIVE_INFINITY;
  let maximumNormalizedJointStep = 0;
  let failure: Extract<CutterGridPtpAdaptiveCertificationV4, { valid: false }> | undefined;

  const inspect = (sample: CutterGridPtpEvaluationV4, progress: number): boolean => {
    if (!withinJointLimits(challenge, sample.jointAngles)) {
      failure = { valid: false, reason: 'joint-limit', sampleProgress: progress };
      return false;
    }
    const pose = computeRobotPose(challenge.robotConfig, sample.jointAngles);
    if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
      failure = { valid: false, reason: 'head-collision', sampleProgress: progress };
      return false;
    }
    minimumHeadClearance = Math.min(
      minimumHeadClearance,
      measureRobotHeadClearance(pose, challenge.voxelConfig, challenge.robotConfig.geometry),
    );
    minimumJointLimitMargin = Math.min(
      minimumJointLimitMargin,
      minimumNormalizedJointLimitMargin(sample.jointAngles, challenge.robotConfig.joints),
    );
    return true;
  };

  const visit = (
    startTimeMs: number,
    startSample: CutterGridPtpEvaluationV4,
    endTimeMs: number,
    endSample: CutterGridPtpEvaluationV4,
    depth: number,
  ): void => {
    if (failure) return;
    if (!inspect(startSample, startTimeMs / primitive.durationMs) || !inspect(endSample, endTimeMs / primitive.durationMs)) return;
    const middleTimeMs = (startTimeMs + endTimeMs) / 2;
    const middleSample = evaluateCutterGridSyncPtpV4(challenge, primitive, middleTimeMs);
    if (!inspect(middleSample, middleTimeMs / primitive.durationMs)) return;
    const maximumJointDelta = Math.max(...challenge.robotConfig.joints.map((joint) =>
      Math.max(
        Math.abs(middleSample.jointAngles[joint.id] - startSample.jointAngles[joint.id]),
        Math.abs(endSample.jointAngles[joint.id] - middleSample.jointAngles[joint.id]),
      ),
    ));
    const intervalClearance = Math.min(
      clearanceFor(challenge, startSample),
      clearanceFor(challenge, middleSample),
      clearanceFor(challenge, endSample),
    );
    const nearHead = intervalClearance <=
      challenge.voxelConfig.size * CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.nearHeadClearanceDistanceInVoxels;
    const maximumEndEffectorDistance = challenge.voxelConfig.size /
      (nearHead
        ? CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.nearHeadMaxEndEffectorDistanceDivisor
        : CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.ordinaryMaxEndEffectorDistanceDivisor);
    const maximumJointLimit = nearHead
      ? CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.nearHeadMaxJointDeltaDeg
      : CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.ordinaryMaxJointDeltaDeg;
    const displacementBound = conservativeLinkDisplacementBound(challenge, startSample.jointAngles, endSample.jointAngles);
    const needsSubdivision =
      depth < CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.minimumSubdivisionDepth ||
      maximumJointDelta > maximumJointLimit + 1e-12 ||
      distance(startSample.endEffector, endSample.endEffector) > maximumEndEffectorDistance + 1e-12 ||
      intervalClearance <= displacementBound + 1e-12;
    if (needsSubdivision) {
      if (depth >= CUTTER_GRID_COMPACT_PTP_ADAPTIVE_CERTIFICATION_CONFIG.maximumSubdivisionDepth) {
        failure = { valid: false, reason: 'sampling-limit', sampleProgress: middleTimeMs / primitive.durationMs };
        return;
      }
      visit(startTimeMs, startSample, middleTimeMs, middleSample, depth + 1);
      visit(middleTimeMs, middleSample, endTimeMs, endSample, depth + 1);
      return;
    }
    maximumNormalizedJointStep = Math.max(
      maximumNormalizedJointStep,
      normalizedJointDistance(startSample.jointAngles, middleSample.jointAngles, challenge.robotConfig.joints),
      normalizedJointDistance(middleSample.jointAngles, endSample.jointAngles, challenge.robotConfig.joints),
    );
    samples.push(middleSample);
    samples.push(endSample);
  };

  visit(0, start, primitive.durationMs, end, 0);
  if (failure) return failure;
  return {
    valid: true,
    samples,
    minimumHeadClearance,
    minimumJointLimitMargin,
    maximumNormalizedJointStep,
  };
}

/** Conservative coefficient bound; no sampled dynamic value can exceed it. */
export function measureCutterGridSyncPtpDynamicsV4(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
  limits: CutterGridMotionLimitsV4,
): CutterGridPtpDynamicsV4 {
  const durationSeconds = primitive.durationMs / 1_000;
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;
  for (const joint of challenge.robotConfig.joints) {
    const coefficients = quinticCoefficients(
      primitive.start.jointAngles[joint.id],
      primitive.start.jointVelocitiesDegPerSec[joint.id],
      primitive.start.jointAccelerationsDegPerSec2[joint.id],
      primitive.end.jointAngles[joint.id],
      primitive.end.jointVelocitiesDegPerSec[joint.id],
      primitive.end.jointAccelerationsDegPerSec2[joint.id],
      durationSeconds,
    );
    const { maximumVelocity, maximumAcceleration, maximumJerk } =
      exactQuinticDynamicBounds(coefficients, durationSeconds);
    const jointLimits = limits.joints[joint.id];
    maximumVelocityRatio = Math.max(maximumVelocityRatio, maximumVelocity / jointLimits.maxVelocityDegPerSec);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, maximumAcceleration / jointLimits.maxAccelerationDegPerSec2);
    maximumJerkRatio = Math.max(maximumJerkRatio, maximumJerk / jointLimits.maxJerkDegPerSec3);
  }
  return {
    maximumVelocityRatio,
    maximumAccelerationRatio,
    maximumJerkRatio,
    valid: Math.max(maximumVelocityRatio, maximumAccelerationRatio, maximumJerkRatio) <= 1 + 1e-12,
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

function cloneBoundaryState(
  challenge: Challenge,
  state: CutterTrajectoryBoundaryStateV4,
): CutterTrajectoryBoundaryStateV4 {
  return {
    jointAngles: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      state.jointAngles[joint.id],
    ])) as Record<JointId, number>,
    jointVelocitiesDegPerSec: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      state.jointVelocitiesDegPerSec[joint.id],
    ])) as Record<JointId, number>,
    jointAccelerationsDegPerSec2: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      state.jointAccelerationsDegPerSec2[joint.id],
    ])) as Record<JointId, number>,
  };
}

function evaluateBoundary(
  challenge: Challenge,
  state: CutterTrajectoryBoundaryStateV4,
  timeMs: number,
): CutterGridPtpEvaluationV4 {
  return {
    timeMs,
    jointAngles: { ...state.jointAngles },
    jointVelocitiesDegPerSec: { ...state.jointVelocitiesDegPerSec },
    jointAccelerationsDegPerSec2: { ...state.jointAccelerationsDegPerSec2 },
    jointJerksDegPerSec3: Object.fromEntries(
      challenge.robotConfig.joints.map((joint) => [joint.id, 0]),
    ) as Record<JointId, number>,
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
): { position: number; velocity: number; acceleration: number; jerk: number } {
  const { a0, a1, a2, a3, a4, a5 } = quinticCoefficients(
    startPosition,
    startVelocity,
    startAcceleration,
    endPosition,
    endVelocity,
    endAcceleration,
    durationSeconds,
  );
  const t2 = timeSeconds ** 2;
  const t3 = timeSeconds ** 3;
  const t4 = timeSeconds ** 4;
  const t5 = timeSeconds ** 5;
  return {
    position: a0 + a1 * timeSeconds + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5,
    velocity: a1 + 2 * a2 * timeSeconds + 3 * a3 * t2 + 4 * a4 * t3 + 5 * a5 * t4,
    acceleration: 2 * a2 + 6 * a3 * timeSeconds + 12 * a4 * t2 + 20 * a5 * t3,
    jerk: 6 * a3 + 24 * a4 * timeSeconds + 60 * a5 * t2,
  };
}

function quinticCoefficients(
  startPosition: number,
  startVelocity: number,
  startAcceleration: number,
  endPosition: number,
  endVelocity: number,
  endAcceleration: number,
  durationSeconds: number,
): { a0: number; a1: number; a2: number; a3: number; a4: number; a5: number } {
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
  return { a0, a1, a2, a3, a4, a5 };
}

/** Exact extrema of the quintic's v/a/j polynomials on a closed interval. */
function exactQuinticDynamicBounds(
  coefficients: { a0: number; a1: number; a2: number; a3: number; a4: number; a5: number },
  durationSeconds: number,
): { maximumVelocity: number; maximumAcceleration: number; maximumJerk: number } {
  const velocity = (time: number) =>
    coefficients.a1 + 2 * coefficients.a2 * time + 3 * coefficients.a3 * time ** 2 +
    4 * coefficients.a4 * time ** 3 + 5 * coefficients.a5 * time ** 4;
  const acceleration = (time: number) =>
    2 * coefficients.a2 + 6 * coefficients.a3 * time + 12 * coefficients.a4 * time ** 2 +
    20 * coefficients.a5 * time ** 3;
  const jerk = (time: number) =>
    6 * coefficients.a3 + 24 * coefficients.a4 * time + 60 * coefficients.a5 * time ** 2;
  const jerkRoots = quadraticRoots(
    60 * coefficients.a5,
    24 * coefficients.a4,
    6 * coefficients.a3,
    durationSeconds,
  );
  const accelerationRoots = rootsFromMonotonePartitions(
    acceleration,
    [0, ...jerkRoots, durationSeconds],
  );
  const jerkVertex = Math.abs(coefficients.a5) <= 1e-15
    ? []
    : boundedRoots([-coefficients.a4 / (5 * coefficients.a5)], durationSeconds);
  return {
    maximumVelocity: maximumAbsolute(velocity, [0, ...accelerationRoots, durationSeconds]),
    maximumAcceleration: maximumAbsolute(acceleration, [0, ...jerkRoots, durationSeconds]),
    maximumJerk: maximumAbsolute(jerk, [0, ...jerkVertex, durationSeconds]),
  };
}

function quadraticRoots(a: number, b: number, c: number, maximum: number): number[] {
  if (Math.abs(a) <= 1e-15) {
    return Math.abs(b) <= 1e-15 ? [] : boundedRoots([-c / b], maximum);
  }
  const discriminant = b ** 2 - 4 * a * c;
  if (discriminant < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return boundedRoots([(-b - root) / (2 * a), (-b + root) / (2 * a)], maximum);
}

function rootsFromMonotonePartitions(
  evaluate: (value: number) => number,
  partitions: readonly number[],
): number[] {
  const ordered = [...new Set(partitions.map((value) => roundNumber(value, 12)))].sort((left, right) => left - right);
  const roots: number[] = [];
  for (const value of ordered) {
    if (Math.abs(evaluate(value)) <= 1e-9) roots.push(value);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    let low = ordered[index - 1];
    let high = ordered[index];
    let lowValue = evaluate(low);
    const highValue = evaluate(high);
    if (lowValue === 0 || highValue === 0 || lowValue * highValue > 0) continue;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2;
      const middleValue = evaluate(middle);
      if (middleValue === 0) {
        low = middle;
        high = middle;
        break;
      }
      if (lowValue * middleValue <= 0) high = middle;
      else {
        low = middle;
        lowValue = middleValue;
      }
    }
    roots.push((low + high) / 2);
  }
  return [...new Set(roots.map((value) => roundNumber(value, 12)))];
}

function boundedRoots(values: readonly number[], maximum: number): number[] {
  return values
    .filter((value) => Number.isFinite(value) && value > 0 && value < maximum)
    .map((value) => roundNumber(value, 12));
}

function maximumAbsolute(evaluate: (time: number) => number, points: readonly number[]): number {
  return Math.max(...points.map((time) => Math.abs(evaluate(time))));
}

function roundNumber(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clearanceFor(
  challenge: Challenge,
  sample: CutterGridPtpEvaluationV4,
): number {
  return measureRobotHeadClearance(
    computeRobotPose(challenge.robotConfig, sample.jointAngles),
    challenge.voxelConfig,
    challenge.robotConfig.geometry,
  );
}

/**
 * Any point on a link can move by no more than the arm's full reach times the
 * summed angular change (in radians). This deliberately over-approximates
 * every collision primitive and is used only to prove a sample interval safe.
 */
function conservativeLinkDisplacementBound(
  challenge: Challenge,
  start: Readonly<Record<JointId, number>>,
  end: Readonly<Record<JointId, number>>,
): number {
  const maximumReach =
    challenge.robotConfig.geometry.upperArmLength +
    challenge.robotConfig.geometry.forearmLength +
    challenge.robotConfig.geometry.toolLength;
  const angularTravelRadians = challenge.robotConfig.joints.reduce(
    (sum, joint) => sum + Math.abs(end[joint.id] - start[joint.id]) * Math.PI / 180,
    0,
  );
  return maximumReach * angularTravelRadians;
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
