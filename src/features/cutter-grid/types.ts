import type { JointId, Vec3Tuple, VoxelKey } from '../../types/domain';

export const CUTTER_GRID_PLANNER_VERSION = 'cutter-grid-dls-v1';

/**
 * Declared in repair Phase 0 and intentionally not selected by the V1
 * execution path yet.  Later phases move Profile and trajectory production to
 * this version atomically; keeping the value separate prevents a V1 asset from
 * being accepted as a V2 asset during the migration.
 */
export const CUTTER_GRID_LADDER_PLANNER_VERSION = 'cutter-grid-ladder-v2';
export const CUTTER_GRID_PROFILE_V2_VERSION = 2;

/**
 * V3 keeps V2's globally selected IK branch but replaces the C1 timing and
 * render-clock playback with a serializable, jerk-bounded trajectory.
 */
export const CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION = 'cutter-grid-ladder-v3';
export const CUTTER_GRID_PROFILE_V3_VERSION = 3;

export type CutterGridDirection =
  | 'right'
  | 'left'
  | 'up'
  | 'down'
  | 'forward'
  | 'backward';

export type CutterGridCoord = readonly [number, number, number];

export interface CutterGridMoveV1 {
  type: 'move';
  direction: CutterGridDirection;
  distance: number;
  sourceBlockId: string;
}

export interface CutterGridWaitV1 {
  type: 'wait';
  durationMs: number;
  sourceBlockId: string;
}

export interface CutterGridRepeatV1 {
  type: 'repeat';
  count: number;
  body: CutterGridNodeV1[];
  sourceBlockId: string;
}

export type CutterGridNodeV1 =
  | CutterGridMoveV1
  | CutterGridWaitV1
  | CutterGridRepeatV1;

export interface CutterGridProgramV1 {
  kind: 'cutter-grid';
  version: 1;
  plannerVersion: string;
  nodes: CutterGridNodeV1[];
  sourceBlockCount: number;
}

export type CutterGridAtomicActionV1 =
  | {
      type: 'move-cell';
      direction: CutterGridDirection;
      sourceBlockId: string;
    }
  | CutterGridWaitV1;

export interface CompiledCutterGridProgramV1 {
  program: CutterGridProgramV1;
  runtimeActions: CutterGridAtomicActionV1[];
  executedCommandCount: number;
}

export type CutterGridBlockedReason =
  | 'joint-limit'
  | 'head-collision'
  | 'ik-error';

export interface CutterGridNodeProfileV1 {
  coord: CutterGridCoord;
  worldPosition: Vec3Tuple;
  reachable: boolean;
  blockedReason?: CutterGridBlockedReason;
}

export interface CutterTrajectoryWaypointV1 {
  timeMs: number;
  jointAngles: Record<JointId, number>;
  jointVelocitiesDegPerSec: Record<JointId, number>;
  endEffector: Vec3Tuple;
}

export interface CutterGridProfileV1 {
  version: 1;
  plannerVersion: string;
  challengeSignature: string;
  originHairCoord: CutterGridCoord;
  originWorldPosition: Vec3Tuple;
  entryJointAngles: Record<JointId, number>;
  entryTrajectory: CutterTrajectoryWaypointV1[];
  bounds: CutterGridBounds;
  nodes: CutterGridNodeProfileV1[];
  referenceProgram: CutterGridProgramV1;
  referenceTrajectorySignature: string;
  certification: CutterGridCertificationV1;
}

export interface CutterGridCertificationV1 {
  passed: boolean;
  entryZeroContact: boolean;
  referenceCompletion: number;
  referenceCutVoxels: VoxelKey[];
  referenceExtraCutVoxels: VoxelKey[];
  certifiedDirections: CutterGridDirection[];
}

export interface CutterGridBounds {
  min: CutterGridCoord;
  max: CutterGridCoord;
}

export interface CutterTrajectoryStepV1 {
  index: number;
  kind: 'move-cell' | 'wait';
  sourceBlockId: string;
  startCoord: CutterGridCoord;
  endCoord: CutterGridCoord;
  durationMs: number;
  waypoints: CutterTrajectoryWaypointV1[];
  expectedCutVoxels: VoxelKey[];
}

export interface CutterTrajectoryPlanV1 {
  kind: 'cutter-grid-trajectory';
  version: 1;
  plannerVersion: string;
  challengeSignature: string;
  startCoord: CutterGridCoord;
  endCoord: CutterGridCoord;
  steps: CutterTrajectoryStepV1[];
  expectedResultVoxels: VoxelKey[];
  estimatedDurationMs: number;
  executedCommandCount: number;
  trajectorySignature: string;
}

export type CutterGridPlanningErrorCode =
  | 'profile-mismatch'
  | 'out-of-bounds'
  | 'blocked-node'
  | 'ik-not-converged'
  | 'joint-limit'
  | 'head-collision'
  | 'path-deviation'
  | 'trajectory-discontinuity'
  | 'planning-cancelled';

export interface CutterGridPlanningErrorDetails {
  sourceBlockId?: string;
  targetCoord?: CutterGridCoord;
  startCoord?: CutterGridCoord;
  actionIndex?: number;
  layerIndex?: number;
  stage?: 'candidate' | 'entry' | 'edge' | 'serialization';
  seedBudget?: 24 | 96 | 384;
}

