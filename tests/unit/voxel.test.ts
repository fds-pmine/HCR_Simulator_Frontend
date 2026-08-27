import { describe, expect, it } from 'vitest';
import {
  generateDefaultHairstyles,
  hasDuplicateVoxels,
  isSymmetricAcrossZ,
} from '../../src/features/voxel/hairGenerator';
import {
  coordToKey,
  keyToCoord,
  voxelCoordToWorld,
} from '../../src/features/voxel/voxelKey';

describe('voxel keys', () => {
  it('round-trips integer grid coordinates', () => {
    const coord = { x: -2, y: 5, z: 3 };

    expect(keyToCoord(coordToKey(coord))).toEqual(coord);
    expect(voxelCoordToWorld(coord, [1, 2, 3], 0.5)).toEqual([
      0, 4.5, 4.5,
    ]);
  });

  it('rejects malformed or non-integer coordinates', () => {
    expect(() => coordToKey({ x: 0.5, y: 0, z: 0 })).toThrow(
      'must be an integer',
    );
    expect(() => keyToCoord('1,2')).toThrow('Invalid voxel key');
  });
});

describe('default hairstyle generator', () => {
  it('is deterministic, unique and symmetric', () => {
    const first = generateDefaultHairstyles();
    const second = generateDefaultHairstyles();

    expect(first).toEqual(second);
    expect(first.targetHair.voxels).toHaveLength(230);
    expect(first.initialHair.voxels).toHaveLength(241);
    expect(hasDuplicateVoxels(first.targetHair.voxels)).toBe(false);
    expect(hasDuplicateVoxels(first.initialHair.voxels)).toBe(false);
    expect(isSymmetricAcrossZ(first.initialHair.voxels)).toBe(true);
    // The calibrated all-90° Home sweep crosses matching ±Z voxels, so the
    // measured target happens to retain mirror symmetry as well as reachability.
    expect(isSymmetricAcrossZ(first.targetHair.voxels)).toBe(true);
  });

  it('contains every target voxel in the thicker initial hairstyle', () => {
    const { initialHair, targetHair } = generateDefaultHairstyles();
    const initialKeys = new Set(initialHair.voxels.map(coordToKey));

    expect(targetHair.voxels.length).toBeGreaterThan(0);
    expect(initialHair.voxels.length).toBeGreaterThan(
      targetHair.voxels.length,
    );
    expect(
      targetHair.voxels.every((voxel) =>
        initialKeys.has(coordToKey(voxel)),
      ),
    ).toBe(true);
  });
});
