import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import {
  RobotController,
  type BlockedPoseCollision,
} from '../robot/RobotController';
import { findRobotHeadCollision } from '../robot/headCollision';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import type { RobotCommand } from '../blockly/programTypes';
import type { TrajectoryPlan, TrajectorySegment } from './scalpProgramTypes';

interface ActiveWait {
  elapsedMs: number;
}


export interface TrajectoryMovement {
  segment: TrajectorySegment;
  previousEndEffector: Vec3Tuple;
  currentEndEffector: Vec3Tuple;
}

export interface TrajectoryAdvanceResult {
  consumedMs: number;
  segmentsCompleted: number;
  planCompleted: boolean;
  movements: TrajectoryMovement[];
  blockedCollision?: BlockedPoseCollision;
}

export interface TrajectoryExecutorHooks {
  onSegmentStart?: (segment: TrajectorySegment, index: number) => void;
  onSegmentComplete?: (segment: TrajectorySegment, index: number) => void;
}

/**
 * Executes a trajectory plan against the same RobotController used by the
 * legacy interpreter. It deliberately owns no Hair state; that keeps geometry
 * and contact policy independently testable.
 */
export class TrajectoryExecutor {
  private segments: readonly TrajectorySegment[] = [];
  private segmentIndex = 0;
  private activeSegment: TrajectorySegment | undefined;
  private activeWaypointIndex = 0;
  private activeWait: ActiveWait | undefined;
  private contactEndEffector: Vec3Tuple | undefined;

  constructor(
    private readonly robotController: RobotController,
    private readonly maxEndEffectorStep?: number,
  ) {}

  load(plan: TrajectoryPlan): void {
    this.segments = [...plan.segments];
    this.segmentIndex = 0;
    this.activeSegment = undefined;
    this.activeWaypointIndex = 0;
    this.activeWait = undefined;
    this.contactEndEffector = undefined;
  }

  reset(): void {
    this.segments = [];
    this.segmentIndex = 0;
    this.activeSegment = undefined;
    this.activeWaypointIndex = 0;
    this.activeWait = undefined;
    this.contactEndEffector = undefined;
  }

  advance(
    deltaMs: number,
    hooks: TrajectoryExecutorHooks = {},
    maxSegmentsToComplete = Number.POSITIVE_INFINITY,
  ): TrajectoryAdvanceResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error('Delta must be a finite non-negative number.');
    }

    let remainingMs = deltaMs;
    let consumedMs = 0;
    let segmentsCompleted = 0;
    const movements: TrajectoryMovement[] = [];
    let blockedCollision: BlockedPoseCollision | undefined;
    let safetyCounter = 0;

    while (
      this.segmentIndex < this.segments.length &&
      segmentsCompleted < maxSegmentsToComplete
    ) {
      safetyCounter += 1;
      if (safetyCounter > 100_000) {
        throw new Error('Trajectory executor failed to make progress.');
      }

      const segment = this.segments[this.segmentIndex];
      if (!this.activeSegment) {
        this.activeSegment = segment;
        this.activeWaypointIndex = 0;
        hooks.onSegmentStart?.(segment, this.segmentIndex);
        if (segment.kind === 'wait') {
          this.activeWait = { elapsedMs: 0 };
        } else if (segment.kind !== 'turn') {
          this.beginWaypoint(segment);
        }
      }

      if (segment.kind === 'turn') {
        this.completeSegment(hooks);
        segmentsCompleted += 1;
        continue;
      }

      if (segment.kind === 'wait') {
        const durationMs = segment.durationMs;
        if (durationMs === undefined) {
          throw new Error('Trajectory wait is missing a duration.');
        }
        const activeWait = this.activeWait;
        if (!activeWait) {
          throw new Error('Trajectory wait state is missing.');
        }
        const consumed = Math.min(remainingMs, Math.max(0, durationMs - activeWait.elapsedMs));
        activeWait.elapsedMs += consumed;
        consumedMs += consumed;
        remainingMs = Math.max(0, remainingMs - consumed);
        if (activeWait.elapsedMs < durationMs) {
          break;
        }
        this.completeSegment(hooks);
        segmentsCompleted += 1;
        if (remainingMs === 0) {
          break;
        }
        continue;
      }

      const movement = this.robotController.advancePoseMove(remainingMs);
      consumedMs += movement.consumedMs;
      remainingMs = Math.max(0, remainingMs - movement.consumedMs);
      if (movement.endEffectorPath.length > 0) {
        const start = this.contactEndEffector ?? movement.previousEndEffector;
        movements.push(
          ...toMovements(segment, start, movement.endEffectorPath),
        );
        this.contactEndEffector = movement.endEffectorPath.at(-1);
      }
      if (movement.blockedCollision) {
        blockedCollision = movement.blockedCollision;
        break;
      }
      if (!movement.completed) {
        break;
      }

      this.activeWaypointIndex += 1;
      const waypointCount = segment.edge?.synchronousWaypoints.length ?? 0;
      if (this.activeWaypointIndex < waypointCount) {
        this.beginWaypoint(segment);
        if (remainingMs === 0) {
          break;
        }
        continue;
      }
      this.completeSegment(hooks);
      segmentsCompleted += 1;
      if (remainingMs === 0) {
        break;
      }
    }

    return {
      consumedMs,
      segmentsCompleted,
      planCompleted: this.segmentIndex >= this.segments.length,
      movements,
      ...(blockedCollision ? { blockedCollision } : {}),
    };
  }

  getSegmentIndex(): number {
    return this.segmentIndex;
  }

  getCurrentSegment(): TrajectorySegment | undefined {
    return this.activeSegment ?? this.segments[this.segmentIndex];
  }

  private beginWaypoint(segment: TrajectorySegment): void {
    const waypoint = segment.edge?.synchronousWaypoints[this.activeWaypointIndex];
    if (!waypoint) {
      throw new Error(`Trajectory segment ${segment.id} is missing a waypoint.`);
    }
    this.robotController.beginPoseMove(
      waypoint,
      legacyWaypointDuration(
        this.robotController.getAngles(),
        waypoint,
        this.robotController,
      ),
      this.maxEndEffectorStep === undefined
        ? {}
        : { maxEndEffectorStep: this.maxEndEffectorStep },
    );
    this.contactEndEffector = this.robotController.getPose().endEffector;
  }

  private completeSegment(hooks: TrajectoryExecutorHooks): void {
    const segment = this.activeSegment;
    if (!segment) {
      throw new Error('Trajectory segment state is missing.');
    }
    hooks.onSegmentComplete?.(segment, this.segmentIndex);
    this.segmentIndex += 1;
    this.activeSegment = undefined;
    this.activeWaypointIndex = 0;
    this.activeWait = undefined;
    this.contactEndEffector = undefined;
  }
}

