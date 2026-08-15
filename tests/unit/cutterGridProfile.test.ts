import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  cutterGridProfileMatchesChallenge,
  generateCutterGridProfile,
} from '../../src/features/cutter-grid/profile';
import { CUTTER_GRID_DIRECTIONS } from '../../src/features/cutter-grid/grid';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid certified Profile', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('passes only with zero-contact entry, exact reference cuts and six directions', () => {
    const profile = generateCutterGridProfile(challenge);

    expect(cutterGridProfileMatchesChallenge(profile, challenge)).toBe(true);
    expect(profile.certification).toMatchObject({
      passed: true,
      entryZeroContact: true,
      referenceCompletion: 100,
      referenceExtraCutVoxels: [],
    });
    expect(profile.certification.referenceCutVoxels).toHaveLength(12);
    expect(profile.certification.certifiedDirections).toEqual(
      CUTTER_GRID_DIRECTIONS,
    );
    expect(profile.entryTrajectory.length).toBeGreaterThan(1);
    expect(profile.referenceTrajectorySignature).toMatch(/^[0-9a-f]{16}$/);
  }, 120_000);

  it('rejects a Profile after any signed challenge input changes', () => {
    const profile = generateCutterGridProfile(challenge);
    const changed = {
      ...challenge,
      robotConfig: {
        ...challenge.robotConfig,
        geometry: {
          ...challenge.robotConfig.geometry,
          toolRadius: 0.13,
        },
      },
    };
    expect(cutterGridProfileMatchesChallenge(profile, changed)).toBe(false);
  }, 120_000);
});
