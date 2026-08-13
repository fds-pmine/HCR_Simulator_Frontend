import type { CutterGridProfileV1, CutterGridProfileV2, CutterTrajectoryPlanV1, CutterTrajectoryPlanV2 } from './types';
import { Line } from '@react-three/drei';

export function CutterGridOverlay({
  profile,
  plan,
  executedStepCount = 0,
}: {
  profile: CutterGridProfileV1 | CutterGridProfileV2;
  plan?: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2;
  executedStepCount?: number;
}) {
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
  const path = plan?.steps.flatMap((step, stepIndex) =>
    step.kind === 'move-cell'
      ? step.waypoints
          .filter((_, index) => index % 3 === 0)
          .map((waypoint) => ({ waypoint, stepIndex }))
      : [],
  );
  const movePaths = plan?.steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => step.kind === 'move-cell');
  return (
    <group>
      <mesh position={boundsCenter}>
        <boxGeometry args={boundsSize} />
        <meshBasicMaterial color="#8bb9ca" wireframe transparent opacity={0.38} />
      </mesh>
      {sampledNodes.map((node) => (
        <mesh key={node.coord.join(',')} position={node.worldPosition}>
          <sphereGeometry args={[0.012, 5, 4]} />
          <meshBasicMaterial
            color={('reachable' in node ? node.reachable : node.staticIkStatus === 'safe-candidate-known') ? '#38d6ce' : '#ff805d'}
            transparent
            opacity={('reachable' in node ? node.reachable : node.staticIkStatus === 'safe-candidate-known') ? 0.35 : 0.22}
          />
        </mesh>
      ))}
      {movePaths?.map(({ step, stepIndex }) => (
        <Line
          key={`path-${step.index}`}
          points={step.waypoints.map((waypoint) => waypoint.endEffector)}
          color={stepIndex < executedStepCount ? '#38d6ce' : '#f3c75f'}
          lineWidth={2}
          transparent
          opacity={0.82}
        />
      ))}
      {path?.map(({ waypoint, stepIndex }, index) => (
        <mesh key={index} position={waypoint.endEffector}>
          <sphereGeometry args={[0.018, 6, 4]} />
          <meshBasicMaterial
            color={stepIndex < executedStepCount ? '#38d6ce' : '#f3c75f'}
            transparent
            opacity={0.75}
          />
        </mesh>
      ))}
      <axesHelper args={[0.48]} position={profile.originWorldPosition} />
    </group>
  );
}
