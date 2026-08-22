import type { Challenge, JointId } from '../../types/domain';
import { computeRobotPose } from '../robot/kinematics';
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
const MAX_RUCKIG_SWITCH_TIMES = 45;
const MINIMUM_RUCKIG_SAMPLE_CAPACITY = MAX_RUCKIG_SWITCH_TIMES + 2;

interface RuckigBoundaryProfile {
  id: string;
  velocityScale: number;
  accelerationScale: number;
}

// TOPP-RA's q/v/a envelope is a fast feasibility estimate, whereas every
// Ruckig call below must solve a finite-length state-to-state segment. Keep a
// deterministic, whole-path set of progressively more conservative C2
// boundary profiles. A profile applies to every node, so neighbouring
// segments always share exactly the same q/v/a state; it never inserts an
// unplanned pause or changes the frozen C2 geometry.
const BOUNDARY_PROFILES: readonly RuckigBoundaryProfile[] = [
  { id: 'toppra-shared-v1', velocityScale: 1, accelerationScale: 1 },
  { id: 'zero-acceleration-v1', velocityScale: 1, accelerationScale: 0 },
  { id: 'half-speed-zero-acceleration-v1', velocityScale: 0.5, accelerationScale: 0 },
  { id: 'quarter-speed-zero-acceleration-v1', velocityScale: 0.25, accelerationScale: 0 },
  { id: 'eighth-speed-zero-acceleration-v1', velocityScale: 0.125, accelerationScale: 0 },
];

class RuckigBoundaryRegularizationError extends Error {
  constructor(
    readonly parameter: number,
    readonly resultCode: number | undefined,
  ) {
    super(`Local Ruckig could not construct the requested state-to-state duration at parameter ${parameter.toFixed(6)}.`);
    this.name = 'RuckigBoundaryRegularizationError';
  }
}

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
  /** Number of dense samples consumed by Worker-side safety certification. */
  certificationSampleCount: number;
  /** Exact constant-jerk boundaries required by the runtime evaluator. */
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
    /** Absolute time within this local retiming operation. */
    startTimeSeconds: number;
    samples: readonly CutterGridRuckigSampleV3[];
  }) => void;
  /**
   * Invoked only after every local segment passed `validateSegment`. Use this
   * to compare the aggregate swept-contact set with the frozen atomic Move.
   */
  finalizeSpatialValidation?: () => void;
  /**
   * Tests the C2 reconstruction that the renderer/executor will actually
   * replay. Returning true requests denser samples of the identical Ruckig
   * solution; it may not alter a boundary, duration, or geometric segment.
   */
  requiresFinerSampling?: (segment: {
    startParameter: number;
    endParameter: number;
    startTimeSeconds: number;
    samples: readonly CutterGridRuckigSampleV3[];
  }) => boolean;
  /**
   * A stateful spatial/contact validator must be fresh for each whole-path
   * boundary-profile attempt. Static callbacks remain supported for focused
   * unit tests that do not trigger a profile retry.
   */
  validationPassFactory?: () => Pick<
    CutterGridRuckigRetimeOptionsV3,
    'validateSegment' | 'finalizeSpatialValidation'
  >;
  /**
   * Retrying keeps the same immutable q knots and only selects one of the
   * deterministic slower boundary profiles. A player Move is accepted only
   * after its fixed Cartesian tube and aggregate hair-contact checks pass
   * again, so this cannot shorten, bend, or otherwise replace the authored
   * command.
   */
  retryBoundaryProfilesOnSpatialFailure?: boolean;
}

