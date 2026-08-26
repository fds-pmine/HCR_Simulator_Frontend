import type {
  Challenge,
  JointId,
  ServoAxisId,
  Vec3Tuple,
} from '../../types/domain';
import type { RobotCommand } from '../blockly/programTypes';
import type {
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryWaypointV1,
} from '../cutter-grid/types';
import { solveCutterGridIk } from '../cutter-grid/ik';
import { computeRobotPose, createInitialJointAngles } from './kinematics';

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
  | { type: 'home'; durationMs: number }
  | { type: 'move'; axis: ServoAxisId; value: number; durationMs: number }
  /**
   * Several axes in one write.
   *
   * Servo mode never needs this — one command drives one joint — but a Cutter
   * Grid waypoint moves every joint at once, and sending those as four separate
   * steps would cost four HTTP round trips to an ESP8266 per waypoint. The
   * firmware takes them in one query, and `arm.setAngles` has always accepted an
   * array; nothing had reason to pass more than one element until now.
   *
   * Note the firmware applies them **in `X, Y, Z, B, E` order, sequentially**
   * (`hcr-fw/docs/API.md`) — one request, not one simultaneous motion. Over a
   * single decimation step the deltas are small enough that the difference is
   * below the tolerance this module enforces, but it is not a synchronised move
   * and should not be described as one.
   */
  | { type: 'pose'; moves: { axis: ServoAxisId; value: number }[]; durationMs: number }
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
export const ARM_HOME_SETTLE_MS = 1500;
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
 * The plan first executes the firmware's 90° Home command, then drives every
 * mapped joint to the challenge's initial angle. Homing gives Electron a known
 * physical starting state; the challenge prologue then makes hardware and the
 * simulator agree before the learner's first command.
 */
