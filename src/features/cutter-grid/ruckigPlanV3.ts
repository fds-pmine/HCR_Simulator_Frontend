import type { Challenge, JointId, VoxelKey } from '../../types/domain';
import { computeRobotPose } from '../robot/kinematics';
import {
  CutterGridMotionV3Error,
  finalizeCutterGridTrajectoryPlanV3,
} from './motionV3';
import type { RuckigLocalFiveAxisVector } from './ruckigLocalWasm';
import {
  CutterGridRuckigRetimingError,
  retimeCutterGridGeometryWithRuckigV3,
  type CutterGridRuckigMotionLimitsV3,
  type CutterGridRuckigRetimingV3,
  type CutterGridRuckigSolverV3,
} from './ruckigRetimeV3';
import {
  createCutterGridRuckigMoveSpatialValidatorV3,
  type CutterGridRuckigMoveSpatialValidatorV3,
  type CutterGridRuckigMoveSpatialValidationSummaryV3,
} from './ruckigSpatialValidationV3';
import type {
  CutterGridMotionLimitsV3,
  CutterTrajectoryPlanV3,
  CutterTrajectoryStepMotionV3,
  CutterTrajectoryStepV3,
  CutterTrajectoryWaypointV3,
} from './types';

const DYNAMIC_TOLERANCE = 1e-7;

export interface CutterGridRuckigPlanOptionsV3 {
  /** Overrides the deterministic eight-segment production retiming grid. */
  reachabilityIntervals?: number;
}

/**
 * Replaces V3's analytic scalar time law with local Ruckig state-to-state
 * segments while preserving its selected entry, C2 geometry, Cartesian
 * semantics, and source block mapping. This is intentionally synchronous: it
 * runs inside the planning Worker after the local WASM module has loaded.
 */
export function retimeCutterGridPlanWithLocalRuckigV3(
  challenge: Challenge,
  analyticPlan: CutterTrajectoryPlanV3,
  solver: CutterGridRuckigSolverV3,
  options: CutterGridRuckigPlanOptionsV3 = {},
): CutterTrajectoryPlanV3 {
  const limits = effectiveRuckigLimits(challenge, analyticPlan.motionLimits);
  const initialHair = new Set(challenge.initialHair.voxels);
  // The system entry is already a certified, global V3 C2 trajectory. It
  // carries no player command, score, or contact semantics; solving each of
  // its many geometric micro-segments as independent Ruckig states can turn
  // a safe entry into minutes of conservative motion. Preserve that frozen
  // absolute-time V3 entry and reserve local Ruckig retiming for player Move
  // segments, where its jerk-limited playback directly addresses the visible
  // arm instability.
  const positioning = analyticPlan.positioningMotion;
  const remainingHair = new Set(initialHair);
  let maximumVelocityRatio = analyticPlan.diagnostics.maximumVelocityRatio;
  let maximumAccelerationRatio = analyticPlan.diagnostics.maximumAccelerationRatio;
  let maximumJerkRatio = analyticPlan.diagnostics.maximumJerkRatio;
  let maximumCartesianDeviation = analyticPlan.diagnostics.maximumCartesianDeviation;
  let validationSampleCount = analyticPlan.diagnostics.validationSampleCount;

  const steps = analyticPlan.steps.map((step) => {
    if (step.kind === 'wait') return cloneWait(step);
    const retimed = retimePlayerMove(
      challenge,
      step,
      limits,
      solver,
      remainingHair,
      options,
    );
    retimed.expectedCutVoxels.forEach((key) => remainingHair.delete(key));
    maximumVelocityRatio = Math.max(maximumVelocityRatio, retimed.maximumVelocityRatio);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, retimed.maximumAccelerationRatio);
    maximumJerkRatio = Math.max(maximumJerkRatio, retimed.maximumJerkRatio);
    maximumCartesianDeviation = Math.max(maximumCartesianDeviation, retimed.maximumCartesianDeviation);
    validationSampleCount += retimed.validationSampleCount;
    return retimed.step;
  });

  const expectedResultVoxels = [...remainingHair].sort();
  if (!sameVoxelKeys(expectedResultVoxels, analyticPlan.expectedResultVoxels)) {
    throw new CutterGridMotionV3Error(
      'trajectory-smoothing-path-deviation',
      'Local Ruckig retiming changed the frozen Cutter Grid contact result.',
    );
  }
  const estimatedDurationMs = steps.reduce((total, step) => total + step.durationMs, 0);
  return finalizeCutterGridTrajectoryPlanV3({
    ...analyticPlan,
    positioningMotion: positioning,
    steps,
    expectedResultVoxels,
    estimatedDurationMs,
    diagnostics: {
      ...analyticPlan.diagnostics,
      maximumVelocityRatio,
      maximumAccelerationRatio,
      maximumJerkRatio,
      maximumCartesianDeviation,
      validationSampleCount,
    },
  });
}

