import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import {
  computeRobotPose,
  createInitialJointAngles,
  type RobotPose,
} from './kinematics';
import type {
  BlockedHeadCollision,
  HeadCollision,
} from './headCollision';

const MAX_ANGULAR_STEP_DEG = 0.5;
const COLLISION_BISECTION_STEPS = 12;

export type PoseConstraint = (
  pose: RobotPose,
) => HeadCollision | undefined;

interface ActiveMove {
  jointId: JointId;
  startAngleDeg: number;
  targetAngleDeg: number;
  durationMs: number;
  elapsedMs: number;
}

interface ActivePoseMove {
  startAngles: Record<JointId, number>;
  targetAngles: Record<JointId, number>;
  durationMs: number;
  elapsedMs: number;
  maxEndEffectorStep?: number;
}

export interface MoveAdvanceResult {
  consumedMs: number;
  completed: boolean;
  moved: boolean;
  previousEndEffector: Vec3Tuple;
  currentEndEffector: Vec3Tuple;
  blockedCollision?: BlockedHeadCollision;
}

export interface BlockedPoseCollision extends HeadCollision {
  safeProgress: number;
  safeAngles: Readonly<Record<JointId, number>>;
}

export interface PoseMoveAdvanceResult {
  consumedMs: number;
  completed: boolean;
  moved: boolean;
  previousEndEffector: Vec3Tuple;
  currentEndEffector: Vec3Tuple;
  blockedCollision?: BlockedPoseCollision;
}

export class RobotController {
  private readonly configById: Map<
    JointId,
    Challenge['robotConfig']['joints'][number]
  >;
  private jointAngles: Record<JointId, number>;
  private activeMove: ActiveMove | undefined;
  private activePoseMove: ActivePoseMove | undefined;

  constructor(
    private readonly robotConfig: Challenge['robotConfig'],
    private readonly poseConstraint?: PoseConstraint,
  ) {
    this.configById = new Map(
      robotConfig.joints.map((joint) => [joint.id, joint]),
    );
    this.jointAngles = createInitialJointAngles(robotConfig);
  }

  reset(): void {
    this.jointAngles = createInitialJointAngles(this.robotConfig);
    this.activeMove = undefined;
    this.activePoseMove = undefined;
  }

  beginMove(jointId: JointId, targetAngleDeg: number): void {
    this.activePoseMove = undefined;
    const config = this.configById.get(jointId);
    if (!config) {
      throw new Error(`Unknown joint "${jointId}".`);
    }
    if (
      !Number.isFinite(targetAngleDeg) ||
      targetAngleDeg < config.minAngleDeg ||
      targetAngleDeg > config.maxAngleDeg
    ) {
      throw new Error(
        `Angle ${targetAngleDeg} is outside the range for "${jointId}".`,
      );
    }

    const startAngleDeg = this.jointAngles[jointId];
    this.activeMove = {
      jointId,
      startAngleDeg,
      targetAngleDeg,
      durationMs:
        (Math.abs(targetAngleDeg - startAngleDeg) /
          config.speedDegPerSec) *
        1000,
      elapsedMs: 0,
    };
  }

  advanceMove(deltaMs: number): MoveAdvanceResult {
    if (this.activePoseMove) {
      throw new Error('A synchronized pose move is active.');
    }
    if (!this.activeMove) {
      throw new Error('No active robot move.');
    }
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error('Delta must be a finite non-negative number.');
    }

    const move = this.activeMove;
    const previousPose = this.getPose();
    const previousEndEffector = previousPose.endEffector;
    const remainingMs = Math.max(0, move.durationMs - move.elapsedMs);
    const consumedMs = Math.min(deltaMs, remainingMs);
    const targetElapsedMs = move.elapsedMs + consumedMs;
    const targetProgress =
      move.durationMs === 0 ? 1 : targetElapsedMs / move.durationMs;
    const targetAngle =
      move.startAngleDeg +
      (move.targetAngleDeg - move.startAngleDeg) * targetProgress;
    const blockedCollision = this.advanceAngleWithConstraint(
      move.jointId,
      this.jointAngles[move.jointId],
      targetAngle,
    );

    if (blockedCollision) {
      const safeProgress =
        move.durationMs === 0
          ? 1
          : (blockedCollision.safeAngleDeg - move.startAngleDeg) /
            (move.targetAngleDeg - move.startAngleDeg);
      const safeElapsedMs =
        move.durationMs *
        Math.min(1, Math.max(0, safeProgress));
      const safeConsumedMs = Math.max(
        0,
        safeElapsedMs - move.elapsedMs,
      );
      move.elapsedMs = safeElapsedMs;
      const currentEndEffector = this.getPose().endEffector;

      return {
        consumedMs: safeConsumedMs,
        completed: false,
        moved: !pointsEqual(
          previousEndEffector,
          currentEndEffector,
        ),
        previousEndEffector,
        currentEndEffector,
        blockedCollision,
      };
    }

