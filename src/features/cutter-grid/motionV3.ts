import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { fnv1a64 } from './signature';
import { cutterGridMotionLimitsSignatureV3 } from './motionLimitsV3';
import {
  CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
  type CutterGridMotionLimitsV3,
  type CutterGridPlanningDiagnosticsV3,
  type CutterGridPlanningErrorCodeV3,
  type CutterGridPositioningMotionV3,
  type CutterTrajectoryGeometryKnotV3,
  type CutterTrajectoryGeometryV3,
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

export type CutterGridMotionV3ProgressPhase =
  | 'geometric-smoothing'
  | 'time-parameterization'
  | 'jerk-smoothing'
  | 'playback-validation';

/**
 * Synchronous, deterministic observations of the V3 pipeline.  They are
 * deliberately outside the signed plan: subscribing cannot alter candidate
 * order, geometry, duration, or any safety decision.
 */
export interface CutterGridMotionV3Progress {
  phase: CutterGridMotionV3ProgressPhase;
  completedSegments: number;
  totalSegments: number;
}

export interface CutterGridMotionV3Options {
  onProgress?: (progress: CutterGridMotionV3Progress) => void;
}

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

interface MotionGeometry {
  geometryWaypoints: CutterTrajectoryWaypointV2[];
  geometry: CutterTrajectoryGeometryV3;
}

interface MotionValidationOptions {
  verifyCartesianPipe: boolean;
  requireZeroHairContact: boolean;
}

const PLAYER_MOTION_VALIDATION: MotionValidationOptions = {
  verifyCartesianPipe: true,
  requireZeroHairContact: false,
};

const POSITIONING_MOTION_VALIDATION: MotionValidationOptions = {
  verifyCartesianPipe: false,
  requireZeroHairContact: true,
};

/**
 * Retimes a V2 globally-selected geometry path without selecting a new IK
 * branch.  Geometry is a deterministic global C2 quintic spline in its path
 * parameter while a quintic minimum-jerk time law controls scalar progress
 * through every atomic Cutter Grid move. The exported data is DOM-free and is
 * intentionally shaped for a future byte-for-byte Rust `hcr_sim` counterpart.
 */
export function retimeCutterGridTrajectoryV3(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV2,
  motionLimits: CutterGridMotionLimitsV3,
  options: CutterGridMotionV3Options = {},
): CutterTrajectoryPlanV3 {
  assertMotionLimits(challenge, motionLimits);
  const effective = effectiveMotionLimits(challenge, motionLimits);
  const positioningStep = positioningTrajectoryStep(plan.positioningTrajectory);
  const moveStepCount = plan.steps.filter((step) => step.kind === 'move-cell').length;
  const totalSegments = moveStepCount + 1;
  const reportProgress = (phase: CutterGridMotionV3ProgressPhase, completedSegments: number) => {
    options.onProgress?.({ phase, completedSegments, totalSegments });
  };
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;
  let maximumCartesianDeviation = 0;
  let validationSampleCount = 0;

  // First construct all immutable C2 geometry. Grouping this separate from
  // timing makes the Worker diagnostic truthful and proves that a later
  // duration expansion cannot choose another IK/angle-wrap branch.
  reportProgress('geometric-smoothing', 0);
  const positioningGeometry = buildMotionGeometry(challenge, positioningStep);
  const stepGeometries = plan.steps.map((step) =>
    step.kind === 'move-cell' ? buildMotionGeometry(challenge, step) : undefined,
  );
  reportProgress('geometric-smoothing', totalSegments);

  reportProgress('time-parameterization', 0);
  const positioningInitialMotion = timeParameterizeMotion(
    challenge,
    positioningStep,
    positioningGeometry,
    effective,
  );
  const initialMotions = plan.steps.map((step, index) =>
    step.kind === 'move-cell'
      ? timeParameterizeMotion(challenge, step, requireMotionGeometry(stepGeometries[index]), effective)
      : undefined,
  );
  reportProgress('time-parameterization', totalSegments);

  // Positioning is a system operation, but it is still real arm motion.  Do
  // not let a V2 interpolation create a visible jerk immediately before the
  // first player action.
  reportProgress('jerk-smoothing', 0);
  const positioning = retimeCutterGridPositioningV3(
    challenge,
    positioningStep,
    positioningInitialMotion,
    effective,
  );
  let smoothedSegments = 1;
  reportProgress('jerk-smoothing', smoothedSegments);
  maximumVelocityRatio = Math.max(maximumVelocityRatio, positioning.maximumVelocityRatio);
  maximumAccelerationRatio = Math.max(maximumAccelerationRatio, positioning.maximumAccelerationRatio);
  maximumJerkRatio = Math.max(maximumJerkRatio, positioning.maximumJerkRatio);
  validationSampleCount += positioning.validationSampleCount;

  const steps = plan.steps.map((step, index) => {
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
      requireInitialMotion(initialMotions[index]),
      effective,
    );
    smoothedSegments += 1;
    reportProgress('jerk-smoothing', smoothedSegments);
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

  reportProgress('playback-validation', 0);
  const expectedResultVoxels = applyExpectedContacts(challenge, steps);
  reportProgress('playback-validation', totalSegments);
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
  const geometrySignature = cutterGridGeometrySignatureV3(
    plan.challengeSignature,
    plan.entryOptionId,
    positioning.motion,
    steps,
  );
  const unsigned: Omit<CutterTrajectoryPlanV3, 'trajectorySignature'> = {
    kind: 'cutter-grid-trajectory',
    version: 3,
    plannerVersion: CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
    challengeSignature: plan.challengeSignature,
    entryOptionId: plan.entryOptionId,
    geometrySignature,
    positioningTrajectory: cloneGeometryWaypoints(plan.positioningTrajectory),
    positioningMotion: positioning.motion,
    startCoord: plan.startCoord,
    endCoord: plan.endCoord,
    steps,
    expectedResultVoxels,
    estimatedDurationMs,
    executedCommandCount: plan.executedCommandCount,
    motionLimits,
    motionLimitsSignature: cutterGridMotionLimitsSignatureV3(challenge, motionLimits),
    diagnostics,
  };
  return finalizeCutterGridTrajectoryPlanV3(unsigned);
}

/** Re-sign a fully certified V3 plan after replacing only its timing stream. */
export function finalizeCutterGridTrajectoryPlanV3(
  plan: Omit<CutterTrajectoryPlanV3, 'trajectorySignature'>,
): CutterTrajectoryPlanV3 {
  return {
    ...plan,
    trajectorySignature: motionTrajectorySignature(plan),
  };
}

function retimeCutterGridPositioningV3(
  challenge: Challenge,
  positioningStep: CutterTrajectoryStepV2,
  initialMotion: CutterTrajectoryStepMotionV3,
  effective: EffectiveMotionLimits,
): {
  motion: CutterGridPositioningMotionV3;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  validationSampleCount: number;
} {
  const { motion, validation } = validateWithDurationExpansion(
    challenge,
    positioningStep,
    initialMotion,
    effective,
    POSITIONING_MOTION_VALIDATION,
  );
  return {
    motion: {
      durationMs: motion.durationMs,
      waypoints: validation.waypoints,
      motion,
    },
    maximumVelocityRatio: validation.maximumVelocityRatio,
    maximumAccelerationRatio: validation.maximumAccelerationRatio,
    maximumJerkRatio: validation.maximumJerkRatio,
    validationSampleCount: validation.waypoints.length,
  };
}

function positioningTrajectoryStep(
  geometryWaypoints: readonly CutterTrajectoryWaypointV2[],
): CutterTrajectoryStepV2 {
  const last = geometryWaypoints.at(-1);
  return {
    index: -1,
    kind: 'move-cell',
    sourceBlockId: 'system-positioning',
    startCoord: [0, 0, 0],
    endCoord: [0, 0, 0],
    durationMs: last?.timeMs ?? 0,
    waypoints: cloneGeometryWaypoints(geometryWaypoints),
    expectedCutVoxels: [],
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
  if (step.motion.interpolation === 'ruckig-local-sampled') {
    return evaluateCutterTrajectoryRuckigSampledV3At(
      challenge,
      step.waypoints,
      clamp(targetTimeMs, 0, step.motion.durationMs),
    );
  }
  return evaluateStepMotionAt(
    challenge,
    step.motion,
    clamp(targetTimeMs, 0, step.motion.durationMs),
  ).waypoint;
}

/** Evaluate the system-only V3 entry using the same absolute-time law. */
export function evaluateCutterGridPositioningV3At(
  challenge: Challenge,
  positioning: CutterGridPositioningMotionV3,
  targetTimeMs: number,
): CutterTrajectoryWaypointV3 {
  if (positioning.motion.interpolation === 'ruckig-local-sampled') {
    return evaluateCutterTrajectoryRuckigSampledV3At(
      challenge,
      positioning.waypoints,
      clamp(targetTimeMs, 0, positioning.durationMs),
    );
  }
  return evaluateStepMotionAt(
    challenge,
    positioning.motion,
    clamp(targetTimeMs, 0, positioning.durationMs),
  ).waypoint;
}

/**
 * C2, absolute-time reconstruction for a frozen local-Ruckig stream. Each
 * span uses the exact q/v/a returned at its endpoints; there is no mutable
 * frame delta and no new IK choice during playback. Callers must certify the
 * reconstructed spans before accepting them into a V3 plan.
 */
export function evaluateCutterTrajectorySampledV3At(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV3[],
  targetTimeMs: number,
  interpolation: 'quintic' | 'ruckig-constant-jerk' = 'quintic',
): CutterTrajectoryWaypointV3 {
  const first = waypoints[0];
  const last = waypoints.at(-1);
  if (!first || !last) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 sampled motion has no certified waypoints.',
    );
  }
  const boundedTime = clamp(targetTimeMs, first.timeMs, last.timeMs);
  if (boundedTime <= first.timeMs) return cloneV3Waypoint(first);
  if (boundedTime >= last.timeMs) return cloneV3Waypoint(last);
  const endIndex = sampledWaypointEndIndex(waypoints, boundedTime);
  const end = waypoints[endIndex];
  const start = waypoints[endIndex - 1];
  if (!start || !end || end.timeMs <= start.timeMs) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 sampled motion has a non-increasing waypoint time.',
    );
  }
  // A frozen Ruckig boundary is authoritative. Returning it verbatim avoids a
  // harmless but signature-visible ~1e-14 polynomial rounding drift exactly
  // at a Step checkpoint or final planned sample.
  if (boundedTime === end.timeMs) return cloneV3Waypoint(end);
  if (boundedTime === start.timeMs) return cloneV3Waypoint(start);
  const spanSeconds = (end.timeMs - start.timeMs) / 1_000;
  const elapsedSeconds = (boundedTime - start.timeMs) / 1_000;
  const jointAngles = {} as Record<JointId, number>;
  const jointVelocitiesDegPerSec = {} as Record<JointId, number>;
  const jointAccelerationsDegPerSec2 = {} as Record<JointId, number>;
  const jointJerksDegPerSec3 = {} as Record<JointId, number>;
  for (const joint of challenge.robotConfig.joints) {
    const curve = interpolation === 'ruckig-constant-jerk'
      ? evaluateConstantJerk(
        start.jointAngles[joint.id],
        start.jointVelocitiesDegPerSec[joint.id],
        start.jointAccelerationsDegPerSec2[joint.id],
        start.jointJerksDegPerSec3[joint.id],
        elapsedSeconds,
      )
      : evaluateQuintic(
        quinticCoefficients(
          start.jointAngles[joint.id],
          end.jointAngles[joint.id],
          spanSeconds,
          start.jointVelocitiesDegPerSec[joint.id],
          start.jointAccelerationsDegPerSec2[joint.id],
          end.jointVelocitiesDegPerSec[joint.id],
          end.jointAccelerationsDegPerSec2[joint.id],
        ),
        elapsedSeconds,
      );
    jointAngles[joint.id] = curve.position;
    jointVelocitiesDegPerSec[joint.id] = curve.first;
    jointAccelerationsDegPerSec2[joint.id] = curve.second;
    jointJerksDegPerSec3[joint.id] = curve.third;
  }
  const safeJointAngles = snapNumericalJointLimitNoise(challenge, jointAngles);
  return {
    timeMs: boundedTime,
    jointAngles: safeJointAngles,
    jointVelocitiesDegPerSec,
    jointAccelerationsDegPerSec2,
    jointJerksDegPerSec3,
    endEffector: computeRobotPose(challenge.robotConfig, safeJointAngles).endEffector,
  };
}

