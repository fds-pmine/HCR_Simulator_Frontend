import type {
  CutterGridCoord,
  CutterGridPlanningErrorCodeV4,
  CutterGridPlanningStageV4,
} from './types';

/**
 * Structured V4 failure returned by the compact planner Worker. Keeping this
 * separate from V1–V3 errors prevents the active executor from accidentally
 * interpreting a V4 failure as a historical trajectory result.
 */
export class CutterGridCompactPtpV4PlanningError extends Error {
  constructor(
    public readonly code: CutterGridPlanningErrorCodeV4,
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      targetCoord?: CutterGridCoord;
      startCoord?: CutterGridCoord;
      actionIndex?: number;
      stage?: CutterGridPlanningStageV4;
    } = {},
  ) {
    super(message);
    this.name = 'CutterGridCompactPtpV4PlanningError';
  }
}
