import type { Challenge, VoxelKey } from '../../types/domain';
import { findSweptVoxelHits } from '../voxel/contactDetection';
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

/** Deterministic shortest geometric route that cuts every target and nothing else. */
export function findCutterGridReferenceProgram(
  challenge: Challenge,
  originHairCoord: CutterGridCoord,
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

function compressMoves(directions: CutterGridDirection[]): CutterGridMoveV1[] {
  const result: CutterGridMoveV1[] = [];
  for (const direction of directions) {
    const previous = result.at(-1);
    if (previous?.direction === direction && previous.distance < 12) {
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
