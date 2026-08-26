import type {
  CutterGridPositioningMotionV3,
  CutterTrajectoryPlanV3,
  CutterTrajectoryStepV3,
  CutterTrajectoryWaypointV3,
} from './types';

/**
 * Compact, JSON-safe V3 result used by the frontend/Rust conformance bundle.
 * Full certified sample arrays are covered by trajectorySignature; this keeps
 * the fixture reviewable while still detecting any divergence in Rust replay.
 */
export interface CutterGridTrajectoryConformanceSummaryV3 {
  version: 3;
  plannerVersion: CutterTrajectoryPlanV3['plannerVersion'];
  challengeSignature: string;
  entryOptionId: string;
  geometrySignature: string;
  motionLimitsSignature: string;
  trajectorySignature: string;
  startCoord: readonly [number, number, number];
  endCoord: readonly [number, number, number];
  executedCommandCount: number;
  estimatedDurationMs: number;
  expectedResultVoxels: string[];
  diagnostics: CutterTrajectoryPlanV3['diagnostics'];
  positioning: CutterGridPositioningConformanceSummaryV3;
  steps: CutterGridStepConformanceSummaryV3[];
}

export interface CutterGridPositioningConformanceSummaryV3 {
  durationMs: number;
  interpolation: CutterGridPositioningMotionV3['motion']['interpolation'];
  geometryConstraintResolution?: 'minimum-jerk' | 'monotone-c2-fallback';
  knotCount: number;
  start: CutterGridWaypointConformanceSummaryV3;
  end: CutterGridWaypointConformanceSummaryV3;
}

export interface CutterGridStepConformanceSummaryV3 {
  index: number;
  kind: CutterTrajectoryStepV3['kind'];
  sourceBlockId: string;
  startCoord: readonly [number, number, number];
  endCoord: readonly [number, number, number];
  durationMs: number;
  interpolation: CutterTrajectoryStepV3['motion']['interpolation'];
  geometryConstraintResolution?: 'minimum-jerk' | 'monotone-c2-fallback';
  knotCount: number;
  expectedCutVoxels: string[];
  start: CutterGridWaypointConformanceSummaryV3;
  end: CutterGridWaypointConformanceSummaryV3;
}

export interface CutterGridWaypointConformanceSummaryV3 {
  timeMs: number;
  jointAngles: Record<string, number>;
  jointVelocitiesDegPerSec: Record<string, number>;
  jointAccelerationsDegPerSec2: Record<string, number>;
  jointJerksDegPerSec3: Record<string, number>;
  endEffector: readonly [number, number, number];
}

export function cutterGridTrajectoryConformanceSummaryV3(
  plan: CutterTrajectoryPlanV3,
): CutterGridTrajectoryConformanceSummaryV3 {
  return {
    version: plan.version,
    plannerVersion: plan.plannerVersion,
    challengeSignature: plan.challengeSignature,
    entryOptionId: plan.entryOptionId,
    geometrySignature: plan.geometrySignature,
    motionLimitsSignature: plan.motionLimitsSignature,
    trajectorySignature: plan.trajectorySignature,
    startCoord: [...plan.startCoord] as [number, number, number],
    endCoord: [...plan.endCoord] as [number, number, number],
    executedCommandCount: plan.executedCommandCount,
    estimatedDurationMs: plan.estimatedDurationMs,
    expectedResultVoxels: [...plan.expectedResultVoxels],
    diagnostics: canonicalJsonValue(plan.diagnostics),
    positioning: positioningSummary(plan.positioningMotion),
    steps: plan.steps.map(stepSummary),
  };
}

function positioningSummary(
  positioning: CutterGridPositioningMotionV3,
): CutterGridPositioningConformanceSummaryV3 {
  const start = positioning.waypoints[0];
  const end = positioning.waypoints.at(-1);
  if (!start || !end) throw new Error('Cutter Grid V3 positioning motion has no checkpoints.');
  return {
    durationMs: positioning.durationMs,
    interpolation: positioning.motion.interpolation,
    geometryConstraintResolution: positioning.motion.geometry?.constraintResolution,
    knotCount: positioning.motion.geometry?.knots.length ?? 0,
    start: waypointSummary(start),
    end: waypointSummary(end),
  };
}

function stepSummary(step: CutterTrajectoryStepV3): CutterGridStepConformanceSummaryV3 {
  const start = step.waypoints[0];
  const end = step.waypoints.at(-1);
  if (!start || !end) throw new Error(`Cutter Grid V3 step ${step.index} has no checkpoints.`);
  return {
    index: step.index,
    kind: step.kind,
    sourceBlockId: step.sourceBlockId,
    startCoord: [...step.startCoord] as [number, number, number],
    endCoord: [...step.endCoord] as [number, number, number],
    durationMs: step.durationMs,
    interpolation: step.motion.interpolation,
    geometryConstraintResolution: step.motion.geometry?.constraintResolution,
    knotCount: step.motion.geometry?.knots.length ?? 0,
    expectedCutVoxels: [...step.expectedCutVoxels],
    start: waypointSummary(start),
    end: waypointSummary(end),
  };
}

function waypointSummary(
  waypoint: CutterTrajectoryWaypointV3,
): CutterGridWaypointConformanceSummaryV3 {
  return {
    timeMs: waypoint.timeMs,
    jointAngles: canonicalNumberRecord(waypoint.jointAngles),
    jointVelocitiesDegPerSec: canonicalNumberRecord(waypoint.jointVelocitiesDegPerSec),
    jointAccelerationsDegPerSec2: canonicalNumberRecord(waypoint.jointAccelerationsDegPerSec2),
    jointJerksDegPerSec3: canonicalNumberRecord(waypoint.jointJerksDegPerSec3),
    endEffector: waypoint.endEffector.map(canonicalNumber) as [number, number, number],
  };
}

function canonicalNumberRecord(record: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, canonicalNumber(value)]));
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function canonicalJsonValue<T>(value: T): T {
  if (typeof value === 'number') return canonicalNumber(value) as T;
  if (Array.isArray(value)) return value.map(canonicalJsonValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      canonicalJsonValue(item),
    ])) as T;
  }
  return value;
}