    move.elapsedMs = targetElapsedMs;
    const currentEndEffector = this.getPose().endEffector;
    const completed = targetProgress >= 1;
    if (completed) {
      this.jointAngles[move.jointId] = move.targetAngleDeg;
      this.activeMove = undefined;
    }

    return {
      consumedMs,
      completed,
      moved: !pointsEqual(previousEndEffector, currentEndEffector),
      previousEndEffector,
      currentEndEffector,
    };
  }

  getAngles(): Readonly<Record<JointId, number>> {
    return { ...this.jointAngles };
  }

  getJointConfigs(): readonly Challenge['robotConfig']['joints'][number][] {
    return this.robotConfig.joints;
  }

  getPose(): RobotPose {
    return computeRobotPose(this.robotConfig, this.jointAngles);
  }

  hasActiveMove(): boolean {
    return this.activeMove !== undefined || this.activePoseMove !== undefined;
  }

  /**
   * Starts a synchronized move. Every joint progresses over the same normalized
   * time, while the caller supplies a duration derived from the exported legacy
   * Program IR so visual timing and server scoring stay aligned.
   */
  beginPoseMove(
    targetAngles: Readonly<Record<JointId, number>>,
    durationMs: number,
    options: { maxEndEffectorStep?: number } = {},
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Pose move duration must be a finite non-negative number.');
    }
    if (
      options.maxEndEffectorStep !== undefined &&
      (!Number.isFinite(options.maxEndEffectorStep) ||
        options.maxEndEffectorStep <= 0)
    ) {
      throw new Error('Maximum end-effector step must be a positive finite number.');
    }
    this.validatePoseAngles(targetAngles);
    this.activeMove = undefined;
    this.activePoseMove = {
      startAngles: { ...this.jointAngles },
      targetAngles: { ...targetAngles },
      durationMs,
      elapsedMs: 0,
      ...(options.maxEndEffectorStep !== undefined
        ? { maxEndEffectorStep: options.maxEndEffectorStep }
        : {}),
    };
  }

  advancePoseMove(deltaMs: number): PoseMoveAdvanceResult {
    const move = this.activePoseMove;
    if (!move) {
      throw new Error('No active synchronized pose move.');
    }
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error('Delta must be a finite non-negative number.');
    }

    const previousEndEffector = this.getPose().endEffector;
    const remainingMs = Math.max(0, move.durationMs - move.elapsedMs);
    const consumedMs = Math.min(deltaMs, remainingMs);
    const startProgress = move.durationMs === 0 ? 1 : move.elapsedMs / move.durationMs;
    const targetElapsedMs = move.elapsedMs + consumedMs;
    const targetProgress = move.durationMs === 0 ? 1 : targetElapsedMs / move.durationMs;
    const blockedCollision = this.advancePoseWithConstraint(
      move.startAngles,
      move.targetAngles,
      startProgress,
      targetProgress,
      move.maxEndEffectorStep,
    );

    if (blockedCollision) {
      const safeElapsedMs = move.durationMs * blockedCollision.safeProgress;
      const safeConsumedMs = Math.max(0, safeElapsedMs - move.elapsedMs);
      move.elapsedMs = safeElapsedMs;
      const currentEndEffector = this.getPose().endEffector;
      return {
        consumedMs: safeConsumedMs,
        completed: false,
        moved: !pointsEqual(previousEndEffector, currentEndEffector),
        previousEndEffector,
        currentEndEffector,
        blockedCollision,
      };
    }

    move.elapsedMs = targetElapsedMs;
    const currentEndEffector = this.getPose().endEffector;
    const completed = targetProgress >= 1;
    if (completed) {
      this.jointAngles = { ...move.targetAngles };
      this.activePoseMove = undefined;
    }
    return {
      consumedMs,
      completed,
      moved: !pointsEqual(previousEndEffector, currentEndEffector),
      previousEndEffector,
      currentEndEffector,
    };
  }

  private advanceAngleWithConstraint(
    jointId: JointId,
    startAngleDeg: number,
    targetAngleDeg: number,
  ): BlockedHeadCollision | undefined {
    if (!this.poseConstraint) {
      this.jointAngles[jointId] = targetAngleDeg;
      return undefined;
    }

    const deltaAngle = targetAngleDeg - startAngleDeg;
    const stepCount = Math.max(
      1,
      Math.ceil(Math.abs(deltaAngle) / MAX_ANGULAR_STEP_DEG),
    );
    let lastSafeAngle = startAngleDeg;

    for (let index = 1; index <= stepCount; index += 1) {
      const candidateAngle =
        startAngleDeg + deltaAngle * (index / stepCount);
      this.jointAngles[jointId] = candidateAngle;
      const collision = this.poseConstraint(this.getPose());

      if (!collision) {
        lastSafeAngle = candidateAngle;
        continue;
      }

      let safeAngle = lastSafeAngle;
      let collidingAngle = candidateAngle;
      let boundaryCollision = collision;
      for (
        let iteration = 0;
        iteration < COLLISION_BISECTION_STEPS;
        iteration += 1
      ) {
        const midpoint = (safeAngle + collidingAngle) / 2;
        this.jointAngles[jointId] = midpoint;
        const midpointCollision = this.poseConstraint(this.getPose());
        if (midpointCollision) {
          collidingAngle = midpoint;
          boundaryCollision = midpointCollision;
        } else {
          safeAngle = midpoint;
        }
      }

      this.jointAngles[jointId] = safeAngle;
      return {
        ...boundaryCollision,
        jointId,
        safeAngleDeg: safeAngle,
      };
    }

    return undefined;
  }

  private advancePoseWithConstraint(
    startAngles: Readonly<Record<JointId, number>>,
    targetAngles: Readonly<Record<JointId, number>>,
    startProgress: number,
    targetProgress: number,
    maxEndEffectorStep?: number,
  ): BlockedPoseCollision | undefined {
    if (!this.poseConstraint) {
      this.jointAngles = interpolateAngles(startAngles, targetAngles, targetProgress);
      return undefined;
    }

    const delta = Math.max(
      ...this.robotConfig.joints.map((joint) =>
        Math.abs(targetAngles[joint.id] - startAngles[joint.id]),
      ),
    );
    const startEndEffector = computeRobotPose(
      this.robotConfig,
      startAngles,
    ).endEffector;
    const targetEndEffector = computeRobotPose(
      this.robotConfig,
      targetAngles,
    ).endEffector;
    const spatialStepCount =
      maxEndEffectorStep === undefined
        ? 1
        : Math.ceil(
            distance(startEndEffector, targetEndEffector) /
              maxEndEffectorStep,
          );
    const fullStepCount = Math.max(
      1,
      Math.ceil(delta / MAX_ANGULAR_STEP_DEG),
      spatialStepCount,
    );
    const span = Math.max(0, targetProgress - startProgress);
    const stepCount = Math.max(1, Math.ceil(fullStepCount * span));
    let lastSafeProgress = startProgress;

    for (let index = 1; index <= stepCount; index += 1) {
      const progress = startProgress + span * (index / stepCount);
      this.jointAngles = interpolateAngles(startAngles, targetAngles, progress);
      const collision = this.poseConstraint(this.getPose());
      if (!collision) {
        lastSafeProgress = progress;
        continue;
      }

      let safeProgress = lastSafeProgress;
      let collidingProgress = progress;
      let boundaryCollision = collision;
      for (let iteration = 0; iteration < COLLISION_BISECTION_STEPS; iteration += 1) {
        const midpoint = (safeProgress + collidingProgress) / 2;
        this.jointAngles = interpolateAngles(startAngles, targetAngles, midpoint);
        const midpointCollision = this.poseConstraint(this.getPose());
        if (midpointCollision) {
          collidingProgress = midpoint;
          boundaryCollision = midpointCollision;
        } else {
          safeProgress = midpoint;
        }
      }

      this.jointAngles = interpolateAngles(startAngles, targetAngles, safeProgress);
      return {
        ...boundaryCollision,
        safeProgress,
        safeAngles: this.getAngles(),
      };
    }
    return undefined;
  }

  private validatePoseAngles(
    targetAngles: Readonly<Record<JointId, number>>,
  ): void {
    for (const joint of this.robotConfig.joints) {
      const target = targetAngles[joint.id];
      if (
        !Number.isFinite(target) ||
        target < joint.minAngleDeg ||
        target > joint.maxAngleDeg
      ) {
        throw new Error(
          `Angle ${target} is outside the range for "${joint.id}".`,
        );
      }
    }
    for (const jointId of Object.keys(targetAngles)) {
      if (!this.configById.has(jointId)) {
        throw new Error(`Unknown joint "${jointId}".`);
      }
    }
  }
}

function interpolateAngles(
  startAngles: Readonly<Record<JointId, number>>,
  targetAngles: Readonly<Record<JointId, number>>,
  progress: number,
): Record<JointId, number> {
  return Object.fromEntries(
    Object.keys(startAngles).map((jointId) => [
      jointId,
      startAngles[jointId] +
        (targetAngles[jointId] - startAngles[jointId]) * progress,
    ]),
  );
}

function pointsEqual(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return (
    Math.abs(a[0] - b[0]) < Number.EPSILON &&
    Math.abs(a[1] - b[1]) < Number.EPSILON &&
    Math.abs(a[2] - b[2]) < Number.EPSILON
  );
}

function distance(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