export class CutterGridRuckigRetimingError extends Error {
  constructor(
    public readonly code:
      | 'jerk-smoothing-infeasible'
      | 'trajectory-smoothing-path-deviation'
      | 'trajectory-smoothing-search-exhausted',
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      targetCoord?: readonly [number, number, number];
      actionIndex?: number;
    } = {},
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
  let lastRegularizationError: RuckigBoundaryRegularizationError | undefined;
  let lastSpatialProfileError: CutterGridRuckigRetimingError | undefined;
  for (const boundaryProfile of BOUNDARY_PROFILES) {
    try {
      const validationPass = options.validationPassFactory?.();
      const attemptOptions = validationPass === undefined
        ? options
        : { ...options, ...validationPass, validationPassFactory: undefined };
      return retimeReachabilityWithProfile(
        challenge,
        geometry,
        limits,
        solver,
        reachability,
        boundaryProfile,
        attemptOptions,
      );
    } catch (error) {
      if (error instanceof RuckigBoundaryRegularizationError) {
        lastRegularizationError = error;
        continue;
      }
      if (
        options.retryBoundaryProfilesOnSpatialFailure &&
        isPathDeviationError(error)
      ) {
        lastSpatialProfileError = error;
        continue;
      }
      throw error;
    }
  }
  throw new CutterGridRuckigRetimingError(
    'jerk-smoothing-infeasible',
    `Local Ruckig could not construct a continuous C2 shared-state trajectory after deterministic boundary regularization${lastRegularizationError ? ` at parameter ${lastRegularizationError.parameter.toFixed(6)} (result ${lastRegularizationError.resultCode ?? 'unknown'})` : ''}${lastSpatialProfileError ? `; the safest positioning profile still failed: ${lastSpatialProfileError.message}` : ''}.`,
  );
}

function isPathDeviationError(error: unknown): error is CutterGridRuckigRetimingError {
  return typeof error === 'object' && error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'trajectory-smoothing-path-deviation' &&
    'message' in error;
}

