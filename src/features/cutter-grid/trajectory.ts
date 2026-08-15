import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose, createInitialJointAngles } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  cutterGridBoundsContain,
  cutterGridCoordToWorld,
  moveCutterGridCoord,
} from './grid';
import { solveCutterGridIk } from './ik';
import { cutterGridChallengeSignature, fnv1a64 } from './signature';
import {
  CUTTER_GRID_PLANNER_VERSION,
  type CompiledCutterGridProgramV1,
  type CutterGridAtomicActionV1,
  type CutterGridBounds,
  type CutterGridCoord,
  type CutterGridDirection,
  type CutterGridPlanningErrorCode,
  type CutterGridPlanningErrorDetails,
  type CutterTrajectoryPlanV1,
  type CutterTrajectoryStepV1,
  type CutterTrajectoryWaypointV1,
} from './types';

export const CUTTER_GRID_TRAJECTORY_CONFIG = Object.freeze({
  cartesianSubdivisionDivisor: 8,
  maxJointSampleDeltaDeg: 0.5,
});

export class CutterGridPlanningError extends Error {
  constructor(
    public readonly code: CutterGridPlanningErrorCode,
    message: string,
    public readonly details: CutterGridPlanningErrorDetails = {},
  ) {
    super(message);
    this.name = 'CutterGridPlanningError';
  }
}

export interface CutterGridPlanningContext {
  challengeSignature: string;
  originHairCoord: CutterGridCoord;
  bounds: CutterGridBounds;
  startJointAngles: Record<JointId, number>;
  reachableCoords?: ReadonlySet<string>;
}

export interface CutterGridPlanningOptions {
  shouldCancel?: () => boolean;
}

export function interpolateCutterTrajectoryJointAngles(
  start: CutterTrajectoryWaypointV1,
  end: CutterTrajectoryWaypointV1,
  targetTimeMs: number,
): Record<JointId, number> {
  const spanMs = end.timeMs - start.timeMs;
  const progress = spanMs <= 0
    ? 1
    : Math.min(1, Math.max(0, (targetTimeMs - start.timeMs) / spanMs));
  const durationSeconds = Math.max(1e-9, spanMs / 1000);
  return Object.fromEntries(
    Object.keys(start.jointAngles).map((jointId) => [
      jointId,
      hermite(
        start.jointAngles[jointId],
        end.jointAngles[jointId],
        start.jointVelocitiesDegPerSec[jointId] * durationSeconds,
        end.jointVelocitiesDegPerSec[jointId] * durationSeconds,
        progress,
      ),
    ]),
  );
}

interface Knot {
  world: Vec3Tuple;
  angles: Record<JointId, number>;
  direction?: CutterGridDirection;
  actionIndex?: number;
  lineStart?: Vec3Tuple;
  lineEnd?: Vec3Tuple;
  sourceBlockId?: string;
  targetCoord?: CutterGridCoord;
}

interface FineSegment {
  startKnot: number;
  endKnot: number;
  direction: CutterGridDirection;
  actionIndex: number;
  durationMs: number;
  continuityGroup: number;
}

export function planCutterGridTrajectory(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV1,
  context: CutterGridPlanningContext,
  options: CutterGridPlanningOptions = {},
): CutterTrajectoryPlanV1 {
  assertPlannerInputs(challenge, compiled, context);
  const built = buildMovementKnots(
    challenge,
    compiled.runtimeActions,
    context,
    options,
  );
  assignSynchronizedDurations(challenge, built.knots, built.segments);
  const movementSteps = sampleMovementSteps(
    challenge,
    compiled.runtimeActions,
    built.knots,
    built.segments,
  );
  const steps = mergeWaitSteps(
    challenge,
    compiled.runtimeActions,
    movementSteps,
    built.actionCoords,
    built.actionAngles,
  );
  const expectedResultVoxels = computeExpectedContacts(challenge, steps);
  const estimatedDurationMs = steps.reduce(
    (sum, step) => sum + step.durationMs,
    0,
  );
  const unsigned: Omit<CutterTrajectoryPlanV1, 'trajectorySignature'> = {
    kind: 'cutter-grid-trajectory',
    version: 1,
    plannerVersion: CUTTER_GRID_PLANNER_VERSION,
    challengeSignature: context.challengeSignature,
    startCoord: [0, 0, 0],
    endCoord: built.finalCoord,
    steps,
    expectedResultVoxels,
    estimatedDurationMs,
    executedCommandCount: compiled.executedCommandCount,
  };
  return { ...unsigned, trajectorySignature: trajectorySignature(unsigned) };
}

