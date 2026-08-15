import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import {
  findRobotHeadCollision,
  measureRobotHeadClearance,
} from '../robot/headCollision';
import { computeRobotPose, createInitialJointAngles } from '../robot/kinematics';

export const CUTTER_GRID_IK_CONFIG = Object.freeze({
  maxIterations: 80,
  jacobianStepDeg: 0.1,
  damping: 0.05,
  maxUpdateDeg: 2,
  angleQuantumDeg: 0.1,
});

export interface CutterGridIkSolution {
  jointAngles: Record<JointId, number>;
  endEffector: Vec3Tuple;
  error: number;
  iterations: number;
}

export type CutterGridSeedBudget = 24 | 96 | 384;

export interface CutterGridIkCandidate extends CutterGridIkSolution {
  /** Stable only inside a Challenge/version/layer namespace. */
  id: string;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
}

export interface CutterGridIkEntrySeed {
  id: string;
  jointAngles: Readonly<Record<JointId, number>>;
}

export interface EnumerateCutterGridIkCandidatesOptions {
  maxError: number;
  previousLayer?: readonly Pick<CutterGridIkCandidate, 'id' | 'jointAngles'>[];
  entryOptions?: readonly CutterGridIkEntrySeed[];
  seedBudget?: CutterGridSeedBudget;
  candidateLimit?: number;
  candidateNamespace?: string;
  shouldCancel?: () => boolean;
}

export interface CutterGridIkOptions {
  maxError: number;
  shouldCancel?: () => boolean;
  quantizeOutput?: boolean;
  maxNormalizedChange?: number;
}

export function solveCutterGridIk(
  challenge: Challenge,
  target: Vec3Tuple,
  previousAngles: Readonly<Record<JointId, number>>,
  options: CutterGridIkOptions,
): CutterGridIkSolution | undefined {
  const previousCandidate = candidateAtAngles(
    challenge,
    target,
    previousAngles,
  );
  if (previousCandidate && previousCandidate.error <= options.maxError) {
    return previousCandidate;
  }
  const candidates = deterministicSeeds(challenge, previousAngles)
    .map((seed) => iterateDls(challenge, target, seed, options))
    .filter((candidate): candidate is CutterGridIkSolution => {
      if (!candidate || candidate.error > options.maxError) return false;
      if (
        options.maxNormalizedChange !== undefined &&
        normalizedDistance(
          candidate.jointAngles,
          previousAngles,
          challenge.robotConfig.joints,
        ) > options.maxNormalizedChange
      ) return false;
      return !findRobotHeadCollision(
        computeRobotPose(challenge.robotConfig, candidate.jointAngles),
        challenge.voxelConfig,
        challenge.robotConfig.geometry,
      );
    });

  candidates.sort((left, right) =>
    compareIkSolutions(left, right, previousAngles, challenge),
  );
  return candidates[0];
}

/**
 * Project a single deterministic seed with the existing numerical DLS solver.
 * The result stays unquantized and unranked so an outer graph can retain every
 * valid kinematic branch rather than committing to a local best pose.
 */
export function projectCutterGridIkSeed(
  challenge: Challenge,
  target: Vec3Tuple,
  seed: Readonly<Record<JointId, number>>,
  options: Pick<CutterGridIkOptions, 'shouldCancel'> = {},
): CutterGridIkSolution | undefined {
  return iterateDls(challenge, target, seed, {
    maxError: Number.POSITIVE_INFINITY,
    shouldCancel: options.shouldCancel,
    quantizeOutput: false,
  });
}

/**
 * Enumerate collision-free, unquantized IK branches from a deterministic,
 * cumulative seed set.  A 96-seed query contains the 24-seed prefix exactly.
 */
export function enumerateCutterGridIkCandidates(
  challenge: Challenge,
  target: Vec3Tuple,
  options: EnumerateCutterGridIkCandidatesOptions,
): CutterGridIkCandidate[] {
  const seeds = ladderSeeds(challenge, options, options.seedBudget ?? 24);
  const candidates = seeds
    .map((seed) => {
      if (options.shouldCancel?.()) return undefined;
      const solution = projectCutterGridIkSeed(challenge, target, seed, options);
      if (!solution || solution.error > options.maxError) return undefined;
      const pose = computeRobotPose(challenge.robotConfig, solution.jointAngles);
      if (
        findRobotHeadCollision(
          pose,
          challenge.voxelConfig,
          challenge.robotConfig.geometry,
        )
      ) return undefined;
      return {
        ...solution,
        id: stableCandidateId(
          options.candidateNamespace ?? stableTargetNamespace(target),
          solution.jointAngles,
          challenge.robotConfig.joints,
        ),
        minimumHeadClearance: measureRobotHeadClearance(
          pose,
          challenge.voxelConfig,
          challenge.robotConfig.geometry,
        ),
        minimumJointLimitMargin: minimumNormalizedJointLimitMargin(
          solution.jointAngles,
          challenge.robotConfig.joints,
        ),
      } satisfies CutterGridIkCandidate;
    })
    .filter((candidate): candidate is CutterGridIkCandidate => candidate !== undefined);

  const unique = deduplicateCandidates(candidates, challenge);
  const candidateLimit = options.candidateLimit ?? 128;
  const lowerBudget = previousSeedBudget(options.seedBudget ?? 24);
  const anchors = lowerBudget
    ? enumerateCutterGridIkCandidates(challenge, target, {
        ...options,
        seedBudget: lowerBudget,
        candidateLimit,
      })
    : [];
  return diversifyCandidates(unique, challenge, candidateLimit, anchors);
}