function retimeReachabilityWithProfile(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  solver: CutterGridRuckigSolverV3,
  reachability: CutterGridReachabilityPlanV3,
  boundaryProfile: RuckigBoundaryProfile,
  options: CutterGridRuckigRetimeOptionsV3,
): CutterGridRuckigRetimingV3 {
  const segments: CutterGridRuckigSegmentV3[] = [];
  let maximumVelocityRatio = 0;
  let maximumAccelerationRatio = 0;
  let maximumJerkRatio = 0;

  for (let index = 1; index < reachability.nodes.length; index += 1) {
    const start = reachability.nodes[index - 1];
    const end = reachability.nodes[index];
    const segment = solveSegment(
      challenge,
      geometry,
      limits,
      solver,
      start,
      end,
      boundaryProfile,
      options,
      segments.reduce((total, candidate) => total + candidate.durationSeconds, 0),
    );
    segments.push(segment.segment);
    maximumVelocityRatio = Math.max(maximumVelocityRatio, segment.maximumVelocityRatio);
    maximumAccelerationRatio = Math.max(maximumAccelerationRatio, segment.maximumAccelerationRatio);
    maximumJerkRatio = Math.max(maximumJerkRatio, segment.maximumJerkRatio);
  }
  try {
    options.finalizeSpatialValidation?.();
  } catch (error) {
    if (error instanceof CutterGridRuckigSpatialValidationError) {
      throw new CutterGridRuckigRetimingError(
        'trajectory-smoothing-path-deviation',
        error.message,
        error.details,
      );
    }
    throw error;
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
  boundaryProfile: RuckigBoundaryProfile,
  options: CutterGridRuckigRetimeOptionsV3,
  startTimeSeconds: number,
): {
  segment: CutterGridRuckigSegmentV3;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
} {
  // Boundary profiles reduce only shared q/v/a node values. Ruckig already
  // computes the physical duration those values require; multiplying the
  // frozen TOPP-RA minimum by 2/4/8 as well would double-count conservatism
  // and turn a short Cutter Grid action into minutes of animation.
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
  let lastFailureReason: string | undefined;
  let lastSampleCount = 2;

  for (;;) {
    const input = makeRuckigInput(
      challenge,
      geometry,
      limits,
      start,
      end,
      boundaryProfile,
      requestedMinimumDuration,
      MINIMUM_RUCKIG_SAMPLE_CAPACITY,
    );
    try {
      const probe = solver.sample(input);
      let sampleCount = sampleCountForTrajectory(challenge, probe);
      for (;;) {
        lastSampleCount = sampleCount;
        const trajectory = solver.sample({ ...input, sampleCount });
        if (Math.abs(trajectory.durationSeconds - probe.durationSeconds) > 1e-9) {
          throw new Error('Local Ruckig returned different durations for the same immutable segment input.');
        }
        const validation = validateSegment(challenge, limits, input, trajectory);
        const sampleTimes = trajectory.sampleTimesSeconds;
        if (sampleTimes !== undefined && sampleTimes.length !== trajectory.samples.length) {
          throw new Error('Local Ruckig returned a mismatched sample-time vector.');
        }
        const samples = trajectory.samples.map((sample, sampleIndex) => ({
          ...sample,
          timeSeconds: sampleTimes?.[sampleIndex] ??
            trajectory.durationSeconds * sampleIndex / (trajectory.samples.length - 1),
        }));
        if (options.requiresFinerSampling?.({
          startParameter: start.parameter,
          endParameter: end.parameter,
          startTimeSeconds,
          samples,
        })) {
          sampleCount = nextSpatialSampleCount(sampleCount, end.parameter);
          continue;
        }
        try {
          options.validateSegment?.({
            startParameter: start.parameter,
            endParameter: end.parameter,
            startTimeSeconds,
            samples,
          });
        } catch (error) {
          if (!(error instanceof CutterGridRuckigSpatialValidationError) || error.code !== 'sample-resolution') {
            throw error;
          }
          if (sampleCount >= MAX_SAMPLE_COUNT) {
            throw new CutterGridRuckigRetimingError(
              'trajectory-smoothing-search-exhausted',
              `Cutter Grid exhausted ${MAX_SAMPLE_COUNT} local Ruckig samples at parameter ${end.parameter.toFixed(6)} (${error.message}).`,
            );
          }
          sampleCount = nextSpatialSampleCount(sampleCount, end.parameter);
          continue;
        }
        return {
          segment: {
            startParameter: start.parameter,
            endParameter: end.parameter,
            requestedMinimumDurationSeconds: requestedMinimumDuration,
            durationSeconds: trajectory.durationSeconds,
            durationExtensionCount: extensionCount,
            certificationSampleCount: samples.length,
            samples: extractRuckigControlSamples(samples),
          },
          ...validation,
        };
      }
    } catch (error) {
      if (error instanceof CutterGridRuckigSpatialValidationError) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-path-deviation',
          error.message,
          error.details,
        );
      }
      if (error instanceof CutterGridRuckigRetimingError) throw error;
      if (error instanceof RuckigBoundaryRegularizationError) throw error;
      if (error instanceof WebAssembly.RuntimeError || (
        error instanceof Error && /memory access out of bounds/i.test(error.message)
      )) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-search-exhausted',
          `Local Ruckig exhausted its fixed WASM memory while certifying ${lastSampleCount} samples at parameter ${end.parameter.toFixed(6)}.`,
        );
      }
      if (error instanceof RuckigLocalWasmError && (
        error.resultCode === -100 || error.resultCode === -101
      )) {
        throw new RuckigBoundaryRegularizationError(end.parameter, error.resultCode);
      }
      lastFailureReason = `${error instanceof Error ? error.message : String(error)}; samples=${lastSampleCount}`;
      const nextDuration = requestedMinimumDuration * DURATION_EXTENSION_FACTOR;
      if (nextDuration > maximumDuration + 1e-12) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-search-exhausted',
          `Cutter Grid exhausted the ${MAX_DURATION_SCALE}x local Ruckig duration budget at parameter ${end.parameter.toFixed(6)}${lastFailureReason ? ` (last failure: ${lastFailureReason})` : ''}.`,
        );
      }
      requestedMinimumDuration = nextDuration;
      extensionCount += 1;
    }
  }
}

/**
 * The ABI emits a uniform certification grid plus every material jerk switch.
 * Uniform points prove collision/path/contact safety in the Worker but are
 * redundant for exact piecewise-constant-jerk playback. Keep only the first,
 * last, and right-hand jerk changes in the serializable plan.
 */
