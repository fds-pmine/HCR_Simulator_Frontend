import type { Challenge, JointId, ServoAxisId } from '../../types/domain';
import type { RobotCommand } from '../blockly/programTypes';

/**
 * The renderer's view of the physical arm.
 *
 * Present only in the Electron build, where `electron/preload.cjs` exposes it.
 * In a browser tab `window.hcrArm` is undefined and every consumer here reports
 * unavailable, because a page served over HTTPS genuinely cannot reach a
 * plain-HTTP device on the local network — that is a browser rule, not a
 * missing feature. The UI hides rather than degrades.
 */

/** One entry of the timeline main replays. */
export type ArmStep =
  | { type: 'move'; axis: ServoAxisId; value: number; durationMs: number }
  | { type: 'wait'; durationMs: number };

export interface ArmProgress {
  phase: 'step';
  index: number;
  total: number;
  step: ArmStep;
}

export interface ArmRunResult {
  completed: number;
  total: number;
  aborted: boolean;
}

/** Main answers with a tagged result so error wording survives the IPC hop. */
type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface ArmBridge {
  available: true;
  getAddress(): Promise<IpcResult<string>>;
  setAddress(address: string): Promise<IpcResult<string>>;
  check(): Promise<IpcResult<{ runtime: string }>>;
  discover(): Promise<
    IpcResult<{ station: string; address?: string; selected?: string }>
  >;
  readAngles(): Promise<IpcResult<Record<string, number>>>;
  home(): Promise<IpcResult<Record<string, number>>>;
  run(plan: readonly ArmStep[]): Promise<IpcResult<ArmRunResult>>;
  abort(): Promise<IpcResult<boolean>>;
  onProgress(listener: (progress: ArmProgress) => void): () => void;
}

declare global {
  interface Window {
    hcrArm?: ArmBridge;
  }
}

export function getArmBridge(): ArmBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.hcrArm;
}

/** Whether this build can drive hardware at all. */
export function isArmAvailable(): boolean {
  return getArmBridge()?.available === true;
}

export class ArmUnavailableError extends Error {
  constructor() {
    super('This build cannot reach the arm. Use the desktop app.');
    this.name = 'ArmUnavailableError';
  }
}

export class ArmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArmError';
  }
}

/** Unwrap main's tagged result, turning a failure back into a thrown error. */
export async function armCall<T>(
  call: (bridge: ArmBridge) => Promise<IpcResult<T>>,
): Promise<T> {
  const bridge = getArmBridge();
  if (!bridge) {
    throw new ArmUnavailableError();
  }
  const result = await call(bridge);
  if (!result.ok) {
    throw new ArmError(result.error);
  }
  return result.value;
}

/**
 * A joint the arm cannot perform, and why.
 *
 * `shoulderRoll` is the live case: the hardware is five servos and none of them
 * rolls the shoulder, so a program using it is simulation-only. Reporting that
 * before a run matters more than it might seem — silently skipping the command
 * would produce an arm that moves confidently through a *different* program
 * than the one on screen, and the learner would have no way to tell.
 */
export interface UnsupportedJoint {
  jointId: JointId;
  name: string;
}

export interface ArmPlan {
  steps: ArmStep[];
  unsupported: UnsupportedJoint[];
}

/**
 * How long to allow for the opening move to the challenge's start pose.
 *
 * Unlike every later step this one has no known starting angle — the arm is
 * wherever the last session left it — so the travel time cannot be computed.
 * A full sweep of an MG996R is comfortably inside this.
 */
const START_POSE_SETTLE_MS = 1500;

/**
 * Turn a compiled program into the timeline main replays.
 *
 * Durations come from the joint's configured speed, because the servo reports
 * no completion and the arm cannot be asked whether it has arrived. Holding for
 * the simulated travel time is the closest available approximation, and it is
 * what keeps a later command from being sent while the previous move is still
 * in flight.
 *
 * The plan opens by driving every mapped joint to the challenge's initial
 * angle. The simulator resets to that pose before each run, so without the
 * prologue the arm would replay the same commands from a different starting
 * point and diverge from the screen on the very first move.
 */
export function buildArmPlan(
  challenge: Challenge,
  commands: readonly RobotCommand[],
): ArmPlan {
  const joints = new Map(
    challenge.robotConfig.joints.map((joint) => [joint.id, joint]),
  );
  const angles: Record<JointId, number> = {};
  const steps: ArmStep[] = [];
  const unsupported = new Map<JointId, UnsupportedJoint>();

  for (const joint of challenge.robotConfig.joints) {
    angles[joint.id] = joint.initialAngleDeg;
    if (joint.servo) {
      steps.push({
        type: 'move',
        axis: joint.servo.axis,
        value: joint.initialAngleDeg,
        durationMs: 0,
      });
    }
  }
  if (steps.length > 0) {
    steps[steps.length - 1].durationMs = START_POSE_SETTLE_MS;
  }

  for (const command of commands) {
    if (command.type === 'wait') {
      steps.push({ type: 'wait', durationMs: command.durationMs });
      continue;
    }

    const joint = joints.get(command.jointId);
    if (!joint) {
      continue;
    }
    if (!joint.servo) {
      unsupported.set(joint.id, { jointId: joint.id, name: joint.name });
      continue;
    }

    const from = angles[command.jointId];
    const travelDeg = Math.abs(command.angleDeg - from);
    angles[command.jointId] = command.angleDeg;
    steps.push({
      type: 'move',
      axis: joint.servo.axis,
      value: command.angleDeg,
      durationMs: Math.round((travelDeg / joint.speedDegPerSec) * 1000),
    });
  }

  return { steps, unsupported: [...unsupported.values()] };
}
