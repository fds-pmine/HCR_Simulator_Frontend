import type { Challenge, JointId } from '../../types/domain';
import { evaluateCutterTrajectoryGeometryV3AtParameter } from './motionV3';
import type { CutterTrajectoryGeometryV3 } from './types';

/**
 * The velocity/acceleration part of the V3 local retiming contract. Jerk is
 * deliberately absent: it is applied only by the subsequent local
 * state-to-state Ruckig stage, never by this fixed-geometry reachability pass.
 */
export type CutterGridReachabilityLimitsV3 = Record<JointId, {
  velocityDegPerSec: number;
  accelerationDegPerSec2: number;
}>;

export interface CutterGridReachabilityNodeV3 {
  parameter: number;
  timeSeconds: number;
  pathVelocityPerSec: number;
  pathAccelerationPerSec2: number;
  jointVelocitiesDegPerSec: Record<JointId, number>;
  jointAccelerationsDegPerSec2: Record<JointId, number>;
}

export interface CutterGridReachabilityPlanV3 {
  algorithm: 'toppra-style-conservative-v1';
  nodes: CutterGridReachabilityNodeV3[];
  minimumDurationSeconds: number;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  iterations: number;
}

export class CutterGridReachabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CutterGridReachabilityError';
  }
}

interface GeometrySample {
  parameter: number;
  velocityCapSquared: number;
  jointVelocityPerParameter: Record<JointId, number>;
  jointAccelerationPerParameter2: Record<JointId, number>;
}

const EPSILON = 1e-10;
const DEFAULT_INTERVALS = 96;
const MAX_RELAXATION_ITERATIONS = 64;

/**
 * Computes a deterministic, conservative TOPP-RA-style forward/backward
 * reachability profile for one already-frozen C2 joint geometry. The spatial
 * geometry is queried but never changed. Endpoint path velocity and
 * acceleration are exactly zero so every Cutter Grid atomic move remains a
 * pause-safe checkpoint.
 *
 * This is intentionally a preparatory pure-domain stage. It exposes shared
 * `q/v/a` boundary states for a later local Ruckig pass; it does not itself
 * generate a jerk-limited wall-clock spline or perform collision/contact
 * certification.
 */
export function computeCutterGridReachabilityV3(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridReachabilityLimitsV3,
  requestedIntervals = DEFAULT_INTERVALS,
): CutterGridReachabilityPlanV3 {
  assertLimits(challenge, limits);
  const endParameter = geometry.knots.at(-1)?.parameter;
  if (!Number.isFinite(endParameter) || !endParameter || endParameter <= 0) {
    throw new CutterGridReachabilityError('Cutter Grid reachability requires a non-empty C2 geometry path.');
  }
  const intervals = Math.max(8, Math.ceil(requestedIntervals));
  const parameterStep = endParameter / intervals;
  const samples = Array.from({ length: intervals + 1 }, (_, index) =>
    sampleGeometry(challenge, geometry, limits, Math.min(endParameter, index * parameterStep)),
  );
  const finiteCaps = samples
    .map((sample) => sample.velocityCapSquared)
    .filter((value) => Number.isFinite(value) && value > EPSILON);
  if (finiteCaps.length === 0) {
    throw new CutterGridReachabilityError('Cutter Grid reachability found no movable joint-space derivative.');
  }
  // A parameter point with every derivative numerically zero is locally
  // unconstrained. Bound it by the largest real cap elsewhere rather than
  // allowing an Infinity into the fixed-order relaxation.
  const fallbackCap = Math.max(...finiteCaps);
  const squaredPathVelocity = samples.map((sample) =>
    Number.isFinite(sample.velocityCapSquared) ? sample.velocityCapSquared : fallbackCap,
  );
  squaredPathVelocity[0] = 0;
  squaredPathVelocity[squaredPathVelocity.length - 1] = 0;

  let iterations = 0;
  for (; iterations < MAX_RELAXATION_ITERATIONS; iterations += 1) {
    let changed = false;
    for (let index = 0; index < intervals; index += 1) {
      const accelerationBound = positivePathAccelerationBound(
        challenge,
        limits,
        samples[index],
        squaredPathVelocity[index],
      );
      const reachable = squaredPathVelocity[index] + 2 * parameterStep * accelerationBound;
      const next = Math.min(squaredPathVelocity[index + 1], reachable);
      if (next < squaredPathVelocity[index + 1] - EPSILON) changed = true;
      squaredPathVelocity[index + 1] = Math.max(0, next);
    }
    for (let index = intervals - 1; index >= 0; index -= 1) {
      const accelerationBound = positivePathAccelerationBound(
        challenge,
        limits,
        samples[index + 1],
        squaredPathVelocity[index + 1],
      );
      const reachable = squaredPathVelocity[index + 1] + 2 * parameterStep * accelerationBound;
      const previous = Math.min(squaredPathVelocity[index], reachable);
      if (previous < squaredPathVelocity[index] - EPSILON) changed = true;
      squaredPathVelocity[index] = Math.max(0, previous);
    }
    squaredPathVelocity[0] = 0;
    squaredPathVelocity[squaredPathVelocity.length - 1] = 0;
    if (!changed) break;
  }
  if (iterations === MAX_RELAXATION_ITERATIONS) {
    throw new CutterGridReachabilityError('Cutter Grid reachability relaxation did not converge deterministically.');
  }

  const pathAcceleration = squaredPathVelocity.map((velocitySquared, index) => {
    if (index === 0 || index === intervals) return 0;
    const incoming = (velocitySquared - squaredPathVelocity[index - 1]) / (2 * parameterStep);
    const outgoing = (squaredPathVelocity[index + 1] - velocitySquared) / (2 * parameterStep);
    const bound = positivePathAccelerationBound(challenge, limits, samples[index], velocitySquared);
    return clamp((incoming + outgoing) / 2, -bound, bound);
  });

  const times = [0];
  for (let index = 0; index < intervals; index += 1) {
    const denominator = Math.sqrt(squaredPathVelocity[index]) + Math.sqrt(squaredPathVelocity[index + 1]);
    if (denominator <= EPSILON) {
      throw new CutterGridReachabilityError(
        `Cutter Grid reachability has no positive path speed in interval ${index}.`,
      );
    }
    times.push(times[index] + (2 * parameterStep) / denominator);
  }

  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  const nodes = samples.map((sample, index) => {
    const pathVelocity = Math.sqrt(squaredPathVelocity[index]);
    const jointVelocitiesDegPerSec = {} as Record<JointId, number>;
    const jointAccelerationsDegPerSec2 = {} as Record<JointId, number>;
    for (const joint of challenge.robotConfig.joints) {
      const qPrime = sample.jointVelocityPerParameter[joint.id];
      const qDoublePrime = sample.jointAccelerationPerParameter2[joint.id];
      const velocity = normalizeZero(qPrime * pathVelocity);
      const acceleration = normalizeZero(
        qDoublePrime * squaredPathVelocity[index] + qPrime * pathAcceleration[index],
      );
      jointVelocitiesDegPerSec[joint.id] = velocity;
      jointAccelerationsDegPerSec2[joint.id] = acceleration;
      maximumVelocityRatio = Math.max(maximumVelocityRatio, Math.abs(velocity) / limits[joint.id].velocityDegPerSec);
      maximumAccelerationRatio = Math.max(
        maximumAccelerationRatio,
        Math.abs(acceleration) / limits[joint.id].accelerationDegPerSec2,
      );
    }
    return {
      parameter: sample.parameter,
      timeSeconds: times[index],
      pathVelocityPerSec: pathVelocity,
      pathAccelerationPerSec2: pathAcceleration[index],
      jointVelocitiesDegPerSec,
      jointAccelerationsDegPerSec2,
    } satisfies CutterGridReachabilityNodeV3;
  });
  if (maximumVelocityRatio > 1 + 1e-7 || maximumAccelerationRatio > 1 + 1e-7) {
    throw new CutterGridReachabilityError('Cutter Grid reachability exceeded a joint velocity or acceleration limit.');
  }

  return {
    algorithm: 'toppra-style-conservative-v1',
    nodes,
    minimumDurationSeconds: times.at(-1) ?? 0,
    maximumVelocityRatio,
    maximumAccelerationRatio,
    iterations: iterations + 1,
  };
}