export interface TrajectoryReplayResult {
  status: 'completed' | 'error';
  hairVoxels: ReadonlySet<VoxelKey>;
  jointAngles: Readonly<Record<JointId, number>>;
  elapsedMs: number;
  error?: string;
  blockId?: string;
}

/** Replay a synchronous plan without Three.js or React. */
export function replaySynchronizedTrajectory(
  plan: TrajectoryPlan,
  challenge: Challenge,
  tickMs = 16,
): TrajectoryReplayResult {
  const controller = constrainedController(challenge);
  const executor = new TrajectoryExecutor(
    controller,
    challenge.voxelConfig.size / 4,
  );
  executor.load(plan);
  let hairVoxels = new Set(challenge.initialHair.voxels);
  let elapsedMs = 0;

  for (let ticks = 0; ticks < 100_000; ticks += 1) {
    const result = executor.advance(tickMs);
    elapsedMs += result.consumedMs;
    if (result.blockedCollision) {
      return failure(
        hairVoxels,
        controller,
        elapsedMs,
        `${result.blockedCollision.partLabel} would contact the head.`,
        executor.getCurrentSegment()?.sourceBlockId,
      );
    }
    for (const movement of result.movements) {
      const hits = findSweptVoxelHits(
        movement.previousEndEffector,
        movement.currentEndEffector,
        hairVoxels,
        challenge.voxelConfig,
        challenge.robotConfig.geometry.toolRadius,
      );
      if (hits.length === 0) {
        continue;
      }
      if (!movement.segment.cutterEnabled) {
        return failure(
          hairVoxels,
          controller,
          elapsedMs,
          'Hover or transit motion would contact hair.',
          movement.segment.sourceBlockId,
        );
      }
      hairVoxels = removeHits(hairVoxels, hits);
    }
    if (result.planCompleted) {
      return {
        status: 'completed',
        hairVoxels,
        jointAngles: controller.getAngles(),
        elapsedMs,
      };
    }
  }
  return failure(hairVoxels, controller, elapsedMs, 'Synchronized trajectory exceeded its tick budget.');
}

/** Replays the exact legacy Program semantics used by the current backend. */
export function replayLegacyCommands(
  commands: readonly RobotCommand[],
  challenge: Challenge,
  tickMs = 16,
): TrajectoryReplayResult {
  if (!Number.isFinite(tickMs) || tickMs <= 0) {
    throw new Error('Legacy replay tick must be a positive finite number.');
  }
  const controller = constrainedController(challenge);
  let hairVoxels = new Set(challenge.initialHair.voxels);
  let elapsedMs = 0;
  for (const command of commands) {
    if (command.type === 'wait') {
      elapsedMs += command.durationMs;
      continue;
    }
    controller.beginMove(command.jointId, command.angleDeg);
    for (let ticks = 0; controller.hasActiveMove(); ticks += 1) {
      if (ticks > 100_000) {
        return failure(
          hairVoxels,
          controller,
          elapsedMs,
          'Legacy trajectory exceeded its tick budget.',
          command.sourceBlockId,
        );
      }
      const movement = controller.advanceMove(tickMs);
      elapsedMs += movement.consumedMs;
      if (movement.blockedCollision) {
        return failure(
          hairVoxels,
          controller,
          elapsedMs,
          `${movement.blockedCollision.partLabel} would contact the head.`,
          command.sourceBlockId,
        );
      }
      hairVoxels = removePathHits(
        movement.previousEndEffector,
        movement.endEffectorPath,
        hairVoxels,
        challenge,
      );
    }
  }
  return {
    status: 'completed',
    hairVoxels,
    jointAngles: controller.getAngles(),
    elapsedMs,
  };
}

