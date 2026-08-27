export type JointId = string;

/** A servo on the arm. Named as `hcr-fw` names them (`robot/axis_config.rs`). */
export type ServoAxisId = 'X' | 'Y' | 'Z' | 'B' | 'E';

/**
 * Affine map between a joint's servo degrees and the geometric angle the
 * kinematics rotates by. Applied in `features/robot/servoMapping.ts`, which is
 * where the reasoning lives.
 */
export interface ServoMapping {
  axis: ServoAxisId;
  /** Servo angle the joint's `offsetDeg` lands on. 90° on every axis. */
  centerDeg: number;
  /** +1 when the servo turns the same way as the model, −1 when it opposes. */
  direction: 1 | -1;
  /** Geometric angle that `centerDeg` corresponds to. */
  offsetDeg: number;
}
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
  /**
   * Limits, start and commanded angles are **servo degrees** — the number the
   * physical servo is driven to — for every joint that has a `servo` mapping.
   * A joint without one has no servo to speak for, so its angles stay geometric.
   * See `features/robot/servoMapping.ts`.
   */
  minAngleDeg: number;
  maxAngleDeg: number;
  /** Initial command/state. Servo-backed joints initialize at 90°. */
  initialAngleDeg: number;
  speedDegPerSec: number;
  /** Absent for simulation-only joints the arm has no axis for. */
  servo?: ServoMapping;
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