export function serializeCutterTrajectoryPlan(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  plan: CutterTrajectoryPlanV1,
): CutterTrajectoryPlanV1 {
  const quantizedSteps = plan.steps.map((step) => {
    let previousTimeMs = -1;
    const waypoints = step.waypoints.map((waypoint, waypointIndex) => {
      const jointAngles = Object.fromEntries(
        Object.entries(waypoint.jointAngles).map(([id, value]) => [
          id,
          Math.round(value * 10) / 10,
        ]),
      );
      const roundedTimeMs = Math.round(waypoint.timeMs);
      const timeMs =
        step.kind === 'wait' || waypointIndex === 0
          ? roundedTimeMs
          : Math.max(previousTimeMs + 1, roundedTimeMs);
      previousTimeMs = timeMs;
      return {
        timeMs,
        jointAngles,
        jointVelocitiesDegPerSec: Object.fromEntries(
          Object.entries(waypoint.jointVelocitiesDegPerSec).map(
            ([id, value]) => [id, round(value, 6)],
          ),
        ),
        endEffector: computeRobotPose(
          challenge.robotConfig,
          jointAngles,
        ).endEffector,
      };
    });
    return {
      ...step,
      durationMs:
        step.kind === 'wait'
          ? Math.round(step.durationMs)
          : (waypoints.at(-1)?.timeMs ?? 0),
      expectedCutVoxels: [...step.expectedCutVoxels].sort(),
      waypoints,
    };
  });
  const speedScale = Math.ceil(
    serializedTrajectorySpeedScale(challenge, quantizedSteps),
  );
  const serializedSteps = quantizedSteps.map((step) =>
    step.kind === 'wait' || speedScale === 1
      ? step
      : {
          ...step,
          durationMs: step.durationMs * speedScale,
          waypoints: step.waypoints.map((waypoint) => ({
            ...waypoint,
            timeMs: waypoint.timeMs * speedScale,
            jointVelocitiesDegPerSec: Object.fromEntries(
              Object.entries(waypoint.jointVelocitiesDegPerSec).map(
                ([id, value]) => [id, round(value / speedScale, 6)],
              ),
            ),
          })),
        },
  );
  const expectedResultVoxels = computeExpectedContacts(
    challenge,
    serializedSteps,
  );
  const serialized = {
    ...plan,
    estimatedDurationMs: serializedSteps.reduce(
      (sum, step) => sum + step.durationMs,
      0,
    ),
    steps: serializedSteps,
    expectedResultVoxels,
  };
  validateCutterTrajectoryPlan(challenge, originHairCoord, serialized);
  return {
    ...serialized,
    trajectorySignature: trajectorySignature(serialized),
  };
}

function serializedTrajectorySpeedScale(
  challenge: Challenge,
  steps: readonly CutterTrajectoryStepV1[],
): number {
  let scale = 1;
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    for (let index = 1; index < step.waypoints.length; index += 1) {
      const start = step.waypoints[index - 1];
      const end = step.waypoints[index];
      const durationSeconds = (end.timeMs - start.timeMs) / 1000;
      if (durationSeconds <= 0) continue;
      for (const joint of challenge.robotConfig.joints) {
        const maximumSpeed =
          hermiteMaxDerivative(
            start.jointAngles[joint.id],
            end.jointAngles[joint.id],
            start.jointVelocitiesDegPerSec[joint.id] * durationSeconds,
            end.jointVelocitiesDegPerSec[joint.id] * durationSeconds,
          ) / durationSeconds;
        scale = Math.max(scale, maximumSpeed / joint.speedDegPerSec);
      }
    }
  }
  return scale > 1 ? scale * (1 + 1e-6) : 1;
}

