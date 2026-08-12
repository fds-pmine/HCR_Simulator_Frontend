import type { Challenge, JointId, VoxelKey } from '../../types/domain';
import { calculateScore } from '../scoring/scoring';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  CUTTER_GRID_DIRECTIONS,
  cutterGridCoordToWorld,
  deriveCutterGridBounds,
  enumerateCutterGridCoords,
  hairBoundsToLogicalBounds,
} from './grid';
import { solveCutterGridIk } from './ik';
import { expandCutterGridProgram } from './programCompiler';
import { findCutterGridReferenceProgram } from './referenceProgram';
import { cutterGridChallengeSignature } from './signature';
import {
  planCutterGridEntryTrajectory,
  planCutterGridTrajectory,
} from './trajectory';
import {
  CUTTER_GRID_PLANNER_VERSION,
  type CompiledCutterGridProgramV1,
  type CutterGridCoord,
  type CutterGridDirection,
  type CutterGridNodeProfileV1,
  type CutterGridProfileV1,
} from './types';

export interface CutterGridProfileGenerationOptions {
  shouldCancel?: () => boolean;
  includeNodeMap?: boolean;
}

export function generateCutterGridProfile(
  challenge: Challenge,
  originHairCoord: CutterGridCoord = [0, -5, 8],
  options: CutterGridProfileGenerationOptions = {},
): CutterGridProfileV1 {
  const challengeSignature = cutterGridChallengeSignature(challenge);
  const originWorldPosition = cutterGridCoordToWorld(
    [0, 0, 0],
    originHairCoord,
    challenge.voxelConfig,
  );
  const entryTrajectory = planCutterGridEntryTrajectory(
    challenge,
    originWorldPosition,
    options,
  );
  const entryJointAngles = copyAngles(
    entryTrajectory.at(-1)?.jointAngles,
    challenge,
  );
  const bounds = hairBoundsToLogicalBounds(
    deriveCutterGridBounds(challenge, originHairCoord),
    originHairCoord,
  );
  const reference = findCutterGridReferenceProgram(challenge, originHairCoord);
  if (!reference) {
    throw new Error('No geometric Cutter Grid reference program exists.');
  }
  const referenceCompiled = compileReference(reference.program);
  const referencePlan = planCutterGridTrajectory(
    challenge,
    referenceCompiled,
    {
      challengeSignature,
      originHairCoord,
      bounds,
      startJointAngles: entryJointAngles,
    },
    options,
  );
  const expectedTarget = [...challenge.targetHair.voxels].sort();
  const referenceCutVoxels = referencePlan.steps
    .flatMap((step) => step.expectedCutVoxels)
    .sort();
  const targetCuts = new Set(reference.expectedCutVoxels);
  const referenceExtraCutVoxels = referenceCutVoxels.filter(
    (key) => !targetCuts.has(key),
  );
  const score = calculateScore({
    initialVoxels: challenge.initialHair.voxels,
    targetVoxels: challenge.targetHair.voxels,
    resultVoxels: new Set(referencePlan.expectedResultVoxels),
    programMetrics: {
      sourceBlockCount: reference.program.sourceBlockCount,
      executedCommandCount: referenceCompiled.executedCommandCount,
      estimatedDurationMs: referencePlan.estimatedDurationMs,
    },
    scoring: challenge.scoring,
  });
  const certifiedDirections = certifyDirections(
    challenge,
    originHairCoord,
    bounds,
    entryJointAngles,
    challengeSignature,
    options,
  );
  const entryZeroContact = findTrajectoryHits(
    challenge,
    entryTrajectory,
  ).length === 0;
  const passed =
    entryZeroContact &&
    score.completionScore === 100 &&
    referenceExtraCutVoxels.length === 0 &&
    arraysEqual(referencePlan.expectedResultVoxels, expectedTarget) &&
    certifiedDirections.length === CUTTER_GRID_DIRECTIONS.length;
  if (!passed) {
    throw new Error(
      `Cutter Grid certification gate failed: entryZeroContact=${entryZeroContact}, ` +
        `completion=${score.completionScore}, extras=${referenceExtraCutVoxels.length}, ` +
        `resultMatches=${arraysEqual(referencePlan.expectedResultVoxels, expectedTarget)}, ` +
        `directions=${certifiedDirections.join(',')}.`,
    );
  }

  return {
    version: 1,
    plannerVersion: CUTTER_GRID_PLANNER_VERSION,
    challengeSignature,
    originHairCoord,
    originWorldPosition,
    entryJointAngles,
    entryTrajectory,
    bounds,
    nodes: options.includeNodeMap
      ? generateNodeMap(challenge, originHairCoord, bounds, entryJointAngles, options)
      : [],
    referenceProgram: reference.program,
    referenceTrajectorySignature: referencePlan.trajectorySignature,
    certification: {
      passed,
      entryZeroContact,
      referenceCompletion: score.completionScore,
      referenceCutVoxels,
      referenceExtraCutVoxels,
      certifiedDirections,
    },
  };
}

