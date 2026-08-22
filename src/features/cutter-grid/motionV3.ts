import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { fnv1a64 } from './signature';
import {
  CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
  type CutterGridMotionLimitsV3,
  type CutterGridPlanningDiagnosticsV3,
  type CutterGridPlanningErrorCodeV3,
  type CutterTrajectoryPlanV2,
  type CutterTrajectoryPlanV3,
  type CutterTrajectoryStepMotionV3,
  type CutterTrajectoryStepV2,
  type CutterTrajectoryStepV3,
  type CutterTrajectoryWaypointV2,
  type CutterTrajectoryWaypointV3,
} from './types';

/**
 * V3's deterministic validation density.  The sampling grid is deliberately
 * independent of render cadence so the same frozen plan is checked on every
 * browser and later by the Rust implementation.
 */
export const CUTTER_GRID_MOTION_V3_CONFIG = Object.freeze({
  maxValidationIntervalMs: 5,
  maxJointSampleDeltaDeg: 0.5,
  maxEndEffectorSampleDelta: 1 / 16,
  normalizedDerivativeSamples: 512,
});

export class CutterGridMotionV3Error extends Error {
  constructor(
    public readonly code: CutterGridPlanningErrorCodeV3,
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      targetCoord?: readonly [number, number, number];
      actionIndex?: number;
    } = {},
  ) {
    super(message);
    this.name = 'CutterGridMotionV3Error';
  }
}

interface StepEvaluation {
  waypoint: CutterTrajectoryWaypointV3;
  velocityRatio: number;
  accelerationRatio: number;
  jerkRatio: number;
}

interface ValidationResult {
  waypoints: CutterTrajectoryWaypointV3[];
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  maximumCartesianDeviation: number;
}

/**
 * Retimes a V2 globally-selected geometry path without selecting a new IK
 * branch.  Geometry remains cubic Hermite in its path parameter while a
 * quintic minimum-jerk time law controls the scalar progress through every
 * atomic Cutter Grid move.  The exported data is DOM-free and is intentionally
 * shaped for a future byte-for-byte Rust `hcr_sim` counterpart.
 */
export function retimeCutterGridTrajectoryV3(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV2,
  motionLimits: CutterGridMotionLimitsV3,
): CutterTrajectoryPlanV3 {
  assertMotionLimits(challenge, motionLimits);
  const effective = effectiveMotionLimits(challenge, motionLimits);
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;
  let maximumCartesianDeviation = 0;
  let validationSampleCount = 0;

  const steps = plan.steps.map((step) => {
    if (step.kind === 'wait') {
      const waypoints = step.waypoints.map((waypoint) => holdWaypoint(challenge, waypoint));
      validationSampleCount += waypoints.length;
      return {
        ...step,
        waypoints,
        motion: {
          interpolation: 'hold',
          durationMs: step.durationMs,
          geometryWaypoints: cloneGeometryWaypoints(step.waypoints),
        },
      } satisfies CutterTrajectoryStepV3;
    }

    const { motion, validation } = validateWithDurationExpansion(
      challenge,
      step,
      motionForStep(challenge, step, effective),
      effective,
    );
    maximumVelocityRatio = Math.max(maximumVelocityRatio, validation.maximumVelocityRatio);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, validation.maximumAccelerationRatio);
    maximumJerkRatio = Math.max(maximumJerkRatio, validation.maximumJerkRatio);
    maximumCartesianDeviation = Math.max(maximumCartesianDeviation, validation.maximumCartesianDeviation);
    validationSampleCount += validation.waypoints.length;
    return {
      ...step,
      durationMs: motion.durationMs,
      waypoints: validation.waypoints,
      motion,
      expectedCutVoxels: [],
    } satisfies CutterTrajectoryStepV3;
  });

  const expectedResultVoxels = applyExpectedContacts(challenge, steps);
  const estimatedDurationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
  const actualSpeedScale = Math.min(
    ...challenge.robotConfig.joints.map((joint) =>
      effective[joint.id].velocity / motionLimits.joints[joint.id].nominalVelocityDegPerSec,
    ),
  );
  const diagnostics: CutterGridPlanningDiagnosticsV3 = {
    ...plan.diagnostics,
    requestedSpeedScale: motionLimits.requestedSpeedScale,
    actualSpeedScale,
    maximumVelocityRatio,
    maximumAccelerationRatio,
    maximumJerkRatio,
    maximumCartesianDeviation,
    validationSampleCount,
  };
  const unsigned: Omit<CutterTrajectoryPlanV3, 'trajectorySignature'> = {
    kind: 'cutter-grid-trajectory',
    version: 3,
    plannerVersion: CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
    challengeSignature: plan.challengeSignature,
    entryOptionId: plan.entryOptionId,
    positioningTrajectory: cloneGeometryWaypoints(plan.positioningTrajectory),
    startCoord: plan.startCoord,
    endCoord: plan.endCoord,
    steps,
    expectedResultVoxels,
    estimatedDurationMs,
    executedCommandCount: plan.executedCommandCount,
    motionLimits,
    diagnostics,
  };
  return {
    ...unsigned,
    trajectorySignature: motionTrajectorySignature(unsigned),
  };
}

