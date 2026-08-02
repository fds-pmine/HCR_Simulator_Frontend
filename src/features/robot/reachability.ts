import type { Challenge, JointId, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from './headCollision';
import { computeRobotPose } from './kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';

/**
 * Which hair the tool can touch anywhere in the collision-free joint space.
 *
 * # What this is for
 *
 * A target that asks for a voxel outside this set is **unwinnable**: a program
 * is a path through the joint space, so it can only ever carve a subset of the
 * union over every pose. Three generated items shipped asking for 91, 284 and
 * 345 voxels while the arm could touch 20, 145 and 232 of them — nobody could
 * score 100 on any of them, and nothing in the test suite noticed.
 *
 * # What it is not
 *
 * Necessary, not sufficient. Being able to touch each voxel in *some* pose does
 * not mean one program touches them all — in a single run, inside the command
 * budget, without the head constraint stopping it in between. Use this to prove
 * a target impossible, never to declare one solvable. Generated items get their
 * solvability constructively instead, by deriving the target from a replayed
 * reference solution (`hcr_qbank::starter`).
 *
 * # Sampling
 *
 * The joint space is swept on a grid, so the result is a *subset* of what is
 * truly reachable — a coarse grid under-reports and would accuse a legitimate
 * target of being impossible. {@link DEFAULT_STEPS} is calibrated against the
 * shipped arm; lower it only for exploration, never for an audit.
 */
export const DEFAULT_STEPS: Readonly<Record<JointId, number>> = {
  baseYaw: 48,
  shoulderRoll: 8,
  shoulder: 24,
  elbow: 24,
  wrist: 12,
};

export interface ReachabilityOptions {
  /** Samples per joint. Fewer under-reports reachability; see {@link DEFAULT_STEPS}. */
  steps?: Partial<Record<JointId, number>>;
  /**
   * Stop once these voxels have all been reached.
   *
   * An audit only cares whether the asked set is covered, and quitting early
   * turns a two-minute sweep into a few seconds for a target that is fine.
   */
  until?: ReadonlySet<VoxelKey>;
}

export function computeReachableVoxels(
  challenge: Challenge,
  options: ReachabilityOptions = {},
): Set<VoxelKey> {
  const { joints, geometry } = challenge.robotConfig;
  const steps = { ...DEFAULT_STEPS, ...options.steps };
  const axes = joints.map((joint) => {
    const count = Math.max(1, steps[joint.id] ?? 12);
    const span = joint.maxAngleDeg - joint.minAngleDeg;
    return {
      id: joint.id,
      values: Array.from(
        { length: count + 1 },
        (_, index) => joint.minAngleDeg + (span * index) / count,
      ),
    };
  });

  const hair = challenge.initialHair.voxels;
  const reached = new Set<VoxelKey>();
  const pending = options.until ? new Set(options.until) : undefined;
  const angles: Record<JointId, number> = {};

  const descend = (depth: number): boolean => {
    if (pending?.size === 0) {
      return true;
    }
    const axis = axes[depth];
    if (!axis) {
      const pose = computeRobotPose(challenge.robotConfig, angles);
      if (findRobotHeadCollision(pose, challenge.voxelConfig, geometry)) {
        return false;
      }
      for (const key of findSweptVoxelHits(
        pose.endEffector,
        pose.endEffector,
        hair,
        challenge.voxelConfig,
        geometry.toolRadius,
      )) {
        reached.add(key);
        pending?.delete(key);
      }
      return pending?.size === 0;
    }

    for (const value of axis.values) {
      angles[axis.id] = value;
      if (descend(depth + 1)) {
        return true;
      }
    }
    return false;
  };

  descend(0);
  return reached;
}

/** The hair a challenge asks the learner to remove. */
export function askedVoxels(challenge: Challenge): Set<VoxelKey> {
  const asked = new Set<VoxelKey>();
  for (const key of challenge.initialHair.voxels) {
    if (!challenge.targetHair.voxels.has(key)) {
      asked.add(key);
    }
  }
  return asked;
}

/**
 * The hair a challenge asks for that the arm can never touch.
 *
 * Empty means the target is *possible*; it does not mean it is solvable. A
 * non-empty result is decisive the other way: those voxels cannot be removed by
 * any program, so nobody can score 100.
 */
export function unreachableAsked(
  challenge: Challenge,
  reachable: ReadonlySet<VoxelKey>,
): VoxelKey[] {
  return [...askedVoxels(challenge)].filter((key) => !reachable.has(key));
}

/**
 * Everything the reachable set depends on, as a stable string.
 *
 * A cached sweep that silently outlives the geometry it was measured against is
 * worse than no cache: it would report a clean audit for an arm that can no
 * longer reach any of it. Consumers compare this against the value stored
 * beside the cache and regenerate when it moves.
 */
export function reachabilitySignature(challenge: Challenge): string {
  const { joints, geometry } = challenge.robotConfig;
  return hash(
    JSON.stringify({
      // Travel limits, not `initialAngleDeg`: the sweep enumerates each joint's
      // whole range, so where a program *starts* cannot change which poses
      // exist. Excluding it is what lets the eight lessons — identical hair and
      // arm, different opening poses — share one measurement instead of paying
      // for the same sweep nine times.
      //
      // This holds only because the sweep ignores connectivity between poses.
      // If it ever grows a reachable-*from* notion, the start pose becomes an
      // input and belongs back in here.
      joints: joints
        .map((joint) => [joint.id, joint.minAngleDeg, joint.maxAngleDeg])
        .sort(),
      geometry,
      voxelConfig: challenge.voxelConfig,
      steps: DEFAULT_STEPS,
      hair: [...challenge.initialHair.voxels].sort(),
    }),
  );
}

/** FNV-1a, 64-bit. Dependency-free so this module stays usable in the browser. */
function hash(input: string): string {
  const PRIME = 1_099_511_628_211n;
  const MASK = (1n << 64n) - 1n;
  let value = 14_695_981_039_346_656_037n;
  for (let index = 0; index < input.length; index += 1) {
    value = ((value ^ BigInt(input.charCodeAt(index))) * PRIME) & MASK;
  }
  return value.toString(16).padStart(16, '0');
}
