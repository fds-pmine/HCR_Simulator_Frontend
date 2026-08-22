import type { Challenge, JointId } from '../../types/domain';
import { evaluateCutterTrajectoryGeometryV3AtParameter } from './motionV3';
import {
  RuckigLocalWasmError,
  type RuckigLocalFiveAxisVector,
  type RuckigLocalStateToStateInput,
  type RuckigLocalTrajectoryResult,
  type RuckigLocalTrajectorySample,
} from './ruckigLocalWasm';
import { CutterGridRuckigSpatialValidationError } from './ruckigSpatialValidationV3';
import {
  computeCutterGridReachabilityV3,
  type CutterGridReachabilityLimitsV3,
  type CutterGridReachabilityNodeV3,
  type CutterGridReachabilityPlanV3,
} from './toppraV3';
import type { CutterTrajectoryGeometryV3 } from './types';

const MAX_DURATION_SCALE = 50;
const DURATION_EXTENSION_FACTOR = 1.1;
const MAX_SAMPLE_INTERVAL_SECONDS = 0.005;
const MAX_SAMPLE_COUNT = 65_536;
const ENDPOINT_TOLERANCE = 1e-7;

export type CutterGridRuckigMotionLimitsV3 = Record<JointId, {
  velocityDegPerSec: number;
  accelerationDegPerSec2: number;
  jerkDegPerSec3: number;
}>;

export interface CutterGridRuckigSolverV3 {
  sample(input: RuckigLocalStateToStateInput): RuckigLocalTrajectoryResult;
}

export interface CutterGridRuckigSampleV3 extends RuckigLocalTrajectorySample {
  timeSeconds: number;
}

export interface CutterGridRuckigSegmentV3 {
  startParameter: number;
  endParameter: number;
  requestedMinimumDurationSeconds: number;
  durationSeconds: number;
  durationExtensionCount: number;
  samples: CutterGridRuckigSampleV3[];
}

export interface CutterGridRuckigRetimingV3 {
  algorithm: 'toppra-ruckig-local-v1';
  reachability: CutterGridReachabilityPlanV3;
  segments: CutterGridRuckigSegmentV3[];
  durationSeconds: number;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
}

/**
 * The caller owns the player-move Cartesian tube and remaining-hair state.
 * Keeping this callback explicit prevents a local q/v/a solver from quietly
 * substituting its own geometric contract while it retimes a frozen path.
 */
export interface CutterGridRuckigRetimeOptionsV3 {
  validateSegment?: (segment: {
    startParameter: number;
    endParameter: number;
    samples: readonly CutterGridRuckigSampleV3[];
  }) => void;
}

export class CutterGridRuckigRetimingError extends Error {
  constructor(
    public readonly code:
      | 'jerk-smoothing-infeasible'
      | 'trajectory-smoothing-path-deviation'
      | 'trajectory-smoothing-search-exhausted',
    message: string,
  ) {
    super(message);
    this.name = 'CutterGridRuckigRetimingError';
  }
}

/**
 * Turns a frozen C2 geometry into Ruckig-ready, jerk-bounded local segments.
 * Geometry and the V2-selected IK branch are inputs only: this function never
 * selects a new posture, changes a Cartesian waypoint, or calls a network.
 *
 * A caller can attach `validateSegment` to certify head clearance, the fixed
 * Cartesian tube, sampling density, and swept contact before accepting a
 * segment. That is mandatory when this becomes an active plan source.
 */
export function retimeCutterGridGeometryWithRuckigV3(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  solver: CutterGridRuckigSolverV3,
  reachabilityIntervals?: number,
  options: CutterGridRuckigRetimeOptionsV3 = {},
): CutterGridRuckigRetimingV3 {
  assertFiveJointRobot(challenge);
  const reachability = computeCutterGridReachabilityV3(
    challenge,
    geometry,
    reachabilityLimits(limits),
    reachabilityIntervals,
  );
  const segments: CutterGridRuckigSegmentV3[] = [];
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;

  for (let index = 1; index < reachability.nodes.length; index += 1) {
    const start = reachability.nodes[index - 1];
    const end = reachability.nodes[index];
    const segment = solveSegment(challenge, geometry, limits, solver, start, end, options);
    segments.push(segment.segment);
    maximumVelocityRatio = Math.max(maximumVelocityRatio, segment.maximumVelocityRatio);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, segment.maximumAccelerationRatio);
    maximumJerkRatio = Math.max(maximumJerkRatio, segment.maximumJerkRatio);
  }

  return {
    algorithm: 'toppra-ruckig-local-v1',
    reachability,
    segments,
    durationSeconds: segments.reduce((total, segment) => total + segment.durationSeconds, 0),
    maximumVelocityRatio,
    maximumAccelerationRatio,
    maximumJerkRatio,
  };
}