/** Evaluate a V3 move without using a frame delta or mutable executor state. */
export function evaluateCutterTrajectoryStepV3At(
  challenge: Challenge,
  step: CutterTrajectoryStepV3,
  targetTimeMs: number,
): CutterTrajectoryWaypointV3 {
  if (step.motion.interpolation === 'hold') {
    return step.waypoints.at(-1) ?? holdWaypoint(challenge, step.motion.geometryWaypoints[0]);
  }
  return evaluateStepMotionAt(
    challenge,
    step.motion,
    clamp(targetTimeMs, 0, step.motion.durationMs),
  ).waypoint;
}

type EffectiveMotionLimits = Record<JointId, {
  velocity: number;
  acceleration: number;
  jerk: number;
}>;

function effectiveMotionLimits(
  challenge: Challenge,
  motionLimits: CutterGridMotionLimitsV3,
): EffectiveMotionLimits {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const limit = motionLimits.joints[joint.id];
    return [joint.id, {
      velocity: Math.min(limit.maxVelocityDegPerSec, limit.nominalVelocityDegPerSec * motionLimits.requestedSpeedScale),
      acceleration: Math.min(limit.maxAccelerationDegPerSec2, limit.nominalAccelerationDegPerSec2 * motionLimits.requestedSpeedScale ** 2),
      jerk: Math.min(limit.maxJerkDegPerSec3, limit.nominalJerkDegPerSec3 * motionLimits.requestedSpeedScale ** 3),
    }];
  })) as EffectiveMotionLimits;
}

function assertMotionLimits(challenge: Challenge, motionLimits: CutterGridMotionLimitsV3): void {
  if (!Number.isFinite(motionLimits.requestedSpeedScale) || motionLimits.requestedSpeedScale <= 0) {
    throw new CutterGridMotionV3Error('motion-limit-missing', 'Cutter Grid V3 requires a positive requested speed scale.');
  }
  for (const joint of challenge.robotConfig.joints) {
    const limit = motionLimits.joints[joint.id];
    const values = limit && [
      limit.nominalVelocityDegPerSec,
      limit.nominalAccelerationDegPerSec2,
      limit.nominalJerkDegPerSec3,
      limit.maxVelocityDegPerSec,
      limit.maxAccelerationDegPerSec2,
      limit.maxJerkDegPerSec3,
    ];
    if (!values || values.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new CutterGridMotionV3Error(
        'motion-limit-missing',
        `Cutter Grid V3 has no complete dynamic limits for ${joint.name}.`,
      );
    }
  }
}