/**
 * Ruckig exposes a piecewise constant-jerk trajectory. Its ABI v3 samples
 * every material jerk switch, so integrating the right-hand jerk from the
 * start q/v/a of each interval is its exact cubic representation. This is
 * C2 at a switch and avoids manufacturing a tiny quintic overshoot merely
 * from floating-point endpoint round-off near a dynamic limit.
 */
export function evaluateCutterTrajectoryRuckigSampledV3At(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV3[],
  targetTimeMs: number,
): CutterTrajectoryWaypointV3 {
  return evaluateCutterTrajectorySampledV3At(
    challenge,
    waypoints,
    targetTimeMs,
    'ruckig-constant-jerk',
  );
}

/** Locate the first immutable q/v/a boundary at or after an absolute time. */
function sampledWaypointEndIndex(
  waypoints: readonly CutterTrajectoryWaypointV3[],
  targetTimeMs: number,
): number {
  let low = 1;
  let high = waypoints.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((waypoints[middle]?.timeMs ?? Number.POSITIVE_INFINITY) < targetTimeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
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

function buildMotionGeometry(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
): MotionGeometry {
  if (step.waypoints.length < 2) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'A Cutter Grid move needs at least two certified geometry waypoints.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }
  const geometryWaypoints = unwrapGeometryWaypoints(challenge, step);
  const geometry = buildGlobalC2QuinticGeometry(challenge, geometryWaypoints, step);
  return { geometryWaypoints, geometry };
}

function timeParameterizeMotion(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  geometryData: MotionGeometry,
  limits: EffectiveMotionLimits,
): CutterTrajectoryStepMotionV3 {
  const { geometryWaypoints, geometry } = geometryData;
  let minimumDurationSeconds = 0;
  for (let sample = 0; sample <= CUTTER_GRID_MOTION_V3_CONFIG.normalizedDerivativeSamples; sample += 1) {
    const normalizedTime = sample / CUTTER_GRID_MOTION_V3_CONFIG.normalizedDerivativeSamples;
    const normalized = evaluateGeometryAtNormalizedTime(challenge, geometry, normalizedTime, 1);
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
    interpolation: 'global-c2-quintic-time-law',
    durationMs: Math.max(1, Math.ceil(minimumDurationSeconds * 1_000)),
    geometryWaypoints,
    geometry,
  };
}

function requireMotionGeometry(geometry: MotionGeometry | undefined): MotionGeometry {
  if (!geometry) {
    throw new CutterGridMotionV3Error(
      'trajectory-smoothing-search-exhausted',
      'Cutter Grid V3 lost a prepared geometry segment.',
    );
  }
  return geometry;
}

function requireInitialMotion(motion: CutterTrajectoryStepMotionV3 | undefined): CutterTrajectoryStepMotionV3 {
  if (!motion) {
    throw new CutterGridMotionV3Error(
      'trajectory-smoothing-search-exhausted',
      'Cutter Grid V3 lost a prepared timing segment.',
    );
  }
  return motion;
}

function validateStepMotion(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
  motion: CutterTrajectoryStepMotionV3,
  limits: EffectiveMotionLimits,
  validationOptions: MotionValidationOptions,
): ValidationResult {
  let sampleCount = Math.max(
    1,
    Math.ceil(motion.durationMs / CUTTER_GRID_MOTION_V3_CONFIG.maxValidationIntervalMs),
  );
  for (;;) {
    const result = validateStepAtSampleCount(
      challenge,
      step,
      motion,
      limits,
      sampleCount,
      validationOptions,
    );
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
  validationOptions: MotionValidationOptions = PLAYER_MOTION_VALIDATION,
): { motion: CutterTrajectoryStepMotionV3; validation: ValidationResult } {
  let motion = initialMotion;
  const maximumDurationMs = initialMotion.durationMs * 50;
  for (;;) {
    try {
      return {
        motion,
        validation: validateStepMotion(challenge, step, motion, limits, validationOptions),
      };
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
  validationOptions: MotionValidationOptions,
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
    if (validationOptions.verifyCartesianPipe && lineStart && lineEnd) {
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
    if (validationOptions.requireZeroHairContact && index > 0) {
      const previous = waypoints.at(-1);
      if (previous) {
        const hits = findSweptVoxelHits(
          previous.endEffector,
          waypoint.endEffector,
          challenge.initialHair.voxels,
          challenge.voxelConfig,
          challenge.robotConfig.geometry.toolRadius,
        );
        if (hits.length > 0) {
          throw new CutterGridMotionV3Error(
            'trajectory-smoothing-path-deviation',
            'Cutter Grid V3 system positioning would contact hair.',
          );
        }
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
  if (!motion.geometry) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 move is missing its C2 geometry.',
    );
  }
  const normalized = evaluateGeometryAtNormalizedTime(
    challenge,
    motion.geometry,
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

/**
 * Choose a deterministic equivalent angle representation before smoothing.
 * The V2 graph has already selected the IK branch; this only prevents a
 * mathematically equivalent +/- 360 degree representation from creating a
 * false discontinuity in the timing domain.
 */
function unwrapGeometryWaypoints(
  challenge: Challenge,
  step: CutterTrajectoryStepV2,
): CutterTrajectoryWaypointV2[] {
  const result = cloneGeometryWaypoints(step.waypoints);
  for (const joint of challenge.robotConfig.joints) {
    let previous: number | undefined;
    for (const waypoint of result) {
      const raw = waypoint.jointAngles[joint.id];
      const minimumTurn = Math.ceil((joint.minAngleDeg - raw) / 360);
      const maximumTurn = Math.floor((joint.maxAngleDeg - raw) / 360);
      let selected: number | undefined;
      for (let turn = minimumTurn; turn <= maximumTurn; turn += 1) {
        const candidate = raw + turn * 360;
        if (
          selected === undefined ||
          (previous !== undefined && Math.abs(candidate - previous) < Math.abs(selected - previous) - 1e-12) ||
          (previous !== undefined && Math.abs(candidate - previous) <= Math.abs(selected - previous) + 1e-12 && candidate < selected) ||
          (previous === undefined && Math.abs(candidate - raw) < Math.abs(selected - raw) - 1e-12) ||
          (previous === undefined && Math.abs(candidate - raw) <= Math.abs(selected - raw) + 1e-12 && candidate < selected)
        ) {
          selected = candidate;
        }
      }
      if (selected === undefined) {
        throw new CutterGridMotionV3Error(
          'joint-branch-discontinuity',
          `${joint.name} has no equivalent angle inside its configured range.`,
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
        );
      }
      waypoint.jointAngles[joint.id] = selected;
      previous = selected;
    }
  }
  return result.map((waypoint) => ({
    ...waypoint,
    endEffector: computeRobotPose(challenge.robotConfig, waypoint.jointAngles).endEffector,
  }));
}

function buildGlobalC2QuinticGeometry(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV2[],
  step: CutterTrajectoryStepV2,
): CutterTrajectoryGeometryV3 {
  const startTime = waypoints[0]?.timeMs;
  const endTime = waypoints.at(-1)?.timeMs;
  if (startTime === undefined || endTime === undefined || endTime <= startTime) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 geometry needs strictly increasing waypoint times.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }
  const parameters = waypoints.map((waypoint) => (waypoint.timeMs - startTime) / (endTime - startTime));
  if (parameters.some((parameter, index) => index > 0 && parameter <= parameters[index - 1])) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 geometry waypoint parameters must be strictly increasing.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }

  const minimumJerkDerivatives = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    solveMinimumJerkKnotDerivatives(
      parameters,
      waypoints.map((waypoint) => waypoint.jointAngles[joint.id]),
      step,
    ),
  ])) as Record<JointId, { velocities: number[]; accelerations: number[] }>;
  const minimumJerkGeometry = geometryFromDerivatives(
    challenge,
    waypoints,
    parameters,
    minimumJerkDerivatives,
    'minimum-jerk',
  );
  if (geometryRespectsJointRanges(challenge, minimumJerkGeometry)) {
    return minimumJerkGeometry;
  }

  // The unconstrained minimum-jerk optimum can overshoot a joint that is
  // already on its physical limit. Preserve the same V2 knot sequence with a
  // deterministic C2 monotone construction rather than relaxing the limit or
  // letting a planning failure leak into a valid player command.
  const monotoneDerivatives = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    monotoneC2KnotDerivatives(
      parameters,
      waypoints.map((waypoint) => waypoint.jointAngles[joint.id]),
    ),
  ])) as Record<JointId, { velocities: number[]; accelerations: number[] }>;
  return geometryFromDerivatives(
    challenge,
    waypoints,
    parameters,
    monotoneDerivatives,
    'monotone-c2-fallback',
  );
}

