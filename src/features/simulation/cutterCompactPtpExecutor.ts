import type { Challenge, JointId, VoxelKey } from '../../types/domain';
import { evaluateCutterGridSyncPtpV4 } from '../cutter-grid/compactPtpV4';
import type {
  CutterGridContactEventV4,
  CutterGridSyncPtpPrimitiveV4,
  CutterGridTrajectoryActionV4,
  CutterTrajectoryPlanV4,
} from '../cutter-grid/types';

export interface CutterCompactPtpExecutorHooks {
  onPositioningSample?: (jointAngles: Readonly<Record<JointId, number>>) => void;
  onActionStart?: (action: CutterGridTrajectoryActionV4, index: number) => void;
  onActionComplete?: (action: CutterGridTrajectoryActionV4, index: number) => void;
  onCertifiedContacts?: (voxelKeys: readonly VoxelKey[]) => void;
  onActionSample?: (jointAngles: Readonly<Record<JointId, number>>) => void;
}

export interface CutterCompactPtpAdvanceResult {
  consumedMs: number;
  actionsCompleted: number;
  planCompleted: boolean;
}

/**
 * Replays a frozen V4 plan from its compact analytic primitives. This class
 * never reconstructs Cartesian layers or runs IK; the authoritative clock is
 * its accumulated plan time, not the render frame count.
 */
export class CutterCompactPtpExecutor {
  private plan: CutterTrajectoryPlanV4 | undefined;
  private positioningPrimitiveIndex = 0;
  private positioningElapsedMs = 0;
  private actionIndex = 0;
  private elapsedInActionMs = 0;
  private primitiveIndex = 0;
  private elapsedInPrimitiveMs = 0;
  private contactEventIndex = 0;
  private actionStarted = false;

  constructor(private readonly challenge: Challenge) {}

  load(plan: CutterTrajectoryPlanV4): void {
    this.plan = plan;
    this.positioningPrimitiveIndex = 0;
    this.positioningElapsedMs = 0;
    this.actionIndex = 0;
    this.elapsedInActionMs = 0;
    this.primitiveIndex = 0;
    this.elapsedInPrimitiveMs = 0;
    this.contactEventIndex = 0;
    this.actionStarted = false;
  }

  reset(): void {
    this.plan = undefined;
    this.positioningPrimitiveIndex = 0;
    this.positioningElapsedMs = 0;
    this.actionIndex = 0;
    this.elapsedInActionMs = 0;
    this.primitiveIndex = 0;
    this.elapsedInPrimitiveMs = 0;
    this.contactEventIndex = 0;
    this.actionStarted = false;
  }

  advancePositioning(
    deltaMs: number,
    hooks: CutterCompactPtpExecutorHooks = {},
  ): { consumedMs: number; completed: boolean } {
    const plan = this.requirePlan();
    assertDelta(deltaMs);
    let remainingMs = deltaMs;
    let consumedMs = 0;
    while (this.positioningPrimitiveIndex < plan.positioning.primitives.length) {
      const primitive = plan.positioning.primitives[this.positioningPrimitiveIndex];
      const primitiveRemaining = Math.max(0, primitive.durationMs - this.positioningElapsedMs);
      const consumed = Math.min(remainingMs, primitiveRemaining);
      const targetTimeMs = this.positioningElapsedMs + consumed;
      hooks.onPositioningSample?.(
        evaluateCutterGridSyncPtpV4(this.challenge, primitive, targetTimeMs).jointAngles,
      );
      this.positioningElapsedMs = targetTimeMs;
      consumedMs += consumed;
      remainingMs -= consumed;
      if (this.positioningElapsedMs < primitive.durationMs) break;
      this.positioningPrimitiveIndex += 1;
      this.positioningElapsedMs = 0;
      if (remainingMs === 0) break;
    }
    return {
      consumedMs,
      completed: this.positioningPrimitiveIndex >= plan.positioning.primitives.length,
    };
  }

  advance(
    deltaMs: number,
    hooks: CutterCompactPtpExecutorHooks = {},
    maxActionsToComplete = Number.POSITIVE_INFINITY,
  ): CutterCompactPtpAdvanceResult {
    const plan = this.requirePlan();
    assertDelta(deltaMs);
    let remainingMs = deltaMs;
    let consumedMs = 0;
    let actionsCompleted = 0;
    while (
      this.actionIndex < plan.actions.length &&
      actionsCompleted < maxActionsToComplete
    ) {
      const action = plan.actions[this.actionIndex];
      if (!this.actionStarted) {
        this.actionStarted = true;
        hooks.onActionStart?.(action, this.actionIndex);
      }
      const consumed = action.type === 'wait'
        ? this.advanceWait(action, remainingMs)
        : this.advanceMove(action, remainingMs, hooks);
      consumedMs += consumed;
      remainingMs -= consumed;

      if (!this.isCurrentActionComplete(action)) break;
      hooks.onActionComplete?.(action, this.actionIndex);
      this.actionIndex += 1;
      this.elapsedInActionMs = 0;
      this.primitiveIndex = 0;
      this.elapsedInPrimitiveMs = 0;
      this.contactEventIndex = 0;
      this.actionStarted = false;
      actionsCompleted += 1;
      if (remainingMs === 0) break;
    }
    return {
      consumedMs,
      actionsCompleted,
      planCompleted: this.actionIndex >= plan.actions.length,
    };
  }