function extractRuckigControlSamples(
  samples: readonly CutterGridRuckigSampleV3[],
): CutterGridRuckigSampleV3[] {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) throw new Error('Local Ruckig returned no control samples.');
  const control = [first];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    if (hasMaterialJerkChange(previous.jerk, current.jerk)) {
      control.push(current);
    }
  }
  control.push(last);
  return control.map((sample) => ({
    ...sample,
    position: [...sample.position] as CutterGridRuckigSampleV3['position'],
    velocity: [...sample.velocity] as CutterGridRuckigSampleV3['velocity'],
    acceleration: [...sample.acceleration] as CutterGridRuckigSampleV3['acceleration'],
    jerk: [...sample.jerk] as CutterGridRuckigSampleV3['jerk'],
  }));
}

function hasMaterialJerkChange(
  previous: readonly number[],
  current: readonly number[],
): boolean {
  return previous.some((value, index) => Math.abs(value - (current[index] ?? Number.NaN)) > 1e-9);
}

function makeRuckigInput(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  start: CutterGridReachabilityNodeV3,
  end: CutterGridReachabilityNodeV3,
  boundaryProfile: RuckigBoundaryProfile,
  minimumDurationSeconds: number,
  sampleCount: number,
): RuckigLocalStateToStateInput {
  const input: RuckigLocalStateToStateInput = {
    current: stateAtNode(challenge, geometry, limits, start, boundaryProfile),
    target: stateAtNode(challenge, geometry, limits, end, boundaryProfile),
    maximum: {
      velocity: vectorFromJoints(challenge, (joint) => limits[joint.id].velocityDegPerSec),
      acceleration: vectorFromJoints(challenge, (joint) => limits[joint.id].accelerationDegPerSec2),
      jerk: vectorFromJoints(challenge, (joint) => limits[joint.id].jerkDegPerSec3),
    },
    minimumDurationSeconds,
    sampleCount,
  };
  assertRuckigBoundaryLimits(challenge, limits, input, end.parameter);
  return input;
}

function assertRuckigBoundaryLimits(
  challenge: Challenge,
  limits: CutterGridRuckigMotionLimitsV3,
  input: RuckigLocalStateToStateInput,
  parameter: number,
): void {
  for (const boundary of [input.current, input.target]) {
    for (const [index, joint] of challenge.robotConfig.joints.entries()) {
      const velocityRatio = Math.abs(boundary.velocity[index]) / limits[joint.id].velocityDegPerSec;
      const accelerationRatio = Math.abs(boundary.acceleration[index]) / limits[joint.id].accelerationDegPerSec2;
      if (velocityRatio > 1 + ENDPOINT_TOLERANCE || accelerationRatio > 1 + ENDPOINT_TOLERANCE) {
        throw new CutterGridRuckigRetimingError(
          'jerk-smoothing-infeasible',
          `TOPP-RA produced an out-of-range ${joint.name} q/v/a boundary at parameter ${parameter.toFixed(6)} ` +
          `(v=${velocityRatio.toFixed(9)}, a=${accelerationRatio.toFixed(9)}).`,
        );
      }
    }
  }
}

function stateAtNode(
  challenge: Challenge,
  geometry: CutterTrajectoryGeometryV3,
  limits: CutterGridRuckigMotionLimitsV3,
  node: CutterGridReachabilityNodeV3,
  boundaryProfile: RuckigBoundaryProfile,
): RuckigLocalStateToStateInput['current'] {
  const geometryState = evaluateCutterTrajectoryGeometryV3AtParameter(challenge, geometry, node.parameter);
  return {
    position: vectorFromJoints(challenge, (joint) => geometryState[joint.id].angle),
    velocity: vectorFromJoints(challenge, (joint) =>
      node.jointVelocitiesDegPerSec[joint.id] * boundaryProfile.velocityScale,
    ),
    acceleration: vectorFromJoints(challenge, (joint) => jerkFeasibleAcceleration(
      node.jointVelocitiesDegPerSec[joint.id] * boundaryProfile.velocityScale,
      node.jointAccelerationsDegPerSec2[joint.id] * boundaryProfile.accelerationScale,
      limits[joint.id],
    )),
  };
}

