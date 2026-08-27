import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision, measureRobotHeadClearance } from '../robot/headCollision';
import { computeRobotPose, createInitialJointAngles } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { fnv1a64 } from './signature';
import type {
  CutterGridEntryOptionV2,
  CutterTrajectoryWaypointV2,
} from './types';
import { normalizedJointDistance } from './ik';

export const CUTTER_GRID_ENTRY_CONFIG = Object.freeze({
  maxJointSampleDeltaDeg: 0.5,
  maxEndEffectorSampleDistanceDivisor: 16,
  // A joint-angle grid does not bound tool travel on its own: the same 0.5°
  // step sweeps further the more the arm is extended, so the sample spacing
  // the certification is written against has to be reached by refinement.
  maxSampleRefinements: 6,
  prmInitialHaltonNodes: 2048,
  prmMaximumHaltonNodes: 8192,
  prmNeighbors: 24,
});

interface EntryValidation {
  waypoints: CutterTrajectoryWaypointV2[];
  minimumHeadClearance: number;
}

export interface CutterGridEntryPlanningOptions {
  /**
   * Profile generation certifies every origin candidate it can reach directly
   * before it pays for the PRM. The fallback stays reachable — it just no
   * longer runs for a candidate the Profile does not need.
   */
  allowPrmFallback?: boolean;
}

/**
 * Certify an entry from the Servo initial pose to one logical-origin IK
 * candidate. Direct synchronized motion is always attempted first. The PRM
 * fallback is deterministic and only lives in Profile generation; it never
 * gives a player Cartesian freedom to route around hair.
 */
export function planCertifiedCutterGridEntry(
  challenge: Challenge,
  id: string,
  targetAngles: Readonly<Record<JointId, number>>,
  options: CutterGridEntryPlanningOptions = {},
): CutterGridEntryOptionV2 | undefined {
  const initial = createInitialJointAngles(challenge.robotConfig);
  const direct = validateJointSpaceEntrySegment(challenge, initial, targetAngles);
  const validated = direct ??
    (options.allowPrmFallback === false
      ? undefined
      : planPrmEntry(challenge, initial, targetAngles));
  if (!validated) return undefined;
  const jointAngles = copyAngles(targetAngles, challenge);
  return {
    id,
    jointAngles,
    positioningTrajectory: validated.waypoints,
    positioningSignature: entryTrajectorySignature(id, validated.waypoints),
    minimumHeadClearance: validated.minimumHeadClearance,
  };
}

/** Exposed for deterministic PRM/entry tests and Profile re-certification. */
export function validateJointSpaceEntrySegment(
  challenge: Challenge,
  startAngles: Readonly<Record<JointId, number>>,
  endAngles: Readonly<Record<JointId, number>>,
): EntryValidation | undefined {
  if (!jointAnglesValid(challenge, startAngles) || !jointAnglesValid(challenge, endAngles)) {
    return undefined;
  }
  let durationMs = 1;
  let sampleCount = 1;
  for (const joint of challenge.robotConfig.joints) {
    const delta = Math.abs(endAngles[joint.id] - startAngles[joint.id]);
    // The maximum derivative of the zero-tangent cubic is 1.5 * delta.
    durationMs = Math.max(durationMs, Math.ceil((1.5 * delta / joint.speedDegPerSec) * 1000));
    sampleCount = Math.max(
      sampleCount,
      Math.ceil((1.5 * delta) / CUTTER_GRID_ENTRY_CONFIG.maxJointSampleDeltaDeg),
    );
  }
  const maximumSampleDistance =
    challenge.voxelConfig.size / CUTTER_GRID_ENTRY_CONFIG.maxEndEffectorSampleDistanceDivisor;
  // Rejecting a segment whose samples land too far apart would confuse "not
  // resolved finely enough to certify" with "unsafe". Refine the grid until it
  // resolves the certified distance, then run the contact checks on it: the
  // outcome is the same motion checked more strictly, never a weaker gate. A
  // segment that cannot be resolved inside the bound stays refused.
  let waypoints = sampleEntrySegment(challenge, startAngles, endAngles, sampleCount, durationMs);
  for (let refinement = 0; ; refinement += 1) {
    const widest = widestEndEffectorStep(waypoints);
    if (widest <= maximumSampleDistance + 1e-9) break;
    if (refinement >= CUTTER_GRID_ENTRY_CONFIG.maxSampleRefinements) return undefined;
    sampleCount = Math.ceil(sampleCount * Math.max(2, widest / maximumSampleDistance));
    waypoints = sampleEntrySegment(challenge, startAngles, endAngles, sampleCount, durationMs);
  }
  let minimumHeadClearance = Number.POSITIVE_INFINITY;
  for (const waypoint of waypoints) {
    const pose = computeRobotPose(challenge.robotConfig, waypoint.jointAngles);
    if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
      return undefined;
    }
    minimumHeadClearance = Math.min(
      minimumHeadClearance,
      measureRobotHeadClearance(pose, challenge.voxelConfig, challenge.robotConfig.geometry),
    );
  }
  for (let index = 1; index < waypoints.length; index += 1) {
    if (entryHairHits(challenge, waypoints[index - 1].endEffector, waypoints[index].endEffector).length > 0) {
      return undefined;
    }
  }
  return { waypoints, minimumHeadClearance };
}

