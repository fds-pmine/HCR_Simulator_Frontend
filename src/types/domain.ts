export type JointId = string;
export type VoxelKey = `${number},${number},${number}`;
export type Axis = 'x' | 'y' | 'z';
export type Vec3Tuple = readonly [number, number, number];
export type AllowedBlockType =
  | 'set-joint-angle'
  | 'wait'
  | 'repeat';

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export interface JointConfig {
  id: JointId;
  name: string;
  axis: Axis;
  minAngleDeg: number;
  maxAngleDeg: number;
  initialAngleDeg: number;
  speedDegPerSec: number;
}

export interface RobotGeometryConfig {
  basePosition: Vec3Tuple;
  shoulderHeight: number;
  upperArmLength: number;
  forearmLength: number;
  toolLength: number;
  toolRadius: number;
  collision: RobotCollisionConfig;
}

export interface RobotCollisionConfig {
  linkRadius: number;
  jointRadius: number;
  toolShaftRadius: number;
  headClearance: number;
}

export interface RobotState {
  joints: Record<JointId, number>;
}

export interface HairstyleDefinition {
  id: string;
  name: string;
  voxels: VoxelCoord[];
}

export interface ScoreWeights {
  completion: number;
  efficiency: number;
  time: number;
}

export interface ScoringConfig {
  weights: ScoreWeights;
  referenceProgramCost: number;
  referenceTimeMs: number;
  commandWeight: number;
}

export interface ProgramMetrics {
  sourceBlockCount: number;
  executedCommandCount: number;
  estimatedDurationMs: number;
}

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  robotConfig: {
    joints: JointConfig[];
    geometry: RobotGeometryConfig;
  };
  voxelConfig: {
    origin: Vec3Tuple;
    size: number;
    headCenter: Vec3Tuple;
    headScale: Vec3Tuple;
  };
  initialHair: HairstyleDefinition;
  targetHair: HairstyleDefinition;
  allowedBlocks: AllowedBlockType[];
  starterWorkspace: Record<string, unknown>;
  scoring: ScoringConfig;
}

export interface HairstyleTarget {
  id: string;
  name: string;
  voxels: ReadonlySet<VoxelKey>;
}

export interface Challenge
  extends Omit<ChallengeDefinition, 'initialHair' | 'targetHair'> {
  initialHair: HairstyleTarget;
  targetHair: HairstyleTarget;
}

export interface ChallengeSummary {
  id: string;
  name: string;
  description: string;
}

export interface ScoreInput {
  /**
   * The hairstyle before the program ran.
   *
   * Completion is scored on the *cut* — which hair came off against which hair
   * should have — so the starting point is part of the question, not context.
   */
  initialVoxels: ReadonlySet<VoxelKey>;
  targetVoxels: ReadonlySet<VoxelKey>;
  resultVoxels: ReadonlySet<VoxelKey>;
  programMetrics: ProgramMetrics;
  scoring: ScoringConfig;
}

export interface ScoreResult {
  completionScore: number;
  efficiencyScore: number;
  timeScore: number;
  finalScore: number;
  programCost: number;
}

export type TimingCommand =
  | {
      type: 'set-joint-angle';
      jointId: JointId;
      angleDeg: number;
    }
  | {
      type: 'wait';
      durationMs: number;
    };
