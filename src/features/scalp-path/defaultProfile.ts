import { defaultChallengeDefinition } from '../../data/challenges/defaultChallenge';
import type { Challenge } from '../../types/domain';
import { scalpGeometrySignature } from './geometrySignature';
import { createScalpGrid, scalpNodeId } from './scalpGrid';
import type {
  JointAngles,
  ScalpMotionProfile,
  ScalpProfileResolution,
  SafetyEdge,
  SafetyPose,
} from './types';

const REACHABLE_ROWS = [2, 3, 4] as const;
const REACHABLE_COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const BASE_YAWS = [-55, -40, -25, -10, 5, 20, 35, 50, 55] as const;

const CUT_CONFIGS: Readonly<Record<number, Omit<JointAngles, 'baseYaw'>>> = {
  2: { shoulderRoll: 0, shoulder: 90, elbow: -40, wrist: -20 },
  3: { shoulderRoll: 0, shoulder: 80, elbow: -20, wrist: -20 },
  4: { shoulderRoll: 0, shoulder: 70, elbow: 0, wrist: -20 },
};

const HOVER_CONFIG: Omit<JointAngles, 'baseYaw'> = {
  shoulderRoll: 0,
  shoulder: 90,
  elbow: 0,
  wrist: 0,
};

export const DEFAULT_SCALP_GEOMETRY_SIGNATURE = scalpGeometrySignature({
  robotConfig: defaultChallengeDefinition.robotConfig,
  voxelConfig: defaultChallengeDefinition.voxelConfig,
});

/**
 * The initial certified profile intentionally exposes a connected 3×9 patch.
 * Its joint candidates are conservative poses checked against the same head
 * collision primitive as the simulator; the remaining 57 grid nodes stay
 * visible but disabled until a later calibration expands coverage.
 */
export const defaultScalpMotionProfile: ScalpMotionProfile = buildDefaultProfile();

export function resolveScalpMotionProfile(
  challenge: Pick<Challenge, 'robotConfig' | 'voxelConfig'>,
): ScalpProfileResolution {
  const signature = scalpGeometrySignature(challenge);
  if (signature !== DEFAULT_SCALP_GEOMETRY_SIGNATURE) {
    return {
      error:
        'Scalp path programming is unavailable because this robot geometry is not calibrated.',
    };
  }
  return { profile: defaultScalpMotionProfile };
}

function buildDefaultProfile(): ScalpMotionProfile {
  const nodes = createScalpGrid(defaultChallengeDefinition.voxelConfig).map(
    (node) => ({ ...node, neighbors: { ...node.neighbors } }),
  );
  const poses: SafetyPose[] = [];
  const edges: SafetyEdge[] = [];
  const startNodeId = scalpNodeId(4, 2);
  const parkPoseId = 'park';

  const parkAngles = hoverAngles(-55);
  poses.push({ id: parkPoseId, kind: 'park', jointAngles: parkAngles });

  for (const row of REACHABLE_ROWS) {
    for (let index = 0; index < REACHABLE_COLUMNS.length; index += 1) {
      const column = REACHABLE_COLUMNS[index];
      const baseYaw = BASE_YAWS[index];
      const node = nodes.find((item) => item.id === scalpNodeId(row, column));
      if (!node) {
        throw new Error(`Missing scalp grid node r${row}-c${column}.`);
      }
      const hoverPoseId = `hover-${node.id}`;
      const cutPoseId = `cut-${node.id}`;
      node.reachable = true;
      node.hoverPoseId = hoverPoseId;
      node.cutPoseId = cutPoseId;
      poses.push(
        { id: hoverPoseId, kind: 'hover', gridNodeId: node.id, jointAngles: hoverAngles(baseYaw) },
        { id: cutPoseId, kind: 'cut', gridNodeId: node.id, jointAngles: cutAngles(row, baseYaw) },
      );
      edges.push(
        edge(`engage-${node.id}`, hoverPoseId, cutPoseId, 'engage', true, cutAngles(row, baseYaw)),
        edge(`retract-${node.id}`, cutPoseId, hoverPoseId, 'retract', false, hoverAngles(baseYaw)),
      );
    }
  }

  for (const node of nodes.filter((item) => item.reachable)) {
    for (const neighborId of Object.values(node.neighbors)) {
      const neighbor = nodes.find((item) => item.id === neighborId);
      if (!neighbor?.reachable || !node.hoverPoseId || !node.cutPoseId || !neighbor.hoverPoseId || !neighbor.cutPoseId) {
        continue;
      }
      const targetHover = poseById(poses, neighbor.hoverPoseId).jointAngles;
      const targetCut = poseById(poses, neighbor.cutPoseId).jointAngles;
      edges.push(
        edge(`hover-${node.id}-to-${neighbor.id}`, node.hoverPoseId, neighbor.hoverPoseId, 'hover', false, targetHover),
        edge(`cut-${node.id}-to-${neighbor.id}`, node.cutPoseId, neighbor.cutPoseId, 'cut', true, targetCut),
      );
    }
  }

  const startHoverId = poseIdFor(nodes, startNodeId, 'hoverPoseId');
  edges.push(
    edge('entry', parkPoseId, startHoverId, 'entry', false, poseById(poses, startHoverId).jointAngles),
    edge('exit', startHoverId, parkPoseId, 'exit', false, parkAngles),
  );

  return {
    version: 1,
    geometrySignature: DEFAULT_SCALP_GEOMETRY_SIGNATURE,
    startNodeId,
    startHeading: 'east',
    parkPoseId,
    nodes,
    poses,
    edges,
  };
}

function hoverAngles(baseYaw: number): JointAngles {
  return { baseYaw, ...HOVER_CONFIG };
}

function cutAngles(row: number, baseYaw: number): JointAngles {
  const config = CUT_CONFIGS[row];
  if (!config) {
    throw new Error(`No cut configuration for scalp row ${row}.`);
  }
  return { baseYaw, ...config };
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: SafetyEdge['kind'],
  cuttingEnabled: boolean,
  target: JointAngles,
): SafetyEdge {
  return {
    id,
    from,
    to,
    kind,
    cuttingEnabled,
    synchronousWaypoints: [{ ...target }],
    legacyWaypoints: [{ ...target }],
  };
}

function poseById(poses: readonly SafetyPose[], id: string): SafetyPose {
  const pose = poses.find((item) => item.id === id);
  if (!pose) {
    throw new Error(`Missing safety pose ${id}.`);
  }
  return pose;
}

function poseIdFor(
  nodes: readonly { id: string; hoverPoseId?: string; cutPoseId?: string }[],
  nodeId: string,
  key: 'hoverPoseId' | 'cutPoseId',
): string {
  const id = nodes.find((node) => node.id === nodeId)?.[key];
  if (!id) {
    throw new Error(`Missing ${key} for ${nodeId}.`);
  }
  return id;
}