function sampleEntrySegment(
  challenge: Challenge,
  startAngles: Readonly<Record<JointId, number>>,
  endAngles: Readonly<Record<JointId, number>>,
  sampleCount: number,
  durationMs: number,
): CutterTrajectoryWaypointV2[] {
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const progress = index / sampleCount;
    const smooth = smoothStep(progress);
    const slope = smoothStepDerivative(progress);
    const jointAngles = index === 0
      ? copyAngles(startAngles, challenge)
      : index === sampleCount
        ? copyAngles(endAngles, challenge)
        : Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
            joint.id,
            startAngles[joint.id] + (endAngles[joint.id] - startAngles[joint.id]) * smooth,
          ])) as Record<JointId, number>;
    const jointVelocitiesDegPerSec = Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
      joint.id,
      normalizeSignedZero(
        ((endAngles[joint.id] - startAngles[joint.id]) * slope) / (durationMs / 1000),
      ),
    ])) as Record<JointId, number>;
    return {
      timeMs: Math.round((durationMs * index) / sampleCount),
      jointAngles,
      jointVelocitiesDegPerSec,
      endEffector: computeRobotPose(challenge.robotConfig, jointAngles).endEffector,
    } satisfies CutterTrajectoryWaypointV2;
  });
}

function widestEndEffectorStep(waypoints: readonly CutterTrajectoryWaypointV2[]): number {
  let widest = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    widest = Math.max(
      widest,
      distance(waypoints[index - 1].endEffector, waypoints[index].endEffector),
    );
  }
  return widest;
}

function planPrmEntry(
  challenge: Challenge,
  initial: Record<JointId, number>,
  target: Readonly<Record<JointId, number>>,
): EntryValidation | undefined {
  for (
    let haltonCount = CUTTER_GRID_ENTRY_CONFIG.prmInitialHaltonNodes;
    haltonCount <= CUTTER_GRID_ENTRY_CONFIG.prmMaximumHaltonNodes;
    haltonCount *= 4
  ) {
    const nodes = [initial, copyAngles(target, challenge)];
    for (let index = 1; index <= haltonCount; index += 1) {
      const candidate = haltonJointAngles(challenge, index);
      const pose = computeRobotPose(challenge.robotConfig, candidate);
      if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) continue;
      nodes.push(candidate);
    }
    const path = findPrmPath(challenge, nodes);
    if (!path) continue;
    const joined = joinEntrySegments(
      path.map((angles, index) =>
        index === 0 ? undefined : validateJointSpaceEntrySegment(challenge, path[index - 1], angles),
      ),
    );
    if (joined) return joined;
  }
  return undefined;
}