function geometryFromDerivatives(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV2[],
  parameters: readonly number[],
  derivatives: Record<JointId, { velocities: number[]; accelerations: number[] }>,
  constraintResolution: CutterTrajectoryGeometryV3['constraintResolution'],
): CutterTrajectoryGeometryV3 {
  const knots: CutterTrajectoryGeometryKnotV3[] = waypoints.map((waypoint, index) => ({
    parameter: parameters[index],
    jointAngles: { ...waypoint.jointAngles },
    jointVelocitiesPerParameter: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      derivatives[joint.id].velocities[index],
    ])) as Record<JointId, number>,
    jointAccelerationsPerParameter2: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      derivatives[joint.id].accelerations[index],
    ])) as Record<JointId, number>,
  }));
  return { interpolation: 'global-c2-quintic-spline', constraintResolution, knots };
}

function geometryRespectsJointRanges(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
): boolean {
  for (let segment = 0; segment < geometry.knots.length - 1; segment += 1) {
    const start = geometry.knots[segment].parameter;
    const end = geometry.knots[segment + 1].parameter;
    for (let sample = 0; sample <= 32; sample += 1) {
      const evaluated = evaluateCutterTrajectoryGeometryV3AtParameter(
        challenge,
        geometry,
        start + ((end - start) * sample) / 32,
      );
      for (const joint of challenge.robotConfig.joints) {
        const angle = evaluated[joint.id].angle;
        if (angle < joint.minAngleDeg - 1e-9 || angle > joint.maxAngleDeg + 1e-9) return false;
      }
    }
  }
  return true;
}