function sampleGeometry(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridReachabilityLimitsV3,
  parameter: number,
): GeometrySample {
  const evaluated = evaluateCutterTrajectoryGeometryV3AtParameter(challenge, geometry, parameter);
  let velocityCapSquared = Number.POSITIVE_INFINITY;
  const jointVelocityPerParameter = {} as Record<JointId, number>;
  const jointAccelerationPerParameter2 = {} as Record<JointId, number>;
  for (const joint of challenge.robotConfig.joints) {
    const qPrime = evaluated[joint.id].velocityPerParameter;
    const qDoublePrime = evaluated[joint.id].accelerationPerParameter2;
    jointVelocityPerParameter[joint.id] = qPrime;
    jointAccelerationPerParameter2[joint.id] = qDoublePrime;
    if (Math.abs(qPrime) > EPSILON) {
      velocityCapSquared = Math.min(
        velocityCapSquared,
        (limits[joint.id].velocityDegPerSec / Math.abs(qPrime)) ** 2,
      );
    }
    if (Math.abs(qDoublePrime) > EPSILON) {
      velocityCapSquared = Math.min(
        velocityCapSquared,
        limits[joint.id].accelerationDegPerSec2 / Math.abs(qDoublePrime),
      );
    }
  }
  return { parameter, velocityCapSquared, jointVelocityPerParameter, jointAccelerationPerParameter2 };
}

function positivePathAccelerationBound(
  challenge: Challenge,
  limits: CutterGridReachabilityLimitsV3,
  sample: GeometrySample,
  pathVelocitySquared: number,
): number {
  let bound = Number.POSITIVE_INFINITY;
  for (const joint of challenge.robotConfig.joints) {
    const qPrime = Math.abs(sample.jointVelocityPerParameter[joint.id]);
    const curvatureDemand = Math.abs(sample.jointAccelerationPerParameter2[joint.id]) * pathVelocitySquared;
    const remainingAcceleration = limits[joint.id].accelerationDegPerSec2 - curvatureDemand;
    if (remainingAcceleration < -1e-8) return 0;
    if (qPrime > EPSILON) {
      bound = Math.min(bound, Math.max(0, remainingAcceleration) / qPrime);
    }
  }
  // At a geometry point where every q' is zero, path acceleration has no
  // first-order joint-acceleration effect. Keep that local bound unbounded;
  // the adjacent node's finite velocity/curvature caps still constrain the
  // forward/backward propagation. Treating it as zero would falsely make a
  // valid stationary endpoint unable to leave its first interval.
  return bound;
}

function assertLimits(challenge: Challenge, limits: CutterGridReachabilityLimitsV3): void {
  for (const joint of challenge.robotConfig.joints) {
    const limit = limits[joint.id];
    if (
      !limit ||
      !Number.isFinite(limit.velocityDegPerSec) ||
      !Number.isFinite(limit.accelerationDegPerSec2) ||
      limit.velocityDegPerSec <= 0 ||
      limit.accelerationDegPerSec2 <= 0
    ) {
      throw new CutterGridReachabilityError(`Cutter Grid reachability has invalid limits for ${joint.name}.`);
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeZero(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : value;
}
