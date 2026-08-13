import type { CutterTrajectoryPlanV1, CutterTrajectoryPlanV2, CutterTrajectoryStepV1 } from '../cutter-grid/types';
import { interpolateCutterTrajectoryJointAngles } from '../cutter-grid/trajectory';
import type { RobotController, MoveAdvanceResult } from '../robot/RobotController';

export interface CutterTrajectoryExecutorHooks {
  onStepStart?: (step: CutterTrajectoryStepV1, index: number) => void;
  onStepComplete?: (step: CutterTrajectoryStepV1, index: number) => void;
  onMovement?: (movement: MoveAdvanceResult) => void;
}

export interface CutterTrajectoryAdvanceResult {
  consumedMs: number;
  stepsCompleted: number;
  planCompleted: boolean;
}

export class CutterTrajectoryExecutor {
  private plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | undefined;
  private stepIndex = 0;
  private elapsedInStepMs = 0;
  private waypointIndex = 0;
  private stepStarted = false;

  constructor(private readonly robotController: RobotController) {}

  load(plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2): void {
    this.plan = plan;
    this.stepIndex = 0;
    this.elapsedInStepMs = 0;
    this.waypointIndex = 0;
    this.stepStarted = false;
  }

  reset(): void {
    this.plan = undefined;
    this.stepIndex = 0;
    this.elapsedInStepMs = 0;
    this.waypointIndex = 0;
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

  getCurrentStep(): CutterTrajectoryStepV1 | undefined {
    return this.plan?.steps[this.stepIndex];
  }

  getPlan(): CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | undefined {
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
    if (movement.moved) hooks.onMovement?.(movement);
  }

  private replayWaypointsThrough(
    step: CutterTrajectoryStepV1,
    targetTimeMs: number,
    hooks: CutterTrajectoryExecutorHooks,
  ): void {
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

  private nextStepRequiresTime(): boolean {
    const next = this.plan?.steps[this.stepIndex];
    return (next?.durationMs ?? 0) > 0;
  }
}
