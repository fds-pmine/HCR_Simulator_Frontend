import type {
  AllowedBlockType,
  ChallengeDefinition,
  JointConfig,
  VoxelCoord,
} from '../types/domain';
import { validateScoringConfig } from '../features/scoring/scoring';
import { coordToKey } from '../features/voxel/voxelKey';
import {
  computeRobotPose,
  createInitialJointAngles,
} from '../features/robot/kinematics';
import { findRobotHeadCollision } from '../features/robot/headCollision';
import { assertServoRange } from '../features/robot/servoMapping';

const ALLOWED_BLOCKS = new Set<AllowedBlockType>([
  'set-joint-angle',
  'wait',
  'repeat',
]);

export class ChallengeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeValidationError';
  }
}

export function validateChallengeDefinition(
  definition: ChallengeDefinition,
): void {
  assertNonEmpty(definition.id, 'Challenge id');
  assertNonEmpty(definition.name, 'Challenge name');
  assertNonEmpty(definition.description, 'Challenge description');

  if (definition.robotConfig.joints.length === 0) {
    fail('Challenge must define at least one joint.');
  }

  const jointIds = new Set<string>();
  for (const joint of definition.robotConfig.joints) {
    validateJoint(joint);
    if (jointIds.has(joint.id)) {
      fail(`Duplicate joint id "${joint.id}".`);
    }
    jointIds.add(joint.id);
  }

  const { geometry } = definition.robotConfig;
  if (!geometry.collision) {
    fail('Robot collision geometry is required.');
  }
  const geometryValues = [
    geometry.shoulderHeight,
    geometry.upperArmLength,
    geometry.forearmLength,
    geometry.toolLength,
    geometry.toolRadius,
    geometry.collision.linkRadius,
    geometry.collision.jointRadius,
    geometry.collision.toolShaftRadius,
  ];
  if (
    geometryValues.some(
      (value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0,
    )
  ) {
    fail('Robot geometry lengths and radius must be greater than 0.');
  }
  if (
    !Number.isFinite(geometry.collision.headClearance) ||
    geometry.collision.headClearance < 0
  ) {
    fail('Robot head clearance must be a finite non-negative number.');
  }

  if (
    !Number.isFinite(definition.voxelConfig.size) ||
    definition.voxelConfig.size <= 0
  ) {
    fail('Voxel size must be greater than 0.');
  }
  validateVector(geometry.basePosition, 'Robot base position');
  validateVector(definition.voxelConfig.origin, 'Voxel origin');
  validateVector(definition.voxelConfig.headCenter, 'Head center');
  if (
    definition.voxelConfig.headScale.some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  ) {
    fail('Head scale axes must be finite numbers greater than 0.');
  }

  const initialCollision = findRobotHeadCollision(
    computeRobotPose(
      definition.robotConfig,
      createInitialJointAngles(definition.robotConfig),
    ),
    definition.voxelConfig,
    definition.robotConfig.geometry,
  );
  if (initialCollision) {
    fail(
      `Initial robot pose collides with the head at "${initialCollision.part}".`,
    );
  }

  validateVoxelDefinition(definition.initialHair.voxels, 'Initial hair');
  validateVoxelDefinition(definition.targetHair.voxels, 'Target hair');

  if (definition.targetHair.voxels.length === 0) {
    fail('Target hair must not be empty.');
  }

  const initialKeys = new Set(
    definition.initialHair.voxels.map(coordToKey),
  );
  const missingTarget = definition.targetHair.voxels.find(
    (voxel) => !initialKeys.has(coordToKey(voxel)),
  );
  if (missingTarget) {
    fail(
      `Target voxel "${coordToKey(missingTarget)}" is not in initial hair.`,
    );
  }

  if (definition.allowedBlocks.length === 0) {
    fail('At least one Blockly type must be allowed.');
  }
  if (
    new Set(definition.allowedBlocks).size !==
    definition.allowedBlocks.length
  ) {
    fail('Allowed Blockly types must be unique.');
  }
  for (const block of definition.allowedBlocks) {
    if (!ALLOWED_BLOCKS.has(block)) {
      fail(`Unsupported Blockly type "${block}".`);
    }
  }

  try {
    validateScoringConfig(definition.scoring);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Invalid scoring config.');
  }
}

function validateJoint(joint: JointConfig): void {
  assertNonEmpty(joint.id, 'Joint id');
  assertNonEmpty(joint.name, 'Joint name');
  if (
    !Number.isFinite(joint.minAngleDeg) ||
    !Number.isFinite(joint.maxAngleDeg) ||
    joint.minAngleDeg >= joint.maxAngleDeg
  ) {
    fail(`Joint "${joint.id}" has an invalid angle range.`);
  }
  if (
    !Number.isFinite(joint.initialAngleDeg) ||
    joint.initialAngleDeg < joint.minAngleDeg ||
    joint.initialAngleDeg > joint.maxAngleDeg
  ) {
    fail(`Joint "${joint.id}" has an invalid initial angle.`);
  }
  if (!Number.isFinite(joint.speedDegPerSec) || joint.speedDegPerSec <= 0) {
    fail(`Joint "${joint.id}" speed must be greater than 0.`);
  }
  // A joint configured past its servo's travel does not look wrong on screen —
  // it simulates correctly and then the arm cannot reproduce it. Refuse the
  // definition instead, which matters most when `offsetDeg` is being changed
  // from a measurement and a slip shifts a whole joint off the end.
  try {
    assertServoRange(joint);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function validateVoxelDefinition(
  voxels: readonly VoxelCoord[],
  label: string,
): void {
  const keys = new Set<string>();
  for (const voxel of voxels) {
    let key: string;
    try {
      key = coordToKey(voxel);
    } catch {
      fail(`${label} contains a non-integer coordinate.`);
    }
    if (keys.has(key)) {
      fail(`${label} contains duplicate voxel "${key}".`);
    }
    keys.add(key);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    fail(`${label} must not be empty.`);
  }
}

function validateVector(
  value: readonly number[],
  label: string,
): void {
  if (
    value.length !== 3 ||
    value.some((component) => !Number.isFinite(component))
  ) {
    fail(`${label} must contain three finite numbers.`);
  }
}

function fail(message: string): never {
  throw new ChallengeValidationError(message);
}