function monotoneC2KnotDerivatives(
  parameters: readonly number[],
  positions: readonly number[],
): { velocities: number[]; accelerations: number[] } {
  const velocities = Array<number>(positions.length).fill(0);
  const accelerations = Array<number>(positions.length).fill(0);
  for (let knot = 1; knot < positions.length - 1; knot += 1) {
    const previousSlope = (positions[knot] - positions[knot - 1]) / (parameters[knot] - parameters[knot - 1]);
    const nextSlope = (positions[knot + 1] - positions[knot]) / (parameters[knot + 1] - parameters[knot]);
    if (previousSlope * nextSlope <= 0) continue;
    // Keeping each endpoint derivative no greater than half either secant
    // slope makes the quintic segment monotone; the zero accelerations are
    // shared on both sides, so the fallback remains C2.
    velocities[knot] = Math.sign(previousSlope) * Math.min(
      Math.abs(previousSlope),
      Math.abs(nextSlope),
    ) / 2;
  }
  return { velocities, accelerations };
}

function solveMinimumJerkKnotDerivatives(
  parameters: readonly number[],
  positions: readonly number[],
  step: CutterTrajectoryStepV2,
): { velocities: number[]; accelerations: number[] } {
  const knotCount = positions.length;
  const unknownCount = Math.max(0, (knotCount - 2) * 2);
  const velocities = Array<number>(knotCount).fill(0);
  const accelerations = Array<number>(knotCount).fill(0);
  if (unknownCount === 0) return { velocities, accelerations };

  const matrix = Array.from({ length: unknownCount }, () => Array<number>(unknownCount).fill(0));
  const vector = Array<number>(unknownCount).fill(0);
  for (let segment = 0; segment < knotCount - 1; segment += 1) {
    const h = parameters[segment + 1] - parameters[segment];
    const constant = quinticJerkCoefficientVector(
      quinticCoefficients(positions[segment], positions[segment + 1], h, 0, 0, 0, 0),
    );
    const localTerms = [
      minimumJerkVariableTerm(segment, knotCount, 'start', 'velocity', h),
      minimumJerkVariableTerm(segment, knotCount, 'start', 'acceleration', h),
      minimumJerkVariableTerm(segment + 1, knotCount, 'end', 'velocity', h),
      minimumJerkVariableTerm(segment + 1, knotCount, 'end', 'acceleration', h),
    ].filter((term): term is { index: number; coefficients: [number, number, number] } => term !== undefined);
    const metric = jerkIntegralMetric(h);
    for (const left of localTerms) {
      vector[left.index] -= dot3(left.coefficients, multiply3(metric, constant));
      for (const right of localTerms) {
        matrix[left.index][right.index] += dot3(
          left.coefficients,
          multiply3(metric, right.coefficients),
        );
      }
    }
  }
  const solution = solveSymmetricLinearSystem(matrix, vector, step);
  for (let knot = 1; knot < knotCount - 1; knot += 1) {
    const base = (knot - 1) * 2;
    velocities[knot] = solution[base];
    accelerations[knot] = solution[base + 1];
  }
  return { velocities, accelerations };
}