function motionForStep(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  limits: EffectiveMotionLimits,
): CutterTrajectoryStepMotionV3 {
  if (step.waypoints.length < 2) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'A Cutter Grid move needs at least two certified geometry waypoints.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }
  let minimumDurationSeconds = 0;
  for (let sample = 0; sample <= CUTTER_GRID_MOTION_V3_CONFIG.normalizedDerivativeSamples; sample += 1) {
    const normalizedTime = sample / CUTTER_GRID_MOTION_V3_CONFIG.normalizedDerivativeSamples;
    const normalized = evaluateGeometryAtNormalizedTime(challenge, step.waypoints, normalizedTime, 1);
    for (const joint of challenge.robotConfig.joints) {
      const angle = normalized[joint.id];
      minimumDurationSeconds = Math.max(
        minimumDurationSeconds,
        Math.abs(angle.velocity) / limits[joint.id].velocity,
        Math.sqrt(Math.abs(angle.acceleration) / limits[joint.id].acceleration),
        Math.cbrt(Math.abs(angle.jerk) / limits[joint.id].jerk),
      );
    }
  }
  if (!Number.isFinite(minimumDurationSeconds) || minimumDurationSeconds <= 0) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 could not calculate a finite motion duration.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }
  return {
    interpolation: 'cubic-hermite-quintic-time-law',
    durationMs: Math.max(1, Math.ceil(minimumDurationSeconds * 1_000)),
    geometryWaypoints: cloneGeometryWaypoints(step.waypoints),
  };
}

function validateStepMotion(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  motion: CutterTrajectoryStepMotionV3,
  limits: EffectiveMotionLimits,
): ValidationResult {
  let sampleCount = Math.max(
    1,
    Math.ceil(motion.durationMs / CUTTER_GRID_MOTION_V3_CONFIG.maxValidationIntervalMs),
  );
  for (;;) {
    const result = validateStepAtSampleCount(challenge, step, motion, limits, sampleCount);
    if (samplesMeetSpatialResolution(challenge, result.waypoints)) return result;
    sampleCount *= 2;
    if (sampleCount > 65_536) {
      throw new CutterGridMotionV3Error(
        'trajectory-smoothing-search-exhausted',
        'Cutter Grid V3 could not certify its trajectory sampling resolution.',
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
      );
    }
  }
}

/**
 * Sampling is intentionally stricter than the duration estimate.  If a
 * sampled dynamic peak proves that estimate optimistic, extend only this
 * fixed geometry interval by the deterministic MoveIt-style 1.1 multiplier.
 */
function validateWithDurationExpansion(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  initialMotion: CutterTrajectoryStepMotionV3,
  limits: EffectiveMotionLimits,
): { motion: CutterTrajectoryStepMotionV3; validation: ValidationResult } {
  let motion = initialMotion;
  const maximumDurationMs = initialMotion.durationMs * 50;
  for (;;) {
    try {
      return { motion, validation: validateStepMotion(challenge, step, motion, limits) };
    } catch (error) {
      if (
        !(error instanceof CutterGridMotionV3Error) ||
        error.code !== 'jerk-smoothing-infeasible'
      ) {
        throw error;
      }
      const nextDurationMs = Math.max(motion.durationMs + 1, Math.ceil(motion.durationMs * 1.1));
      if (nextDurationMs > maximumDurationMs) {
        throw new CutterGridMotionV3Error(
          'trajectory-smoothing-search-exhausted',
          'Cutter Grid V3 exhausted its deterministic duration-extension budget.',
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
        );
      }
      motion = { ...motion, durationMs: nextDurationMs };
    }
  }
}