/**
 * Project a TOPP-RA q/v/a node into Ruckig's finite-jerk velocity-feasible
 * set. With symmetric velocity limits, stopping an acceleration `a` before
 * a velocity boundary consumes a²/(2j) of velocity margin. The projection
 * changes only the temporal acceleration boundary, is deterministic, and is
 * shared verbatim by the neighbouring state-to-state segments.
 */
function jerkFeasibleAcceleration(
  velocity: number,
  acceleration: number,
  limits: CutterGridRuckigMotionLimitsV3[JointId],
): number {
  const maxVelocity = limits.velocityDegPerSec;
  const maxAcceleration = limits.accelerationDegPerSec2;
  const maxJerk = limits.jerkDegPerSec3;
  const positiveAccelerationCap = Math.min(
    maxAcceleration,
    Math.sqrt(Math.max(0, 2 * maxJerk * (maxVelocity - velocity))),
  );
  const negativeAccelerationCap = Math.min(
    maxAcceleration,
    Math.sqrt(Math.max(0, 2 * maxJerk * (maxVelocity + velocity))),
  );
  const projected = Math.min(
    positiveAccelerationCap,
    Math.max(-negativeAccelerationCap, acceleration),
  );
  return Object.is(projected, -0) ? 0 : projected;
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
  let velocityPeak = '';
  for (const sample of trajectory.samples) {
    for (const [index, joint] of challenge.robotConfig.joints.entries()) {
      if (sample.position[index] < joint.minAngleDeg - ENDPOINT_TOLERANCE || sample.position[index] > joint.maxAngleDeg + ENDPOINT_TOLERANCE) {
        throw new CutterGridRuckigRetimingError(
          'trajectory-smoothing-path-deviation',
          `${joint.name} leaves its configured range during local Ruckig retiming.`,
        );
      }
      maximumVelocityRatio = Math.max(
        maximumVelocityRatio,
        Math.abs(sample.velocity[index]) / limits[joint.id].velocityDegPerSec,
      );
      if (Math.abs(sample.velocity[index]) / limits[joint.id].velocityDegPerSec >= maximumVelocityRatio) {
        velocityPeak = `${joint.id}=${sample.velocity[index].toFixed(9)}/${limits[joint.id].velocityDegPerSec.toFixed(9)}`;
      }
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
    throw new Error(
      `Local Ruckig exceeds a configured dynamic limit (v=${maximumVelocityRatio.toFixed(9)}, ` +
      `a=${maximumAccelerationRatio.toFixed(9)}, j=${maximumJerkRatio.toFixed(9)}, peak=${velocityPeak}).`,
    );
  }
  return { maximumVelocityRatio, maximumAccelerationRatio, maximumJerkRatio };
}

function reachabilityLimits(limits: CutterGridRuckigMotionLimitsV3): CutterGridReachabilityLimitsV3 {
  return Object.fromEntries(Object.entries(limits).map(([jointId, limit]) => [jointId, {
    velocityDegPerSec: limit.velocityDegPerSec,
    accelerationDegPerSec2: limit.accelerationDegPerSec2,
  }])) as CutterGridReachabilityLimitsV3;
}

/**
 * The five-millisecond temporal grid alone is insufficient when a joint is
 * legitimately moving at 300 deg/s: its adjacent poses would be 1.5 deg
 * apart, which violates Cutter Grid's 0.5 deg spatial certificate. The
 * first, small Ruckig probe includes every exact jerk switch, so it is a
 * deterministic place to estimate both joint and tool speed and request the
 * needed base-grid density without repeatedly running full collision/contact
 * validation at 2x, 4x, 8x ... sample counts.
 */
function sampleCountForTrajectory(
  challenge: Challenge,
  trajectory: RuckigLocalTrajectoryResult,
): number {
  const durationSeconds = trajectory.durationSeconds;
  const maxJointVelocity = Math.max(
    0,
    ...trajectory.samples.flatMap((sample) => sample.velocity.map((velocity) => Math.abs(velocity))),
  );
  const maxEndEffectorVelocity = Math.max(
    0,
    ...trajectory.samples.map((sample) => endEffectorVelocityMetersPerSecond(challenge, sample)),
  );
  const maximumJointInterval = maxJointVelocity === 0
    ? Number.POSITIVE_INFINITY
    : CUTTER_GRID_MAX_JOINT_SAMPLE_DELTA_DEG / maxJointVelocity;
  const maximumEndEffectorInterval = maxEndEffectorVelocity === 0
    ? Number.POSITIVE_INFINITY
    : (challenge.voxelConfig.size * CUTTER_GRID_MAX_END_EFFECTOR_SAMPLE_DELTA_IN_VOXELS) /
      maxEndEffectorVelocity;
  // A deterministic 5% reserve covers the finite-difference velocity
  // estimate and nonlinear forward kinematics between Ruckig switches. The
  // spatial validator remains authoritative and may ask for a denser stream.
  const intervalSeconds = Math.min(
    MAX_SAMPLE_INTERVAL_SECONDS,
    maximumJointInterval * 0.95,
    maximumEndEffectorInterval * 0.95,
  );
  const sampleCount = Math.ceil(durationSeconds / intervalSeconds) + 1 + MAX_RUCKIG_SWITCH_TIMES;
  if (
    !Number.isFinite(sampleCount) ||
    sampleCount < MINIMUM_RUCKIG_SAMPLE_CAPACITY ||
    sampleCount > MAX_SAMPLE_COUNT
  ) {
    throw new CutterGridRuckigRetimingError(
      'trajectory-smoothing-search-exhausted',
      'Local Ruckig duration cannot be certified at the required 5ms resolution.',
    );
  }
  return sampleCount;
}

const CUTTER_GRID_MAX_JOINT_SAMPLE_DELTA_DEG = 0.5;
const CUTTER_GRID_MAX_END_EFFECTOR_SAMPLE_DELTA_IN_VOXELS = 1 / 16;
const END_EFFECTOR_VELOCITY_DIFFERENCE_SECONDS = 1e-4;

function endEffectorVelocityMetersPerSecond(
  challenge: Challenge,
  sample: RuckigLocalTrajectoryResult['samples'][number],
): number {
  if (sample.velocity.every((velocity) => velocity === 0)) return 0;
  const before = computeRobotPose(
    challenge.robotConfig,
    jointAnglesAtVelocityOffset(challenge, sample.position, sample.velocity, -END_EFFECTOR_VELOCITY_DIFFERENCE_SECONDS),
  ).endEffector;
  const after = computeRobotPose(
    challenge.robotConfig,
    jointAnglesAtVelocityOffset(challenge, sample.position, sample.velocity, END_EFFECTOR_VELOCITY_DIFFERENCE_SECONDS),
  ).endEffector;
  return Math.hypot(
    after[0] - before[0],
    after[1] - before[1],
    after[2] - before[2],
  ) / (2 * END_EFFECTOR_VELOCITY_DIFFERENCE_SECONDS);
}

function jointAnglesAtVelocityOffset(
  challenge: Challenge,
  position: RuckigLocalFiveAxisVector,
  velocity: RuckigLocalFiveAxisVector,
  offsetSeconds: number,
): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint, index) => [
    joint.id,
    position[index] + velocity[index] * offsetSeconds,
  ])) as Record<JointId, number>;
}

/**
 * Five milliseconds is only the initial temporal density. Spatial
 * certification can require more samples on the exact same state-to-state
 * Ruckig solution when a fast joint or the end effector crosses its 0.5° /
 * voxelSize/16 bound. This is a sampling refinement, not a duration retry or
 * a change to the frozen geometry/IK branch.
 */
function nextSpatialSampleCount(sampleCount: number, endParameter: number): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount >= MAX_SAMPLE_COUNT) {
    throw new CutterGridRuckigRetimingError(
      'trajectory-smoothing-search-exhausted',
      `Cutter Grid could not certify local Ruckig spatial sampling at parameter ${endParameter.toFixed(6)}.`,
    );
  }
  return Math.min(MAX_SAMPLE_COUNT, sampleCount * 2 - 1);
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