function minimumJerkVariableTerm(
  knotIndex: number,
  knotCount: number,
  side: 'start' | 'end',
  kind: 'velocity' | 'acceleration',
  duration: number,
): { index: number; coefficients: [number, number, number] } | undefined {
  if (knotIndex === 0 || knotIndex === knotCount - 1) return undefined;
  const index = (knotIndex - 1) * 2 + (kind === 'velocity' ? 0 : 1);
  const startVelocity = side === 'start' && kind === 'velocity' ? 1 : 0;
  const startAcceleration = side === 'start' && kind === 'acceleration' ? 1 : 0;
  const endVelocity = side === 'end' && kind === 'velocity' ? 1 : 0;
  const endAcceleration = side === 'end' && kind === 'acceleration' ? 1 : 0;
  const curve = quinticCoefficients(
    0,
    0,
    duration,
    startVelocity,
    startAcceleration,
    endVelocity,
    endAcceleration,
  );
  return { index, coefficients: quinticJerkCoefficientVector(curve) };
}

function quinticJerkCoefficientVector(curve: QuinticCurve): [number, number, number] {
  return [6 * curve.c3, 24 * curve.c4, 60 * curve.c5];
}

function jerkIntegralMetric(duration: number): [[number, number, number], [number, number, number], [number, number, number]] {
  const h = duration;
  return [
    [h, h ** 2 / 2, h ** 3 / 3],
    [h ** 2 / 2, h ** 3 / 3, h ** 4 / 4],
    [h ** 3 / 3, h ** 4 / 4, h ** 5 / 5],
  ];
}