function validateStepAtSampleCount(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  motion: CutterTrajectoryStepMotionV3,
  limits: EffectiveMotionLimits,
  sampleCount: number,
): ValidationResult {
  const waypoints: CutterTrajectoryWaypointV3[] = [];
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;
  let maximumCartesianDeviation = 0;
  const lineStart = step.waypoints[0]?.endEffector;
  const lineEnd = step.waypoints.at(-1)?.endEffector;
  for (let index = 0; index <= sampleCount; index += 1) {
    const evaluation = evaluateStepMotionAt(
      challenge,
      motion,
      (motion.durationMs * index) / sampleCount,
      limits,
    );
    const { waypoint } = evaluation;
    for (const joint of challenge.robotConfig.joints) {
      const angle = waypoint.jointAngles[joint.id];
      if (angle < joint.minAngleDeg - 1e-9 || angle > joint.maxAngleDeg + 1e-9) {
        throw new CutterGridMotionV3Error(
          'trajectory-smoothing-path-deviation',
          `${joint.name} exceeds its range during V3 motion validation.`,
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
        );
      }
    }
    const collision = findRobotHeadCollision(
      computeRobotPose(challenge.robotConfig, waypoint.jointAngles),
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    );
    if (collision) {
      throw new CutterGridMotionV3Error(
        'trajectory-smoothing-path-deviation',
        `${collision.partLabel} collides with the head during V3 motion validation.`,
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
      );
    }
    if (lineStart && lineEnd) {
      const deviation = pointSegmentDistance(waypoint.endEffector, lineStart, lineEnd);
      maximumCartesianDeviation = Math.max(maximumCartesianDeviation, deviation);
      if (deviation > challenge.voxelConfig.size / 16 + 1e-9) {
        throw new CutterGridMotionV3Error(
          'trajectory-smoothing-path-deviation',
          'Cutter Grid V3 motion leaves the fixed-axis Cartesian path.',
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
        );
      }
    }
    maximumVelocityRatio = Math.max(maximumVelocityRatio, evaluation.velocityRatio);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, evaluation.accelerationRatio);
    maximumJerkRatio = Math.max(maximumJerkRatio, evaluation.jerkRatio);
    if (
      evaluation.velocityRatio > 1 + 1e-7 ||
      evaluation.accelerationRatio > 1 + 1e-7 ||
      evaluation.jerkRatio > 1 + 1e-7
    ) {
      throw new CutterGridMotionV3Error(
        'jerk-smoothing-infeasible',
        'Cutter Grid V3 motion exceeds an effective dynamic limit.',
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
      );
    }
    waypoints.push(waypoint);
  }
  return {
    waypoints,
    maximumVelocityRatio,
    maximumAccelerationRatio,
    maximumJerkRatio,
    maximumCartesianDeviation,
  };
}

function evaluateStepMotionAt(
  challenge: Challenge,
  motion: CutterTrajectoryStepMotionV3,
  targetTimeMs: number,
  limits?: EffectiveMotionLimits,
): StepEvaluation {
  const durationSeconds = Math.max(1e-9, motion.durationMs / 1_000);
  const normalizedTime = clamp(targetTimeMs / motion.durationMs, 0, 1);
  const normalized = evaluateGeometryAtNormalizedTime(
    challenge,
    motion.geometryWaypoints,
    normalizedTime,
    durationSeconds,
  );
  const unsnappedJointAngles = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    normalized[joint.id].angle,
  ])) as Record<JointId, number>;
  // A certified V2 solution may sit exactly on a joint boundary.  Polynomial
  // evaluation can turn that into 45.000000000000014 at an interior V3 sample;
  // preserve the certified boundary instead of manufacturing an out-of-range
  // playback failure.  Values outside the validation epsilon are never
  // clamped and still fail closed below.
  const jointAngles = snapNumericalJointLimitNoise(challenge, unsnappedJointAngles);
  const jointVelocitiesDegPerSec = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    normalized[joint.id].velocity,
  ])) as Record<JointId, number>;
  const jointAccelerationsDegPerSec2 = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    normalized[joint.id].acceleration,
  ])) as Record<JointId, number>;
  const jointJerksDegPerSec3 = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    normalized[joint.id].jerk,
  ])) as Record<JointId, number>;
  const velocityRatio = limits
    ? Math.max(...challenge.robotConfig.joints.map((joint) => Math.abs(jointVelocitiesDegPerSec[joint.id]) / limits[joint.id].velocity))
    : 0;
  const accelerationRatio = limits
    ? Math.max(...challenge.robotConfig.joints.map((joint) => Math.abs(jointAccelerationsDegPerSec2[joint.id]) / limits[joint.id].acceleration))
    : 0;
  const jerkRatio = limits
    ? Math.max(...challenge.robotConfig.joints.map((joint) => Math.abs(jointJerksDegPerSec3[joint.id]) / limits[joint.id].jerk))
    : 0;
  return {
    waypoint: {
      timeMs: targetTimeMs,
      jointAngles,
      jointVelocitiesDegPerSec,
      jointAccelerationsDegPerSec2,
      jointJerksDegPerSec3,
      endEffector: computeRobotPose(challenge.robotConfig, jointAngles).endEffector,
    },
    velocityRatio,
    accelerationRatio,
    jerkRatio,
  };
}

