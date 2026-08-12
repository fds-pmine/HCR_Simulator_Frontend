import type { JointId, Vec3Tuple, VoxelKey } from '../../types/domain';

export const CUTTER_GRID_PLANNER_VERSION = 'cutter-grid-dls-v1';

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