export function normalizedJointDistance(
  angles: Readonly<Record<JointId, number>>,
  reference: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): number {
  return Math.sqrt(
    joints.reduce((sum, joint) => {
      const span = joint.maxAngleDeg - joint.minAngleDeg;
      return sum + ((angles[joint.id] - reference[joint.id]) / span) ** 2;
    }, 0),
  );
}

export function minimumNormalizedJointLimitMargin(
  angles: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): number {
  return Math.min(
    ...joints.map((joint) => {
      const span = joint.maxAngleDeg - joint.minAngleDeg;
      return Math.min(
        (angles[joint.id] - joint.minAngleDeg) / span,
        (joint.maxAngleDeg - angles[joint.id]) / span,
      );
    }),
  );
}

function candidateAtAngles(
  challenge: Challenge,
  target: Vec3Tuple,
  angles: Readonly<Record<JointId, number>>,
): CutterGridIkSolution | undefined {
  const jointAngles = copyAngles(angles, challenge.robotConfig.joints);
  const pose = computeRobotPose(challenge.robotConfig, jointAngles);
  if (
    findRobotHeadCollision(
      pose,
      challenge.voxelConfig,
      challenge.robotConfig.geometry,
    )
  ) return undefined;
  return {
    jointAngles,
    endEffector: pose.endEffector,
    error: distance(pose.endEffector, target),
    iterations: 0,
  };
}

export function compareIkSolutions(
  left: CutterGridIkSolution,
  right: CutterGridIkSolution,
  previousAngles: Readonly<Record<JointId, number>>,
  challenge: Pick<Challenge, 'robotConfig'>,
): number {
  const joints = challenge.robotConfig.joints;
  return (
    compareNumber(
      errorBand(left.error),
      errorBand(right.error),
    ) ||
    compareNumber(
      normalizedDistance(left.jointAngles, previousAngles, joints),
      normalizedDistance(right.jointAngles, previousAngles, joints),
    ) ||
    compareNumber(
      midpointDistance(left.jointAngles, joints),
      midpointDistance(right.jointAngles, joints),
    ) ||
    compareAngles(left.jointAngles, right.jointAngles, joints)
  );
}

function errorBand(error: number): number {
  return Math.round(error / 0.0005);
}

function iterateDls(
  challenge: Challenge,
  target: Vec3Tuple,
  seed: Readonly<Record<JointId, number>>,
  options: CutterGridIkOptions,
): CutterGridIkSolution | undefined {
  const joints = challenge.robotConfig.joints;
  const angles = Object.fromEntries(
    joints.map((joint) => [
      joint.id,
      clamp(seed[joint.id], joint.minAngleDeg, joint.maxAngleDeg),
    ]),
  ) as Record<JointId, number>;
  let iterations = 0;

  for (; iterations < CUTTER_GRID_IK_CONFIG.maxIterations; iterations += 1) {
    if (options.shouldCancel?.()) return undefined;
    const current = computeRobotPose(challenge.robotConfig, angles).endEffector;
    const error = subtract(target, current);
    const jacobian = numericalJacobian(challenge, angles, current);
    const update = dampedLeastSquares(jacobian, error);
    for (let index = 0; index < joints.length; index += 1) {
      const joint = joints[index];
      angles[joint.id] = clamp(
        angles[joint.id] +
          clamp(
            radiansToDegrees(update[index] ?? 0),
            -CUTTER_GRID_IK_CONFIG.maxUpdateDeg,
            CUTTER_GRID_IK_CONFIG.maxUpdateDeg,
          ),
        joint.minAngleDeg,
        joint.maxAngleDeg,
      );
    }
  }

  const quantized = Object.fromEntries(
    joints.map((joint) => [
      joint.id,
      clamp(
        options.quantizeOutput === false
          ? angles[joint.id]
          : quantize(angles[joint.id], CUTTER_GRID_IK_CONFIG.angleQuantumDeg),
        joint.minAngleDeg,
        joint.maxAngleDeg,
      ),
    ]),
  ) as Record<JointId, number>;
  const endEffector = computeRobotPose(
    challenge.robotConfig,
    quantized,
  ).endEffector;
  return {
    jointAngles: quantized,
    endEffector,
    error: distance(endEffector, target),
    iterations,
  };
}

