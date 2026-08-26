import profileFixture from '../../../tests/fixtures/cutter-grid-profile.json';
import profileV2Fixture from '../../../tests/fixtures/cutter-grid-profile-v2.json';
import type { Challenge } from '../../types/domain';
import { cutterGridProfileMatchesChallenge } from './profile';
import { cutterGridProfileV2MatchesChallenge } from './profileV2';
import { upgradeCutterGridProfileV2ToV3 } from './profileV3';
import { upgradeCutterGridProfileV2ToV4 } from './profileV4';
import type {
  CutterGridProfileV1,
  CutterGridProfileV2,
  CutterGridProfileV3,
  CutterGridProfileV4,
} from './types';

const bundledProfile = profileFixture as unknown as CutterGridProfileV1;
const bundledProfiles = new Map<string, CutterGridProfileV1>(
  bundledProfile.challengeSignature
    ? [[bundledProfile.challengeSignature, bundledProfile]]
    : [],
);

const bundledProfileV2 = profileV2Fixture as unknown as CutterGridProfileV2;
const bundledProfilesV2 = new Map<string, CutterGridProfileV2>(
  bundledProfileV2.challengeSignature
    ? [[bundledProfileV2.challengeSignature, bundledProfileV2]]
    : [],
);

const bundledProfilesV4 = new Map<string, CutterGridProfileV4>();

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

/**
 * The V2 registry remains separate until the V2 Worker and frozen-trajectory
 * executor land together.  This prevents a V1 caller from accidentally
 * treating static node information as a globally connected runtime plan.
 */
export function registeredCutterGridProfileV2(
  challenge: Challenge,
): CutterGridProfileV2 | undefined {
  for (const profile of bundledProfilesV2.values()) {
    if (cutterGridProfileV2MatchesChallenge(profile, challenge)) return profile;
  }
  return undefined;
}

/**
 * V3 is intentionally derived from the certified bundled V2 geometry while
 * the browser implementation is a test bed.  Its fully materialized output
 * is serializable and can be compared with Rust before it becomes authoritative.
 */
export function registeredCutterGridProfileV3(
  challenge: Challenge,
): CutterGridProfileV3 | undefined {
  const profile = registeredCutterGridProfileV2(challenge);
  return profile ? upgradeCutterGridProfileV2ToV3(challenge, profile) : undefined;
}

/**
 * V4 is derived once from the signed V2 geometry and cached by the V2
 * Challenge signature. Regenerating its 256-node collision roadmap on every
 * React render would make a compact plan look slow before Worker planning even
 * begins.
 */
export function registeredCutterGridProfileV4(
  challenge: Challenge,
): CutterGridProfileV4 | undefined {
  const profile = registeredCutterGridProfileV2(challenge);
  if (!profile) return undefined;
  const cached = bundledProfilesV4.get(profile.challengeSignature);
  if (cached) return cached;
  const upgraded = upgradeCutterGridProfileV2ToV4(challenge, profile);
  bundledProfilesV4.set(profile.challengeSignature, upgraded);
  return upgraded;
}
