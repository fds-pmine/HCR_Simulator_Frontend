import type { Challenge, Vec3Tuple, VoxelKey } from '../../types/domain';
import { computeRobotPose, createInitialJointAngles } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { voxelCoordToWorld } from '../voxel/voxelKey';
import {
  CUTTER_GRID_DIRECTIONS,
  compareCutterGridCoords,
  cutterGridBoundsContain,
  deriveCutterGridBounds,
  enumerateCutterGridCoords,
  moveCutterGridCoord,
  nearestHairLatticeCoord,
} from './grid';
import { cutterGridChallengeSignature } from './signature';
import type {
  CutterGridBounds,
  CutterGridCoord,
  CutterGridDirection,
} from './types';

export interface CutterGridGeometricAudit {
  version: 1;
  challengeSignature: string;
  originCandidate: {
    hairCoord: CutterGridCoord;
    worldPosition: Vec3Tuple;
    distanceFromInitialEndEffector: number;
    hairHits: VoxelKey[];
  };
  bounds: CutterGridBounds;
  nodeCount: number;
  directedEdgeCount: number;
  safeDirectedEdgeCount: number;
  safeEmptyEdgeCount: number;
  safeCutEdgeCount: number;
  safeEdgesByDirection: Record<CutterGridDirection, number>;
  targetVoxelKeys: VoxelKey[];
  uncoveredTargetVoxelKeys: VoxelKey[];
  directionsWithoutSafeEdge: CutterGridDirection[];
  geometricGatePassed: boolean;
  trajectoryCertification: 'pending-planner';
}

/**
 * Cheap, deterministic Phase 0 gate for the world-axis lattice.
 *
 * This proves that the requested box and 0.12-radius contact semantics are not
 * geometrically self-contradictory. It deliberately does not claim that the
 * robot can follow these edges: only the versioned trajectory planner may turn
 * a geometric candidate into an enabled Profile.
 */
export function computeCutterGridGeometricAudit(
  challenge: Challenge,
): CutterGridGeometricAudit {
  const initialPose = computeRobotPose(
    challenge.robotConfig,
    createInitialJointAngles(challenge.robotConfig),
  );
  const originHairCoord = nearestHairLatticeCoord(
    initialPose.endEffector,
    challenge.voxelConfig,
  );
  const originWorldPosition = hairCoordToWorld(
    originHairCoord,
    challenge.voxelConfig,
  );
  const bounds = deriveCutterGridBounds(challenge, originHairCoord);
  const targetVoxelKeys = [...challenge.initialHair.voxels]
    .filter((key) => !challenge.targetHair.voxels.has(key))
    .sort();
  const targetSet = new Set(targetVoxelKeys);
  const coveredTargets = new Set<VoxelKey>();
  const safeEdgesByDirection = Object.fromEntries(
    CUTTER_GRID_DIRECTIONS.map((direction) => [direction, 0]),
  ) as Record<CutterGridDirection, number>;
  let directedEdgeCount = 0;
  let safeDirectedEdgeCount = 0;
  let safeEmptyEdgeCount = 0;
  let safeCutEdgeCount = 0;

  const nodes = enumerateCutterGridCoords(bounds);
  for (const start of nodes) {
    for (const direction of CUTTER_GRID_DIRECTIONS) {
      const end = moveCutterGridCoord(start, direction);
      if (!cutterGridBoundsContain(bounds, end)) {
        continue;
      }
      directedEdgeCount += 1;
      const hits = edgeHits(start, end, challenge);
      if (!hits.every((key) => targetSet.has(key))) {
        continue;
      }
      safeDirectedEdgeCount += 1;
      safeEdgesByDirection[direction] += 1;
      if (hits.length === 0) {
        safeEmptyEdgeCount += 1;
      } else {
        safeCutEdgeCount += 1;
        hits.forEach((key) => coveredTargets.add(key));
      }
    }
  }

  const hairHits = findSweptVoxelHits(
    originWorldPosition,
    originWorldPosition,
    challenge.initialHair.voxels,
    challenge.voxelConfig,
    challenge.robotConfig.geometry.toolRadius,
  ).sort();
  const uncoveredTargetVoxelKeys = targetVoxelKeys.filter(
    (key) => !coveredTargets.has(key),
  );
  const directionsWithoutSafeEdge = CUTTER_GRID_DIRECTIONS.filter(
    (direction) => safeEdgesByDirection[direction] === 0,
  );

  return {
    version: 1,
    challengeSignature: cutterGridChallengeSignature(challenge),
    originCandidate: {
      hairCoord: originHairCoord,
      worldPosition: originWorldPosition,
      distanceFromInitialEndEffector: distance(
        initialPose.endEffector,
        originWorldPosition,
      ),
      hairHits,
    },
    bounds,
    nodeCount: nodes.length,
    directedEdgeCount,
    safeDirectedEdgeCount,
    safeEmptyEdgeCount,
    safeCutEdgeCount,
    safeEdgesByDirection,
    targetVoxelKeys,
    uncoveredTargetVoxelKeys,
    directionsWithoutSafeEdge,
    geometricGatePassed:
      hairHits.length === 0 &&
      uncoveredTargetVoxelKeys.length === 0 &&
      directionsWithoutSafeEdge.length === 0,
    trajectoryCertification: 'pending-planner',
  };
}

function edgeHits(
  start: CutterGridCoord,
  end: CutterGridCoord,
  challenge: Challenge,
): VoxelKey[] {
  return findSweptVoxelHits(
    hairCoordToWorld(start, challenge.voxelConfig),
    hairCoordToWorld(end, challenge.voxelConfig),
    challenge.initialHair.voxels,
    challenge.voxelConfig,
    challenge.robotConfig.geometry.toolRadius,
  ).sort();
}

function hairCoordToWorld(
  coord: CutterGridCoord,
  voxelConfig: Challenge['voxelConfig'],
): Vec3Tuple {
  return voxelCoordToWorld(
    { x: coord[0], y: coord[1], z: coord[2] },
    voxelConfig.origin,
    voxelConfig.size,
  );
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

export function compareOriginCandidates(
  initialEndEffector: Vec3Tuple,
  left: CutterGridCoord,
  right: CutterGridCoord,
  voxelConfig: Challenge['voxelConfig'],
): number {
  const distanceDelta =
    distance(hairCoordToWorld(left, voxelConfig), initialEndEffector) -
    distance(hairCoordToWorld(right, voxelConfig), initialEndEffector);
  return distanceDelta || compareCutterGridCoords(left, right);
}