function snapNumericalJointLimitNoise(
  challenge: Challenge,
  angles: Record<JointId, number>,
): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const angle = angles[joint.id];
    if (angle < joint.minAngleDeg && angle >= joint.minAngleDeg - 1e-9) {
      return [joint.id, joint.minAngleDeg];
    }
    if (angle > joint.maxAngleDeg && angle <= joint.maxAngleDeg + 1e-9) {
      return [joint.id, joint.maxAngleDeg];
    }
    return [joint.id, angle];
  })) as Record<JointId, number>;
}

function evaluateGeometryAtNormalizedTime(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV2[],
  normalizedTime: number,
  durationSeconds: number,
): Record<JointId, { angle: number; velocity: number; acceleration: number; jerk: number }> {
  const spanCount = waypoints.length - 1;
  const ease = quinticTimeLaw(normalizedTime);
  const parameter = Math.min(spanCount, spanCount * ease.position);
  const spanIndex = Math.min(spanCount - 1, Math.floor(parameter));
  const local = parameter - spanIndex;
  const start = waypoints[spanIndex];
  const end = waypoints[spanIndex + 1];
  const oldDurationSeconds = Math.max(1e-9, (end.timeMs - start.timeMs) / 1_000);
  const parameterVelocity = (spanCount * ease.velocity) / durationSeconds;
  const parameterAcceleration = (spanCount * ease.acceleration) / durationSeconds ** 2;
  const parameterJerk = (spanCount * ease.jerk) / durationSeconds ** 3;
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const p0 = start.jointAngles[joint.id];
    const p1 = end.jointAngles[joint.id];
    const m0 = start.jointVelocitiesDegPerSec[joint.id] * oldDurationSeconds;
    const m1 = end.jointVelocitiesDegPerSec[joint.id] * oldDurationSeconds;
    const geometry = cubicHermite(p0, p1, m0, m1, local);
    const velocity = geometry.first * parameterVelocity;
    const acceleration = geometry.second * parameterVelocity ** 2 + geometry.first * parameterAcceleration;
    const jerk =
      geometry.third * parameterVelocity ** 3 +
      3 * geometry.second * parameterVelocity * parameterAcceleration +
      geometry.first * parameterJerk;
    return [joint.id, { angle: geometry.position, velocity, acceleration, jerk }];
  })) as Record<JointId, { angle: number; velocity: number; acceleration: number; jerk: number }>;
}

function quinticTimeLaw(t: number): { position: number; velocity: number; acceleration: number; jerk: number } {
  const u = clamp(t, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  return {
    position: 6 * u5 - 15 * u4 + 10 * u3,
    velocity: 30 * u2 * (1 - u) ** 2,
    acceleration: 60 * u - 180 * u2 + 120 * u3,
    jerk: 60 - 360 * u + 360 * u2,
  };
}

function cubicHermite(p0: number, p1: number, m0: number, m1: number, t: number): {
  position: number;
  first: number;
  second: number;
  third: number;
} {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    position:
      (2 * t3 - 3 * t2 + 1) * p0 +
      (t3 - 2 * t2 + t) * m0 +
      (-2 * t3 + 3 * t2) * p1 +
      (t3 - t2) * m1,
    first:
      (6 * t2 - 6 * t) * p0 +
      (3 * t2 - 4 * t + 1) * m0 +
      (-6 * t2 + 6 * t) * p1 +
      (3 * t2 - 2 * t) * m1,
    second:
      (12 * t - 6) * p0 +
      (6 * t - 4) * m0 +
      (-12 * t + 6) * p1 +
      (6 * t - 2) * m1,
    third: 12 * p0 + 6 * m0 - 12 * p1 + 6 * m1,
  };
}