function retimePlayerMove(
  challenge: Challenge,
  step: CutterTrajectoryStepV3,
  limits: CutterGridRuckigMotionLimitsV3,
  solver: CutterGridRuckigSolverV3,
  hairVoxels: ReadonlySet<VoxelKey>,
  options: CutterGridRuckigPlanOptionsV3,
): {
  step: CutterTrajectoryStepV3;
  expectedCutVoxels: readonly VoxelKey[];
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  maximumCartesianDeviation: number;
  validationSampleCount: number;
} {
  const geometry = requireGeometry(step.motion, step.sourceBlockId);
  const fixedAxisLine = fixedAxisLineFor(step);
  const validationContext = {
    fixedAxisLine,
    hairVoxels,
    expectedCutVoxels: step.expectedCutVoxels,
    sourceBlockId: step.sourceBlockId,
    targetCoord: step.endCoord,
    actionIndex: step.index,
  };
  let spatialSummary: CutterGridRuckigMoveSpatialValidationSummaryV3 | undefined;
  const retiming = retimeGeometry(
    challenge,
    geometry,
    limits,
    solver,
    () => createCutterGridRuckigMoveSpatialValidatorV3(challenge, validationContext),
    options,
    validationContext,
    true,
    (summary) => { spatialSummary = summary; },
  );
  const waypoints = certifyRuckigControlWaypoints(
    challenge,
    flattenRuckigWaypoints(challenge, retiming),
    limits,
    validationContext,
  );
  if (!spatialSummary) {
    throw new CutterGridMotionV3Error(
      'trajectory-smoothing-search-exhausted',
      'Local Ruckig did not produce a final Worker-side spatial certification summary.',
      validationContext,
    );
  }
  const motion = sampledMotion(step.motion, waypoints);
  return {
    step: {
      ...step,
      durationMs: motion.durationMs,
      waypoints,
      motion,
      certifiedContactEvents: spatialSummary.contactEvents.map((event) => ({
        timeMs: event.timeSeconds * 1_000,
        voxelKeys: [...event.voxelKeys],
      })),
    },
    expectedCutVoxels: step.expectedCutVoxels,
    maximumVelocityRatio: retiming.maximumVelocityRatio,
    maximumAccelerationRatio: retiming.maximumAccelerationRatio,
    maximumJerkRatio: retiming.maximumJerkRatio,
    maximumCartesianDeviation: spatialSummary.maximumCartesianDeviation,
    validationSampleCount: retiming.segments.reduce(
      (total, segment) => total + segment.certificationSampleCount,
      0,
    ),
  };
}

function retimeGeometry(
  challenge: Challenge,
  geometry: NonNullable<CutterTrajectoryStepMotionV3['geometry']>,
  limits: CutterGridRuckigMotionLimitsV3,
  solver: CutterGridRuckigSolverV3,
  createValidator: () => CutterGridRuckigMoveSpatialValidatorV3,
  options: CutterGridRuckigPlanOptionsV3,
  details: { sourceBlockId?: string; targetCoord?: readonly [number, number, number]; actionIndex?: number },
  retryBoundaryProfilesOnSpatialFailure = false,
  onValidated?: (summary: CutterGridRuckigMoveSpatialValidationSummaryV3) => void,
): CutterGridRuckigRetimingV3 {
  try {
    return retimeCutterGridGeometryWithRuckigV3(
      challenge,
      geometry,
      limits,
      solver,
      options.reachabilityIntervals ?? 8,
      {
        validationPassFactory: () => {
          const validator = createValidator();
          return {
            validateSegment: ({ samples, startTimeSeconds }) => validator.validateSegment(samples, startTimeSeconds),
            finalizeSpatialValidation: () => { onValidated?.(validator.finalize()); },
          };
        },
        retryBoundaryProfilesOnSpatialFailure,
      },
    );
  } catch (error) {
    if (error instanceof CutterGridRuckigRetimingError) {
      throw new CutterGridMotionV3Error(error.code, error.message, {
        ...details,
        ...error.details,
      });
    }
    throw error;
  }
}

