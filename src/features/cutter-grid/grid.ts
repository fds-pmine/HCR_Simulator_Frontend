import type { Challenge, Vec3Tuple, VoxelCoord } from '../../types/domain';
import { keyToCoord, voxelCoordToWorld } from '../voxel/voxelKey';
import type {
  CutterGridBounds,
  CutterGridCoord,
  CutterGridDirection,
} from './types';

export const CUTTER_GRID_BOUND_PADDING = 2;

export const CUTTER_GRID_DIRECTION_DELTA: Readonly<
  Record<CutterGridDirection, CutterGridCoord>
> = {
  right: [1, 0, 0],
  left: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
  forward: [0, 0, -1],
  backward: [0, 0, 1],
};

export const CUTTER_GRID_DIRECTIONS = Object.freeze(
  Object.keys(CUTTER_GRID_DIRECTION_DELTA) as CutterGridDirection[],
);

export function deriveCutterGridBounds(
  challenge: Pick<Challenge, 'initialHair'>,
  originHairCoord: CutterGridCoord,
): CutterGridBounds {
  const coords = [...challenge.initialHair.voxels].map(keyToCoord);
  if (coords.length === 0) {
    throw new Error('Cutter Grid requires at least one initial hair voxel.');
  }

  const values = (axis: keyof VoxelCoord): number[] =>
    coords.map((coord) => coord[axis]);
  const paddedMin: CutterGridCoord = [
    Math.min(...values('x')) - CUTTER_GRID_BOUND_PADDING,
    Math.min(...values('y')) - CUTTER_GRID_BOUND_PADDING,
    Math.min(...values('z')) - CUTTER_GRID_BOUND_PADDING,
  ];
  const paddedMax: CutterGridCoord = [
    Math.max(...values('x')) + CUTTER_GRID_BOUND_PADDING,
    Math.max(...values('y')) + CUTTER_GRID_BOUND_PADDING,
    Math.max(...values('z')) + CUTTER_GRID_BOUND_PADDING,
  ];

  return {
    min: paddedMin.map((value, axis) =>
      Math.min(value, originHairCoord[axis]),
    ) as unknown as CutterGridCoord,
    max: paddedMax.map((value, axis) =>
      Math.max(value, originHairCoord[axis]),
    ) as unknown as CutterGridCoord,
  };
}

export function nearestHairLatticeCoord(
  point: Vec3Tuple,
  voxelConfig: Challenge['voxelConfig'],
): CutterGridCoord {
  return point.map((value, axis) =>
    normalizeInteger(
      Math.round((value - voxelConfig.origin[axis]) / voxelConfig.size),
    ),
  ) as unknown as CutterGridCoord;
}

export function logicalToHairCoord(
  logicalCoord: CutterGridCoord,
  originHairCoord: CutterGridCoord,
): CutterGridCoord {
  return logicalCoord.map(
    (value, axis) => value + originHairCoord[axis],
  ) as unknown as CutterGridCoord;
}

export function hairToLogicalCoord(
  hairCoord: CutterGridCoord,
  originHairCoord: CutterGridCoord,
): CutterGridCoord {
  return hairCoord.map(
    (value, axis) => value - originHairCoord[axis],
  ) as unknown as CutterGridCoord;
}

export function cutterGridCoordToWorld(
  logicalCoord: CutterGridCoord,
  originHairCoord: CutterGridCoord,
  voxelConfig: Challenge['voxelConfig'],
): Vec3Tuple {
  const hairCoord = logicalToHairCoord(logicalCoord, originHairCoord);
  return voxelCoordToWorld(
    { x: hairCoord[0], y: hairCoord[1], z: hairCoord[2] },
    voxelConfig.origin,
    voxelConfig.size,
  );
}

export function moveCutterGridCoord(
  coord: CutterGridCoord,
  direction: CutterGridDirection,
): CutterGridCoord {
  const delta = CUTTER_GRID_DIRECTION_DELTA[direction];
  return coord.map(
    (value, axis) => value + delta[axis],
  ) as unknown as CutterGridCoord;
}

export function cutterGridBoundsContain(
  bounds: CutterGridBounds,
  coord: CutterGridCoord,
): boolean {
  return coord.every(
    (value, axis) =>
      value >= bounds.min[axis] && value <= bounds.max[axis],
  );
}

export function compareCutterGridCoords(
  left: CutterGridCoord,
  right: CutterGridCoord,
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function enumerateCutterGridCoords(
  bounds: CutterGridBounds,
): CutterGridCoord[] {
  const result: CutterGridCoord[] = [];
  for (let x = bounds.min[0]; x <= bounds.max[0]; x += 1) {
    for (let y = bounds.min[1]; y <= bounds.max[1]; y += 1) {
      for (let z = bounds.min[2]; z <= bounds.max[2]; z += 1) {
        result.push([x, y, z]);
      }
    }
  }
  return result;
}

function normalizeInteger(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