export function cutterGridProfileMatchesChallenge(
  profile: CutterGridProfileV1,
  challenge: Challenge,
): boolean {
  return (
    profile.version === 1 &&
    profile.plannerVersion === CUTTER_GRID_PLANNER_VERSION &&
    profile.challengeSignature === cutterGridChallengeSignature(challenge) &&
    profile.certification.passed
  );
}

function certifyDirections(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  bounds: CutterGridProfileV1['bounds'],
  entryJointAngles: Record<JointId, number>,
  challengeSignature: string,
  options: CutterGridProfileGenerationOptions,
): CutterGridDirection[] {
  const result: CutterGridDirection[] = [];
  for (const direction of CUTTER_GRID_DIRECTIONS) {
    const path: CutterGridDirection[] =
      direction === 'down'
        ? ['up', 'down']
        : direction === 'backward'
          ? ['forward', 'backward']
          : [direction];
    const program = {
      kind: 'cutter-grid' as const,
      version: 1 as const,
      plannerVersion: CUTTER_GRID_PLANNER_VERSION,
      nodes: path.map((stepDirection, index) => ({
          type: 'move' as const,
          direction: stepDirection,
          distance: 1,
          sourceBlockId: `certify-${direction}-${index}`,
        })),
      sourceBlockCount: path.length,
    };
    try {
      planCutterGridTrajectory(
        challenge,
        compileReference(program),
        {
          challengeSignature,
          originHairCoord,
          bounds,
          startJointAngles: entryJointAngles,
        },
        options,
      );
      result.push(direction);
    } catch {
      // A direction is certified only by a fully validated edge.
    }
  }
  return result;
}

function generateNodeMap(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  bounds: CutterGridProfileV1['bounds'],
  seed: Record<JointId, number>,
  options: CutterGridProfileGenerationOptions,
): CutterGridNodeProfileV1[] {
  return enumerateCutterGridCoords(bounds).map((coord) => {
    const worldPosition = cutterGridCoordToWorld(
      coord,
      originHairCoord,
      challenge.voxelConfig,
    );
    const solution = solveCutterGridIk(challenge, worldPosition, seed, {
      maxError: challenge.voxelConfig.size / 16,
      shouldCancel: options.shouldCancel,
    });
    return {
      coord,
      worldPosition,
      reachable: solution !== undefined,
      ...(solution ? {} : { blockedReason: 'ik-error' as const }),
    };
  });
}

function compileReference(
  program: CutterGridProfileV1['referenceProgram'],
): CompiledCutterGridProgramV1 {
  const runtimeActions = expandCutterGridProgram(program);
  return {
    program,
    runtimeActions,
    executedCommandCount: runtimeActions.length,
  };
}

function copyAngles(
  angles: Readonly<Record<JointId, number>> | undefined,
  challenge: Challenge,
): Record<JointId, number> {
  if (!angles) throw new Error('Cutter Grid entry trajectory has no final pose.');
  return Object.fromEntries(
    challenge.robotConfig.joints.map((joint) => [joint.id, angles[joint.id]]),
  );
}

function findTrajectoryHits(
  challenge: Challenge,
  waypoints: CutterGridProfileV1['entryTrajectory'],
): VoxelKey[] {
  const hits = new Set<VoxelKey>();
  for (let index = 1; index < waypoints.length; index += 1) {
    findSweptVoxelHits(
      waypoints[index - 1].endEffector,
      waypoints[index].endEffector,
      challenge.initialHair.voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    ).forEach((key) => hits.add(key));
  }
  return [...hits].sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