function samplesMeetSpatialResolution(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV3[],
): boolean {
  return waypoints.every((waypoint, index) => {
    if (index === 0) return true;
    const previous = waypoints[index - 1];
    const maximumJointDelta = Math.max(...challenge.robotConfig.joints.map((joint) =>
      Math.abs(waypoint.jointAngles[joint.id] - previous.jointAngles[joint.id]),
    ));
    return (
      maximumJointDelta <= CUTTER_GRID_MOTION_V3_CONFIG.maxJointSampleDeltaDeg + 1e-9 &&
      distance(waypoint.endEffector, previous.endEffector) <=
        challenge.voxelConfig.size * CUTTER_GRID_MOTION_V3_CONFIG.maxEndEffectorSampleDelta + 1e-9
    );
  });
}

function applyExpectedContacts(
  challenge: Challenge,
  steps: CutterTrajectoryStepV3[],
): VoxelKey[] {
  const remaining = new Set(challenge.initialHair.voxels);
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    const hits = new Set<VoxelKey>();
    for (let index = 1; index < step.waypoints.length; index += 1) {
      findSweptVoxelHits(
        step.waypoints[index - 1].endEffector,
        step.waypoints[index].endEffector,
        remaining,
        challenge.voxelConfig,
        challenge.robotConfig.geometry.toolRadius,
      ).forEach((key) => hits.add(key));
    }
    step.expectedCutVoxels = [...hits].sort();
    hits.forEach((key) => remaining.delete(key));
  }
  return [...remaining].sort();
}

function holdWaypoint(
  challenge: Challenge,
  waypoint: CutterTrajectoryWaypointV2 | undefined,
): CutterTrajectoryWaypointV3 {
  if (!waypoint) {
    throw new CutterGridMotionV3Error('time-parameterization-infeasible', 'Cutter Grid V3 wait has no hold pose.');
  }
  const zeros = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [joint.id, 0])) as Record<JointId, number>;
  return {
    timeMs: waypoint.timeMs,
    jointAngles: { ...waypoint.jointAngles },
    jointVelocitiesDegPerSec: zeros,
    jointAccelerationsDegPerSec2: { ...zeros },
    jointJerksDegPerSec3: { ...zeros },
    endEffector: [...waypoint.endEffector] as Vec3Tuple,
  };
}

function cloneGeometryWaypoints(
  waypoints: readonly CutterTrajectoryWaypointV2[],
): CutterTrajectoryWaypointV2[] {
  return waypoints.map((waypoint) => ({
    timeMs: waypoint.timeMs,
    jointAngles: { ...waypoint.jointAngles },
    jointVelocitiesDegPerSec: { ...waypoint.jointVelocitiesDegPerSec },
    endEffector: [...waypoint.endEffector] as Vec3Tuple,
  }));
}

function motionTrajectorySignature(plan: Omit<CutterTrajectoryPlanV3, 'trajectorySignature'>): string {
  return fnv1a64(JSON.stringify({
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      waypoints: step.waypoints.map((waypoint) => ({
        timeMs: round(waypoint.timeMs, 6),
        jointAngles: roundRecord(waypoint.jointAngles),
        jointVelocitiesDegPerSec: roundRecord(waypoint.jointVelocitiesDegPerSec),
        jointAccelerationsDegPerSec2: roundRecord(waypoint.jointAccelerationsDegPerSec2),
        jointJerksDegPerSec3: roundRecord(waypoint.jointJerksDegPerSec3),
        endEffector: waypoint.endEffector.map((value) => round(value, 9)),
      })),
    })),
  }));
}

function roundRecord(record: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, round(value, 9)]));
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction: Vec3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const progress = lengthSquared === 0 ? 0 : clamp(
    ((point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1] + (point[2] - start[2]) * direction[2]) / lengthSquared,
    0,
    1,
  );
  return distance(point, [
    start[0] + direction[0] * progress,
    start[1] + direction[1] * progress,
    start[2] + direction[2] * progress,
  ]);
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