/**
 * V2 planning contracts are introduced before their runtime is wired in.  V1
 * consumers remain deliberately typed to their V1 assets until the V2 Profile
 * and executor phases replace them together.
 */
export type CutterGridStaticIkStatus =
  | 'safe-candidate-known'
  | 'no-safe-candidate-found';

export interface CutterGridEntryOptionV2 {
  id: string;
  jointAngles: Record<JointId, number>;
  positioningTrajectory: CutterTrajectoryWaypointV2[];
  positioningSignature: string;
  minimumHeadClearance: number;
}

export interface CutterGridNodeProfileV2 {
  coord: CutterGridCoord;
  worldPosition: Vec3Tuple;
  staticIkStatus: CutterGridStaticIkStatus;
  candidateCount: number;
  seedBudget: 24 | 96 | 384;
}

export interface CutterGridCertificationV2 extends CutterGridCertificationV1 {
  authenticatedEntryOptionIds: string[];
  /** Phase 3 can set this only after the V2 global planner certifies it. */
  referenceTrajectoryCertified: boolean;
}

export interface CutterGridProfileV2 {
  version: typeof CUTTER_GRID_PROFILE_V2_VERSION;
  plannerVersion: typeof CUTTER_GRID_LADDER_PLANNER_VERSION;
  challengeSignature: string;
  originHairCoord: CutterGridCoord;
  originWorldPosition: Vec3Tuple;
  bounds: CutterGridBounds;
  entryOptions: CutterGridEntryOptionV2[];
  nodes: CutterGridNodeProfileV2[];
  referenceProgram: CutterGridProgramV1;
  referenceTrajectorySignature: string;
  certification: CutterGridCertificationV2;
}

export type CutterTrajectoryWaypointV2 = CutterTrajectoryWaypointV1;

export type CutterTrajectoryStepV2 = CutterTrajectoryStepV1;

export interface CutterGridPlanningDiagnosticsV2 {
  entryOptionId: string;
  cartesianLayerCount: number;
  candidateCounts: number[];
  seedBudgetUsed: 24 | 96 | 384;
  expandedRange?: readonly [number, number];
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
  maximumNormalizedJointStep: number;
}

export interface CutterTrajectoryPlanV2 {
  kind: 'cutter-grid-trajectory';
  version: 2;
  plannerVersion: typeof CUTTER_GRID_LADDER_PLANNER_VERSION;
  challengeSignature: string;
  entryOptionId: string;
  positioningTrajectory: CutterTrajectoryWaypointV2[];
  startCoord: CutterGridCoord;
  endCoord: CutterGridCoord;
  steps: CutterTrajectoryStepV2[];
  expectedResultVoxels: VoxelKey[];
  estimatedDurationMs: number;
  executedCommandCount: number;
  diagnostics: CutterGridPlanningDiagnosticsV2;
  trajectorySignature: string;
}

export type CutterGridPlanningPhaseV2 =
  | 'generating-candidates'
  | 'connecting-graph'
  | 'selecting-path'
  | 'validating-trajectory';

export interface CutterGridPlanningProgressV2 {
  type: 'progress';
  requestId: number;
  phase: CutterGridPlanningPhaseV2;
  completedLayers: number;
  totalLayers: number;
  seedBudget: 24 | 96 | 384;
  disconnectedLayer?: number;
}

/**
 * V3 preserves the V2 global-IK progress stages, then reports the immutable
 * geometry and timing work separately. `unit` makes the counter explicit: the
 * first four phases count Cartesian layers, while the latter four count real
 * arm-motion segments (the system entry plus player moves).
 */
export type CutterGridPlanningPhaseV3 =
  | CutterGridPlanningPhaseV2
  | 'geometric-smoothing'
  | 'time-parameterization'
  | 'jerk-smoothing'
  | 'playback-validation';

export interface CutterGridPlanningProgressV3 {
  type: 'progress-v3';
  requestId: number;
  phase: CutterGridPlanningPhaseV3;
  completedItems: number;
  totalItems: number;
  unit: 'layers' | 'motion-segments';
  seedBudget?: 24 | 96 | 384;
  disconnectedLayer?: number;
}

export type CutterGridPlanningErrorCodeV2 =
  | 'no-safe-ik-candidate'
  | 'no-compatible-entry'
  | 'no-continuous-joint-path'
  | 'planning-search-exhausted';

export type AnyCutterGridPlanningErrorCode =
  | CutterGridPlanningErrorCode
  | CutterGridPlanningErrorCodeV2
  | CutterGridPlanningErrorCodeV3;

/** Per-joint dynamic limits are explicitly part of a V3 profile. */
export interface CutterGridJointMotionLimitsV3 {
  nominalVelocityDegPerSec: number;
  nominalAccelerationDegPerSec2: number;
  nominalJerkDegPerSec3: number;
  maxVelocityDegPerSec: number;
  maxAccelerationDegPerSec2: number;
  maxJerkDegPerSec3: number;
}

