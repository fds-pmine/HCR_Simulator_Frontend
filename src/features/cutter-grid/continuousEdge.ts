import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import { findRobotHeadCollision, measureRobotHeadClearance } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { minimumNormalizedJointLimitMargin, normalizedJointDistance } from './ik';

export const CUTTER_GRID_EDGE_CONFIG = Object.freeze({
  maxJointSampleDeltaDeg: 0.5,
  maxEndEffectorSampleDistanceDivisor: 16,
  maxPathDeviationDivisor: 16,
});

export interface CutterGridHermiteEdgeInput {
  previousAngles?: Readonly<Record<JointId, number>>;
  startAngles: Readonly<Record<JointId, number>>;
  endAngles: Readonly<Record<JointId, number>>;
  nextAngles?: Readonly<Record<JointId, number>>;
  lineStart: Vec3Tuple;
  lineEnd: Vec3Tuple;
  /** A turn, Wait boundary, or program endpoint forces this segment's tangent to zero. */
  startTangentZero?: boolean;
  endTangentZero?: boolean;
}

export interface CutterGridContinuousEdgeMetrics {
  maximumNormalizedJointStep: number;
  cumulativeNormalizedJointDisplacementSquared: number;
  secondDifferenceSquared: number;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
  sampleCount: number;
}

export type CutterGridContinuousEdgeResult =
  | { valid: true; metrics: CutterGridContinuousEdgeMetrics }
  | {
      valid: false;
      reason: 'joint-limit' | 'head-collision' | 'path-deviation' | 'sampling-limit';
      sampleProgress: number;
    };

export interface CutterGridHermiteSample {
  progress: number;
  angles: Record<JointId, number>;
  endEffector: Vec3Tuple;
}

export type CutterGridHermiteTangentPair = {
  start: Record<JointId, number>;
  end: Record<JointId, number>;
};

/**
 * Verifies the exact Hermite segment which a later ladder graph will replay.
 * It deliberately has no maximum normalized joint-change gate: a long, slow
 * and collision-free transition may be valid even when its endpoints differ.
 */
export function validateCutterGridContinuousEdge(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
): CutterGridContinuousEdgeResult {
  const sampled = sampleCutterGridHermiteEdge(challenge, input);
  if (!sampled.valid) return sampled;
  return { valid: true, metrics: sampled.metrics };
}

/**
 * Samples exactly the same C1 Hermite curve used for edge certification.
 * Consumers that serialize a frozen plan must use this rather than recreate a
 * separate easing curve, otherwise planning and replay could diverge.
 */
export function sampleCutterGridHermiteEdge(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
): CutterGridContinuousEdgeResult & { samples?: CutterGridHermiteSample[]; tangents?: CutterGridHermiteTangentPair } {
  const tangents = cutterGridHermiteTangents(challenge, input);
  const maxEndEffectorDistance =
    challenge.voxelConfig.size / CUTTER_GRID_EDGE_CONFIG.maxEndEffectorSampleDistanceDivisor;
  const maxPathDeviation =
    challenge.voxelConfig.size / CUTTER_GRID_EDGE_CONFIG.maxPathDeviationDivisor;
  // Most cross-branch edges are invalid because their C1 midpoint leaves the
  // requested Cartesian axis.  Reject those with the same safety predicates
  // before allocating the denser 0.5° sampling grid below.
  for (const progress of [0, 0.5, 1]) {
    const angles = interpolateCutterGridHermiteAngles(challenge, input, tangents, progress);
    if (!withinJointLimits(challenge, angles)) {
      return { valid: false, reason: 'joint-limit', sampleProgress: progress };
    }
    const pose = computeRobotPose(challenge.robotConfig, angles);
    if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
      return { valid: false, reason: 'head-collision', sampleProgress: progress };
    }
    if (pointSegmentDistance(pose.endEffector, input.lineStart, input.lineEnd) > maxPathDeviation + 1e-9) {
      return { valid: false, reason: 'path-deviation', sampleProgress: progress };
    }
  }
  // The maximum absolute Hermite derivative is a conservative angular speed
  // bound.  It lets us directly choose a sampling grid that satisfies the
  // 0.5° contract, avoiding the repeated midpoint evaluations that made a
  // dense layered graph impractical in a Web Worker.
  let sampleCount = Math.max(1, Math.ceil(Math.max(...challenge.robotConfig.joints.map((joint) =>
    maximumHermiteDerivative(
      input.startAngles[joint.id],
      input.endAngles[joint.id],
      tangents.start[joint.id],
      tangents.end[joint.id],
    ) / CUTTER_GRID_EDGE_CONFIG.maxJointSampleDeltaDeg,
  ))));

  while (sampleCount <= 1_048_576) {
    const samples = Array.from({ length: sampleCount + 1 }, (_, index) => {
      const progress = index / sampleCount;
      const angles = interpolateCutterGridHermiteAngles(challenge, input, tangents, progress);
      return {
        progress,
        angles,
        endEffector: computeRobotPose(challenge.robotConfig, angles).endEffector,
      };
    });
    for (const sample of samples) {
      if (!withinJointLimits(challenge, sample.angles)) {
        return { valid: false, reason: 'joint-limit', sampleProgress: sample.progress };
      }
      const pose = computeRobotPose(challenge.robotConfig, sample.angles);
      if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
        return { valid: false, reason: 'head-collision', sampleProgress: sample.progress };
      }
      if (pointSegmentDistance(sample.endEffector, input.lineStart, input.lineEnd) > maxPathDeviation + 1e-9) {
        return { valid: false, reason: 'path-deviation', sampleProgress: sample.progress };
      }
    }
    const respectsEndEffectorSampling = samples.every((sample, index) =>
      index === 0 || distance(sample.endEffector, samples[index - 1].endEffector) <= maxEndEffectorDistance + 1e-12,
    );
    if (respectsEndEffectorSampling) {
      const metrics = edgeMetrics(challenge, input, samples);
      return { valid: true, metrics, samples, tangents };
    }
    sampleCount *= 2;
  }
  return { valid: false, reason: 'sampling-limit', sampleProgress: 0.5 };
}