export function validateCutterTrajectoryPlan(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  plan: Omit<CutterTrajectoryPlanV1, 'trajectorySignature'>,
): void {
  let previousWaypoint: CutterTrajectoryWaypointV1 | undefined;
  for (const step of plan.steps) {
    const lineStart = cutterGridCoordToWorld(
      step.startCoord,
      originHairCoord,
      challenge.voxelConfig,
    );
    const lineEnd = cutterGridCoordToWorld(
      step.endCoord,
      originHairCoord,
      challenge.voxelConfig,
    );
    for (const waypoint of step.waypoints) {
      const knot: Knot = {
        world: waypoint.endEffector,
        angles: waypoint.jointAngles,
        sourceBlockId: step.sourceBlockId,
        targetCoord: step.endCoord,
      };
      validateJointLimits(challenge, waypoint.jointAngles, knot);
      for (const joint of challenge.robotConfig.joints) {
        if (
          Math.abs(waypoint.jointVelocitiesDegPerSec[joint.id]) >
          joint.speedDegPerSec + 1e-9
        ) {
          throw new CutterGridPlanningError(
            'trajectory-discontinuity',
            `${joint.name} exceeds its speed limit after trajectory serialization.`,
            { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
          );
        }
      }
      const collision = findRobotHeadCollision(
        computeRobotPose(challenge.robotConfig, waypoint.jointAngles),
        challenge.voxelConfig,
        challenge.robotConfig.geometry,
      );
      if (collision) {
        throw new CutterGridPlanningError(
          'head-collision',
          `${collision.partLabel} collides with the head after trajectory serialization.`,
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
        );
      }
      const pathDeviation = pointSegmentDistance(
        waypoint.endEffector,
        lineStart,
        lineEnd,
      );
      if (pathDeviation > challenge.voxelConfig.size / 16 + 1e-9) {
        throw new CutterGridPlanningError(
          'path-deviation',
          `Serialized trajectory deviates from its fixed-axis path (${pathDeviation.toFixed(6)} > ${(challenge.voxelConfig.size / 16).toFixed(6)}).`,
          { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
        );
      }
      if (previousWaypoint) {
        const previous = previousWaypoint;
        const jointDelta = Math.max(
          ...challenge.robotConfig.joints.map((joint) =>
            Math.abs(
              waypoint.jointAngles[joint.id] -
                previous.jointAngles[joint.id],
            ),
          ),
        );
        if (
          jointDelta >
            CUTTER_GRID_TRAJECTORY_CONFIG.maxJointSampleDeltaDeg + 1e-9 ||
          distance(waypoint.endEffector, previous.endEffector) >
            challenge.voxelConfig.size / 4 + 1e-9
        ) {
          throw new CutterGridPlanningError(
            'trajectory-discontinuity',
            'Serialized trajectory exceeds its joint or cutter resampling limit.',
            { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
          );
        }
      }
      previousWaypoint = waypoint;
    }
    for (let index = 1; index < step.waypoints.length; index += 1) {
      validateSerializedInterval(
        challenge,
        step,
        step.waypoints[index - 1],
        step.waypoints[index],
        lineStart,
        lineEnd,
      );
    }
    const finalWaypoint = step.waypoints.at(-1);
    if (
      finalWaypoint &&
      distance(finalWaypoint.endEffector, lineEnd) >
        challenge.voxelConfig.size / 16 + 1e-9
    ) {
      throw new CutterGridPlanningError(
        'ik-not-converged',
        'Serialized trajectory misses its logical grid coordinate.',
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
      );
    }
  }
}

function validateSerializedInterval(
  challenge: Challenge,
  step: CutterTrajectoryStepV1,
  start: CutterTrajectoryWaypointV1,
  end: CutterTrajectoryWaypointV1,
  lineStart: Vec3Tuple,
  lineEnd: Vec3Tuple,
): void {
  const durationSeconds = Math.max(1e-9, (end.timeMs - start.timeMs) / 1000);
  for (const joint of challenge.robotConfig.joints) {
    const maximumSpeed =
      hermiteMaxDerivative(
        start.jointAngles[joint.id],
        end.jointAngles[joint.id],
        start.jointVelocitiesDegPerSec[joint.id] * durationSeconds,
        end.jointVelocitiesDegPerSec[joint.id] * durationSeconds,
      ) / durationSeconds;
    if (maximumSpeed > joint.speedDegPerSec + 1e-6) {
      throw new CutterGridPlanningError(
        'trajectory-discontinuity',
        `${joint.name} exceeds its synchronized speed limit after serialization.`,
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
      );
    }
  }
  for (let subdivision = 1; subdivision < 4; subdivision += 1) {
    const timeMs =
      start.timeMs + ((end.timeMs - start.timeMs) * subdivision) / 4;
    const jointAngles = interpolateCutterTrajectoryJointAngles(
      start,
      end,
      timeMs,
    );
    const pose = computeRobotPose(challenge.robotConfig, jointAngles);
    const collision = findRobotHeadCollision(
      pose,
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    );
    if (collision) {
      throw new CutterGridPlanningError(
        'head-collision',
        `${collision.partLabel} collides with the head between serialized waypoints.`,
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
      );
    }
    if (
      pointSegmentDistance(pose.endEffector, lineStart, lineEnd) >
      challenge.voxelConfig.size / 16 + 1e-9
    ) {
      throw new CutterGridPlanningError(
        'path-deviation',
        'Serialized Hermite playback deviates from its fixed-axis cutter path.',
        { sourceBlockId: step.sourceBlockId, targetCoord: step.endCoord },
      );
    }
  }
}

export function planCutterGridEntryTrajectory(
  challenge: Challenge,
  originWorldPosition: Vec3Tuple,
  options: CutterGridPlanningOptions = {},
): CutterTrajectoryWaypointV1[] {
  const initialAngles = createInitialJointAngles(challenge.robotConfig);
  const initialWorld = computeRobotPose(
    challenge.robotConfig,
    initialAngles,
  ).endEffector;
  const knotCount = Math.max(
    1,
    Math.ceil(
      distance(initialWorld, originWorldPosition) /
        (challenge.voxelConfig.size /
          CUTTER_GRID_TRAJECTORY_CONFIG.cartesianSubdivisionDivisor),
    ),
  );
  const knots: Knot[] = [{ world: initialWorld, angles: initialAngles }];
  let previous = initialAngles;
  for (let index = 1; index <= knotCount; index += 1) {
    throwIfCancelled(options);
    const target = interpolate(initialWorld, originWorldPosition, index / knotCount);
    const solution = solveCutterGridIk(challenge, target, previous, {
      maxError: challenge.voxelConfig.size / 32,
      shouldCancel: options.shouldCancel,
      maxNormalizedChange: 0.2,
    });
    if (!solution) {
      throw new CutterGridPlanningError(
        'ik-not-converged',
        'The certified entry trajectory could not reach its Cutter Grid origin.',
        { targetCoord: [0, 0, 0] },
      );
    }
    previous = solution.jointAngles;
    knots.push({
      world: target,
      angles: solution.jointAngles,
      targetCoord: [0, 0, 0],
    });
  }
  const segments: FineSegment[] = Array.from(
    { length: knots.length - 1 },
    (_, index) => ({
      startKnot: index,
      endKnot: index + 1,
      direction: 'right',
      actionIndex: 0,
      durationMs: 0,
      continuityGroup: 0,
    }),
  );
  assignSynchronizedDurations(challenge, knots, segments);
  const sampled = sampleSegments(challenge, knots, segments);
  const hits = sweptHits(challenge, sampled);
  if (hits.length > 0) {
    throw new CutterGridPlanningError(
      'path-deviation',
      `The certified entry trajectory touches ${hits.length} hair voxels.`,
      { targetCoord: [0, 0, 0] },
    );
  }
  return sampled;
}

function buildMovementKnots(
  challenge: Challenge,
  actions: readonly CutterGridAtomicActionV1[],
  context: CutterGridPlanningContext,
  options: CutterGridPlanningOptions,
): {
  knots: Knot[];
  segments: FineSegment[];
  actionCoords: CutterGridCoord[];
  actionAngles: Array<Record<JointId, number>>;
  finalCoord: CutterGridCoord;
} {
  let coord: CutterGridCoord = [0, 0, 0];
  let angles = { ...context.startJointAngles };
  const world = cutterGridCoordToWorld(
    coord,
    context.originHairCoord,
    challenge.voxelConfig,
  );
  const knots: Knot[] = [{ world, angles }];
  const segments: FineSegment[] = [];
  const actionCoords: CutterGridCoord[] = [];
  const actionAngles: Array<Record<JointId, number>> = [];
  let continuityGroup = 0;
  let previousDirection: CutterGridDirection | undefined;
  let breakContinuity = true;

  actions.forEach((action, actionIndex) => {
    throwIfCancelled(options);
    if (action.type === 'wait') {
      actionCoords[actionIndex] = coord;
      actionAngles[actionIndex] = angles;
      breakContinuity = true;
      return;
    }
    if (breakContinuity || previousDirection !== action.direction) {
      continuityGroup += 1;
    }
    const nextCoord = moveCutterGridCoord(coord, action.direction);
    if (!cutterGridBoundsContain(context.bounds, nextCoord)) {
      throw planningError(
        'out-of-bounds',
        action,
        nextCoord,
        `Cutter Grid coordinate ${formatCoord(nextCoord)} is outside the certified boundary.`,
      );
    }
    if (
      context.reachableCoords &&
      !context.reachableCoords.has(nextCoord.join(','))
    ) {
      throw planningError(
        'blocked-node',
        action,
        nextCoord,
        `Cutter Grid coordinate ${formatCoord(nextCoord)} is blocked.`,
      );
    }
    const lineStart = cutterGridCoordToWorld(
      coord,
      context.originHairCoord,
      challenge.voxelConfig,
    );
    const lineEnd = cutterGridCoordToWorld(
      nextCoord,
      context.originHairCoord,
      challenge.voxelConfig,
    );
    for (
      let subdivision = 1;
      subdivision <= CUTTER_GRID_TRAJECTORY_CONFIG.cartesianSubdivisionDivisor;
      subdivision += 1
    ) {
      throwIfCancelled(options);
      const target = interpolate(
        lineStart,
        lineEnd,
        subdivision / CUTTER_GRID_TRAJECTORY_CONFIG.cartesianSubdivisionDivisor,
      );
      const solution = solveCutterGridIk(challenge, target, angles, {
        maxError: challenge.voxelConfig.size / 32,
        shouldCancel: options.shouldCancel,
        quantizeOutput: false,
        maxNormalizedChange: 0.2,
      });
      if (!solution) {
        throw planningError(
          'ik-not-converged',
          action,
          nextCoord,
          `IK did not converge for Cutter Grid coordinate ${formatCoord(nextCoord)}.`,
        );
      }
      angles = solution.jointAngles;
      const startKnot = knots.length - 1;
      knots.push({
        world: target,
        angles,
        direction: action.direction,
        actionIndex,
        lineStart,
        lineEnd,
        sourceBlockId: action.sourceBlockId,
        targetCoord: nextCoord,
      });
      segments.push({
        startKnot,
        endKnot: startKnot + 1,
        direction: action.direction,
        actionIndex,
        durationMs: 0,
        continuityGroup,
      });
    }
    coord = nextCoord;
    actionCoords[actionIndex] = coord;
    actionAngles[actionIndex] = angles;
    previousDirection = action.direction;
    breakContinuity = false;
  });
  return { knots, segments, actionCoords, actionAngles, finalCoord: coord };
}

function assignSynchronizedDurations(
  challenge: Challenge,
  knots: readonly Knot[],
  segments: FineSegment[],
): void {
  const tangents = knotTangents(challenge, knots, segments);
  for (let start = 0; start < segments.length; ) {
    let end = start + 1;
    while (
      end < segments.length &&
      segments[end].continuityGroup === segments[start].continuityGroup &&
      segments[end].startKnot === segments[end - 1].endKnot
    ) {
      end += 1;
    }
    let durationMs = 0;
    for (let index = start; index < end; index += 1) {
      const segment = segments[index];
      for (const joint of challenge.robotConfig.joints) {
        const p0 = knots[segment.startKnot].angles[joint.id];
        const p1 = knots[segment.endKnot].angles[joint.id];
        const maxDerivative = hermiteMaxDerivative(
          p0,
          p1,
          tangents[segment.startKnot][joint.id],
          tangents[segment.endKnot][joint.id],
        );
        durationMs = Math.max(
          durationMs,
          (maxDerivative / joint.speedDegPerSec) * 1000,
        );
      }
    }
    durationMs = Math.max(1, Math.ceil(durationMs));
    for (let index = start; index < end; index += 1) {
      segments[index].durationMs = durationMs;
    }
    start = end;
  }
}

function knotTangents(
  challenge: Challenge,
  knots: readonly Knot[],
  segments: readonly FineSegment[],
): Array<Record<JointId, number>> {
  return knots.map((knot, index) => {
    const previous = segments[index - 1];
    const next = segments[index];
    const continuous =
      previous &&
      next &&
      previous.continuityGroup === next.continuityGroup;
    return Object.fromEntries(
      challenge.robotConfig.joints.map((joint) => [
        joint.id,
        continuous
          ? monotoneTangent(
              knot.angles[joint.id] - knots[index - 1].angles[joint.id],
              knots[index + 1].angles[joint.id] - knot.angles[joint.id],
            )
          : 0,
      ]),
    ) as Record<JointId, number>;
  });
}

function monotoneTangent(previousDelta: number, nextDelta: number): number {
  if (previousDelta * nextDelta <= 0) return 0;
  return (2 * previousDelta * nextDelta) / (previousDelta + nextDelta);
}

function sampleMovementSteps(
  challenge: Challenge,
  actions: readonly CutterGridAtomicActionV1[],
  knots: readonly Knot[],
  segments: readonly FineSegment[],
): Map<number, CutterTrajectoryStepV1> {
  const byAction = new Map<number, CutterTrajectoryWaypointV1[]>();
  for (const segment of segments) {
    const samples = sampleSingleSegment(challenge, knots, segments, segment);
    const actionSamples = byAction.get(segment.actionIndex) ?? [];
    const localStart = actionSamples.at(-1)?.timeMs ?? 0;
    for (const [index, sample] of samples.entries()) {
      if (actionSamples.length > 0 && index === 0) continue;
      actionSamples.push({ ...sample, timeMs: localStart + sample.timeMs });
    }
    byAction.set(segment.actionIndex, actionSamples);
  }

  const result = new Map<number, CutterTrajectoryStepV1>();
  let coord: CutterGridCoord = [0, 0, 0];
  actions.forEach((action, index) => {
    if (action.type !== 'move-cell') return;
    const endCoord = moveCutterGridCoord(coord, action.direction);
    const waypoints = byAction.get(index) ?? [];
    result.set(index, {
      index,
      kind: 'move-cell',
      sourceBlockId: action.sourceBlockId,
      startCoord: coord,
      endCoord,
      durationMs: waypoints.at(-1)?.timeMs ?? 0,
      waypoints,
      expectedCutVoxels: [],
    });
    coord = endCoord;
  });
  return result;
}

function sampleSegments(
  challenge: Challenge,
  knots: readonly Knot[],
  segments: readonly FineSegment[],
): CutterTrajectoryWaypointV1[] {
  const result: CutterTrajectoryWaypointV1[] = [];
  let elapsed = 0;
  for (const segment of segments) {
    const samples = sampleSingleSegment(challenge, knots, segments, segment);
    samples.forEach((sample, index) => {
      if (result.length > 0 && index === 0) return;
      result.push({ ...sample, timeMs: elapsed + sample.timeMs });
    });
    elapsed += segment.durationMs;
  }
  return result;
}

function sampleSingleSegment(
  challenge: Challenge,
  knots: readonly Knot[],
  segments: readonly FineSegment[],
  segment: FineSegment,
): CutterTrajectoryWaypointV1[] {
  const tangents = knotTangents(challenge, knots, segments);
  const start = knots[segment.startKnot];
  const end = knots[segment.endKnot];
  let sampleCount = 1;
  for (const joint of challenge.robotConfig.joints) {
    sampleCount = Math.max(
      sampleCount,
      Math.ceil(
        hermiteMaxDerivative(
          start.angles[joint.id],
          end.angles[joint.id],
          tangents[segment.startKnot][joint.id],
          tangents[segment.endKnot][joint.id],
        ) / CUTTER_GRID_TRAJECTORY_CONFIG.maxJointSampleDeltaDeg,
      ),
    );
  }
  const createSamples = (count: number) =>
    Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count;
    const jointAngles = Object.fromEntries(
      challenge.robotConfig.joints.map((joint) => [
        joint.id,
        hermite(
          start.angles[joint.id],
          end.angles[joint.id],
          tangents[segment.startKnot][joint.id],
          tangents[segment.endKnot][joint.id],
          progress,
        ),
      ]),
    ) as Record<JointId, number>;
    const durationSeconds = Math.max(1e-9, segment.durationMs / 1000);
    const jointVelocitiesDegPerSec = Object.fromEntries(
      challenge.robotConfig.joints.map((joint) => [
        joint.id,
        hermiteDerivative(
          start.angles[joint.id],
          end.angles[joint.id],
          tangents[segment.startKnot][joint.id],
          tangents[segment.endKnot][joint.id],
          progress,
        ) / durationSeconds,
      ]),
    ) as Record<JointId, number>;
    validateJointLimits(challenge, jointAngles, end);
    const pose = computeRobotPose(challenge.robotConfig, jointAngles);
    const collision = findRobotHeadCollision(
      pose,
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    );
    if (collision) {
      throw new CutterGridPlanningError(
        'head-collision',
        `${collision.partLabel} collides with the head during trajectory validation.`,
        {
          sourceBlockId: end.sourceBlockId,
          targetCoord: end.targetCoord,
        },
      );
    }
    if (
      end.lineStart &&
      end.lineEnd &&
      pointSegmentDistance(pose.endEffector, end.lineStart, end.lineEnd) >
        challenge.voxelConfig.size / 16
    ) {
      throw new CutterGridPlanningError(
        'path-deviation',
        `The synchronized joint spline deviates from its fixed-axis cutter path (${pointSegmentDistance(
          pose.endEffector,
          end.lineStart,
          end.lineEnd,
        ).toFixed(6)} > ${(
          challenge.voxelConfig.size / 16
        ).toFixed(6)}).`,
        {
          sourceBlockId: end.sourceBlockId,
          targetCoord: end.targetCoord,
        },
      );
    }
    return {
      timeMs: (segment.durationMs * index) / count,
      jointAngles,
      jointVelocitiesDegPerSec,
      endEffector: pose.endEffector,
    };
  });
  let samples = createSamples(sampleCount);
  while (!samplesMeetResamplingLimits(challenge, samples)) {
    sampleCount *= 2;
    if (sampleCount > 4_096) {
      throw new CutterGridPlanningError(
        'trajectory-discontinuity',
        'Trajectory could not satisfy its joint and cutter resampling limits.',
        {
          sourceBlockId: end.sourceBlockId,
          targetCoord: end.targetCoord,
        },
      );
    }
    samples = createSamples(sampleCount);
  }
  return samples;
}

function samplesMeetResamplingLimits(
  challenge: Challenge,
  samples: readonly CutterTrajectoryWaypointV1[],
): boolean {
  for (let index = 1; index < samples.length; index += 1) {
    const jointDelta = Math.max(
      ...challenge.robotConfig.joints.map((joint) =>
        Math.abs(
          samples[index].jointAngles[joint.id] -
            samples[index - 1].jointAngles[joint.id],
        ),
      ),
    );
    if (
      jointDelta > CUTTER_GRID_TRAJECTORY_CONFIG.maxJointSampleDeltaDeg + 1e-9 ||
      distance(samples[index].endEffector, samples[index - 1].endEffector) >
        challenge.voxelConfig.size / 4 + 1e-9
    ) return false;
  }
  return true;
}

function mergeWaitSteps(
  challenge: Challenge,
  actions: readonly CutterGridAtomicActionV1[],
  movement: Map<number, CutterTrajectoryStepV1>,
  actionCoords: readonly CutterGridCoord[],
  actionAngles: ReadonlyArray<Record<JointId, number>>,
): CutterTrajectoryStepV1[] {
  let lastCoord: CutterGridCoord = [0, 0, 0];
  return actions.map((action, index) => {
    const move = movement.get(index);
    if (move) {
      lastCoord = move.endCoord;
      return move;
    }
    const angles = actionAngles[index];
    const endEffector = angles
      ? computeRobotPose(challenge.robotConfig, angles).endEffector
      : undefined;
    const waypoints =
      angles && endEffector
          ? [
            {
              timeMs: 0,
              jointAngles: angles,
              jointVelocitiesDegPerSec: zeroVelocities(challenge),
              endEffector,
            },
            {
              timeMs: action.type === 'wait' ? action.durationMs : 0,
              jointAngles: angles,
              jointVelocitiesDegPerSec: zeroVelocities(challenge),
              endEffector,
            },
          ]
        : [];
    const coord = actionCoords[index] ?? lastCoord;
    return {
      index,
      kind: 'wait',
      sourceBlockId: action.sourceBlockId,
      startCoord: coord,
      endCoord: coord,
      durationMs: action.type === 'wait' ? action.durationMs : 0,
      waypoints,
      expectedCutVoxels: [],
    };
  });
}

function computeExpectedContacts(
  challenge: Challenge,
  steps: CutterTrajectoryStepV1[],
): VoxelKey[] {
  const remaining = new Set(challenge.initialHair.voxels);
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    const hits = sweptHits(challenge, step.waypoints, remaining);
    step.expectedCutVoxels = hits;
    hits.forEach((key) => remaining.delete(key));
  }
  return [...remaining].sort();
}

