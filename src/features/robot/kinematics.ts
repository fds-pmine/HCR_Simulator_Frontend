import type {
  Challenge,
  JointConfig,
  JointId,
  RobotGeometryConfig,
  Vec3Tuple,
} from '../../types/domain';
import { toGeometricDeg } from './servoMapping';

export interface RobotPose {
  base: Vec3Tuple;
  shoulder: Vec3Tuple;
  shoulderRoll: Vec3Tuple;
  elbow: Vec3Tuple;
  wrist: Vec3Tuple;
  toolBase: Vec3Tuple;
  endEffector: Vec3Tuple;
  jointPositions: Record<JointId, Vec3Tuple>;
}

export function computeRobotPose(
  robotConfig: Challenge['robotConfig'],
  jointAngles: Readonly<Record<JointId, number>>,
): RobotPose {
  const { geometry } = robotConfig;
  // `jointAngles` is in servo degrees; the rotations below are geometric. This
  // is the boundary between the two, and the only one — every other consumer of
  // a pose goes through this function.
  const read = (jointId: JointId): number =>
    degreesToRadians(readAngle(robotConfig.joints, jointAngles, jointId));
  const baseYaw = read('baseYaw');
  const shoulderRollAngle = read('shoulderRoll');
  const shoulderAngle = read('shoulder');
  const elbowAngle = read('elbow');
  const wristAngle = read('wrist');

  const base = geometry.basePosition;
  const shoulder: Vec3Tuple = [
    base[0],
    base[1] + geometry.shoulderHeight,
    base[2],
  ];
  const shoulderRoll = shoulder;
  const baseRotation = rotationY(baseYaw);
  const rollRotation = multiplyMatrices(
    baseRotation,
    rotationX(shoulderRollAngle),
  );
  const shoulderRotation = multiplyMatrices(
    rollRotation,
    rotationZ(shoulderAngle),
  );
  const elbow = addTransformedLink(
    shoulder,
    geometry.upperArmLength,
    shoulderRotation,
  );
  const elbowRotation = multiplyMatrices(
    shoulderRotation,
    rotationZ(elbowAngle),
  );
  const wrist = addTransformedLink(
    elbow,
    geometry.forearmLength,
    elbowRotation,
  );
  const wristRotation = multiplyMatrices(
    elbowRotation,
    rotationZ(wristAngle),
  );
  const toolBase = wrist;
  const endEffector = addTransformedLink(
    toolBase,
    geometry.toolLength,
    wristRotation,
  );

  return {
    base,
    shoulder,
    shoulderRoll,
    elbow,
    wrist,
    toolBase,
    endEffector,
    jointPositions: {
      baseYaw: shoulder,
      shoulderRoll,
      shoulder,
      elbow,
      wrist,
    },
  };
}

export function createInitialJointAngles(
  robotConfig: Challenge['robotConfig'],
): Record<JointId, number> {
  return Object.fromEntries(
    robotConfig.joints.map((joint) => [joint.id, joint.initialAngleDeg]),
  );
}

export function linkLengths(
  geometry: RobotGeometryConfig,
): readonly [number, number, number] {
  return [
    geometry.upperArmLength,
    geometry.forearmLength,
    geometry.toolLength,
  ];
}

type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function addTransformedLink(
  start: Vec3Tuple,
  length: number,
  rotation: Matrix3,
): Vec3Tuple {
  const direction = transformDirection(rotation, [length, 0, 0]);
  return [
    start[0] + direction[0],
    start[1] + direction[1],
    start[2] + direction[2],
  ];
}

function transformDirection(
  matrix: Matrix3,
  vector: Vec3Tuple,
): Vec3Tuple {
  return [
    matrix[0] * vector[0] +
      matrix[1] * vector[1] +
      matrix[2] * vector[2],
    matrix[3] * vector[0] +
      matrix[4] * vector[1] +
      matrix[5] * vector[2],
    matrix[6] * vector[0] +
      matrix[7] * vector[1] +
      matrix[8] * vector[2],
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
    left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
    left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
    left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
    left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
    left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
    left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ];
}

function rotationX(angle: number): Matrix3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [1, 0, 0, 0, cosine, -sine, 0, sine, cosine];
}

function rotationY(angle: number): Matrix3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine];
}

function rotationZ(angle: number): Matrix3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1];
}

function readAngle(
  joints: readonly JointConfig[],
  jointAngles: Readonly<Record<JointId, number>>,
  jointId: JointId,
): number {
  const angle = jointAngles[jointId];
  if (!Number.isFinite(angle)) {
    throw new Error(`Missing or invalid angle for joint "${jointId}".`);
  }
  const joint = joints.find((candidate) => candidate.id === jointId);
  if (!joint) {
    throw new Error(`No joint configured with id "${jointId}".`);
  }
  return toGeometricDeg(joint, angle);
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
