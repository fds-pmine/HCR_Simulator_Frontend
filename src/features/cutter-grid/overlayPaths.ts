import type { Challenge, Vec3Tuple } from '../../types/domain';
import { evaluateCutterGridSyncPtpV4 } from './compactPtpV4';
import type {
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from './types';

export function plannedMovePaths(
  challenge: Challenge,
  plan:
    | CutterTrajectoryPlanV1
    | CutterTrajectoryPlanV2
    | CutterTrajectoryPlanV3
    | CutterTrajectoryPlanV4
    | undefined,
): Array<{ id: string; points: Vec3Tuple[]; stepIndex: number }> {
  if (!plan) return [];
  if (plan.version === 4) {
    return plan.actions.flatMap((action, stepIndex) => {
      if (action.type === 'wait') return [];
      const points: Vec3Tuple[] = [];
      for (const primitive of action.primitives) {
        const samples = Math.min(256, Math.max(4, Math.ceil(primitive.durationMs / 40)));
        for (let index = points.length === 0 ? 0 : 1; index <= samples; index += 1) {
          points.push(evaluateCutterGridSyncPtpV4(
            challenge,
            primitive,
            (primitive.durationMs * index) / samples,
          ).endEffector);
        }
      }
      return [{ id: `v4-${action.occurrenceId}`, points, stepIndex }];
    });
  }
  return plan.steps.flatMap((step, stepIndex) =>
    step.kind === 'move-cell'
      ? [{
        id: `v${plan.version}-${step.index}`,
        points: step.waypoints.map((waypoint) => waypoint.endEffector),
        stepIndex,
      }]
      : [],
  );
}
