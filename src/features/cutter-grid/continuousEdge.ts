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

/**
 * Verifies the exact Hermite segment which a later ladder graph will replay.
 * It deliberately has no maximum normalized joint-change gate: a long, slow
 * and collision-free transition may be valid even when its endpoints differ.
 */
export function validateCutterGridContinuousEdge(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
): CutterGridContinuousEdgeResult {
  const tangents = edgeTangents(challenge, input);
  const maxEndEffectorDistance =
    challenge.voxelConfig.size / CUTTER_GRID_EDGE_CONFIG.maxEndEffectorSampleDistanceDivisor;
  const maxPathDeviation =
    challenge.voxelConfig.size / CUTTER_GRID_EDGE_CONFIG.maxPathDeviationDivisor;
  const samples: Array<{ progress: number; angles: Record<JointId, number>; endEffector: Vec3Tuple }> = [];
  const stack: Array<readonly [number, number]> = [[0, 1]];
  const endpoints = new Map<number, { angles: Record<JointId, number>; endEffector: Vec3Tuple }>();

  const at = (progress: number) => {
    const cached = endpoints.get(progress);
    if (cached) return cached;
    const angles = interpolateAngles(challenge, input, tangents, progress);
    const pose = computeRobotPose(challenge.robotConfig, angles);
    const result = { angles, endEffector: pose.endEffector };
    endpoints.set(progress, result);
    return result;
  };

  while (stack.length > 0) {
    const [startProgress, endProgress] = stack.pop()!;
    const start = at(startProgress);
    const end = at(endProgress);
    const midpointProgress = (startProgress + endProgress) / 2;
    const midpoint = at(midpointProgress);
    const checkpoint = [
      [startProgress, start],
      [midpointProgress, midpoint],
      [endProgress, end],
    ] as const;
    for (const [progress, sample] of checkpoint) {
      if (!withinJointLimits(challenge, sample.angles)) {
        return { valid: false, reason: 'joint-limit', sampleProgress: progress };
      }
      if (
        findRobotHeadCollision(
          computeRobotPose(challenge.robotConfig, sample.angles),
          challenge.voxelConfig,
          challenge.robotConfig.geometry,
        )
      ) return { valid: false, reason: 'head-collision', sampleProgress: progress };
      if (pointSegmentDistance(sample.endEffector, input.lineStart, input.lineEnd) > maxPathDeviation + 1e-9) {
        return { valid: false, reason: 'path-deviation', sampleProgress: progress };
      }
    }
    const maximumJointDelta = Math.max(
      ...challenge.robotConfig.joints.map((joint) =>
        Math.abs(end.angles[joint.id] - start.angles[joint.id]),
      ),
    );
    if (
      maximumJointDelta > CUTTER_GRID_EDGE_CONFIG.maxJointSampleDeltaDeg ||
      distance(start.endEffector, end.endEffector) > maxEndEffectorDistance
    ) {
      if (endProgress - startProgress < 1 / 1_048_576) {
        return { valid: false, reason: 'sampling-limit', sampleProgress: midpointProgress };
      }
      stack.push([midpointProgress, endProgress], [startProgress, midpointProgress]);
      continue;
    }
    samples.push(
      { progress: startProgress, ...start },
      { progress: endProgress, ...end },
    );
  }

  const uniqueSamples = [...new Map(
    samples.map((sample) => [sample.progress, sample]),
  ).values()].sort((left, right) => left.progress - right.progress);
  const metrics = edgeMetrics(challenge, input, uniqueSamples);
  return { valid: true, metrics };
}

function edgeTangents(
  challenge: Challenge,
  input: CutterGridHermiteEdgeInput,
): { start: Record<JointId, number>; end: Record<JointId, number> } {
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

function interpolateAngles(
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
  return challenge.robotConfig.joints.every(
    (joint) =>
      Number.isFinite(angles[joint.id]) &&
      angles[joint.id] >= joint.minAngleDeg &&
      angles[joint.id] <= joint.maxAngleDeg,
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