function sweptHits(
  challenge: Challenge,
  waypoints: readonly CutterTrajectoryWaypointV1[],
  voxels: ReadonlySet<VoxelKey> = challenge.initialHair.voxels,
): VoxelKey[] {
  const hits = new Set<VoxelKey>();
  for (let index = 1; index < waypoints.length; index += 1) {
    findSweptVoxelHits(
      waypoints[index - 1].endEffector,
      waypoints[index].endEffector,
      voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    ).forEach((key) => hits.add(key));
  }
  return [...hits].sort();
}

function assertPlannerInputs(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV1,
  context: CutterGridPlanningContext,
): void {
  if (
    compiled.program.plannerVersion !== CUTTER_GRID_PLANNER_VERSION ||
    context.challengeSignature !== cutterGridChallengeSignature(challenge)
  ) {
    throw new CutterGridPlanningError(
      'profile-mismatch',
      'Cutter Grid program and certified planner versions do not match.',
    );
  }
  if (context.startJointAngles === undefined) {
    throw new CutterGridPlanningError('profile-mismatch', 'Cutter Grid profile is incomplete.');
  }
}

function validateJointLimits(
  challenge: Challenge,
  angles: Readonly<Record<JointId, number>>,
  knot: Knot,
): void {
  for (const joint of challenge.robotConfig.joints) {
    const value = angles[joint.id];
    if (value < joint.minAngleDeg - 1e-9 || value > joint.maxAngleDeg + 1e-9) {
      throw new CutterGridPlanningError(
        'joint-limit',
        `${joint.name} exceeds its certified range.`,
        {
          sourceBlockId: knot.sourceBlockId,
          targetCoord: knot.targetCoord,
        },
      );
    }
  }
}

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
}

