import type { HairstyleDefinition, VoxelCoord } from '../../types/domain';
import { coordToKey } from './voxelKey';

const TARGET_INNER_BOUND = 0.68;
const INITIAL_OUTER_BOUND = 1.24;

export interface GeneratedHairstyles {
  initialHair: HairstyleDefinition;
  targetHair: HairstyleDefinition;
}

export function generateDefaultHairstyles(): GeneratedHairstyles {
  const initial = generateShell(TARGET_INNER_BOUND, INITIAL_OUTER_BOUND, -2);
  const target = initial.filter((voxel) => !isTrimBandVoxel(voxel));

  return {
    initialHair: {
      id: 'thick-cap',
      name: 'Thick Cap Initial Hairstyle',
      voxels: initial,
    },
    targetHair: {
      id: 'neat-short-cap',
      name: 'Symmetric Neat Crop',
      voxels: target,
    },
  };
}

function isTrimBandVoxel(voxel: VoxelCoord): boolean {
  const absoluteZ = Math.abs(voxel.z);
  if (voxel.x === 0 && (voxel.y === 1 || voxel.y === 2)) {
    return absoluteZ === 4;
  }
  if (voxel.x === 1 && voxel.y === 1) {
    return absoluteZ === 4;
  }
  if (voxel.x === 1 && voxel.y === 2) {
    return absoluteZ === 3 || absoluteZ === 4;
  }
  if (voxel.x === 2 && voxel.y === 1) {
    return absoluteZ === 3 || absoluteZ === 4;
  }
  if (voxel.x === 2 && voxel.y === 2) {
    return absoluteZ === 3;
  }
  if (voxel.x === 3 && voxel.y === 1) {
    return absoluteZ === 2 || absoluteZ === 3;
  }
  if (voxel.x === 3 && voxel.y === 2) {
    return absoluteZ >= 1 && absoluteZ <= 3;
  }
  return false;
}

function generateShell(
  innerBound: number,
  outerBound: number,
  minimumY: number,
): VoxelCoord[] {
  const voxels: VoxelCoord[] = [];

  for (let x = -6; x <= 6; x += 1) {
    for (let y = minimumY; y <= 7; y += 1) {
      for (let z = -6; z <= 6; z += 1) {
        const normalized =
          (x * x) / (4.2 * 4.2) +
          (y * y) / (5.2 * 5.2) +
          (z * z) / (4.2 * 4.2);

        if (normalized >= innerBound && normalized <= outerBound) {
          voxels.push({ x, y, z });
        }
      }
    }
  }

  return voxels.sort(compareCoords);
}

function compareCoords(a: VoxelCoord, b: VoxelCoord): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

export function hasDuplicateVoxels(voxels: readonly VoxelCoord[]): boolean {
  return new Set(voxels.map(coordToKey)).size !== voxels.length;
}

export function isSymmetricAcrossZ(voxels: readonly VoxelCoord[]): boolean {
  const keys = new Set(voxels.map(coordToKey));
  return voxels.every((voxel) =>
    keys.has(coordToKey({ ...voxel, z: -voxel.z })),
  );
}
