import type { Challenge, Vec3Tuple } from '../../types/domain';
import type { Heading, ScalpGridNode } from './types';

export const SCALP_GRID_ROWS = 7;
export const SCALP_GRID_COLUMNS = 12;

const DIRECTIONS: readonly Heading[] = [
  'north',
  'east',
  'south',
  'west',
];

/**
 * Creates a complete visual scalp grid. Reachability is deliberately assigned
 * later by a calibrated motion profile, so an untrusted geometry cannot make a
 * visually plausible but unsafe cell programmable.
 */
export function createScalpGrid(
  voxelConfig: Challenge['voxelConfig'],
): ScalpGridNode[] {
  const nodes: ScalpGridNode[] = [];
  for (let row = 0; row < SCALP_GRID_ROWS; row += 1) {
    for (let column = 0; column < SCALP_GRID_COLUMNS; column += 1) {
      const point = pointOnScalp(voxelConfig, row, column);
      nodes.push({
        id: scalpNodeId(row, column),
        row,
        column,
        worldPosition: point.position,
        surfaceNormal: point.normal,
        neighbors: Object.fromEntries(
          DIRECTIONS.flatMap((direction) => {
            const neighbor = gridNeighbor(row, column, direction);
            return neighbor ? [[direction, scalpNodeId(...neighbor)]] : [];
          }),
        ),
        reachable: false,
      });
    }
  }
  return nodes;
}

export function scalpNodeId(row: number, column: number): string {
  return `r${row}-c${column}`;
}

export function gridNeighbor(
  row: number,
  column: number,
  heading: Heading,
): readonly [number, number] | undefined {
  if (heading === 'north') {
    return row > 0 ? [row - 1, column] : undefined;
  }
  if (heading === 'south') {
    return row < SCALP_GRID_ROWS - 1 ? [row + 1, column] : undefined;
  }
  if (heading === 'east') {
    return [row, (column + 1) % SCALP_GRID_COLUMNS];
  }
  return [row, (column + SCALP_GRID_COLUMNS - 1) % SCALP_GRID_COLUMNS];
}

function pointOnScalp(
  voxelConfig: Challenge['voxelConfig'],
  row: number,
  column: number,
): { position: Vec3Tuple; normal: Vec3Tuple } {
  // Avoid a pole row: every column keeps a distinct, stable turtle neighbor.
  const polar = Math.PI * (0.08 + (row / (SCALP_GRID_ROWS - 1)) * 0.58);
  const azimuth = (column / SCALP_GRID_COLUMNS) * Math.PI * 2;
  const unit: Vec3Tuple = [
    Math.sin(polar) * Math.cos(azimuth),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(azimuth),
  ];
  const { headCenter, headScale } = voxelConfig;
  const position: Vec3Tuple = [
    headCenter[0] + headScale[0] * unit[0],
    headCenter[1] + headScale[1] * unit[1],
    headCenter[2] + headScale[2] * unit[2],
  ];
  const normal = normalize([
    unit[0] / headScale[0],
    unit[1] / headScale[1],
    unit[2] / headScale[2],
  ]);
  return { position, normal };
}

function normalize(value: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(...value);
  if (length === 0) {
    throw new Error('Scalp normal cannot be zero.');
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}
