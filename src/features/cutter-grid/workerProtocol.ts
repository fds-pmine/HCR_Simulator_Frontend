import type { Challenge } from '../../types/domain';
import type { CompiledCutterGridProgramV1, CutterGridProfileV1, CutterTrajectoryPlanV1 } from './types';

export interface CutterGridWorkerRequest {
  type: 'plan';
  requestId: number;
  challenge: Challenge;
  compiled: CompiledCutterGridProgramV1;
  profile: CutterGridProfileV1;
}

export type CutterGridWorkerResponse =
  | {
      type: 'planned';
      requestId: number;
      plan: CutterTrajectoryPlanV1;
    }
  | {
      type: 'failed';
      requestId: number;
      code: string;
      message: string;
      sourceBlockId?: string;
      targetCoord?: readonly [number, number, number];
    };