  getPlan(): CutterTrajectoryPlanV4 | undefined {
    return this.plan;
  }

  getActionIndex(): number {
    return this.actionIndex;
  }

  getCurrentAction(): CutterGridTrajectoryActionV4 | undefined {
    return this.plan?.actions[this.actionIndex];
  }

  getElapsedInActionMs(): number {
    return this.elapsedInActionMs;
  }

  getPositioningElapsedMs(): number {
    return this.positioning.primitivesElapsedMs;
  }

  private get positioning(): { primitivesElapsedMs: number } {
    const plan = this.plan;
    if (!plan) return { primitivesElapsedMs: 0 };
    return {
      primitivesElapsedMs: plan.positioning.primitives
        .slice(0, this.positioningPrimitiveIndex)
        .reduce((sum, primitive) => sum + primitive.durationMs, 0) + this.positioningElapsedMs,
    };
  }

  private advanceWait(
    action: Extract<CutterGridTrajectoryActionV4, { type: 'wait' }>,
    remainingMs: number,
  ): number {
    const consumed = Math.min(remainingMs, Math.max(0, action.durationMs - this.elapsedInActionMs));
    this.elapsedInActionMs += consumed;
    return consumed;
  }

  private advanceMove(
    action: Extract<CutterGridTrajectoryActionV4, { type: 'move' }>,
    remainingMs: number,
    hooks: CutterCompactPtpExecutorHooks,
  ): number {
    let remaining = remainingMs;
    let consumedTotal = 0;
    while (this.primitiveIndex < action.primitives.length && remaining > 0) {
      const primitive = action.primitives[this.primitiveIndex];
      const primitiveRemaining = Math.max(0, primitive.durationMs - this.elapsedInPrimitiveMs);
      const consumed = Math.min(remaining, primitiveRemaining);
      const targetPrimitiveTimeMs = this.elapsedInPrimitiveMs + consumed;
      this.replayContactsThrough(action.contactEvents, this.elapsedInActionMs + consumed, hooks);
      hooks.onActionSample?.(
        evaluateCutterGridSyncPtpV4(this.challenge, primitive, targetPrimitiveTimeMs).jointAngles,
      );
      this.elapsedInPrimitiveMs = targetPrimitiveTimeMs;
      this.elapsedInActionMs += consumed;
      consumedTotal += consumed;
      remaining -= consumed;
      if (this.elapsedInPrimitiveMs < primitive.durationMs) break;
      this.primitiveIndex += 1;
      this.elapsedInPrimitiveMs = 0;
    }
    return consumedTotal;
  }

  private replayContactsThrough(
    events: readonly CutterGridContactEventV4[],
    targetTimeMs: number,
    hooks: CutterCompactPtpExecutorHooks,
  ): void {
    while (
      this.contactEventIndex < events.length &&
      events[this.contactEventIndex].timeMs <= targetTimeMs
    ) {
      hooks.onCertifiedContacts?.(events[this.contactEventIndex].voxelKeys);
      this.contactEventIndex += 1;
    }
  }

  private isCurrentActionComplete(action: CutterGridTrajectoryActionV4): boolean {
    return action.type === 'wait'
      ? this.elapsedInActionMs >= action.durationMs
      : this.primitiveIndex >= action.primitives.length;
  }

  private requirePlan(): CutterTrajectoryPlanV4 {
    if (!this.plan) throw new Error('No Cutter Grid V4 compact PTP plan is loaded.');
    return this.plan;
  }
}

export function cutterGridV4ActionDurationMs(action: CutterGridTrajectoryActionV4): number {
  return action.type === 'wait'
    ? action.durationMs
    : action.primitives.reduce((total, primitive) => total + primitive.durationMs, 0);
}

export function cutterGridV4PositioningDurationMs(
  primitives: readonly CutterGridSyncPtpPrimitiveV4[],
): number {
  return primitives.reduce((total, primitive) => total + primitive.durationMs, 0);
}

function assertDelta(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error('Delta must be a finite non-negative number.');
  }
}
