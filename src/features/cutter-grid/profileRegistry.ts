import profileFixture from '../../../tests/fixtures/cutter-grid-profile.json';
import type { Challenge } from '../../types/domain';
import { cutterGridProfileMatchesChallenge } from './profile';
import type { CutterGridProfileV1 } from './types';

const bundledProfile = profileFixture as unknown as CutterGridProfileV1;
const bundledProfiles = new Map<string, CutterGridProfileV1>(
  bundledProfile.challengeSignature
    ? [[bundledProfile.challengeSignature, bundledProfile]]
    : [],
);

export function registeredCutterGridProfile(
  challenge: Challenge,
): CutterGridProfileV1 | undefined {
  for (const profile of bundledProfiles.values()) {
    if (cutterGridProfileMatchesChallenge(profile, challenge)) return profile;
  }
  return undefined;
}

export function cutterGridAvailableForChallenge(challenge: Challenge): boolean {
  return registeredCutterGridProfile(challenge) !== undefined;
}