function hermiteDerivative(
  p0: number,
  p1: number,
  m0: number,
  m1: number,
  t: number,
): number {
  const t2 = t * t;
  return (
    (6 * t2 - 6 * t) * p0 +
    (3 * t2 - 4 * t + 1) * m0 +
    (-6 * t2 + 6 * t) * p1 +
    (3 * t2 - 2 * t) * m1
  );
}

function zeroVelocities(challenge: Challenge): Record<JointId, number> {
  return Object.fromEntries(
    challenge.robotConfig.joints.map((joint) => [joint.id, 0]),
  ) as Record<JointId, number>;
}

function hermiteMaxDerivative(p0: number, p1: number, m0: number, m1: number): number {
  const a = 6 * p0 + 3 * m0 - 6 * p1 + 3 * m1;
  const b = -6 * p0 - 4 * m0 + 6 * p1 - 2 * m1;
  const c = m0;
  const values = [Math.abs(c), Math.abs(a + b + c)];
  if (Math.abs(a) > 1e-12) {
    const root = -b / (2 * a);
    if (root > 0 && root < 1) values.push(Math.abs(a * root * root + b * root + c));
  }
  return Math.max(...values);
}

function trajectorySignature(
  plan: Omit<CutterTrajectoryPlanV1, 'trajectorySignature'>,
): string {
  return fnv1a64(
    JSON.stringify({
      ...plan,
      steps: plan.steps.map((step) => ({
        ...step,
        waypoints: step.waypoints.map((waypoint) => ({
          timeMs: round(waypoint.timeMs, 6),
          jointAngles: Object.fromEntries(
            Object.entries(waypoint.jointAngles).map(([id, value]) => [id, round(value, 9)]),
          ),
          jointVelocitiesDegPerSec: Object.fromEntries(
            Object.entries(waypoint.jointVelocitiesDegPerSec).map(
              ([id, value]) => [id, round(value, 9)],
            ),
          ),
          endEffector: waypoint.endEffector.map((value) => round(value, 9)),
        })),
      })),
    }),
  );
}

function planningError(
  code: CutterGridPlanningErrorCode,
  action: CutterGridAtomicActionV1,
  targetCoord: CutterGridCoord,
  message: string,
): CutterGridPlanningError {
  return new CutterGridPlanningError(code, message, {
    sourceBlockId: action.sourceBlockId,
    targetCoord,
  });
}

function throwIfCancelled(options: CutterGridPlanningOptions): void {
  if (options.shouldCancel?.()) {
    throw new CutterGridPlanningError('planning-cancelled', 'Cutter Grid planning was cancelled.');
  }
}

function interpolate(start: Vec3Tuple, end: Vec3Tuple, t: number): Vec3Tuple {
  return start.map((value, axis) => value + (end[axis] - value) * t) as unknown as Vec3Tuple;
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction = end.map((value, axis) => value - start[axis]) as unknown as Vec3Tuple;
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, direction.reduce(
        (sum, value, axis) => sum + (point[axis] - start[axis]) * value,
        0,
      ) / lengthSquared));
  return distance(point, interpolate(start, end, t));
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function formatCoord(coord: CutterGridCoord): string {
  return `(${coord.join(', ')})`;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
