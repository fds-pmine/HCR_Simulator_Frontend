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

export type CutterGridPlanningErrorCodeV2 =
  | 'no-safe-ik-candidate'
  | 'no-compatible-entry'
  | 'no-continuous-joint-path'
  | 'planning-search-exhausted';