function solveSegment(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  solver: CutterGridRuckigSolverV3,
  start: CutterGridReachabilityNodeV3,
  end: CutterGridReachabilityNodeV3,
  options: CutterGridRuckigRetimeOptionsV3,
): {
  segment: CutterGridRuckigSegmentV3;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
} {
  const baseDuration = end.timeSeconds - start.timeSeconds;
  if (!Number.isFinite(baseDuration) || baseDuration <= 0) {
    throw new CutterGridRuckigRetimingError(
      'jerk-smoothing-infeasible',
      'Cutter Grid reachability produced a non-positive local Ruckig duration.',
    );
  }
  const maximumDuration = baseDuration * MAX_DURATION_SCALE;
  let requestedMinimumDuration = baseDuration;
  let extensionCount = 0;

  for (;;) {
    const input = makeRuckigInput(challenge, geometry, limits, start, end, requestedMinimumDuration, 2);
    try {
      const probe = solver.sample(input);
      const sampleCount = sampleCountForDuration(probe.durationSeconds);
      const trajectory = solver.sample({ ...input, sampleCount });
      if (Math.abs(trajectory.durationSeconds - probe.durationSeconds) > 1e-9) {
        throw new Error('Local Ruckig returned different durations for the same immutable segment input.');
      }
      const validation = validateSegment(challenge, limits, input, trajectory);
      const samples = trajectory.samples.map((sample, sampleIndex) => ({
        ...sample,
        timeSeconds: trajectory.durationSeconds * sampleIndex / (trajectory.samples.length - 1),
      }));
      options.validateSegment?.({
        startParameter: start.parameter,
        endParameter: end.parameter,
        samples,
      });
      return {
        segment: {
          startParameter: start.parameter,
          endParameter: end.parameter,
          requestedMinimumDurationSeconds: requestedMinimumDuration,
          durationSeconds: trajectory.durationSeconds,
          durationExtensionCount: extensionCount,
          samples,
        },
        ...validation,
      };
    } catch (error) {
      if (error instanceof CutterGridRuckigSpatialValidationError) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-path-deviation',
          error.message,
        );
      }
      if (error instanceof CutterGridRuckigRetimingError) throw error;
      if (error instanceof RuckigLocalWasmError && error.resultCode === -100) {
        throw new CutterGridRuckigRetimingError(
          'jerk-smoothing-infeasible',
          `Local Ruckig rejected a shared q/v/a boundary at parameter ${end.parameter.toFixed(6)}.`,
        );
      }
      const nextDuration = requestedMinimumDuration * DURATION_EXTENSION_FACTOR;
      if (nextDuration > maximumDuration + 1e-12) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-search-exhausted',
          `Cutter Grid exhausted the ${MAX_DURATION_SCALE}x local Ruckig duration budget at parameter ${end.parameter.toFixed(6)}.`,
        );
      }
      requestedMinimumDuration = nextDuration;
      extensionCount += 1;
    }
  }
}

function makeRuckigInput(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  start: CutterGridReachabilityNodeV3,
  end: CutterGridReachabilityNodeV3,
  minimumDurationSeconds: number,
  sampleCount: number,
): RuckigLocalStateToStateInput {
  return {
    current: stateAtNode(challenge, geometry, start),
    target: stateAtNode(challenge, geometry, end),
    maximum: {
      velocity: vectorFromJoints(challenge, (joint) => limits[joint.id].velocityDegPerSec),
      acceleration: vectorFromJoints(challenge, (joint) => limits[joint.id].accelerationDegPerSec2),
      jerk: vectorFromJoints(challenge, (joint) => limits[joint.id].jerkDegPerSec3),
    },
    minimumDurationSeconds,
    sampleCount,
  };
}

function stateAtNode(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  node: CutterGridReachabilityNodeV3,
): RuckigLocalStateToStateInput['current'] {
  const geometryState = evaluateCutterTrajectoryGeometryV3AtParameter(challenge, geometry, node.parameter);
  return {
    position: vectorFromJoints(challenge, (joint) => geometryState[joint.id].angle),
    velocity: vectorFromJoints(challenge, (joint) => node.jointVelocitiesDegPerSec[joint.id]),
    acceleration: vectorFromJoints(challenge, (joint) => node.jointAccelerationsDegPerSec2[joint.id]),
  };
}

