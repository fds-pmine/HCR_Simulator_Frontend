import type { Challenge, VoxelKey } from '../../types/domain';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { enumerateCutterGridIkCandidates } from './ik';
import {
  CUTTER_GRID_DIRECTIONS,
  cutterGridBoundsContain,
  deriveCutterGridBounds,
  hairToLogicalCoord,
  moveCutterGridCoord,
} from './grid';
import type {
  CutterGridCoord,
  CutterGridDirection,
  CutterGridMoveV1,
  CutterGridProgramV1,
} from './types';
import { CUTTER_GRID_PLANNER_VERSION } from './types';
import { voxelCoordToWorld } from '../voxel/voxelKey';

interface SearchState {
  coord: CutterGridCoord;
  cutMask: number;
}

interface SearchParent {
  previousKey: string;
  direction: CutterGridDirection;
}

export interface CutterGridReferenceSolution {
  program: CutterGridProgramV1;
  directions: CutterGridDirection[];
  expectedCutVoxels: VoxelKey[];
}

export interface CutterGridReferenceSearchOptions {
  /**
   * Necessary kinematic condition for standing at a cell. Geometry alone can
   * route the cutter through cells no arm pose reaches — the shortest sweep
   * over the crown climbs straight past the top of the reachable envelope —
   * and the trajectory planners can only report that as a late failure. The
   * Profile generators pass their own static IK check here so an
   * uncertifiable route is never proposed in the first place.
   */
  isReachable?: (coord: CutterGridCoord) => boolean;
}

/** Deterministic shortest geometric route that cuts every target and nothing else. */
export function findCutterGridReferenceProgram(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
  options: CutterGridReferenceSearchOptions = {},
): CutterGridReferenceSolution | undefined {
  const targetKeys = [...challenge.initialHair.voxels]
    .filter((key) => !challenge.targetHair.voxels.has(key))
    .sort();
  if (targetKeys.length === 0 || targetKeys.length > 30) return undefined;
  const targetIndex = new Map(targetKeys.map((key, index) => [key, index]));
  const targetMask = (1 << targetKeys.length) - 1;
  const bounds = deriveCutterGridBounds(challenge, originHairCoord);
  const start: SearchState = { coord: originHairCoord, cutMask: 0 };
  const startKey = stateKey(start);
  const queue: SearchState[] = [start];
  const parents = new Map<string, SearchParent>();
  const visited = new Set([startKey]);
  let cursor = 0;
  let goalKey: string | undefined;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current.cutMask === targetMask) {
      goalKey = stateKey(current);
      break;
    }
    for (const direction of CUTTER_GRID_DIRECTIONS) {
      const nextCoord = moveCutterGridCoord(current.coord, direction);
      if (!cutterGridBoundsContain(bounds, nextCoord)) continue;
      const hits = edgeHits(challenge, current.coord, nextCoord);
      if (hits.some((key) => !targetIndex.has(key))) continue;
      if (options.isReachable && !options.isReachable(nextCoord)) continue;
      let cutMask = current.cutMask;
      for (const key of hits) cutMask |= 1 << (targetIndex.get(key) ?? 0);
      const next: SearchState = { coord: nextCoord, cutMask };
      const nextKey = stateKey(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      parents.set(nextKey, { previousKey: stateKey(current), direction });
      queue.push(next);
    }
  }
  if (!goalKey) return undefined;

  const directions: CutterGridDirection[] = [];
  for (let key = goalKey; key !== startKey; ) {
    const parent = parents.get(key);
    if (!parent) throw new Error('Broken Cutter Grid reference search parent chain.');
    directions.push(parent.direction);
    key = parent.previousKey;
  }
  directions.reverse();
  const nodes = compressMoves(directions);
  return {
    program: {
      kind: 'cutter-grid',
      version: 1,
      plannerVersion: CUTTER_GRID_PLANNER_VERSION,
      nodes,
      sourceBlockCount: nodes.length,
    },
    directions,
    expectedCutVoxels: targetKeys,
  };
}

/**
 * A lower budget than the ladder planner's 384 escalation on purpose. Seed
 * budgets nest — every candidate 96 finds, 384 finds too — so a cell that
 * passes here is one the planner can certainly pose at, and the filter stays a
 * conservative necessary condition rather than a second planner. The search
 * visits thousands of cells, and 384 would spend minutes proving what 96
 * already settles.
 */
const REFERENCE_REACHABILITY_SEED_BUDGET = 96;

/** Memoized static IK existence check, in hair coordinates. */
export function createCutterGridReferenceReachability(
  challenge: Challenge,
): (hairCoord: CutterGridCoord) => boolean {
  const cache = new Map<string, boolean>();
  return (hairCoord) => {
    const key = hairCoord.join(',');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const candidates = enumerateCutterGridIkCandidates(
      challenge,
      voxelCoordToWorld(
        { x: hairCoord[0], y: hairCoord[1], z: hairCoord[2] },
        challenge.voxelConfig.origin,
        challenge.voxelConfig.size,
      ),
      {
        maxError: challenge.voxelConfig.size / 16,
        seedBudget: REFERENCE_REACHABILITY_SEED_BUDGET,
        candidateLimit: 1,
        candidateNamespace: 'reference-reachability',
      },
    );
    cache.set(key, candidates.length > 0);
    return candidates.length > 0;
  };
}

/**
 * How far one Move may run in the certified reference program.
 *
 * The block language allows 12, but V4 flies one synchronized PTP per visible
 * Move, and a joint-space arc bows further off the straight cell line the
 * longer it gets. Measured on the shipped arm: 6 cells stays within 0.09 world
 * units of the line and cuts exactly the target, while 8 bows 0.19 — wider
 * than a voxel — and takes two neighbours with it. The reference program is
 * the challenge's proof that the target is cuttable, so it stays inside the
 * span both planners reproduce. Player programs are not capped; their real
 * swept path is what the score reports.
 */
const REFERENCE_COMPRESSION_LIMIT = 6;

function compressMoves(directions: CutterGridDirection[]): CutterGridMoveV1[] {
  const result: CutterGridMoveV1[] = [];
  for (const direction of directions) {
    const previous = result.at(-1);
    if (previous?.direction === direction && previous.distance < REFERENCE_COMPRESSION_LIMIT) {
      previous.distance += 1;
      continue;
    }
    result.push({
      type: 'move',
      direction,
      distance: 1,
      sourceBlockId: `reference-${result.length + 1}`,
    });
  }
  return result;
}

function edgeHits(
  challenge: Challenge,
  start: CutterGridCoord,
  end: CutterGridCoord,
): VoxelKey[] {
  const world = (coord: CutterGridCoord) =>
    voxelCoordToWorld(
      { x: coord[0], y: coord[1], z: coord[2] },
      challenge.voxelConfig.origin,
      challenge.voxelConfig.size,
    );
  return findSweptVoxelHits(
    world(start),
    world(end),
    challenge.initialHair.voxels,
    challenge.voxelConfig,
    challenge.robotConfig.geometry.toolRadius,
  );
}

function stateKey(state: SearchState): string {
  return `${state.coord.join(',')}|${state.cutMask}`;
}

export function logicalReferenceEnd(
  originHairCoord: CutterGridCoord,
  directions: readonly CutterGridDirection[],
): CutterGridCoord {
  let coord = originHairCoord;
  for (const direction of directions) coord = moveCutterGridCoord(coord, direction);
  return hairToLogicalCoord(coord, originHairCoord);
}
