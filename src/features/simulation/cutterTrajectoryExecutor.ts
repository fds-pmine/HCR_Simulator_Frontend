import type {
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryStepV1,
  CutterTrajectoryStepV3,
} from '../cutter-grid/types';
import { evaluateCutterTrajectoryStepV3At } from '../cutter-grid/motionV3';
import { interpolateCutterTrajectoryJointAngles } from '../cutter-grid/trajectory';
import type { RobotController, MoveAdvanceResult } from '../robot/RobotController';
import type { Challenge, VoxelKey } from '../../types/domain';

export interface CutterTrajectoryExecutorHooks {
  onStepStart?: (step: CutterTrajectoryStepV1, index: number) => void;
  onStepComplete?: (step: CutterTrajectoryStepV1, index: number) => void;
  onMovement?: (movement: MoveAdvanceResult) => void;
  /** Dense Worker-side certification supplied these cuts for sparse Ruckig replay. */
  onCertifiedContacts?: (voxelKeys: readonly VoxelKey[]) => void;
}

export interface CutterTrajectoryAdvanceResult {
  consumedMs: number;
  stepsCompleted: number;
  planCompleted: boolean;
}

export class CutterTrajectoryExecutor {
  private plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | undefined;
  private stepIndex = 0;
  private elapsedInStepMs = 0;
  private waypointIndex = 0;
  private contactEventIndex = 0;
  private stepStarted = false;

  constructor(
    private readonly robotController: RobotController,
    private readonly challenge: Challenge,
  ) {}

  load(plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3): void {
    this.plan = plan;
    this.stepIndex = 0;
    this.elapsedInStepMs = 0;
    this.waypointIndex = 0;
    this.contactEventIndex = 0;
    this.stepStarted = false;
  }

  reset(): void {
    this.plan = undefined;
    this.stepIndex = 0;
    this.elapsedInStepMs = 0;
    this.waypointIndex = 0;
    this.contactEventIndex = 0;
    this.stepStarted = false;
  }

