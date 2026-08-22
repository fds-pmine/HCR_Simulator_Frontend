import type { Challenge } from '../../types/domain';
import type {
  CompiledCutterGridProgramV1,
  CutterGridPlanningProgressV2,
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
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

export type CutterGridWorkerRequest =
  | CutterGridWorkerV1Request
  | CutterGridWorkerV2Request
  | CutterGridWorkerV3Request;

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
  | CutterGridPlanningProgressV2
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
      stage?: 'candidate' | 'entry' | 'edge' | 'serialization';
      seedBudget?: 24 | 96 | 384;
    };
