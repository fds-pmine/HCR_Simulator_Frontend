import type {
  Challenge,
  JointId,
  Vec3Tuple,
} from '../../types/domain';
import type { RobotPose } from './kinematics';

export type RobotCollisionPart =
  | 'base'
  | 'shoulder-joint'
  | 'upper-arm'
  | 'elbow-joint'
  | 'forearm'
  | 'wrist-joint'
  | 'tool-shaft'
  | 'end-effector';

export interface HeadCollision {
  part: RobotCollisionPart;
  partLabel: string;
}

export interface BlockedHeadCollision extends HeadCollision {
  jointId: JointId;
  safeAngleDeg: number;
}

export interface RobotHeadCollisionPrimitive {
  part: RobotCollisionPart;
  partLabel: string;
  start: Vec3Tuple;
  end: Vec3Tuple;
  radius: number;
}

export function findRobotHeadCollision(
  pose: RobotPose,
  voxelConfig: Challenge['voxelConfig'],
  geometry: Challenge['robotConfig']['geometry'],
): HeadCollision | undefined {
  return robotHeadCollisionPrimitives(pose, geometry).find((primitive) =>
    segmentIntersectsExpandedEllipsoid(
      primitive.start,
      primitive.end,
      voxelConfig.headCenter,
      voxelConfig.headScale,
      primitive.radius + geometry.collision.headClearance,
    ),
  );
}

/**
 * The single source of robot collision primitives.  Clearance metrics and
 * boolean collision checks must consume this exact list so a planner can never
 * rank a pose as safe that the runtime would reject.
 */
export function robotHeadCollisionPrimitives(
  pose: RobotPose,
  geometry: Challenge['robotConfig']['geometry'],
): RobotHeadCollisionPrimitive[] {
  const { collision } = geometry;
  return [
    {
      part: 'base',
      partLabel: 'Base',
      start: pose.base,
      end: pose.shoulder,
      radius: collision.jointRadius,
    },
    {
      part: 'shoulder-joint',
      partLabel: 'Shoulder Joint',
      start: pose.shoulder,
      end: pose.shoulder,
      radius: collision.jointRadius,
    },
    {
      part: 'upper-arm',
      partLabel: 'Upper Arm Link',
      start: pose.shoulder,
      end: pose.elbow,
      radius: collision.linkRadius,
    },
    {
      part: 'elbow-joint',
      partLabel: 'Elbow Joint',
      start: pose.elbow,
      end: pose.elbow,
      radius: collision.jointRadius,
    },
    {
      part: 'forearm',
      partLabel: 'Forearm Link',
      start: pose.elbow,
      end: pose.wrist,
      radius: collision.linkRadius,
    },
    {
      part: 'wrist-joint',
      partLabel: 'Wrist Joint',
      start: pose.wrist,
      end: pose.wrist,
      radius: collision.jointRadius,
    },
    {
      part: 'tool-shaft',
      partLabel: 'Tool Shaft',
      start: pose.toolBase,
      end: pose.endEffector,
      radius: collision.toolShaftRadius,
    },
    {
      part: 'end-effector',
      partLabel: 'End Effector',
      start: pose.endEffector,
      end: pose.endEffector,
      radius: geometry.toolRadius,
    },
  ];
}

/**
 * Conservative signed world-space clearance to the exact expanded-head test
 * used by {@link findRobotHeadCollision}.  Positive values are safe, zero is
 * contact, and negative values overlap the existing safety margin.
 */
export function measureRobotHeadClearance(
  pose: RobotPose,
  voxelConfig: Challenge['voxelConfig'],
  geometry: Challenge['robotConfig']['geometry'],
): number {
  return Math.min(
    ...robotHeadCollisionPrimitives(pose, geometry).map((primitive) => {
      const collisionExpansion = primitive.radius + geometry.collision.headClearance;
      const contactExpansion = minimumEllipsoidExpansionForSegment(
        primitive.start,
        primitive.end,
        voxelConfig.headCenter,
        voxelConfig.headScale,
      );
      return contactExpansion - collisionExpansion;
    }),
  );
}

function minimumEllipsoidExpansionForSegment(
  start: Vec3Tuple,
  end: Vec3Tuple,
  center: Vec3Tuple,
  scale: Vec3Tuple,
): number {
  if (segmentIntersectsExpandedEllipsoid(start, end, center, scale, 0)) {
    return 0;
  }
  let low = 0;
  let high = Math.max(scale[0], scale[1], scale[2], 1);
  while (!segmentIntersectsExpandedEllipsoid(start, end, center, scale, high)) {
    high *= 2;
    if (high > 1_024) return high;
  }
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    if (segmentIntersectsExpandedEllipsoid(start, end, center, scale, middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

export function segmentIntersectsExpandedEllipsoid(
  start: Vec3Tuple,
  end: Vec3Tuple,
  center: Vec3Tuple,
  scale: Vec3Tuple,
  expansion: number,
): boolean {
  const axes: Vec3Tuple = [
    scale[0] + expansion,
    scale[1] + expansion,
    scale[2] + expansion,
  ];
  const normalizedStart = normalizePoint(start, center, axes);
  const normalizedEnd = normalizePoint(end, center, axes);
  const direction: Vec3Tuple = [
    normalizedEnd[0] - normalizedStart[0],
    normalizedEnd[1] - normalizedStart[1],
    normalizedEnd[2] - normalizedStart[2],
  ];
  const lengthSquared = dot(direction, direction);
  const closestT =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            -dot(normalizedStart, direction) / lengthSquared,
          ),
        );
  const closest: Vec3Tuple = [
    normalizedStart[0] + direction[0] * closestT,
    normalizedStart[1] + direction[1] * closestT,
    normalizedStart[2] + direction[2] * closestT,
  ];

  return dot(closest, closest) <= 1;
}

function normalizePoint(
  point: Vec3Tuple,
  center: Vec3Tuple,
  axes: Vec3Tuple,
): Vec3Tuple {
  return [
    (point[0] - center[0]) / axes[0],
    (point[1] - center[1]) / axes[1],
    (point[2] - center[2]) / axes[2],
  ];
}

function dot(left: Vec3Tuple, right: Vec3Tuple): number {
  return (
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2]
  );
}