export function cutterGridHermiteTangents(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
): CutterGridHermiteTangentPair {
  return {
    start: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      input.startTangentZero || !input.previousAngles
        ? 0
        : monotoneTangent(
            input.startAngles[joint.id] - input.previousAngles[joint.id],
            input.endAngles[joint.id] - input.startAngles[joint.id],
          ),
    ])) as Record<JointId, number>,
    end: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      input.endTangentZero || !input.nextAngles
        ? 0
        : monotoneTangent(
            input.endAngles[joint.id] - input.startAngles[joint.id],
            input.nextAngles[joint.id] - input.endAngles[joint.id],
          ),
    ])) as Record<JointId, number>,
  };
}

export function interpolateCutterGridHermiteAngles(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
  tangents: { start: Record<JointId, number>; end: Record<JointId, number> },
  progress: number,
): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    hermite(
      input.startAngles[joint.id],
      input.endAngles[joint.id],
      tangents.start[joint.id],
      tangents.end[joint.id],
      progress,
    ),
  ])) as Record<JointId, number>;
}

/** Angular derivative with respect to normalized segment progress. */
export function cutterGridHermiteAngleDerivative(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
  tangents: CutterGridHermiteTangentPair,
  progress: number,
): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    hermiteDerivative(
      input.startAngles[joint.id],
      input.endAngles[joint.id],
      tangents.start[joint.id],
      tangents.end[joint.id],
      progress,
    ),
  ])) as Record<JointId, number>;
}

function edgeMetrics(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
  samples: readonly { angles: Record<JointId, number>; endEffector: Vec3Tuple }[],
): CutterGridContinuousEdgeMetrics {
  let maximumNormalizedJointStep = 0;
  let cumulativeNormalizedJointDisplacementSquared = 0;
  let minimumHeadClearance = Number.POSITIVE_INFINITY;
  let minimumJointLimitMargin = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const pose = computeRobotPose(challenge.robotConfig, samples[index].angles);
    minimumHeadClearance = Math.min(
      minimumHeadClearance,
      measureRobotHeadClearance(pose, challenge.voxelConfig, challenge.robotConfig.geometry),
    );
    minimumJointLimitMargin = Math.min(
      minimumJointLimitMargin,
      minimumNormalizedJointLimitMargin(samples[index].angles, challenge.robotConfig.joints),
    );
    if (index === 0) continue;
    const step = normalizedJointDistance(
      samples[index - 1].angles,
      samples[index].angles,
      challenge.robotConfig.joints,
    );
    maximumNormalizedJointStep = Math.max(maximumNormalizedJointStep, step);
    cumulativeNormalizedJointDisplacementSquared += step ** 2;
  }
  const secondDifferenceSquared = input.previousAngles && input.nextAngles
    ? challenge.robotConfig.joints.reduce((sum, joint) => {
        const delta =
          input.nextAngles![joint.id] -
          2 * input.endAngles[joint.id] +
          input.previousAngles![joint.id];
        const span = joint.maxAngleDeg - joint.minAngleDeg;
        return sum + (delta / span) ** 2;
      }, 0)
    : 0;
  return {
    maximumNormalizedJointStep,
    cumulativeNormalizedJointDisplacementSquared,
    secondDifferenceSquared,
    minimumHeadClearance,
    minimumJointLimitMargin,
    sampleCount: samples.length,
  };
}

function withinJointLimits(
  challenge: Challenge,
  angles: Readonly<Record<JointId, number>>,
): boolean {
  const numericalTolerance = 1e-9;
  return challenge.robotConfig.joints.every(
    (joint) =>
      Number.isFinite(angles[joint.id]) &&
      angles[joint.id] >= joint.minAngleDeg - numericalTolerance &&
      angles[joint.id] <= joint.maxAngleDeg + numericalTolerance,
  );
}

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1;
}

function hermiteDerivative(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  return (6 * t2 - 6 * t) * p0 +
    (3 * t2 - 4 * t + 1) * m0 +
    (-6 * t2 + 6 * t) * p1 +
    (3 * t2 - 2 * t) * m1;
}

function maximumHermiteDerivative(p0: number, p1: number, m0: number, m1: number): number {
  const candidates = [0, 1];
  const quadratic = 6 * p0 - 6 * p1 + 3 * m0 + 3 * m1;
  const linear = -6 * p0 + 6 * p1 - 4 * m0 - 2 * m1;
  if (Math.abs(quadratic) > 1e-12) {
    const critical = -linear / (2 * quadratic);
    if (critical > 0 && critical < 1) candidates.push(critical);
  }
  return Math.max(...candidates.map((progress) => Math.abs(hermiteDerivative(p0, p1, m0, m1, progress))));
}

function monotoneTangent(previousDelta: number, nextDelta: number): number {
  if (previousDelta * nextDelta <= 0) return 0;
  return (2 * previousDelta * nextDelta) / (previousDelta + nextDelta);
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction: Vec3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (
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
