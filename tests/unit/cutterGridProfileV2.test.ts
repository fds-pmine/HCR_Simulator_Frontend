import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { findSweptVoxelHits } from '../../src/features/voxel/contactDetection';
import {
  cutterGridProfileV2MatchesChallenge,
  generateCutterGridProfileV2,
} from '../../src/features/cutter-grid/profileV2';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { normalizedJointDistance } from '../../src/features/cutter-grid/ik';
import profileFixture from '../fixtures/cutter-grid-profile-v2.json';
import { CUTTER_GRID_LADDER_PLANNER_VERSION } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid Profile V2 multi-entry certification', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
  });

  it('certifies deterministic, different zero-contact entries and a V2 reference trajectory', () => {
    const first = generateCutterGridProfileV2(challenge);
    const second = generateCutterGridProfileV2(challenge);

    expect(first).toEqual(second);
    expect(cutterGridProfileV2MatchesChallenge(first, challenge)).toBe(true);
    expect(first.plannerVersion).toBe(CUTTER_GRID_LADDER_PLANNER_VERSION);
    expect(first.entryOptions.length).toBeGreaterThanOrEqual(2);
    expect(first.entryOptions.length).toBeLessThanOrEqual(32);
    expect(first.certification.authenticatedEntryOptionIds).toEqual(
      first.entryOptions.map((entry) => entry.id),
    );
    expect(first.certification.referenceTrajectoryCertified).toBe(true);
    expect(first.referenceProgram.plannerVersion).toBe(CUTTER_GRID_LADDER_PLANNER_VERSION);
    for (let index = 0; index < first.entryOptions.length; index += 1) {
      for (let other = index + 1; other < first.entryOptions.length; other += 1) {
        expect(normalizedJointDistance(
          first.entryOptions[index].jointAngles,
          first.entryOptions[other].jointAngles,
          challenge.robotConfig.joints,
        )).toBeGreaterThan(0.01 - 1e-12);
      }
    }
    for (const entry of first.entryOptions) {
      expect(entry.positioningTrajectory.length).toBeGreaterThan(1);
      expect(entry.minimumHeadClearance).toBeGreaterThan(0);
      const firstWaypoint = entry.positioningTrajectory[0];
      const lastWaypoint = entry.positioningTrajectory.at(-1);
      expect(lastWaypoint?.jointAngles).toEqual(entry.jointAngles);
      for (let index = 1; index < entry.positioningTrajectory.length; index += 1) {
        expect(findSweptVoxelHits(
          entry.positioningTrajectory[index - 1].endEffector,
          entry.positioningTrajectory[index].endEffector,
          challenge.initialHair.voxels,
          challenge.voxelConfig,
          challenge.robotConfig.geometry.toolRadius,
        )).toEqual([]);
      }
      expect(firstWaypoint.jointVelocitiesDegPerSec).toEqual(
        Object.fromEntries(challenge.robotConfig.joints.map((joint) => [joint.id, 0])),
      );
      expect(lastWaypoint?.jointVelocitiesDegPerSec).toEqual(
        Object.fromEntries(challenge.robotConfig.joints.map((joint) => [joint.id, 0])),
      );
    }
  }, 900_000);

  it('fails closed when a V2-signature input changes', () => {
    const profile = generateCutterGridProfileV2(challenge);
    expect(cutterGridProfileV2MatchesChallenge(profile, {
      ...challenge,
      robotConfig: {
        ...challenge.robotConfig,
        geometry: {
          ...challenge.robotConfig.geometry,
          collision: {
            ...challenge.robotConfig.geometry.collision,
            headClearance: challenge.robotConfig.geometry.collision.headClearance + 0.01,
          },
        },
      },
    })).toBe(false);
  }, 900_000);

  it('loads the generated asset with static IK status distinct from path connectivity', () => {
    const profile = profileFixture as unknown as ReturnType<typeof generateCutterGridProfileV2>;
    expect(cutterGridProfileV2MatchesChallenge(profile, challenge)).toBe(true);
    expect(profile.nodes).toHaveLength(2535);
    expect(profile.nodes.every((node) =>
      node.staticIkStatus === 'safe-candidate-known' ||
      node.staticIkStatus === 'no-safe-candidate-found',
    )).toBe(true);
    expect('reachable' in profile.nodes[0]).toBe(false);
    expect(profile.certification.referenceTrajectoryCertified).toBe(true);
    expect(registeredCutterGridProfileV2(challenge)).toEqual(profile);
  });
});