export function buildArmPlan(
  challenge: Challenge,
  commands: readonly RobotCommand[],
): ArmPlan {
  const joints = new Map(
    challenge.robotConfig.joints.map((joint) => [joint.id, joint]),
  );
  const angles: Record<JointId, number> = {};
  const steps: ArmStep[] = [{ type: 'home', durationMs: ARM_HOME_SETTLE_MS }];
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
  if (steps.length > 1) {
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

// ---------------------------------------------------------------------------
// Cutter Grid
// ---------------------------------------------------------------------------

/**
 * Milliseconds an MG996R needs per degree of travel.
 *
 * From the vendor firmware's own `Maxdms = 1440`, the time it allows for a full
 * 180° sweep (`ESP8266.ino:101`). Used to work out whether the arm can keep up
 * with a trajectory, and to slow it down when it cannot.
 */
export const SERVO_MS_PER_DEGREE = 1440 / 180;

/**
 * The finest tolerance worth asking for.
 *
 * The firmware stores angles as tenths of a degree, so decimating to anything
 * tighter than this is measuring noise the hardware cannot represent.
 */
export const ARM_ANGLE_RESOLUTION_DEG = 0.1;

/** How far the decimation search will loosen before giving up. */
const MAX_TOLERANCE_DEG = 5;

/** What the arm will actually do, next to what was planned. */
export interface CutterArmFidelity {
  /** Waypoints in the frozen trajectory. */
  waypointCount: number;
  /** Poses the arm is actually commanded to. */
  poseCount: number;
  /** Largest joint-angle error decimation introduced, degrees. */
  jointToleranceDeg: number;
  /** Largest tool-tip error decimation introduced, metres. */
  tipDeviation: number;
  /** How long the simulation takes. */
  plannedDurationMs: number;
  /**
   * How long the arm takes.
   *
   * Longer whenever the trajectory asks for motion faster than the servos
   * manage. The path is preserved and the clock is stretched, rather than the
   * reverse: a program that arrives late is still the right program, and one
   * that cuts corners to stay on time is not.
   */
  armDurationMs: number;
}

/**
 * Why the arm cannot perform a trajectory at all.
 *
 * Distinct from `unsupported` on a servo plan, which reports commands that were
 * *skipped*. Here the missing joint is used by the planner on every waypoint, so
 * there is nothing to skip and nothing partial to send.
 */
export interface CutterArmRefusal {
  joints: UnsupportedJoint[];
  /** Where the tip would end up if the missing joints were pinned, metres. */
  tipDeviation: number;
  /** That same error in voxels, which is the unit the cut is measured in. */
  tipDeviationVoxels: number;
}

export interface CutterArmPlan {
  steps: ArmStep[];
  fidelity: CutterArmFidelity;
  /** Set when the arm cannot perform this trajectory; `steps` is then empty. */
  refusal?: CutterArmRefusal;
}

interface TimedPose {
  timeMs: number;
  angles: Readonly<Record<JointId, number>>;
  /** Cell boundaries are kept whatever the tolerance says. */
  pinned: boolean;
}

/**
 * Flatten a frozen plan into one absolute timeline.
 *
 * Waypoint times are per-step and restart at zero, so they are offset by the
 * accumulated duration. The entry trajectory comes first: it cuts nothing and is
 * not charged to the learner, but the arm still has to travel it.
 */
function flatten(
  plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2,
): TimedPose[] {
  const poses: TimedPose[] = [];
  let offset = 0;

  const positioning =
    'positioningTrajectory' in plan ? plan.positioningTrajectory : [];
  const append = (
    waypoints: readonly CutterTrajectoryWaypointV1[],
    durationMs: number,
  ): void => {
    waypoints.forEach((waypoint, index) => {
      poses.push({
        timeMs: offset + waypoint.timeMs,
        angles: waypoint.jointAngles,
        pinned: index === 0 || index === waypoints.length - 1,
      });
    });
    offset += durationMs;
  };

  if (positioning.length > 0) {
    append(positioning, positioning[positioning.length - 1]?.timeMs ?? 0);
  }
  for (const step of plan.steps) {
    append(step.waypoints, step.durationMs);
  }

  // Consecutive steps share a pose — the end of one is the start of the next —
  // and commanding it twice would stall the arm for a step of zero travel.
  return poses.filter(
    (pose, index) => index === 0 || pose.timeMs > poses[index - 1].timeMs,
  );
}

/** Largest per-joint difference between two poses, degrees. */
function jointDistance(
  left: Readonly<Record<JointId, number>>,
  right: Readonly<Record<JointId, number>>,
  jointIds: readonly JointId[],
): number {
  let worst = 0;
  for (const jointId of jointIds) {
    worst = Math.max(worst, Math.abs((left[jointId] ?? 0) - (right[jointId] ?? 0)));
  }
  return worst;
}

/**
 * Keep the fewest poses that hold every dropped one within `toleranceDeg`.
 *
 * The arm sweeps between commanded angles, so the path it actually traces is
 * roughly the linear interpolation of what it was told. A dropped waypoint is
 * therefore acceptable exactly when that interpolation still passes within
 * tolerance of it — which is what this checks, rather than sampling every nth
 * waypoint and hoping.
 */
function decimate(
  poses: readonly TimedPose[],
  jointIds: readonly JointId[],
  toleranceDeg: number,
): TimedPose[] {
  if (poses.length <= 2) {
    return [...poses];
  }

  const kept: TimedPose[] = [poses[0]];
  let anchor = 0;

  const withinTolerance = (from: number, to: number): boolean => {
    const start = poses[from];
    const end = poses[to];
    const span = end.timeMs - start.timeMs;
    for (let index = from + 1; index < to; index += 1) {
      const middle = poses[index];
      if (middle.pinned) {
        return false;
      }
      const t = span === 0 ? 0 : (middle.timeMs - start.timeMs) / span;
      for (const jointId of jointIds) {
        const interpolated =
          (start.angles[jointId] ?? 0) +
          ((end.angles[jointId] ?? 0) - (start.angles[jointId] ?? 0)) * t;
        if (Math.abs(interpolated - (middle.angles[jointId] ?? 0)) > toleranceDeg) {
          return false;
        }
      }
    }
    return true;
  };

  let candidate = 1;
  while (candidate < poses.length) {
    if (withinTolerance(anchor, candidate)) {
      candidate += 1;
      continue;
    }
    // `candidate` broke it, so the last good end was the one before.
    const keepAt = Math.max(anchor + 1, candidate - 1);
    kept.push(poses[keepAt]);
    anchor = keepAt;
    candidate = keepAt + 1;
  }

  const last = poses[poses.length - 1];
  if (kept[kept.length - 1] !== last) {
    kept.push(last);
  }
  return kept;
}

/** Worst tool-tip error the kept poses introduce, metres. */
function measureTipDeviation(
  challenge: Challenge,
  poses: readonly TimedPose[],
  kept: readonly TimedPose[],
): number {
  const tipAt = (angles: Readonly<Record<JointId, number>>): Vec3Tuple =>
    computeRobotPose(challenge.robotConfig, angles).endEffector;

  let worst = 0;
  let segment = 0;
  for (const pose of poses) {
    while (
      segment + 2 < kept.length &&
      kept[segment + 1].timeMs <= pose.timeMs
    ) {
      segment += 1;
    }
    const start = kept[segment];
    const end = kept[Math.min(segment + 1, kept.length - 1)];
    const span = end.timeMs - start.timeMs;
    const t = span === 0 ? 0 : (pose.timeMs - start.timeMs) / span;

    const blended: Record<JointId, number> = {};
    for (const joint of challenge.robotConfig.joints) {
      const from = start.angles[joint.id] ?? 0;
      const to = end.angles[joint.id] ?? 0;
      blended[joint.id] = from + (to - from) * Math.min(1, Math.max(0, t));
    }
    worst = Math.max(worst, distance(tipAt(pose.angles), tipAt(blended)));
  }
  return worst;
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

export interface CutterArmPlanOptions {
  /** Most poses the sequencer will accept. Mirrors `sequencer.MAX_STEPS`. */
  maxSteps?: number;
}

/**
 * Turn a frozen Cutter Grid trajectory into something the arm can perform.
 *
 * # Why this is not `buildArmPlan`
 *
 * A servo program is a handful of joint commands and maps to the arm almost
 * directly. A Cutter Grid trajectory is thousands of five-joint waypoints a few
 * milliseconds apart, produced by a compile-time IK search — far more than the
 * arm's step budget, and far faster than an ESP8266 answers HTTP. It has to be
 * reduced, and the reduction has to be honest about what it cost.
 *
 * # The two things that can go wrong, and what happens
 *
 * **The trajectory needs a joint the arm does not have.** Then there is no
 * reduction to make: the plan is refused with the tip error that pinning the
 * missing joint would cause. Every Cutter Grid trajectory currently hits this,
 * because the ladder planner uses `shoulderRoll` as a real degree of freedom and
 * this arm has no roll servo. Sending it anyway would move the arm confidently
 * along a path with no relation to the screen, which is the one failure this
 * whole module is built to avoid.
 *
 * **The trajectory is finer or faster than the arm.** Then it is decimated to
 * the tightest tolerance that fits the step budget, and each step is given the
 * longer of its planned duration and the time the servos need. The path is what
 * is preserved; the clock is what gives.
 */
export function buildCutterArmPlan(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2,
  options: CutterArmPlanOptions = {},
): CutterArmPlan {
  const maxSteps = options.maxSteps ?? 512;
  const motionStepBudget = Math.max(0, maxSteps - 1);
  const poses = flatten(plan);
  const plannedDurationMs = poses.length > 0 ? poses[poses.length - 1].timeMs : 0;

  const emptyFidelity: CutterArmFidelity = {
    waypointCount: poses.length,
    poseCount: 0,
    jointToleranceDeg: 0,
    tipDeviation: 0,
    plannedDurationMs,
    armDurationMs: 0,
  };

  if (poses.length === 0) {
    return { steps: [], fidelity: emptyFidelity };
  }

  // Which joints the trajectory actually drives. A joint the planner left at
  // rest costs nothing even if the arm cannot move it.
  const moved = challenge.robotConfig.joints.filter((joint) => {
    const first = poses[0].angles[joint.id] ?? 0;
    return poses.some(
      (pose) => Math.abs((pose.angles[joint.id] ?? 0) - first) > ARM_ANGLE_RESOLUTION_DEG,
    );
  });

  const missing = moved.filter((joint) => !joint.servo);
  if (missing.length > 0) {
    // Measure rather than assert. "The arm has no roll servo" is a fact about
    // the hardware; "the tool would be 3 voxels away" is what tells somebody
    // whether it matters.
    const pinned = poses.map((pose) => {
      const angles: Record<JointId, number> = { ...pose.angles };
      for (const joint of missing) {
        angles[joint.id] = joint.initialAngleDeg;
      }
      return { ...pose, angles };
    });
    let worst = 0;
    for (let index = 0; index < poses.length; index += 1) {
      worst = Math.max(
        worst,
        distance(
          computeRobotPose(challenge.robotConfig, poses[index].angles).endEffector,
          computeRobotPose(challenge.robotConfig, pinned[index].angles).endEffector,
        ),
      );
    }
    return {
      steps: [],
      fidelity: emptyFidelity,
      refusal: {
        joints: missing.map((joint) => ({ jointId: joint.id, name: joint.name })),
        tipDeviation: worst,
        tipDeviationVoxels: worst / challenge.voxelConfig.size,
      },
    };
  }

  const drivable = moved.filter((joint) => joint.servo);
  const jointIds = drivable.map((joint) => joint.id);

  // Tighten as far as the budget allows. Starting at the firmware's own
  // resolution means the usual answer is "no error worth reporting".
  let toleranceDeg = ARM_ANGLE_RESOLUTION_DEG;
  let kept = decimate(poses, jointIds, toleranceDeg);
  while (kept.length > motionStepBudget && toleranceDeg < MAX_TOLERANCE_DEG) {
    toleranceDeg = Math.min(toleranceDeg * 1.5, MAX_TOLERANCE_DEG);
    kept = decimate(poses, jointIds, toleranceDeg);
  }

  const steps: ArmStep[] = [{ type: 'home', durationMs: ARM_HOME_SETTLE_MS }];
  let armDurationMs = 0;

  kept.forEach((pose, index) => {
    const moves = drivable
      .map((joint) => ({
        axis: joint.servo!.axis,
        value: pose.angles[joint.id] ?? joint.initialAngleDeg,
      }));

    let durationMs: number;
    if (index === 0) {
      // The arm is wherever the last session left it, so the opening move has
      // no computable travel time. Same reasoning as the servo prologue.
      durationMs = START_POSE_SETTLE_MS;
    } else {
      const previous = kept[index - 1];
      const planned = pose.timeMs - previous.timeMs;
      const travelDeg = jointDistance(previous.angles, pose.angles, jointIds);
      durationMs = Math.round(
        Math.max(planned, travelDeg * SERVO_MS_PER_DEGREE),
      );
    }
    armDurationMs += durationMs;
    steps.push({ type: 'pose', moves, durationMs });
  });

  return {
    steps,
    fidelity: {
      waypointCount: poses.length,
      poseCount: kept.length,
      jointToleranceDeg: toleranceDeg,
      tipDeviation: measureTipDeviation(challenge, poses, kept),
      plannedDurationMs,
      armDurationMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Cutter Grid — endpoint playback
// ---------------------------------------------------------------------------

/** One block's destination, and the pose the arm reaches it with. */
export interface CutterArmEndpoint {
  /** Blockly block this endpoint completes. */
  sourceBlockId: string;
  /** Lattice cell the tool ends the block in. */
  coord: readonly [number, number, number];
  /** Where that cell is in the world. */
  target: Vec3Tuple;
  /** Solved pose, or absent when no roll-free solution exists. */
  jointAngles?: Record<JointId, number>;
  /** Distance from the solved tip to the target, metres. */
  error?: number;
}

export interface CutterArmEndpointPlan {
  steps: ArmStep[];
  endpoints: CutterArmEndpoint[];
  /** Endpoints with no reachable roll-free pose. Empty means the arm can run it. */
  unreachable: CutterArmEndpoint[];
}

/**
 * Drive the arm to the position each block ends at, and nowhere else.
 *
 * # Why this exists alongside `buildCutterArmPlan`
 *
 * Replaying the frozen trajectory is impossible on this hardware: the ladder
 * planner uses `shoulderRoll` throughout and the arm has no roll servo, so the
 * tool lands up to three voxels from the planned path
 * (`docs/05-EMBEDDED.md` §3.1).
 *
 * But that constraint comes from insisting the arm reproduce the *planner's*
 * joint path. It does not have to. `Move left 3 voxels` is one instruction with
 * one destination, and on hardware there is no hair to cut — nothing depends on
 * the route between destinations. Ask only for the destinations and the problem
 * disappears: the arm solves its own pose for each, with the roll pinned at
 * rest, using the same certified solver the planner uses.
 *
 * Measured on the shipped challenge, all five block endpoints of the reference
 * program are reachable roll-free and clear of the head — as are all twenty-two
 * individual cell centres, if a finer trace is ever wanted.
 *
 * # What this is not
 *
 * Not a replay, and not scoreable. The arm visits the same cells by its own
 * means; the path between them is whatever the servos do, so the swept volume
 * is not the simulated one. That is fine for driving hardware and wrong for
 * anything that measures a cut, which is why scoring stays where it is.
 */
export function buildCutterArmEndpointPlan(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2,
  options: CutterArmPlanOptions = {},
): CutterArmEndpointPlan {
  const maxSteps = options.maxSteps ?? 512;
  const endpointStepBudget = Math.max(0, maxSteps - 1);

  // Pinning the roll to a single value makes the solver's own limit clamp do
  // the work: it cannot move a joint whose range is a point. Nothing else about
  // the arm, the head or the solver changes.
  const rollFree: Challenge = {
    ...challenge,
    robotConfig: {
      ...challenge.robotConfig,
      joints: challenge.robotConfig.joints.map((joint) =>
        joint.servo
          ? joint
          : {
              ...joint,
              minAngleDeg: joint.initialAngleDeg,
              maxAngleDeg: joint.initialAngleDeg,
            },
      ),
    },
  };

  // One endpoint per block: the last cell its final step lands in. Steps carry
  // the originating block, so consecutive steps sharing one collapse to a
  // single destination — which is exactly `Move left 3 voxels` being one move.
  const endpoints: CutterArmEndpoint[] = [];
  for (const step of plan.steps) {
    if (step.kind !== 'move-cell') continue;
    const last = endpoints[endpoints.length - 1];
    const target = step.waypoints[step.waypoints.length - 1]?.endEffector;
    if (!target) continue;
    if (last && last.sourceBlockId === step.sourceBlockId) {
      last.coord = step.endCoord;
      last.target = target;
      continue;
    }
    endpoints.push({
      sourceBlockId: step.sourceBlockId,
      coord: step.endCoord,
      target,
    });
  }

  const driven = challenge.robotConfig.joints.filter((joint) => joint.servo);
  let previous = createInitialJointAngles(challenge.robotConfig);
  const steps: ArmStep[] = [];
  const unreachable: CutterArmEndpoint[] = [];

  for (const endpoint of endpoints) {
    const solution = solveCutterGridIk(rollFree, endpoint.target, previous, {
      // A quarter-voxel. Tighter than the tool radius by a wide margin, and
      // loose enough that a pose exists without the roll to fine-tune with.
      maxError: challenge.voxelConfig.size / 4,
      quantizeOutput: true,
    });

    if (!solution) {
      unreachable.push(endpoint);
      continue;
    }
    endpoint.jointAngles = solution.jointAngles;
    endpoint.error = solution.error;

    // Largest joint move from where the arm currently is, which is what sets
    // how long to hold before the next write.
    const travelDeg = Math.max(
      ...driven.map((joint) =>
        Math.abs(
          (solution.jointAngles[joint.id] ?? 0) - (previous[joint.id] ?? 0),
        ),
      ),
    );
    previous = solution.jointAngles;

    steps.push({
      type: 'pose',
      moves: driven.map((joint) => ({
        axis: joint.servo!.axis,
        value: solution.jointAngles[joint.id] ?? joint.initialAngleDeg,
      })),
      durationMs:
        steps.length === 0
          ? START_POSE_SETTLE_MS
          : Math.max(1, Math.round(travelDeg * SERVO_MS_PER_DEGREE)),
    });
  }

  return {
    steps: unreachable.length > 0 || steps.length === 0
      ? []
      : [
          { type: 'home', durationMs: ARM_HOME_SETTLE_MS },
          ...steps.slice(0, endpointStepBudget),
        ],
    endpoints,
    unreachable,
  };
}
