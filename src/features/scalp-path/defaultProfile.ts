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
const REACHABLE_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const BASE_YAWS = [-55, -45, -32.5, -20, -7.5, 5, 17.5, 30, 42.5, 55] as const;

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
 * The initial certified profile intentionally exposes a connected 3×10 patch.
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
  const startNodeId = scalpNodeId(4, 1);
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
      const engageWaypoints =
        node.id === scalpNodeId(2, 2)
          ? referenceCrownEngageWaypoints(baseYaw)
          : row === 4
          ? [
              {
                ...hoverAngles(baseYaw),
                elbow: -40,
                wrist: -20,
              },
              {
                ...hoverAngles(baseYaw),
                shoulder: 70,
                elbow: -40,
                wrist: -20,
              },
              cutAngles(row, baseYaw),
            ]
          : [cutAngles(row, baseYaw)];
      edges.push(
        edgeWithWaypoints(
          `engage-${node.id}`,
          hoverPoseId,
          cutPoseId,
          'engage',
          true,
          engageWaypoints,
        ),
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

  // Certified horizontal sweeps preserve the continuous crown passes from the
  // calibration program. A turtle still visits every logical cell, but a
  // multi-cell Move Forward becomes one verified physical sweep instead of a
  // chain of artificial stops between adjacent cells.
  for (const node of nodes.filter((item) => item.reachable)) {
    const peers = nodes.filter(
      (candidate) =>
        candidate.reachable &&
        candidate.row === node.row &&
        candidate.id !== node.id,
    );
    for (const peer of peers) {
      if (!node.hoverPoseId || !node.cutPoseId || !peer.hoverPoseId || !peer.cutPoseId) {
        continue;
      }
      edges.push(
        edge(
          `hover-sweep-${node.id}-to-${peer.id}`,
          node.hoverPoseId,
          peer.hoverPoseId,
          'hover',
          false,
          poseById(poses, peer.hoverPoseId).jointAngles,
        ),
        edge(
          `cut-sweep-${node.id}-to-${peer.id}`,
          node.cutPoseId,
          peer.cutPoseId,
          'cut',
          true,
          poseById(poses, peer.cutPoseId).jointAngles,
        ),
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

/**
 * Replays the calibrated crown-entry sequence at the one grid cell where the
 * reference path begins cutting. Each waypoint changes one joint, so the
 * synchronized animation and legacy IR follow the same certified route.
 */
function referenceCrownEngageWaypoints(baseYaw: number): JointAngles[] {
  const hover = hoverAngles(baseYaw);
  const lowerShoulder = { ...hover, shoulder: 45 };
  const foldedElbow = { ...lowerShoulder, elbow: -80 };
  const foldedWrist = { ...foldedElbow, wrist: 35 };
  const raisedShoulder = { ...foldedWrist, shoulder: 90 };
  const cuttingElbow = { ...raisedShoulder, elbow: -40 };
  return [{ ...lowerShoulder }, { ...foldedElbow }, { ...foldedWrist }, { ...raisedShoulder }, { ...cuttingElbow }, { ...cuttingElbow, wrist: -20 }];
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: SafetyEdge['kind'],
  cuttingEnabled: boolean,
  target: JointAngles,
): SafetyEdge {
  return edgeWithWaypoints(id, from, to, kind, cuttingEnabled, [target]);
}

function edgeWithWaypoints(
  id: string,
  from: string,
  to: string,
  kind: SafetyEdge['kind'],
  cuttingEnabled: boolean,
  waypoints: readonly JointAngles[],
): SafetyEdge {
  return {
    id,
    from,
    to,
    kind,
    cuttingEnabled,
    synchronousWaypoints: waypoints.map((waypoint) => ({ ...waypoint })),
    legacyWaypoints: waypoints.map((waypoint) => ({ ...waypoint })),
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
