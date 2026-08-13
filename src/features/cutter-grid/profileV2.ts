import type { Challenge, VoxelKey } from '../../types/domain';
import { calculateScore } from '../scoring/scoring';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  CUTTER_GRID_DIRECTIONS,
  cutterGridCoordToWorld,
  deriveCutterGridBounds,
  enumerateCutterGridCoords,
  hairBoundsToLogicalBounds,
  moveCutterGridCoord,
} from './grid';
import { planCertifiedCutterGridEntry } from './entryPlanning';
import { enumerateCutterGridIkCandidates } from './ik';
import { planCutterGridLadderTrajectory } from './ladderPlanner';
import { expandCutterGridProgram } from './programCompiler';
import { findCutterGridReferenceProgram } from './referenceProgram';
import { cutterGridChallengeSignatureV2, fnv1a64 } from './signature';
import {
  CUTTER_GRID_LADDER_PLANNER_VERSION,
  CUTTER_GRID_PROFILE_V2_VERSION,
  type CutterGridCoord,
  type CutterGridNodeProfileV2,
  type CutterGridProfileV2,
} from './types';

export interface CutterGridProfileV2GenerationOptions {
  includeNodeMap?: boolean;
  shouldCancel?: () => boolean;
}

const DEFAULT_PROFILE_V2_ENTRY_TARGET = 8;

/**
 * Build a fail-closed multi-entry Profile.  A profile is usable only after the
 * exact V2 ladder planner reproduces its reference cut program from one of
 * the certified entries.
 */
export function generateCutterGridProfileV2(
  challenge: Challenge,
  originHairCoord: CutterGridCoord = [0, -5, 8],
  options: CutterGridProfileV2GenerationOptions = {},
): CutterGridProfileV2 {
  const challengeSignature = cutterGridChallengeSignatureV2(challenge);
  const originWorldPosition = cutterGridCoordToWorld(
    [0, 0, 0], originHairCoord, challenge.voxelConfig,
  );
  const bounds = hairBoundsToLogicalBounds(
    deriveCutterGridBounds(challenge, originHairCoord), originHairCoord,
  );
  const originCandidates = enumerateCutterGridIkCandidates(challenge, originWorldPosition, {
    maxError: challenge.voxelConfig.size / 16,
    seedBudget: 384,
    candidateLimit: 32,
    candidateNamespace: 'profile-v2-origin',
    shouldCancel: options.shouldCancel,
  });
  const entryOptions = [] as CutterGridProfileV2['entryOptions'];
  for (const [index, candidate] of originCandidates.entries()) {
    if (options.shouldCancel?.()) throw new Error('Cutter Grid Profile V2 generation cancelled.');
    const entry = planCertifiedCutterGridEntry(
      challenge,
      `entry-${index.toString().padStart(2, '0')}`,
      candidate.jointAngles,
    );
    if (entry) entryOptions.push(entry);
    // The V2 contract permits at most 32 entries, rather than requiring every
    // static candidate to be certified.  Eight diversified direct entries
    // already cover the low-Wrist origin branch; stop before an unrelated
    // candidate can force an expensive PRM build.  If fewer than two direct
    // entries exist, the loop continues and each failed direct route invokes
    // the deterministic PRM fallback in planCertifiedCutterGridEntry.
    if (entryOptions.length >= DEFAULT_PROFILE_V2_ENTRY_TARGET) break;
  }
  entryOptions.sort((left, right) => left.id.localeCompare(right.id));
  if (entryOptions.length < 2) {
    throw new Error(`Cutter Grid Profile V2 requires at least two certified entries; found ${entryOptions.length}.`);
  }
  const reference = findCutterGridReferenceProgram(challenge, originHairCoord);
  if (!reference) throw new Error('No geometric Cutter Grid reference program exists.');
  const geometricReference = certifyGeometricReference(challenge, originHairCoord, reference);
  const nodeMap = options.includeNodeMap
    ? generateNodeMapV2(challenge, originHairCoord, bounds, options)
    : [];
  const referenceProgram = {
    ...reference.program,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
  };
  const provisional: CutterGridProfileV2 = {
    version: CUTTER_GRID_PROFILE_V2_VERSION,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
    challengeSignature,
    originHairCoord,
    originWorldPosition,
    bounds,
    entryOptions,
    nodes: nodeMap,
    referenceProgram,
    referenceTrajectorySignature: geometricReference.signature,
    certification: {
      passed: geometricReference.passed,
      entryZeroContact: entryOptions.every((entry) => entryHasNoHairHits(challenge, entry.positioningTrajectory)),
      referenceCompletion: geometricReference.completion,
      referenceCutVoxels: geometricReference.cutVoxels,
      referenceExtraCutVoxels: geometricReference.extraCutVoxels,
      certifiedDirections: geometricReference.certifiedDirections,
      authenticatedEntryOptionIds: entryOptions.map((entry) => entry.id),
      referenceTrajectoryCertified: false,
    },
  };
  const runtimeActions = expandCutterGridProgram(referenceProgram);
  const referencePlan = planCutterGridLadderTrajectory(challenge, {
    program: referenceProgram,
    runtimeActions,
    executedCommandCount: runtimeActions.length,
  }, provisional);
  const referenceResult = new Set(referencePlan.expectedResultVoxels);
  const referenceScore = calculateScore({
    initialVoxels: challenge.initialHair.voxels,
    targetVoxels: challenge.targetHair.voxels,
    resultVoxels: referenceResult,
    programMetrics: {
      sourceBlockCount: referenceProgram.sourceBlockCount,
      executedCommandCount: runtimeActions.length,
      estimatedDurationMs: referencePlan.estimatedDurationMs,
    },
    scoring: challenge.scoring,
  });
  const globalCutVoxels = [...challenge.initialHair.voxels]
    .filter((key) => !referenceResult.has(key))
    .sort();
  const globalExtraCuts = globalCutVoxels.filter((key) => !reference.expectedCutVoxels.includes(key));
  const referenceTrajectoryCertified =
    referenceScore.completionScore === 100 &&
    globalExtraCuts.length === 0 &&
    arraysEqual(globalCutVoxels, [...reference.expectedCutVoxels].sort());
  return {
    ...provisional,
    referenceTrajectorySignature: referencePlan.trajectorySignature,
    certification: {
      ...provisional.certification,
      passed: provisional.certification.passed && referenceTrajectoryCertified,
      referenceCompletion: referenceScore.completionScore,
      referenceCutVoxels: globalCutVoxels,
      referenceExtraCutVoxels: globalExtraCuts,
      referenceTrajectoryCertified,
    },
  };
}