function numericalJacobian(
  challenge: Challenge,
  angles: Readonly<Record<JointId, number>>,
  current: Vec3Tuple,
): number[][] {
  return [0, 1, 2].map((axis) =>
    challenge.robotConfig.joints.map((joint) => {
      const direction =
        angles[joint.id] + CUTTER_GRID_IK_CONFIG.jacobianStepDeg <=
        joint.maxAngleDeg
          ? 1
          : -1;
      const sampleAngles = {
        ...angles,
        [joint.id]:
          angles[joint.id] +
          CUTTER_GRID_IK_CONFIG.jacobianStepDeg * direction,
      };
      const sample = computeRobotPose(
        challenge.robotConfig,
        sampleAngles,
      ).endEffector;
      return (
        (sample[axis] - current[axis]) /
        degreesToRadians(
          CUTTER_GRID_IK_CONFIG.jacobianStepDeg * direction,
        )
      );
    }),
  );
}

/** J^T (J J^T + lambda^2 I)^-1 error. */
function dampedLeastSquares(jacobian: number[][], error: Vec3Tuple): number[] {
  const normal = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) => {
      const product = jacobian[row].reduce(
        (sum, value, index) => sum + value * jacobian[column][index],
        0,
      );
      return product +
        (row === column ? CUTTER_GRID_IK_CONFIG.damping ** 2 : 0);
    }),
  );
  const inverse = invert3(normal);
  if (!inverse) return jacobian[0].map(() => 0);
  const projected = inverse.map((row) => dot(row, error));
  return jacobian[0].map((_, joint) =>
    jacobian.reduce(
      (sum, row, axis) => sum + row[joint] * projected[axis],
      0,
    ),
  );
}

function invert3(matrix: number[][]): number[][] | undefined {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) return undefined;
  return [
    [e * i - f * h, c * h - b * i, b * f - c * e],
    [f * g - d * i, a * i - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d],
  ].map((row) => row.map((value) => value / determinant));
}

function deterministicSeeds(
  challenge: Challenge,
  previous: Readonly<Record<JointId, number>>,
): Array<Record<JointId, number>> {
  const joints = challenge.robotConfig.joints;
  const localSeeds = [
    copyAngles(previous, joints),
    ...joints.flatMap((joint) => [-1, 1].map((direction) => ({
      ...previous,
      [joint.id]: clamp(
        previous[joint.id] + 0.5 * direction,
        joint.minAngleDeg,
        joint.maxAngleDeg,
      ),
    }))),
  ];
  const initial = createInitialJointAngles(challenge.robotConfig);
  const midpoint = Object.fromEntries(
    joints.map((joint) => [joint.id, (joint.minAngleDeg + joint.maxAngleDeg) / 2]),
  ) as Record<JointId, number>;
  const seeds = [...localSeeds, initial, midpoint];
  const primes = [2, 3, 5, 7, 11];
  for (let index = 1; index <= 8; index += 1) {
    seeds.push(
      Object.fromEntries(
        joints.map((joint, jointIndex) => [
          joint.id,
          joint.minAngleDeg +
            radicalInverse(index, primes[jointIndex] ?? 13) *
              (joint.maxAngleDeg - joint.minAngleDeg),
        ]),
      ),
    );
  }
  return deduplicateSeeds(seeds, joints);
}

