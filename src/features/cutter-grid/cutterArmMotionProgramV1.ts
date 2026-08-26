import type { Challenge, JointId } from '../../types/domain';
import { fnv1a64 } from './signature';
import type {
  CutterArmMotionInstructionV1,
  CutterArmMotionProgramV1,
  CutterTrajectoryBoundaryStateV4,
  CutterTrajectoryPlanV4,
} from './types';

/**
 * Serializes the compact V4 motion contract without granting any transport
 * authority. The resulting object is for fixture and firmware-interface
 * verification only; ArmDock deliberately rejects it in this release.
 */
export function buildCutterArmMotionProgramV1(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV4,
): CutterArmMotionProgramV1 {
  const instructions: CutterArmMotionInstructionV1[] = [
    ...plan.positioning.primitives.map((primitive) => ({
      kind: 'sync-ptp' as const,
      phase: 'positioning' as const,
      durationMs: primitive.durationMs,
      start: cloneBoundary(primitive.start),
      end: cloneBoundary(primitive.end),
    })),
    ...plan.actions.flatMap(toPlayerInstructions),
  ];
  const unsigned: Omit<CutterArmMotionProgramV1, 'programSignature'> = {
    kind: 'cutter-arm-motion-program',
    version: 1,
    robotProfileSignature: cutterArmRobotProfileSignatureV1(challenge),
    trajectorySignature: plan.trajectorySignature,
    instructions,
  };
  const program = {
    ...unsigned,
    programSignature: fnv1a64(JSON.stringify(unsigned)),
  };
  validateCutterArmMotionProgramV1(challenge, program);
  return program;
}

/** Validates only the future payload contract; it never opens a hardware link. */
export function validateCutterArmMotionProgramV1(
  challenge: Challenge,
  program: CutterArmMotionProgramV1,
): void {
  if (program.kind !== 'cutter-arm-motion-program' || program.version !== 1) {
    throw new Error('Unsupported Cutter Arm motion program version.');
  }
  if (program.robotProfileSignature !== cutterArmRobotProfileSignatureV1(challenge)) {
    throw new Error('Cutter Arm motion program robot profile signature does not match this challenge.');
  }
  if (!program.trajectorySignature || !program.programSignature || program.instructions.length === 0) {
    throw new Error('Cutter Arm motion program must carry non-empty signatures and instructions.');
  }
  const { programSignature, ...unsigned } = program;
  if (programSignature !== fnv1a64(JSON.stringify(unsigned))) {
    throw new Error('Cutter Arm motion program signature mismatch.');
  }
  for (const instruction of program.instructions) {
    if (!Number.isFinite(instruction.durationMs) || instruction.durationMs <= 0) {
      throw new Error('Cutter Arm motion instruction duration must be finite and positive.');
    }
    if (instruction.kind === 'sync-ptp') {
      validateBoundary(challenge, instruction.start);
      validateBoundary(challenge, instruction.end);
    }
  }
}

export function cutterArmRobotProfileSignatureV1(challenge: Challenge): string {
  return fnv1a64(JSON.stringify({
    robot: challenge.robotConfig,
  }));
}

function cloneBoundary(state: CutterTrajectoryBoundaryStateV4): CutterTrajectoryBoundaryStateV4 {
  return {
    jointAngles: { ...state.jointAngles },
    jointVelocitiesDegPerSec: { ...state.jointVelocitiesDegPerSec },
    jointAccelerationsDegPerSec2: { ...state.jointAccelerationsDegPerSec2 },
  };
}

function toPlayerInstructions(
  action: CutterTrajectoryPlanV4['actions'][number],
): CutterArmMotionInstructionV1[] {
  if (action.type === 'wait') {
    return [{
      kind: 'wait',
      phase: 'player',
      durationMs: action.durationMs,
      sourceBlockId: action.sourceBlockId,
    }];
  }
  return action.primitives.map((primitive) => ({
    kind: 'sync-ptp',
    phase: 'player',
    durationMs: primitive.durationMs,
    sourceBlockId: action.sourceBlockId,
    start: cloneBoundary(primitive.start),
    end: cloneBoundary(primitive.end),
  }));
}

function validateBoundary(
  challenge: Challenge,
  state: CutterTrajectoryBoundaryStateV4,
): void {
  for (const joint of challenge.robotConfig.joints) {
    assertFiniteJointValue(state.jointAngles[joint.id], joint.id, 'angle');
    assertFiniteJointValue(state.jointVelocitiesDegPerSec[joint.id], joint.id, 'velocity');
    assertFiniteJointValue(state.jointAccelerationsDegPerSec2[joint.id], joint.id, 'acceleration');
    if (
      state.jointAngles[joint.id] < joint.minAngleDeg ||
      state.jointAngles[joint.id] > joint.maxAngleDeg
    ) throw new Error(`Cutter Arm motion ${joint.id} angle is outside its configured limit.`);
  }
}

function assertFiniteJointValue(value: number, jointId: JointId, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Cutter Arm motion ${label} for ${jointId} must be finite.`);
  }
}
