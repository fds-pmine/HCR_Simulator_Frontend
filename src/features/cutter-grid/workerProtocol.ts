import type { Challenge } from '../../types/domain';
import type {
  CompiledCutterGridProgramV2,
  CompiledCutterGridProgramV1,
  CutterGridPlanningProgressV2,
  CutterGridPlanningProgressV3,
  CutterGridPlanningProgressV4,
  CutterGridPlanningStageV4,
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterGridProfileV4,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from './types';

export interface CutterGridWorkerV1Request {
  type: 'plan';
  requestId: number;
  challenge: Challenge;
  compiled: CompiledCutterGridProgramV1;
  profile: CutterGridProfileV1;
}

export interface CutterGridWorkerV2Request {
  type: 'plan-v2';
  requestId: number;
  challenge: Challenge;
  compiled: CompiledCutterGridProgramV1;
  profile: CutterGridProfileV2;
}

export interface CutterGridWorkerV3Request {
  type: 'plan-v3';
  requestId: number;
  challenge: Challenge;
  compiled: CompiledCutterGridProgramV1;
  profile: CutterGridProfileV3;
}

/** V4 is isolated from V1–V3 by both its compiled IR and its Profile type. */
export interface CutterGridWorkerV4Request {
  type: 'plan-v4';
  requestId: number;
  challenge: Challenge;
  compiled: CompiledCutterGridProgramV2;
  profile: CutterGridProfileV4;
}

export type CutterGridWorkerRequest =
  | CutterGridWorkerV1Request
  | CutterGridWorkerV2Request
  | CutterGridWorkerV3Request
  | CutterGridWorkerV4Request;

export type CutterGridWorkerResponse =
  | {
      type: 'planned';
      requestId: number;
      plan: CutterTrajectoryPlanV1;
    }
  | {
      type: 'planned-v2';
      requestId: number;
      plan: CutterTrajectoryPlanV2;
    }
  | {
      type: 'planned-v3';
      requestId: number;
      plan: CutterTrajectoryPlanV3;
    }
  | {
      type: 'planned-v4';
      requestId: number;
      plan: CutterTrajectoryPlanV4;
    }
  | CutterGridPlanningProgressV2
  | CutterGridPlanningProgressV3
  | CutterGridPlanningProgressV4
  | {
      type: 'failed';
      requestId: number;
      code: string;
      message: string;
      sourceBlockId?: string;
      targetCoord?: readonly [number, number, number];
      actionIndex?: number;
      layerIndex?: number;
      startCoord?: readonly [number, number, number];
      stage?: 'candidate' | 'entry' | 'edge' | 'serialization' | CutterGridPlanningStageV4;
      seedBudget?: 24 | 96 | 384;
    };