function ladderSeeds(
  challenge: Challenge,
  options: EnumerateCutterGridIkCandidatesOptions,
  budget: CutterGridSeedBudget,
): Array<Record<JointId, number>> {
  const joints = challenge.robotConfig.joints;
  const previousLayer = [...(options.previousLayer ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const entryOptions = [...(options.entryOptions ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const initial = createInitialJointAngles(challenge.robotConfig);
  const midpoint = Object.fromEntries(
    joints.map((joint) => [joint.id, (joint.minAngleDeg + joint.maxAngleDeg) / 2]),
  ) as Record<JointId, number>;
  const seeds = [
    ...previousLayer.map((candidate) => copyAngles(candidate.jointAngles, joints)),
    ...entryOptions.map((entry) => copyAngles(entry.jointAngles, joints)),
    initial,
    midpoint,
  ];
  const primes = [2, 3, 5, 7, 11];
  for (let index = 1; index <= budget; index += 1) {
    seeds.push(
      Object.fromEntries(
        joints.map((joint, jointIndex) => [
          joint.id,
          joint.minAngleDeg +
            radicalInverse(index, primes[jointIndex] ?? 13) *
              (joint.maxAngleDeg - joint.minAngleDeg),
        ]),
      ) as Record<JointId, number>,
    );
  }
  return deduplicateSeeds(seeds, joints);
}

function deduplicateCandidates(
  candidates: readonly CutterGridIkCandidate[],
  challenge: Challenge,
): CutterGridIkCandidate[] {
  // Keep the earliest candidate in the deterministic seed order.  This makes
  // a 24-seed result a literal prefix of a 96/384 result; a later budget may
  // add branches but may never replace one that an earlier planning pass has
  // already exposed to the graph.
  const result: CutterGridIkCandidate[] = [];
  for (const candidate of candidates) {
    if (
      result.some(
        (existing) =>
          normalizedJointDistance(
            existing.jointAngles,
            candidate.jointAngles,
            challenge.robotConfig.joints,
          ) <= 0.01,
      )
    ) continue;
    result.push(candidate);
  }
  return result;
}

function diversifyCandidates(
  candidates: readonly CutterGridIkCandidate[],
  challenge: Challenge,
  limit: number,
  anchors: readonly CutterGridIkCandidate[] = [],
): CutterGridIkCandidate[] {
  const ordered = [...candidates].sort((left, right) =>
    compareCandidateStatic(left, right, challenge),
  );
  if (ordered.length <= limit) return ordered;
  const byId = new Map(ordered.map((candidate) => [candidate.id, candidate]));
  const selected = anchors
    .map((candidate) => byId.get(candidate.id))
    .filter((candidate): candidate is CutterGridIkCandidate => candidate !== undefined)
    .slice(0, limit);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const remaining = ordered.filter((candidate) => !selectedIds.has(candidate.id));
  if (selected.length === 0 && remaining.length > 0) {
    selected.push(remaining.shift()!);
  }
  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const distanceToSelected = Math.min(
        ...selected.map((chosen) =>
          normalizedJointDistance(
            remaining[index].jointAngles,
            chosen.jointAngles,
            challenge.robotConfig.joints,
          ),
        ),
      );
      if (distanceToSelected > bestDistance + 1e-12) {
        bestDistance = distanceToSelected;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function previousSeedBudget(budget: CutterGridSeedBudget): CutterGridSeedBudget | undefined {
  if (budget === 384) return 96;
  if (budget === 96) return 24;
  return undefined;
}

function compareCandidateStatic(
  left: CutterGridIkCandidate,
  right: CutterGridIkCandidate,
  challenge: Challenge,
): number {
  return (
    compareNumber(left.error, right.error) ||
    compareNumber(right.minimumHeadClearance, left.minimumHeadClearance) ||
    compareNumber(right.minimumJointLimitMargin, left.minimumJointLimitMargin) ||
    compareNumber(
      midpointDistance(left.jointAngles, challenge.robotConfig.joints),
      midpointDistance(right.jointAngles, challenge.robotConfig.joints),
    ) ||
    compareAngles(left.jointAngles, right.jointAngles, challenge.robotConfig.joints)
  );
}

function stableCandidateId(
  namespace: string,
  angles: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): string {
  return `${namespace}:${joints.map((joint) => angles[joint.id].toFixed(9)).join(',')}`;
}

function stableTargetNamespace(target: Vec3Tuple): string {
  return target.map((value) => value.toFixed(9)).join(',');
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

function deduplicateSeeds(
  seeds: Array<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): Array<Record<JointId, number>> {
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const key = joints.map((joint) => seed[joint.id].toFixed(6)).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function copyAngles(
  angles: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): Record<JointId, number> {
  return Object.fromEntries(joints.map((joint) => [joint.id, angles[joint.id]]));
}

function normalizedDistance(
  angles: Readonly<Record<JointId, number>>,
  reference: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): number {
  return normalizedJointDistance(angles, reference, joints);
}

function midpointDistance(
  angles: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): number {
  return Math.sqrt(
    joints.reduce((sum, joint) => {
      const span = joint.maxAngleDeg - joint.minAngleDeg;
      const midpoint = (joint.minAngleDeg + joint.maxAngleDeg) / 2;
      return sum + ((angles[joint.id] - midpoint) / span) ** 2;
    }, 0),
  );
}

function compareAngles(
  left: Readonly<Record<JointId, number>>,
  right: Readonly<Record<JointId, number>>,
  joints: Challenge['robotConfig']['joints'],
): number {
  for (const joint of joints) {
    const difference = left[joint.id] - right[joint.id];
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareNumber(left: number, right: number): number {
  const difference = left - right;
  return Math.abs(difference) < 1e-12 ? 0 : difference;
}

function subtract(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number, quantum: number): number {
  return Math.round(value / quantum) * quantum;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