/** Flatten local segment time axes into the frozen plan time axis. */
function flattenRuckigWaypoints(
  challenge: Challenge,
  retiming: CutterGridRuckigRetimingV3,
): CutterTrajectoryWaypointV3[] {
  const waypoints: CutterTrajectoryWaypointV3[] = [];
  let offsetMs = 0;
  for (const [segmentIndex, segment] of retiming.segments.entries()) {
    for (const [sampleIndex, sample] of segment.samples.entries()) {
      if (segmentIndex > 0 && sampleIndex === 0) {
        // `Trajectory::at_time(duration)` reports zero jerk at the completed
        // local segment. The next segment starts at the same q/v/a but owns
        // the right-hand jerk. Keep one shared waypoint and replace only its
        // jerk so cubic replay uses the correct C2 continuation instead of a
        // fictitious constant-acceleration bridge.
        const previous = waypoints.at(-1);
        if (!previous) {
          throw new CutterGridMotionV3Error(
            'jerk-smoothing-infeasible',
            'Local Ruckig omitted the first shared q/v/a waypoint.',
          );
        }
        previous.jointJerksDegPerSec3 = recordFromVector(challenge, sample.jerk);
        continue;
      }
      waypoints.push(waypointFromSample(challenge, sample, offsetMs + sample.timeSeconds * 1_000));
    }
    offsetMs += segment.durationSeconds * 1_000;
  }
  if (waypoints.length < 2) {
    throw new CutterGridMotionV3Error(
      'jerk-smoothing-infeasible',
      'Local Ruckig did not generate enough frozen samples for Cutter Grid V3.',
    );
  }
  return waypoints;
}

function certifyRuckigControlWaypoints(
  challenge: Challenge,
  controlWaypoints: readonly CutterTrajectoryWaypointV3[],
  limits: CutterGridRuckigMotionLimitsV3,
  details: { sourceBlockId?: string; targetCoord?: readonly [number, number, number]; actionIndex?: number },
): CutterTrajectoryWaypointV3[] {
  // The Worker has already checked the complete 5ms collision/path/contact
  // stream. The serializable plan retains only exact jerk boundaries: a
  // constant-jerk span has bounded q/v/a/j by construction, while returning
  // every certification sample makes main-thread playback unstable.
  const certified = controlWaypoints.map((waypoint) => ({
    ...waypoint,
    jointAngles: { ...waypoint.jointAngles },
    jointVelocitiesDegPerSec: { ...waypoint.jointVelocitiesDegPerSec },
    jointAccelerationsDegPerSec2: { ...waypoint.jointAccelerationsDegPerSec2 },
    jointJerksDegPerSec3: { ...waypoint.jointJerksDegPerSec3 },
    endEffector: [...waypoint.endEffector] as [number, number, number],
  }));
  assertDynamicLimits(challenge, certified, limits, details);
  return certified;
}

function sampledMotion(
  source: CutterTrajectoryStepMotionV3,
  waypoints: readonly CutterTrajectoryWaypointV3[],
): CutterTrajectoryStepMotionV3 {
  return {
    interpolation: 'ruckig-local-sampled',
    durationMs: waypoints.at(-1)?.timeMs ?? 0,
    geometryWaypoints: source.geometryWaypoints.map((waypoint) => ({
      timeMs: waypoint.timeMs,
      jointAngles: { ...waypoint.jointAngles },
      jointVelocitiesDegPerSec: { ...waypoint.jointVelocitiesDegPerSec },
      endEffector: [...waypoint.endEffector] as [number, number, number],
    })),
    ...(source.geometry === undefined ? {} : { geometry: source.geometry }),
  };
}

function waypointFromSample(
  challenge: Challenge,
  sample: {
    timeSeconds: number;
    position: RuckigLocalFiveAxisVector;
    velocity: RuckigLocalFiveAxisVector;
    acceleration: RuckigLocalFiveAxisVector;
    jerk: RuckigLocalFiveAxisVector;
  },
  timeMs: number,
): CutterTrajectoryWaypointV3 {
  const jointAngles = recordFromVector(challenge, sample.position);
  return {
    timeMs,
    jointAngles,
    jointVelocitiesDegPerSec: recordFromVector(challenge, sample.velocity),
    jointAccelerationsDegPerSec2: recordFromVector(challenge, sample.acceleration),
    jointJerksDegPerSec3: recordFromVector(challenge, sample.jerk),
    endEffector: computeRobotPose(challenge.robotConfig, jointAngles).endEffector,
  };
}

function recordFromVector(
  challenge: Challenge,
  values: readonly number[],
): Record<JointId, number> {
  if (values.length !== challenge.robotConfig.joints.length) {
    throw new CutterGridMotionV3Error('jerk-smoothing-infeasible', 'Local Ruckig returned an unexpected joint count.');
  }
  return Object.fromEntries(challenge.robotConfig.joints.map((joint, index) => [joint.id, values[index]])) as Record<JointId, number>;
}

