import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import {
  ChallengeValidationError,
  validateChallengeDefinition,
} from '../../src/services/validation';
import type { ChallengeDefinition, VoxelKey } from '../../src/types/domain';

describe('LocalChallengeProvider', () => {
  it('lists and loads a normalized isolated challenge', async () => {
    const provider = new LocalChallengeProvider();
    const summaries = await provider.listChallenges();
    const first = await provider.getChallenge(summaries[0].id);
    const second = await provider.getChallenge(summaries[0].id);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'neat-short-cap',
      name: 'Neat Short Haircut',
    });
    expect(first.initialHair.name).toBe('Thick Cap Initial Hairstyle');
    expect(first.targetHair.name).toBe('Symmetric Neat Crop');
    expect(first.initialHair.voxels).toBeInstanceOf(Set);
    expect(first.targetHair.voxels.size).toBe(215);
    expect(first.robotConfig.joints).toHaveLength(5);
    expect(first.robotConfig.joints.map((joint) => joint.id)).toEqual([
      'baseYaw',
      'shoulderRoll',
      'shoulder',
      'elbow',
      'wrist',
    ]);
    expect(first.robotConfig.joints.map((joint) => joint.name)).toEqual([
      'Base Yaw',
      'Shoulder Roll',
      'Shoulder',
      'Elbow',
      'Wrist',
    ]);
    expect(first.robotConfig.joints[1]).toMatchObject({
      id: 'shoulderRoll',
      axis: 'x',
      minAngleDeg: -45,
      maxAngleDeg: 45,
      initialAngleDeg: 0,
      speedDegPerSec: 45,
    });
    expect(first.robotConfig.geometry.collision).toEqual({
      linkRadius: 0.075,
      jointRadius: 0.18,
      toolShaftRadius: 0.075,
      headClearance: 0.02,
    });
    expect(first.initialHair.voxels).not.toBe(second.initialHair.voxels);
  });

  it('rejects unknown challenge ids', async () => {
    const provider = new LocalChallengeProvider();

    await expect(provider.getChallenge('missing')).rejects.toThrow(
      'was not found',
    );
  });

  it('rejects invalid collision dimensions and an unsafe initial pose', () => {
    const invalidRadius = cloneDefinition();
    invalidRadius.robotConfig.geometry.collision.linkRadius = 0;
    expect(() => validateChallengeDefinition(invalidRadius)).toThrow(
      'greater than 0',
    );

    const collidingInitialPose = cloneDefinition();
    collidingInitialPose.voxelConfig.headCenter = [0, 0.4, 0];
    collidingInitialPose.voxelConfig.headScale = [0.1, 0.1, 0.1];
    expect(() =>
      validateChallengeDefinition(collidingInitialPose),
    ).toThrow('Initial robot pose collides with the head');
  });
});

describe('challenge validation', () => {
  it('rejects duplicate joints and target voxels outside initial hair', () => {
    const duplicateJoint = cloneDefinition();
    duplicateJoint.robotConfig.joints.push({
      ...duplicateJoint.robotConfig.joints[0],
    });
    expect(() => validateChallengeDefinition(duplicateJoint)).toThrow(
      ChallengeValidationError,
    );

    const invalidTarget = cloneDefinition();
    invalidTarget.targetHair.voxels.push({ x: 99, y: 99, z: 99 });
    expect(() => validateChallengeDefinition(invalidTarget)).toThrow(
      'is not in initial hair',
    );
  });
});

describe('LocalScoreProvider', () => {
  it('delegates to the deterministic score calculation', async () => {
    const provider = new LocalScoreProvider();
    const result = await provider.score({
      targetVoxels: new Set<VoxelKey>(['0,0,0']),
      resultVoxels: new Set<VoxelKey>(['0,0,0']),
      programMetrics: {
        sourceBlockCount: 1,
        executedCommandCount: 1,
        estimatedDurationMs: 1_000,
      },
      scoring: defaultChallengeDefinition.scoring,
    });

    expect(result.completionScore).toBe(100);
    expect(result.finalScore).toBe(100);
  });
});

function cloneDefinition(): ChallengeDefinition {
  return structuredClone(defaultChallengeDefinition);
}
