import { Line } from '@react-three/drei';
import type { ScalpMotionProfile } from './types';

interface ScalpGridOverlayProps {
  profile: ScalpMotionProfile;
  currentNodeId?: string;
  cutterMode?: 'hover' | 'cut';
}

/**
 * Visual-only guide for the calibrated scalp cells. It has no collider and is
 * intentionally independent from the motion profile validator.
 */
export function ScalpGridOverlay({
  profile,
  currentNodeId,
  cutterMode = 'hover',
}: ScalpGridOverlayProps) {
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const links = profile.nodes.flatMap((node) =>
    ['east', 'south'].flatMap((direction) => {
      const neighborId = node.neighbors[direction as 'east' | 'south'];
      const neighbor = neighborId ? nodeById.get(neighborId) : undefined;
      // Do not draw the east/west seam over the face: its topological wrap is
      // useful to the turtle but visually misleading on a cropped scalp.
      if (!neighbor || (direction === 'east' && node.column === 11)) {
        return [];
      }
      return [[node.worldPosition, neighbor.worldPosition] as const];
    }),
  );

  return (
    <group name="scalp-grid-overlay" renderOrder={2}>
      {links.map(([from, to], index) => (
        <Line
          key={`grid-link-${index}`}
          points={[from, to]}
          color="#5e7585"
          lineWidth={0.75}
          transparent
          opacity={0.42}
          depthTest={false}
        />
      ))}
      {profile.nodes.map((node) => {
        const current = node.id === currentNodeId;
        const color = current
          ? cutterMode === 'cut'
            ? '#ff815d'
            : '#85e8ff'
          : node.reachable
            ? '#48c7c7'
            : '#48606d';
        return (
          <mesh
            key={node.id}
            position={node.worldPosition}
            scale={current ? 1.7 : 1}
            renderOrder={3}
          >
            <sphereGeometry args={[current ? 0.038 : 0.022, 10, 8]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={node.reachable || current ? 0.95 : 0.35}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
