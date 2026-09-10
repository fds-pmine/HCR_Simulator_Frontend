import { Line } from '@react-three/drei';
import { useSceneTokens } from '../../theme/useSceneTokens';
import type { Challenge, Vec3Tuple } from '../../types/domain';
import { evaluateCutterGridSyncPtpV4 } from './compactPtpV4';
import type {
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterGridProfileV4,
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from './types';

type ProfileNode = (
  | CutterGridProfileV1
  | CutterGridProfileV2
  | CutterGridProfileV3
  | CutterGridProfileV4
)['nodes'][number];

export function CutterGridOverlay({
  challenge,
  profile,
  plan,
  executedStepCount = 0,
}: {
  challenge: Challenge;
  profile: CutterGridProfileV1 | CutterGridProfileV2 | CutterGridProfileV3 | CutterGridProfileV4;
  plan?: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | CutterTrajectoryPlanV4;
  executedStepCount?: number;
}) {
  const tokens = useSceneTokens();
  const sampledNodes = profile.nodes.filter((_, index) => index % 24 === 0);
  const positions = profile.nodes.map((node) => node.worldPosition);
  const min = [0, 1, 2].map((axis) =>
    Math.min(...positions.map((position) => position[axis])),
  ) as [number, number, number];
  const max = [0, 1, 2].map((axis) =>
    Math.max(...positions.map((position) => position[axis])),
  ) as [number, number, number];
  const boundsCenter = min.map(
    (value, axis) => (value + max[axis]) / 2,
  ) as [number, number, number];
  const boundsSize = min.map(
    (value, axis) => max[axis] - value,
  ) as [number, number, number];
  const movePaths = plannedMovePaths(challenge, plan);
  return (
    <group>
      <mesh position={boundsCenter}>
        <boxGeometry args={boundsSize} />
        <meshBasicMaterial
          color={tokens.nodeBounds}
          wireframe
          transparent
          opacity={tokens.boundsOpacity}
        />
      </mesh>
      {sampledNodes.map((node) => (
        <mesh key={node.coord.join(',')} position={node.worldPosition}>
          <sphereGeometry args={[0.012, 5, 4]} />
          <meshBasicMaterial
            color={reachable(node) ? tokens.nodeReachable : tokens.nodeBlocked}
            transparent
            opacity={
              reachable(node)
                ? tokens.nodeReachableOpacity
                : tokens.nodeBlockedOpacity
            }
          />
        </mesh>
      ))}
      {movePaths.map(({ id, points, stepIndex }) => (
        <Line
          key={id}
          points={points}
          color={stepIndex < executedStepCount ? tokens.accent : tokens.nodePlanned}
          lineWidth={2}
          transparent
          opacity={tokens.pathOpacity}
        />
      ))}
      <axesHelper args={[0.48]} position={profile.originWorldPosition} />
    </group>
  );
}

/** V2 profiles carry `reachable`; V4 carries an IK status. Same question. */
function reachable(node: ProfileNode): boolean {
  return 'reachable' in node
    ? node.reachable
    : node.staticIkStatus === 'safe-candidate-known';
}

function plannedMovePaths(
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
        const samples = Math.max(4, Math.ceil(primitive.durationMs / 40));
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