function assertDynamicLimits(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV3[],
  limits: CutterGridRuckigMotionLimitsV3,
  details: { sourceBlockId?: string; targetCoord?: readonly [number, number, number]; actionIndex?: number },
): void {
  for (const waypoint of waypoints) {
    for (const joint of challenge.robotConfig.joints) {
      const velocity = Math.abs(waypoint.jointVelocitiesDegPerSec[joint.id]);
      const acceleration = Math.abs(waypoint.jointAccelerationsDegPerSec2[joint.id]);
      const jerk = Math.abs(waypoint.jointJerksDegPerSec3[joint.id]);
      if (
        !Number.isFinite(velocity) || !Number.isFinite(acceleration) || !Number.isFinite(jerk) ||
        velocity > limits[joint.id].velocityDegPerSec + DYNAMIC_TOLERANCE ||
        acceleration > limits[joint.id].accelerationDegPerSec2 + DYNAMIC_TOLERANCE ||
        jerk > limits[joint.id].jerkDegPerSec3 + DYNAMIC_TOLERANCE
      ) {
        throw new CutterGridMotionV3Error(
          'trajectory-smoothing-path-deviation',
          `Local Ruckig C2 reconstruction exceeds the configured limit for ${joint.name} ` +
            `(v=${velocity.toFixed(9)}/${limits[joint.id].velocityDegPerSec.toFixed(9)}, ` +
            `a=${acceleration.toFixed(9)}/${limits[joint.id].accelerationDegPerSec2.toFixed(9)}, ` +
            `j=${jerk.toFixed(9)}/${limits[joint.id].jerkDegPerSec3.toFixed(9)}).`,
          details,
        );
      }
    }
  }
}

function effectiveRuckigLimits(
  challenge: Challenge,
  motionLimits: CutterGridMotionLimitsV3,
): CutterGridRuckigMotionLimitsV3 {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
    const limit = motionLimits.joints[joint.id];
    return [joint.id, {
      velocityDegPerSec: Math.min(
        limit.maxVelocityDegPerSec,
        limit.nominalVelocityDegPerSec * motionLimits.requestedSpeedScale,
      ),
      accelerationDegPerSec2: Math.min(
        limit.maxAccelerationDegPerSec2,
        limit.nominalAccelerationDegPerSec2 * motionLimits.requestedSpeedScale ** 2,
      ),
      jerkDegPerSec3: Math.min(
        limit.maxJerkDegPerSec3,
        limit.nominalJerkDegPerSec3 * motionLimits.requestedSpeedScale ** 3,
      ),
    }];
  })) as CutterGridRuckigMotionLimitsV3;
}

function requireGeometry(
  motion: CutterTrajectoryStepMotionV3,
  sourceBlockId: string,
): NonNullable<CutterTrajectoryStepMotionV3['geometry']> {
  if (!motion.geometry) {
    throw new CutterGridMotionV3Error(
      'time-parameterization-infeasible',
      'Local Ruckig cannot retime a V3 motion without immutable C2 geometry.',
      { sourceBlockId },
    );
  }
  return motion.geometry;
}

function fixedAxisLineFor(step: CutterTrajectoryStepV3): { start: [number, number, number]; end: [number, number, number] } {
  const start = step.motion.geometryWaypoints[0]?.endEffector;
  const end = step.motion.geometryWaypoints.at(-1)?.endEffector;
  if (!start || !end) {
    throw new CutterGridMotionV3Error(
      'trajectory-smoothing-path-deviation',
      'Cutter Grid Move is missing its frozen Cartesian endpoints.',
      { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord, actionIndex: step.index },
    );
  }
  return { start: [...start], end: [...end] };
}

function cloneWait(step: CutterTrajectoryStepV3): CutterTrajectoryStepV3 {
  return {
    ...step,
    waypoints: step.waypoints.map((waypoint) => ({
      ...waypoint,
      jointAngles: { ...waypoint.jointAngles },
      jointVelocitiesDegPerSec: { ...waypoint.jointVelocitiesDegPerSec },
      jointAccelerationsDegPerSec2: { ...waypoint.jointAccelerationsDegPerSec2 },
      jointJerksDegPerSec3: { ...waypoint.jointJerksDegPerSec3 },
      endEffector: [...waypoint.endEffector] as [number, number, number],
    })),
  };
}

function sameVoxelKeys(left: readonly VoxelKey[], right: readonly VoxelKey[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