function multiply3(
  matrix: readonly (readonly number[])[],
  vector: readonly [number, number, number],
): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function dot3(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function solveSymmetricLinearSystem(
  matrix: number[][],
  vector: number[],
  step: CutterTrajectoryStepV2,
): number[] {
  const size = vector.length;
  // Each quintic span touches only its two adjacent q/v/a knots.  The normal
  // matrix therefore has a fixed half-bandwidth of three scalar variables;
  // do not turn a long Cutter Grid path into an O(n^3) dense solve.
  const halfBandwidth = 3;
  const coefficients = matrix.map((row) => [...row]);
  const constants = [...vector];
  for (let column = 0; column < size; column += 1) {
    const pivot = coefficients[column][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) {
      throw new CutterGridMotionV3Error(
        'trajectory-smoothing-search-exhausted',
        'Cutter Grid V3 could not solve its deterministic C2 geometry system.',
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
      );
    }
    for (let row = column + 1; row <= Math.min(size - 1, column + halfBandwidth); row += 1) {
      const factor = coefficients[row][column] / pivot;
      if (factor === 0) continue;
      coefficients[row][column] = 0;
      for (let index = column + 1; index <= Math.min(size - 1, column + halfBandwidth); index += 1) {
        coefficients[row][index] -= factor * coefficients[column][index];
      }
      constants[row] -= factor * constants[column];
    }
  }
  const solution = Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let remainder = constants[row];
    for (let column = row + 1; column <= Math.min(size - 1, row + halfBandwidth); column += 1) {
      remainder -= coefficients[row][column] * solution[column];
    }
    solution[row] = remainder / coefficients[row][row];
  }
  return solution;
}