export function legacyWaypointDuration(
  start: Readonly<Record<JointId, number>>,
  target: Readonly<Record<JointId, number>>,
  controller: RobotController,
): number {
  return legacyDurationForJoints(start, target, controller.getJointConfigs());
}

export function legacyDurationForJoints(
  start: Readonly<Record<JointId, number>>,
  target: Readonly<Record<JointId, number>>,
  joints: readonly Challenge['robotConfig']['joints'][number][],
): number {
  let durationMs = 0;
  for (const joint of joints) {
    durationMs +=
      (Math.abs(target[joint.id] - start[joint.id]) / joint.speedDegPerSec) *
      1000;
  }
  return durationMs;
}

export interface CompatibilityVerification {
  valid: boolean;
  synchronized: TrajectoryReplayResult;
  legacy: TrajectoryReplayResult;
  error?: string;
}

/**
 * The only legal submission is one whose player-facing synchronized animation
 * and frozen sequential Program IR produce identical gameplay state.
 */
export function verifyScalpCompatibility(
  plan: TrajectoryPlan,
  commands: readonly RobotCommand[],
  challenge: Challenge,
): CompatibilityVerification {
  const synchronized = replaySynchronizedTrajectory(plan, challenge);
  const legacy = replayLegacyCommands(commands, challenge);
  if (synchronized.status !== legacy.status) {
    return { valid: false, synchronized, legacy, error: 'Synchronized and legacy replays have different terminal states.' };
  }
  if (synchronized.status !== 'completed') {
    return { valid: false, synchronized, legacy, error: synchronized.error ?? legacy.error ?? 'The trajectory did not complete.' };
  }
  if (!setsEqual(synchronized.hairVoxels, legacy.hairVoxels)) {
    return { valid: false, synchronized, legacy, error: 'Synchronized and legacy replays remove different hair voxels.' };
  }
  if (!anglesEqual(synchronized.jointAngles, legacy.jointAngles)) {
    return { valid: false, synchronized, legacy, error: 'Synchronized and legacy replays finish at different joint poses.' };
  }
  if (Math.abs(synchronized.elapsedMs - legacy.elapsedMs) > 1e-6) {
    return { valid: false, synchronized, legacy, error: 'Synchronized and legacy replays have different scoring durations.' };
  }
  return { valid: true, synchronized, legacy };
}

function constrainedController(challenge: Challenge): RobotController {
  return new RobotController(
    challenge.robotConfig,
    (pose) =>
      findRobotHeadCollision(
        pose,
        challenge.voxelConfig,
        challenge.robotConfig.geometry,
      ),
  );
}

function removeHits(
  voxels: ReadonlySet<VoxelKey>,
  hits: readonly VoxelKey[],
): Set<VoxelKey> {
  const next = new Set(voxels);
  hits.forEach((key) => next.delete(key));
  return next;
}

function toMovements(
  segment: TrajectorySegment,
  start: Vec3Tuple,
  path: readonly Vec3Tuple[],
): TrajectoryMovement[] {
  let previous = start;
  return path.flatMap((currentEndEffector) => {
    if (pointsEqual(previous, currentEndEffector)) {
      return [];
    }
    const item = { segment, previousEndEffector: previous, currentEndEffector };
    previous = currentEndEffector;
    return [item];
  });
}

function failure(
  hairVoxels: ReadonlySet<VoxelKey>,
  controller: RobotController,
  elapsedMs: number,
  error: string,
  blockId?: string,
): TrajectoryReplayResult {
  return {
    status: 'error',
    hairVoxels,
    jointAngles: controller.getAngles(),
    elapsedMs,
    error,
    ...(blockId ? { blockId } : {}),
  };
}

function setsEqual(left: ReadonlySet<VoxelKey>, right: ReadonlySet<VoxelKey>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function anglesEqual(
  left: Readonly<Record<JointId, number>>,
  right: Readonly<Record<JointId, number>>,
): boolean {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...ids].every((id) => Math.abs((left[id] ?? 0) - (right[id] ?? 0)) <= 1e-6);
}

function removePathHits(
  start: Vec3Tuple,
  path: readonly Vec3Tuple[],
  voxels: ReadonlySet<VoxelKey>,
  challenge: Challenge,
): Set<VoxelKey> {
  let next = new Set(voxels);
  let previous = start;
  for (const current of path) {
    const hits = findSweptVoxelHits(
      previous,
      current,
      next,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    );
    next = removeHits(next, hits);
    previous = current;
  }
  return next;
}

function pointsEqual(left: Vec3Tuple, right: Vec3Tuple): boolean {
  return (
    Math.abs(left[0] - right[0]) < Number.EPSILON &&
    Math.abs(left[1] - right[1]) < Number.EPSILON &&
    Math.abs(left[2] - right[2]) < Number.EPSILON
  );
}