function validateSegment(
  challenge: Challenge,
  limits: CutterGridRuckigMotionLimitsV3,
  expected: RuckigLocalStateToStateInput,
  trajectory: RuckigLocalTrajectoryResult,
): {
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
} {
  const first = trajectory.samples[0];
  const last = trajectory.samples.at(-1);
  if (!first || !last) throw new Error('Local Ruckig returned no trajectory samples.');
  assertNearVector(first.position, expected.current.position, 'initial position');
  assertNearVector(first.velocity, expected.current.velocity, 'initial velocity');
  assertNearVector(first.acceleration, expected.current.acceleration, 'initial acceleration');
  assertNearVector(last.position, expected.target.position, 'target position');
  assertNearVector(last.velocity, expected.target.velocity, 'target velocity');
  assertNearVector(last.acceleration, expected.target.acceleration, 'target acceleration');

  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;
  for (const sample of trajectory.samples) {
    for (const [index, joint] of challenge.robotConfig.joints.entries()) {
      if (sample.position[index] < joint.minAngleDeg - ENDPOINT_TOLERANCE || sample.position[index] > joint.maxAngleDeg + ENDPOINT_TOLERANCE) {
        throw new Error(`${joint.name} leaves its configured range during local Ruckig retiming.`);
      }
      maximumVelocityRatio = Math.max(
        maximumVelocityRatio,
        Math.abs(sample.velocity[index]) / limits[joint.id].velocityDegPerSec,
      );
      maximumAccelerationRatio = Math.max(
        maximumAccelerationRatio,
        Math.abs(sample.acceleration[index]) / limits[joint.id].accelerationDegPerSec2,
      );
      maximumJerkRatio = Math.max(
        maximumJerkRatio,
        Math.abs(sample.jerk[index]) / limits[joint.id].jerkDegPerSec3,
      );
    }
  }
  if (maximumVelocityRatio > 1 + ENDPOINT_TOLERANCE || maximumAccelerationRatio > 1 + ENDPOINT_TOLERANCE || maximumJerkRatio > 1 + ENDPOINT_TOLERANCE) {
    throw new Error('Local Ruckig exceeds a configured dynamic limit.');
  }
  return { maximumVelocityRatio, maximumAccelerationRatio, maximumJerkRatio };
}

function reachabilityLimits(limits: CutterGridRuckigMotionLimitsV3): CutterGridReachabilityLimitsV3 {
  return Object.fromEntries(Object.entries(limits).map(([jointId, limit]) => [jointId, {
    velocityDegPerSec: limit.velocityDegPerSec,
    accelerationDegPerSec2: limit.accelerationDegPerSec2,
  }])) as CutterGridReachabilityLimitsV3;
}

function sampleCountForDuration(durationSeconds: number): number {
  const sampleCount = Math.ceil(durationSeconds / MAX_SAMPLE_INTERVAL_SECONDS) + 1;
  if (!Number.isFinite(sampleCount) || sampleCount < 2 || sampleCount > MAX_SAMPLE_COUNT) {
    throw new Error('Local Ruckig duration cannot be certified at the required 5ms resolution.');
  }
  return sampleCount;
}

function vectorFromJoints(
  challenge: Challenge,
  valueForJoint: (joint: Challenge['robotConfig']['joints'][number]) => number,
): RuckigLocalFiveAxisVector {
  if (challenge.robotConfig.joints.length !== 5) {
    throw new CutterGridRuckigRetimingError(
      'jerk-smoothing-infeasible',
      'Local Ruckig V3 requires exactly five configured joints.',
    );
  }
  const values = challenge.robotConfig.joints.map(valueForJoint);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new CutterGridRuckigRetimingError(
      'jerk-smoothing-infeasible',
      'Local Ruckig received a non-finite five-joint boundary.',
    );
  }
  return values as unknown as RuckigLocalFiveAxisVector;
}

function assertFiveJointRobot(challenge: Challenge): void {
  if (challenge.robotConfig.joints.length !== 5) {
    throw new CutterGridRuckigRetimingError(
      'jerk-smoothing-infeasible',
      'Cutter Grid V3 local Ruckig supports exactly five joints.',
    );
  }
}

function assertNearVector(
  actual: RuckigLocalFiveAxisVector,
  expected: RuckigLocalFiveAxisVector,
  label: string,
): void {
  if (actual.some((value, index) => Math.abs(value - expected[index]) > ENDPOINT_TOLERANCE)) {
    throw new Error(`Local Ruckig does not preserve the shared ${label} boundary.`);
  }
}
