import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { scalpGeometrySignature } from './geometrySignature';
import type { JointAngles, ScalpMotionProfile, SafetyPose } from './types';

export interface PoseValidationResult {
  valid: boolean;
  error?: string;
  endEffector?: Vec3Tuple;
  toolDirection?: Vec3Tuple;
}

export function validateSafetyPose(
  pose: SafetyPose,
  challenge: Pick<Challenge, 'robotConfig' | 'voxelConfig'>,
): PoseValidationResult {
  const jointError = validateJointAngles(pose.jointAngles, challenge);
  if (jointError) {
    return { valid: false, error: `${pose.id}: ${jointError}` };
  }

  const robotPose = computeRobotPose(challenge.robotConfig, pose.jointAngles);
  const collision = findRobotHeadCollision(
    robotPose,
    challenge.voxelConfig,
    challenge.robotConfig.geometry,
  );
  if (collision) {
    return {
      valid: false,
      error: `${pose.id}: ${collision.partLabel} intersects the head.`,
    };
  }

  return {
    valid: true,
    endEffector: robotPose.endEffector,
    toolDirection: normalize(subtract(robotPose.endEffector, robotPose.toolBase)),
  };
}

export function validateScalpMotionProfile(
  profile: ScalpMotionProfile,
  challenge: Pick<Challenge, 'robotConfig' | 'voxelConfig'>,
): string[] {
  const errors: string[] = [];
  if (profile.geometrySignature !== scalpGeometrySignature(challenge)) {
    errors.push('The profile geometry signature does not match this challenge.');
  }

  const nodeIds = new Set(profile.nodes.map((node) => node.id));
  const poseIds = new Set(profile.poses.map((pose) => pose.id));
  if (!nodeIds.has(profile.startNodeId)) {
    errors.push('The profile start node does not exist.');
  }
  if (!poseIds.has(profile.parkPoseId)) {
    errors.push('The profile park pose does not exist.');
  }

  for (const node of profile.nodes) {
    for (const neighborId of Object.values(node.neighbors)) {
      if (!nodeIds.has(neighborId)) {
        errors.push(`${node.id}: neighbor ${neighborId} does not exist.`);
      }
    }
    if (node.reachable && (!node.hoverPoseId || !node.cutPoseId)) {
      errors.push(`${node.id}: reachable nodes require Hover and Cut poses.`);
    }
  }

  for (const pose of profile.poses) {
    const result = validateSafetyPose(pose, challenge);
    if (!result.valid) {
      errors.push(result.error!);
    }
  }

  for (const edge of profile.edges) {
    if (!poseIds.has(edge.from) || !poseIds.has(edge.to)) {
      errors.push(`${edge.id}: edge endpoint does not exist.`);
    }
    if (edge.synchronousWaypoints.length === 0 || edge.legacyWaypoints.length === 0) {
      errors.push(`${edge.id}: both waypoint recipes must be non-empty.`);
    }
  }
  return errors;
}

function validateJointAngles(
  angles: JointAngles,
  challenge: Pick<Challenge, 'robotConfig'>,
): string | undefined {
  const configured = new Set<JointId>();
  for (const joint of challenge.robotConfig.joints) {
    configured.add(joint.id);
    const value = angles[joint.id];
    if (!Number.isFinite(value)) {
      return `missing or invalid ${joint.id} angle.`;
    }
    if (value < joint.minAngleDeg || value > joint.maxAngleDeg) {
      return `${joint.id} is outside its configured range.`;
    }
  }
  for (const id of Object.keys(angles)) {
    if (!configured.has(id)) {
      return `contains unknown joint ${id}.`;
    }
  }
  return undefined;
}

function subtract(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

function normalize(value: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(...value);
  return length === 0
    ? [0, 0, 0]
    : [value[0] / length, value[1] / length, value[2] / length];
}