function findPrmPath(
  challenge: Challenge,
  nodes: readonly Record<JointId, number>[],
): Record<JointId, number>[] | undefined {
  const adjacency = Array.from({ length: nodes.length }, () => new Map<number, EntryValidation>());
  for (let index = 1; index < nodes.length; index += 1) {
    const neighbors = Array.from({ length: index }, (_, other) => other)
      .sort((left, right) => normalizedJointDistance(
        nodes[index], nodes[left], challenge.robotConfig.joints,
      ) - normalizedJointDistance(nodes[index], nodes[right], challenge.robotConfig.joints))
      .slice(0, CUTTER_GRID_ENTRY_CONFIG.prmNeighbors);
    for (const neighbor of neighbors) {
      const edge = validateJointSpaceEntrySegment(challenge, nodes[neighbor], nodes[index]);
      if (!edge) continue;
      adjacency[index].set(neighbor, edge);
      adjacency[neighbor].set(index, edge);
    }
  }
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  distances[0] = 0;
  const pending = new Set(nodes.map((_, index) => index));
  while (pending.size > 0) {
    const current = [...pending].sort((left, right) =>
      distances[left] - distances[right] || left - right,
    )[0];
    pending.delete(current);
    if (!Number.isFinite(distances[current])) break;
    if (current === 1) break;
    for (const neighbor of [...adjacency[current].keys()].sort((left, right) => left - right)) {
      if (!pending.has(neighbor)) continue;
      const cost = normalizedJointDistance(nodes[current], nodes[neighbor], challenge.robotConfig.joints) ** 2;
      const candidate = distances[current] + cost;
      if (candidate < distances[neighbor] - 1e-12) {
        distances[neighbor] = candidate;
        previous[neighbor] = current;
      }
    }
  }
  if (!Number.isFinite(distances[1])) return undefined;
  const result: Record<JointId, number>[] = [];
  for (let node = 1; node >= 0; node = previous[node]) {
    result.push(nodes[node]);
    if (node === 0) break;
  }
  return result.reverse();
}

function joinEntrySegments(
  segments: ReadonlyArray<EntryValidation | undefined>,
): EntryValidation | undefined {
  const waypoints: CutterTrajectoryWaypointV2[] = [];
  let elapsed = 0;
  let minimumHeadClearance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    if (!segment) continue;
    for (const [index, waypoint] of segment.waypoints.entries()) {
      if (waypoints.length > 0 && index === 0) continue;
      waypoints.push({ ...waypoint, timeMs: elapsed + waypoint.timeMs });
    }
    elapsed = waypoints.at(-1)?.timeMs ?? elapsed;
    minimumHeadClearance = Math.min(minimumHeadClearance, segment.minimumHeadClearance);
  }
  return waypoints.length > 1 ? { waypoints, minimumHeadClearance } : undefined;
}

function haltonJointAngles(challenge: Challenge, index: number): Record<JointId, number> {
  const primes = [2, 3, 5, 7, 11];
  return Object.fromEntries(challenge.robotConfig.joints.map((joint, jointIndex) => [
    joint.id,
    joint.minAngleDeg + radicalInverse(index, primes[jointIndex] ?? 13) *
      (joint.maxAngleDeg - joint.minAngleDeg),
  ])) as Record<JointId, number>;
}

function entryHairHits(challenge: Challenge, start: Vec3Tuple, end: Vec3Tuple): VoxelKey[] {
  return findSweptVoxelHits(
    start,
    end,
    challenge.initialHair.voxels,
    challenge.voxelConfig,
    challenge.robotConfig.geometry.toolRadius,
  );
}

function jointAnglesValid(challenge: Challenge, angles: Readonly<Record<JointId, number>>): boolean {
  return challenge.robotConfig.joints.every((joint) =>
    Number.isFinite(angles[joint.id]) &&
    angles[joint.id] >= joint.minAngleDeg &&
    angles[joint.id] <= joint.maxAngleDeg,
  );
}

function copyAngles(
  angles: Readonly<Record<JointId, number>>,
  challenge: Challenge,
): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
    joint.id,
    angles[joint.id],
  ])) as Record<JointId, number>;
}

function entryTrajectorySignature(id: string, waypoints: readonly CutterTrajectoryWaypointV2[]): string {
  return fnv1a64(JSON.stringify({
    id,
    waypoints: waypoints.map((waypoint) => ({
      timeMs: waypoint.timeMs,
      jointAngles: waypoint.jointAngles,
      jointVelocitiesDegPerSec: waypoint.jointVelocitiesDegPerSec,
      endEffector: waypoint.endEffector,
    })),
  }));
}

function smoothStep(progress: number): number {
  return 3 * progress ** 2 - 2 * progress ** 3;
}

function smoothStepDerivative(progress: number): number {
  return 6 * progress - 6 * progress ** 2;
}

function normalizeSignedZero(value: number): number {
  return value === 0 ? 0 : value;
}

function radicalInverse(value: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let remaining = value;
  while (remaining > 0) {
    result += (remaining % base) * fraction;
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return result;
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