function evaluateGeometryAtNormalizedTime(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  normalizedTime: number,
  durationSeconds: number,
): Record<JointId, { angle: number; velocity: number; acceleration: number; jerk: number }> {
  const ease = quinticTimeLaw(normalizedTime);
  const parameterCurve = evaluateCutterTrajectoryGeometryV3AtParameter(
    challenge,
    geometry,
    ease.position,
  );
  const parameterVelocity = ease.velocity / durationSeconds;
  const parameterAcceleration = ease.acceleration / durationSeconds ** 2;
  const parameterJerk = ease.jerk / durationSeconds ** 3;
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const curve = parameterCurve[joint.id];
    const velocity = curve.velocityPerParameter * parameterVelocity;
    const acceleration =
      curve.accelerationPerParameter2 * parameterVelocity ** 2 +
      curve.velocityPerParameter * parameterAcceleration;
    const jerk =
      curve.jerkPerParameter3 * parameterVelocity ** 3 +
      3 * curve.accelerationPerParameter2 * parameterVelocity * parameterAcceleration +
      curve.velocityPerParameter * parameterJerk;
    return [joint.id, { angle: curve.angle, velocity, acceleration, jerk }];
  })) as Record<JointId, { angle: number; velocity: number; acceleration: number; jerk: number }>;
}

/**
 * Evaluates immutable C2 geometry without a wall-clock time law. This pure
 * helper is deliberately exported for the front-end/Rust fixture contract.
 */
export function evaluateCutterTrajectoryGeometryV3AtParameter(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  parameter: number,
): Record<JointId, {
  angle: number;
  velocityPerParameter: number;
  accelerationPerParameter2: number;
  jerkPerParameter3: number;
}> {
  const knots = geometry.knots;
  const end = knots.at(-1);
  if (knots.length < 2 || !end) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Cutter Grid V3 needs at least two C2 geometry knots.',
    );
  }
  const boundedParameter = clamp(parameter, 0, end.parameter);
  const spanIndex = boundedParameter >= end.parameter
    ? knots.length - 2
    : knots.findIndex((knot, index) => index < knots.length - 1 && boundedParameter < knots[index + 1].parameter);
  const start = knots[Math.max(0, spanIndex)];
  const finish = knots[Math.max(0, spanIndex) + 1];
  if (!start || !finish) {
    throw new CutterGridMotionV3Error('time-parameterization-infeasible', 'Cutter Grid V3 geometry span is missing.');
  }
  const local = clamp(boundedParameter - start.parameter, 0, finish.parameter - start.parameter);
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const curve = evaluateQuintic(
      quinticCoefficients(
        start.jointAngles[joint.id],
        finish.jointAngles[joint.id],
        finish.parameter - start.parameter,
        start.jointVelocitiesPerParameter[joint.id],
        start.jointAccelerationsPerParameter2[joint.id],
        finish.jointVelocitiesPerParameter[joint.id],
        finish.jointAccelerationsPerParameter2[joint.id],
      ),
      local,
    );
    return [joint.id, {
      angle: curve.position,
      velocityPerParameter: curve.first,
      accelerationPerParameter2: curve.second,
      jerkPerParameter3: curve.third,
    }];
  })) as Record<JointId, {
    angle: number;
    velocityPerParameter: number;
    accelerationPerParameter2: number;
    jerkPerParameter3: number;
  }>;
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

interface QuinticCurve {
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
}

function quinticCoefficients(
  startPosition: number,
  endPosition: number,
  duration: number,
  startVelocity: number,
  startAcceleration: number,
  endVelocity: number,
  endAcceleration: number,
): QuinticCurve {
  const h = Math.max(1e-12, duration);
  const delta = endPosition - startPosition;
  return {
    c0: startPosition,
    c1: startVelocity,
    c2: startAcceleration / 2,
    c3: (
      20 * delta -
      (8 * endVelocity + 12 * startVelocity) * h -
      (3 * startAcceleration - endAcceleration) * h ** 2
    ) / (2 * h ** 3),
    c4: (
      -30 * delta +
      (14 * endVelocity + 16 * startVelocity) * h +
      (3 * startAcceleration - 2 * endAcceleration) * h ** 2
    ) / (2 * h ** 4),
    c5: (
      12 * delta -
      (6 * endVelocity + 6 * startVelocity) * h -
      (startAcceleration - endAcceleration) * h ** 2
    ) / (2 * h ** 5),
  };
}