export function cutterGridProfileV2MatchesChallenge(
  profile: CutterGridProfileV2,
  challenge: Challenge,
): boolean {
  return (
    profile.version === CUTTER_GRID_PROFILE_V2_VERSION &&
    profile.plannerVersion === CUTTER_GRID_LADDER_PLANNER_VERSION &&
    profile.challengeSignature === cutterGridChallengeSignatureV2(challenge) &&
    profile.entryOptions.length >= 2 &&
    profile.certification.entryZeroContact &&
    profile.certification.passed &&
    profile.certification.referenceTrajectoryCertified
  );
}

function generateNodeMapV2(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  bounds: CutterGridProfileV2['bounds'],
  options: CutterGridProfileV2GenerationOptions,
): CutterGridNodeProfileV2[] {
  return enumerateCutterGridCoords(bounds).map((coord) => {
    if (options.shouldCancel?.()) throw new Error('Cutter Grid Profile V2 generation cancelled.');
    const worldPosition = cutterGridCoordToWorld(coord, originHairCoord, challenge.voxelConfig);
    const candidates = enumerateCutterGridIkCandidates(challenge, worldPosition, {
      maxError: challenge.voxelConfig.size / 16,
      seedBudget: 24,
      candidateNamespace: `profile-v2-node-${coord.join(',')}`,
      shouldCancel: options.shouldCancel,
    });
    return {
      coord,
      worldPosition,
      staticIkStatus: candidates.length > 0 ? 'safe-candidate-known' : 'no-safe-candidate-found',
      candidateCount: candidates.length,
      seedBudget: 24,
    };
  });
}

function certifyGeometricReference(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  reference: NonNullable<ReturnType<typeof findCutterGridReferenceProgram>>,
): {
  passed: boolean;
  completion: number;
  cutVoxels: VoxelKey[];
  extraCutVoxels: VoxelKey[];
  certifiedDirections: CutterGridProfileV2['certification']['certifiedDirections'];
  signature: string;
} {
  const cutVoxels = [...reference.expectedCutVoxels].sort();
  const target = [...challenge.targetHair.voxels].sort();
  const expectedCutSet = new Set(
    [...challenge.initialHair.voxels].filter((key) => !challenge.targetHair.voxels.has(key)),
  );
  const extraCutVoxels = cutVoxels.filter((key) => !expectedCutSet.has(key));
  const score = calculateScore({
    initialVoxels: challenge.initialHair.voxels,
    targetVoxels: challenge.targetHair.voxels,
    resultVoxels: new Set(target),
    programMetrics: {
      sourceBlockCount: reference.program.sourceBlockCount,
      executedCommandCount: reference.program.nodes.length,
      estimatedDurationMs: 0,
    },
    scoring: challenge.scoring,
  });
  const certifiedDirections = CUTTER_GRID_DIRECTIONS.filter((direction) =>
    geometricDirectionHasNoHairContact(challenge, originHairCoord, direction),
  );
  return {
    passed:
      score.completionScore === 100 &&
      extraCutVoxels.length === 0 &&
      arraysEqual(
        [...challenge.initialHair.voxels].filter((key) => !cutVoxels.includes(key)).sort(),
        target,
      ) &&
      certifiedDirections.length === CUTTER_GRID_DIRECTIONS.length,
    completion: score.completionScore,
    cutVoxels,
    extraCutVoxels,
    certifiedDirections,
    signature: fnv1a64(JSON.stringify({
      kind: 'cutter-grid-v2-geometric-reference-pending-global-trajectory',
      originHairCoord,
      cutVoxels,
      certifiedDirections,
    })),
  };
}

function geometricDirectionHasNoHairContact(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  direction: CutterGridProfileV2['certification']['certifiedDirections'][number],
): boolean {
  const start = cutterGridCoordToWorld([0, 0, 0], originHairCoord, challenge.voxelConfig);
  const end = cutterGridCoordToWorld(
    moveCutterGridCoord([0, 0, 0], direction),
    originHairCoord,
    challenge.voxelConfig,
  );
  return findSweptVoxelHits(
    start,
    end,
    challenge.initialHair.voxels,
    challenge.voxelConfig,
    challenge.robotConfig.geometry.toolRadius,
  ).length === 0;
}

function entryHasNoHairHits(
  challenge: Challenge,
  waypoints: CutterGridProfileV2['entryOptions'][number]['positioningTrajectory'],
): boolean {
  return waypoints.every((waypoint, index) =>
    index === 0 || findSweptVoxelHits(
      waypoints[index - 1].endEffector,
      waypoint.endEffector,
      challenge.initialHair.voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    ).length === 0,
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
