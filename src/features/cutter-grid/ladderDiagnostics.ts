import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import { cutterGridCoordToWorld, moveCutterGridCoord } from './grid';
import type {
  CutterGridAtomicActionV1,
  CutterGridCoord,
  CutterGridProgramV1,
} from './types';

/**
 * The smallest program that exposes the V1 greedy-branch defect.  These IDs
 * are deliberately stable: planning diagnostics and tests can point back to a
 * player-visible block without depending on Blockly's generated IDs.
 */
export const CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM: CutterGridProgramV1 = {
  kind: 'cutter-grid',
  version: 1,
  plannerVersion: 'cutter-grid-dls-v1',
  nodes: [
    { type: 'move', direction: 'up', distance: 6, sourceBlockId: 'regression-up' },
    { type: 'move', direction: 'left', distance: 2, sourceBlockId: 'regression-left' },
    {
      type: 'move',
      direction: 'forward',
      distance: 3,
      sourceBlockId: 'regression-forward',
    },
  ],
  sourceBlockCount: 3,
};

export const CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD: CutterGridCoord = [
  -2,
  6,
  -3,
];

/** The V2 four-layer sample at 3/4 of the final Forward cell. */
export const CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE = Object.freeze({
  actionIndex: 10,
  subdivisionIndex: 3,
  subdivisions: 4,
  targetCoord: CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
  targetWorld: [1.03, 1.66, 0.84] as Vec3Tuple,
  greedyWristDeg: 145.9,
  safeWristDeg: 67.9,
});

/**
 * A low-Wrist seed observed for the same point.  It is a diagnostic seed, not
 * a shipped pose or a new fixed entry option; Phase 2 will generate and
 * certify entry options from the full deterministic candidate set instead.
 */
export const CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED: Record<JointId, number> = {
  baseYaw: 56.0,
  shoulderRoll: 5.5,
  shoulder: 133.9,
  elbow: 85.2,
  wrist: 67.9,
};

/**
 * The real sphere sweep outcome of the fixed program.  The extra voxel is a
 * deliberate baseline: global IK must not alter the player Cartesian path or
 * hide this contact through target filtering.
 */
export const CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS: readonly VoxelKey[] = [
  '-2,0,4',
  '-2,1,4',
  '-1,0,4',
  '-1,1,4',
  '-1,2,4',
];

export const CUTTER_GRID_GLOBAL_IK_REGRESSION_EXTRA_CUT_VOXELS: readonly VoxelKey[] = [
  '-2,1,4',
];

export function regressionProgramRuntimeActions(): CutterGridAtomicActionV1[] {
  return [
    ...Array.from({ length: 6 }, () => ({
      type: 'move-cell' as const,
      direction: 'up' as const,
      sourceBlockId: 'regression-up',
    })),
    ...Array.from({ length: 2 }, () => ({
      type: 'move-cell' as const,
      direction: 'left' as const,
      sourceBlockId: 'regression-left',
    })),
    ...Array.from({ length: 3 }, () => ({
      type: 'move-cell' as const,
      direction: 'forward' as const,
      sourceBlockId: 'regression-forward',
    })),
  ];
}

export function regressionProgramSweptVoxelHits(
  challenge: Challenge,
  originHairCoord: CutterGridCoord = [0, -5, 8],
): VoxelKey[] {
  const hits = new Set<VoxelKey>();
  let coord: CutterGridCoord = [0, 0, 0];

  for (const action of regressionProgramRuntimeActions()) {
    if (action.type !== 'move-cell') continue;
    const nextCoord = moveCutterGridCoord(coord, action.direction);
    const start = cutterGridCoordToWorld(
      coord,
      originHairCoord,
      challenge.voxelConfig,
    );
    const end = cutterGridCoordToWorld(
      nextCoord,
      originHairCoord,
      challenge.voxelConfig,
    );
    for (const key of findSweptVoxelHits(
      start,
      end,
      challenge.initialHair.voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    )) {
      hits.add(key);
    }
    coord = nextCoord;
  }

  return [...hits].sort(compareVoxelKeysByCoordinate);
}

export function regressionProgramReverseDirections(): readonly [
  'backward',
  'right',
  'down',
] {
  return ['backward', 'right', 'down'];
}

function compareVoxelKeysByCoordinate(left: VoxelKey, right: VoxelKey): number {
  const leftCoord = left.split(',').map(Number);
  const rightCoord = right.split(',').map(Number);
  for (let axis = 0; axis < 3; axis += 1) {
    const difference = leftCoord[axis] - rightCoord[axis];
    if (difference !== 0) return difference;
  }
  return 0;
}
