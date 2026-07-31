import { coordToKey } from '../features/voxel/voxelKey';
import type { Challenge, ChallengeDefinition } from '../types/domain';

/**
 * Convert a wire/definition challenge into the normalized runtime form.
 *
 * `ChallengeDefinition` carries hair as `VoxelCoord[]` because that is what JSON
 * can express; `Challenge` carries `Set<VoxelKey>` because that is what the
 * engine needs. Every provider must use this one function — a second
 * implementation would be free to drift, and the local and remote paths would
 * quietly stop agreeing.
 */
export function normalizeChallenge(
  definition: ChallengeDefinition,
): Challenge {
  return {
    ...definition,
    robotConfig: {
      joints: definition.robotConfig.joints.map((joint) => ({ ...joint })),
      geometry: {
        ...definition.robotConfig.geometry,
        basePosition: [...definition.robotConfig.geometry.basePosition],
        collision: {
          ...definition.robotConfig.geometry.collision,
        },
      },
    },
    voxelConfig: {
      ...definition.voxelConfig,
      origin: [...definition.voxelConfig.origin],
      headCenter: [...definition.voxelConfig.headCenter],
      headScale: [...definition.voxelConfig.headScale],
    },
    initialHair: {
      id: definition.initialHair.id,
      name: definition.initialHair.name,
      voxels: new Set(definition.initialHair.voxels.map(coordToKey)),
    },
    targetHair: {
      id: definition.targetHair.id,
      name: definition.targetHair.name,
      voxels: new Set(definition.targetHair.voxels.map(coordToKey)),
    },
    allowedBlocks: [...definition.allowedBlocks],
    starterWorkspace: structuredClone(definition.starterWorkspace),
    scoring: {
      ...definition.scoring,
      weights: { ...definition.scoring.weights },
    },
  };
}
