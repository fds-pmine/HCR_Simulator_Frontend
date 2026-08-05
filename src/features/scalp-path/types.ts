import type { JointId, Vec3Tuple } from '../../types/domain';

export type ToolMode = 'hover' | 'cut';
export type Heading = 'north' | 'east' | 'south' | 'west';
export type GridNodeId = string;
export type SafetyPoseId = string;
export type JointAngles = Record<JointId, number>;

export interface ScalpGridNode {
  id: GridNodeId;
  row: number;
  column: number;
  worldPosition: Vec3Tuple;
  surfaceNormal: Vec3Tuple;
  neighbors: Partial<Record<Heading, GridNodeId>>;
  reachable: boolean;
  hoverPoseId?: SafetyPoseId;
  cutPoseId?: SafetyPoseId;
}

export interface SafetyPose {
  id: SafetyPoseId;
  kind: 'park' | 'transit' | 'hover' | 'cut';
  gridNodeId?: GridNodeId;
  jointAngles: JointAngles;
}

export interface SafetyEdge {
  id: string;
  from: SafetyPoseId;
  to: SafetyPoseId;
  kind: 'entry' | 'hover' | 'engage' | 'cut' | 'retract' | 'exit';
  synchronousWaypoints: JointAngles[];
  legacyWaypoints: JointAngles[];
  cuttingEnabled: boolean;
}

export interface ScalpMotionProfile {
  version: 1;
  geometrySignature: string;
  startNodeId: GridNodeId;
  startHeading: Heading;
  parkPoseId: SafetyPoseId;
  nodes: ScalpGridNode[];
  poses: SafetyPose[];
  edges: SafetyEdge[];
}

export interface ScalpProfileResolution {
  profile?: ScalpMotionProfile;
  error?: string;
}
