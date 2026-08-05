import type { Program, RobotCommand } from '../blockly/programTypes';
import type { Heading, SafetyEdge, ToolMode } from './types';

export type ScalpCommand =
  | { type: 'move-forward'; steps: number; sourceBlockId: string }
  | { type: 'turn'; direction: 'left' | 'right'; sourceBlockId: string }
  | { type: 'set-tool-mode'; mode: ToolMode; sourceBlockId: string }
  | { type: 'wait'; durationMs: number; sourceBlockId: string };

export type ScalpProgramNode =
  | ScalpCommand
  | {
      type: 'repeat';
      count: number;
      body: ScalpProgramNode[];
      sourceBlockId: string;
    };

export interface ScalpProgram {
  nodes: ScalpProgramNode[];
  sourceBlockCount: number;
}

export interface TrajectorySegment {
  id: string;
  sourceBlockId: string;
  actionIndex: number;
  kind: SafetyEdge['kind'] | 'turn' | 'wait';
  edge?: SafetyEdge;
  cutterEnabled: boolean;
}

export interface TrajectoryPlan {
  segments: TrajectorySegment[];
  initialNodeId: string;
  finalNodeId: string;
  finalHeading: Heading;
  finalToolMode: ToolMode;
}

export interface CompiledScalpProgram {
  scalpProgram: ScalpProgram;
  trajectoryPlan: TrajectoryPlan;
  /** Frozen hcr.v1 payload submitted to existing providers. */
  program: Program;
  runtimeCommands: RobotCommand[];
  executedCommandCount: number;
}