  advance(
    deltaMs: number,
    hooks: CutterTrajectoryExecutorHooks = {},
    maxStepsToComplete = Number.POSITIVE_INFINITY,
  ): CutterTrajectoryAdvanceResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error('Delta must be a finite non-negative number.');
    }
    const plan = this.plan;
    if (!plan) throw new Error('No Cutter Grid trajectory is loaded.');
    let remainingMs = deltaMs;
    let consumedMs = 0;
    let stepsCompleted = 0;

    while (
      this.stepIndex < plan.steps.length &&
      stepsCompleted < maxStepsToComplete
    ) {
      const step = plan.steps[this.stepIndex];
      if (!this.stepStarted) {
        this.stepStarted = true;
        hooks.onStepStart?.(step, this.stepIndex);
        this.applyInitialWaypoint(step, hooks);
      }
      const stepRemaining = Math.max(0, step.durationMs - this.elapsedInStepMs);
      const consumed = Math.min(remainingMs, stepRemaining);
      const targetTime = this.elapsedInStepMs + consumed;
      this.replayWaypointsThrough(step, targetTime, hooks);
      this.elapsedInStepMs = targetTime;
      consumedMs += consumed;
      remainingMs -= consumed;

      if (this.elapsedInStepMs < step.durationMs) break;
      hooks.onStepComplete?.(step, this.stepIndex);
      this.stepIndex += 1;
      this.elapsedInStepMs = 0;
      this.waypointIndex = 0;
      this.contactEventIndex = 0;
      this.stepStarted = false;
      stepsCompleted += 1;
      if (remainingMs === 0 && this.nextStepRequiresTime()) break;
    }
    return {
      consumedMs,
      stepsCompleted,
      planCompleted: this.stepIndex >= plan.steps.length,
    };
  }

  getStepIndex(): number {
    return this.stepIndex;
  }

  getCurrentStep(): CutterTrajectoryStepV1 | CutterTrajectoryStepV3 | undefined {
    return this.plan?.steps[this.stepIndex];
  }

  getPlan(): CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | undefined {
    return this.plan;
  }

  getElapsedInStepMs(): number {
    return this.elapsedInStepMs;
  }

  private applyInitialWaypoint(
    step: CutterTrajectoryStepV1,
    hooks: CutterTrajectoryExecutorHooks,
  ): void {
    const first = step.waypoints[0];
    if (!first) return;
    const movement = this.robotController.setTrajectoryAngles(first.jointAngles);
    if (movement.moved && !hasPrecertifiedContacts(step)) hooks.onMovement?.(movement);
  }

  private replayWaypointsThrough(
    step: CutterTrajectoryStepV1 | CutterTrajectoryStepV3,
    targetTimeMs: number,
    hooks: CutterTrajectoryExecutorHooks,
  ): void {
    if (this.plan?.version === 3) {
      // A V3 plan was certified at these waypoints.  Traverse every crossed
      // interval before sampling the fractional tail, so voxel sweeps and
      // collision observations stay invariant when a browser drops frames.
      // Evaluating only the final rAF time would turn a curved joint-space
      // segment into one long chord and make cutting depend on frame cadence.
      while (
        this.waypointIndex + 1 < step.waypoints.length &&
        step.waypoints[this.waypointIndex + 1].timeMs <= targetTimeMs
      ) {
        this.waypointIndex += 1;
        const certified = step.waypoints[this.waypointIndex];
        const movement = this.robotController.setTrajectoryAngles(certified.jointAngles);
        if (movement.moved && !hasPrecertifiedContacts(step)) hooks.onMovement?.(movement);
      }
      const certified = step.waypoints[this.waypointIndex];
      if (!certified || targetTimeMs <= certified.timeMs) {
        this.replayPrecertifiedContactsThrough(step as CutterTrajectoryStepV3, targetTimeMs, hooks);
        return;
      }
      const waypoint = evaluateCutterTrajectoryStepV3At(
        this.challenge,
        step as CutterTrajectoryStepV3,
        targetTimeMs,
      );
      const movement = this.robotController.setTrajectoryAngles(waypoint.jointAngles);
      if (movement.moved && !hasPrecertifiedContacts(step)) hooks.onMovement?.(movement);
      this.replayPrecertifiedContactsThrough(step as CutterTrajectoryStepV3, targetTimeMs, hooks);
      return;
    }
    while (
      this.waypointIndex + 1 < step.waypoints.length &&
      step.waypoints[this.waypointIndex + 1].timeMs <= targetTimeMs
    ) {
      this.waypointIndex += 1;
      const waypoint = step.waypoints[this.waypointIndex];
      const movement = this.robotController.setTrajectoryAngles(
        waypoint.jointAngles,
      );
      if (movement.moved) hooks.onMovement?.(movement);
    }
    const previous = step.waypoints[this.waypointIndex];
    const next = step.waypoints[this.waypointIndex + 1];
    if (!previous || !next || targetTimeMs <= previous.timeMs) return;
    const jointAngles = interpolateCutterTrajectoryJointAngles(
      previous,
      next,
      targetTimeMs,
    );
    const movement = this.robotController.setTrajectoryAngles(jointAngles);
    if (movement.moved) hooks.onMovement?.(movement);
  }

  private replayPrecertifiedContactsThrough(
    step: CutterTrajectoryStepV3,
    targetTimeMs: number,
    hooks: CutterTrajectoryExecutorHooks,
  ): void {
    const events = step.certifiedContactEvents;
    if (!events) return;
    while (
      this.contactEventIndex < events.length &&
      events[this.contactEventIndex].timeMs <= targetTimeMs
    ) {
      hooks.onCertifiedContacts?.(events[this.contactEventIndex].voxelKeys);
      this.contactEventIndex += 1;
    }
  }

  private nextStepRequiresTime(): boolean {
    const next = this.plan?.steps[this.stepIndex];
    return (next?.durationMs ?? 0) > 0;
  }
}

function hasPrecertifiedContacts(
  step: CutterTrajectoryStepV1 | CutterTrajectoryStepV3,
): step is CutterTrajectoryStepV3 {
  return 'certifiedContactEvents' in step && step.certifiedContactEvents !== undefined;
}