function evaluateQuintic(curve: QuinticCurve, t: number): {
  position: number;
  first: number;
  second: number;
  third: number;
} {
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  return {
    position: curve.c0 + curve.c1 * t + curve.c2 * t2 + curve.c3 * t3 + curve.c4 * t4 + curve.c5 * t4 * t,
    first: curve.c1 + 2 * curve.c2 * t + 3 * curve.c3 * t2 + 4 * curve.c4 * t3 + 5 * curve.c5 * t4,
    second: 2 * curve.c2 + 6 * curve.c3 * t + 12 * curve.c4 * t2 + 20 * curve.c5 * t3,
    third: 6 * curve.c3 + 24 * curve.c4 * t + 60 * curve.c5 * t2,
  };
}

function evaluateConstantJerk(
  position: number,
  velocity: number,
  acceleration: number,
  jerk: number,
  timeSeconds: number,
): {
  position: number;
  first: number;
  second: number;
  third: number;
} {
  const timeSquared = timeSeconds * timeSeconds;
  return {
    position: position + velocity * timeSeconds + acceleration * timeSquared / 2 + jerk * timeSquared * timeSeconds / 6,
    first: velocity + acceleration * timeSeconds + jerk * timeSquared / 2,
    second: acceleration + jerk * timeSeconds,
    third: jerk,
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
    positioningMotion: {
      ...plan.positioningMotion,
      waypoints: plan.positioningMotion.waypoints.map(signatureWaypoint),
    },
    steps: plan.steps.map((step) => ({
      ...step,
      waypoints: step.waypoints.map(signatureWaypoint),
    })),
  }));
}

function cloneV3Waypoint(waypoint: CutterTrajectoryWaypointV3): CutterTrajectoryWaypointV3 {
  return {
    timeMs: waypoint.timeMs,
    jointAngles: { ...waypoint.jointAngles },
    jointVelocitiesDegPerSec: { ...waypoint.jointVelocitiesDegPerSec },
    jointAccelerationsDegPerSec2: { ...waypoint.jointAccelerationsDegPerSec2 },
    jointJerksDegPerSec3: { ...waypoint.jointJerksDegPerSec3 },
    endEffector: [...waypoint.endEffector] as Vec3Tuple,
  };
}

function cutterGridGeometrySignatureV3(
  challengeSignature: string,
  entryOptionId: string,
  positioning: CutterGridPositioningMotionV3,
  steps: readonly CutterTrajectoryStepV3[],
): string {
  return fnv1a64(JSON.stringify({
    plannerVersion: CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
    challengeSignature,
    entryOptionId,
    positioning: geometryMotionSignaturePayload(positioning.motion),
    steps: steps.map((step) => ({
      index: step.index,
      kind: step.kind,
      startCoord: step.startCoord,
      endCoord: step.endCoord,
      sourceBlockId: step.sourceBlockId,
      motion: geometryMotionSignaturePayload(step.motion),
    })),
  }));
}

function geometryMotionSignaturePayload(
  motion: CutterTrajectoryStepMotionV3,
): Record<string, unknown> {
  return {
    interpolation: motion.interpolation,
    geometryWaypoints: motion.geometryWaypoints.map((waypoint) => ({
      timeMs: round(waypoint.timeMs, 6),
      jointAngles: roundRecord(waypoint.jointAngles),
      jointVelocitiesDegPerSec: roundRecord(waypoint.jointVelocitiesDegPerSec),
      endEffector: waypoint.endEffector.map((value) => round(value, 9)),
    })),
    geometry: motion.geometry && {
      interpolation: motion.geometry.interpolation,
      constraintResolution: motion.geometry.constraintResolution,
      knots: motion.geometry.knots.map((knot) => ({
        parameter: round(knot.parameter, 12),
        jointAngles: roundRecord(knot.jointAngles),
        jointVelocitiesPerParameter: roundRecord(knot.jointVelocitiesPerParameter),
        jointAccelerationsPerParameter2: roundRecord(knot.jointAccelerationsPerParameter2),
      })),
    },
  };
}

function signatureWaypoint(waypoint: CutterTrajectoryWaypointV3): Record<string, unknown> {
  return {
    timeMs: round(waypoint.timeMs, 6),
    jointAngles: roundRecord(waypoint.jointAngles),
    jointVelocitiesDegPerSec: roundRecord(waypoint.jointVelocitiesDegPerSec),
    jointAccelerationsDegPerSec2: roundRecord(waypoint.jointAccelerationsDegPerSec2),
    jointJerksDegPerSec3: roundRecord(waypoint.jointJerksDegPerSec3),
    endEffector: waypoint.endEffector.map((value) => round(value, 9)),
  };
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