export interface CutterGridMotionLimitsV3 {
  requestedSpeedScale: number;
  joints: Record<JointId, CutterGridJointMotionLimitsV3>;
}

export interface CutterGridProfileV3 extends Omit<CutterGridProfileV2, 'version' | 'plannerVersion'> {
  version: typeof CUTTER_GRID_PROFILE_V3_VERSION;
  plannerVersion: typeof CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION;
  motionLimits: CutterGridMotionLimitsV3;
  motionLimitsSignature: string;
  profileSignature: string;
}

/** A sample generated by the V3 analytic timing law. */
export interface CutterTrajectoryWaypointV3 extends CutterTrajectoryWaypointV1 {
  jointAccelerationsDegPerSec2: Record<JointId, number>;
  jointJerksDegPerSec3: Record<JointId, number>;
}

/**
 * A knot of the fixed joint-space geometry path.  Derivatives are with
 * respect to the normalized path parameter rather than wall-clock time, so
 * the same geometry can be retimed without selecting another IK branch.
 */
export interface CutterTrajectoryGeometryKnotV3 {
  parameter: number;
  jointAngles: Record<JointId, number>;
  jointVelocitiesPerParameter: Record<JointId, number>;
  jointAccelerationsPerParameter2: Record<JointId, number>;
}

/** C2 quintic geometry shared by all timing attempts for one fixed path. */
export interface CutterTrajectoryGeometryV3 {
  interpolation: 'global-c2-quintic-spline';
  constraintResolution: 'minimum-jerk' | 'monotone-c2-fallback';
  knots: CutterTrajectoryGeometryKnotV3[];
}

/**
 * A fixed C2 quintic geometry path plus its absolute-time timing law. The
 * executor evaluates this immutable data rather than accumulating frame deltas.
 */
export interface CutterTrajectoryStepMotionV3 {
  /**
   * `ruckig-local-sampled` retains only Ruckig's exact constant-jerk control
   * boundaries. Dense five-millisecond samples are consumed in the Worker
   * for certification and are deliberately not sent to the render thread.
   */
  interpolation: 'global-c2-quintic-time-law' | 'ruckig-local-sampled' | 'hold';
  durationMs: number;
  geometryWaypoints: CutterTrajectoryWaypointV2[];
  geometry?: CutterTrajectoryGeometryV3;
}

/**
 * A hair-contact event proven by dense Worker-side replay of a sparse Ruckig
 * control trajectory. Runtime delivery is timestamp based, so cut semantics
 * do not depend on rAF cadence or on a long Cartesian chord between control
 * boundaries.
 */
export interface CutterTrajectoryContactEventV3 {
  timeMs: number;
  voxelKeys: VoxelKey[];
}

export interface CutterTrajectoryStepV3 extends Omit<CutterTrajectoryStepV1, 'waypoints'> {
  waypoints: CutterTrajectoryWaypointV3[];
  motion: CutterTrajectoryStepMotionV3;
  /** Present only when a local Ruckig move uses sparse control boundaries. */
  certifiedContactEvents?: CutterTrajectoryContactEventV3[];
}

/**
 * The system-only route from the Servo initial pose to the selected Grid
 * origin.  It is deliberately separate from player steps: its duration,
 * motion, and signature are safety-relevant, but it never contributes to
 * player commands, score time, or hair contact.
 */
export interface CutterGridPositioningMotionV3 {
  durationMs: number;
  waypoints: CutterTrajectoryWaypointV3[];
  motion: CutterTrajectoryStepMotionV3;
}

export interface CutterGridPlanningDiagnosticsV3 extends CutterGridPlanningDiagnosticsV2 {
  requestedSpeedScale: number;
  actualSpeedScale: number;
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  maximumCartesianDeviation: number;
  validationSampleCount: number;
}

export interface CutterTrajectoryPlanV3 {
  kind: 'cutter-grid-trajectory';
  version: 3;
  plannerVersion: typeof CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION;
  challengeSignature: string;
  entryOptionId: string;
  /** Stable digest of the selected entry and immutable C2 player geometry. */
  geometrySignature: string;
  /** Immutable source geometry selected by the V2 global entry search. */
  positioningTrajectory: CutterTrajectoryWaypointV2[];
  /** V3 timing for the system-only entry geometry, covered by the plan signature. */
  positioningMotion: CutterGridPositioningMotionV3;
  startCoord: CutterGridCoord;
  endCoord: CutterGridCoord;
  steps: CutterTrajectoryStepV3[];
  expectedResultVoxels: VoxelKey[];
  estimatedDurationMs: number;
  executedCommandCount: number;
  motionLimits: CutterGridMotionLimitsV3;
  motionLimitsSignature: string;
  diagnostics: CutterGridPlanningDiagnosticsV3;
  trajectorySignature: string;
}

export type CutterGridPlanningErrorCodeV3 =
  | 'motion-limit-missing'
  | 'joint-branch-discontinuity'
  | 'time-parameterization-infeasible'
  | 'jerk-smoothing-infeasible'
  | 'trajectory-smoothing-path-deviation'
  | 'trajectory-smoothing-search-exhausted'
  | 'playback-clock-invalid';
