import profileFixture from '../../../tests/fixtures/cutter-grid-profile.json';
import profileV2Fixture from '../../../tests/fixtures/cutter-grid-profile-v2.json';
import type { Challenge } from '../../types/domain';
import { cutterGridProfileMatchesChallenge } from './profile';
import { cutterGridProfileV2MatchesChallenge } from './profileV2';
import { cutterGridChallengeSignatureV2 } from './signature';
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

/**
 * V4 profiles certified ahead of time, one per Servo Angles lesson.
 *
 * These are the reason a lesson can be played in Cutter Grid at all: the mode
 * is only offered where a profile proves the lattice is reachable, that entry
 * cuts nothing, and that a reference route removes exactly the target. They
 * ship as V4 rather than V2 because the V4 upgrade compresses a megabyte of
 * entry options down to a few kilobytes — 273 KB an item instead of 1.25 MB.
 *
 * `import.meta.glob` with `eager` keeps the lookup synchronous, which every
 * caller here depends on, while still letting the set grow by dropping a file
 * in the directory rather than by editing this list.
 */
const certifiedV4 = import.meta.glob<{ default: CutterGridProfileV4 }>(
  '../../data/cutter-grid-profiles/*.json',
  { eager: true },
);

const bundledProfilesV4 = new Map<string, CutterGridProfileV4>(
  Object.values(certifiedV4).map((module) => [
    module.default.challengeSignature,
    module.default,
  ]),
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
  // An existence check, deliberately not `registeredCutterGridProfileV4`:
  // that one *builds* a V4 when only a V2 is bundled, and generating a
  // 256-node collision roadmap is not what a caller asking "is this mode
  // offered?" is expecting to pay for.
  if (registeredCutterGridProfile(challenge) !== undefined) return true;
  return bundledProfilesV4.has(cutterGridChallengeSignatureV2(challenge));
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
  // A bundled V2 wins when there is one. The signature covers `targetHair`, and
  // two challenges can legitimately share a target — Servo lesson 4 sweeps the
  // base to 145 degrees, which removes exactly the eleven crown voxels the
  // shipped challenge asks for, so the two hash identically. Deriving from V2
  // first keeps the richer profile (it carries the node map the overlay and the
  // reachability tests read) instead of letting a pre-certified, node-less one
  // shadow it.
  const profile = registeredCutterGridProfileV2(challenge);
  if (profile) {
    const cached = bundledProfilesV4.get(profile.challengeSignature);
    if (cached?.nodes.length) return cached;
    const upgraded = upgradeCutterGridProfileV2ToV4(challenge, profile);
    bundledProfilesV4.set(profile.challengeSignature, upgraded);
    return upgraded;
  }

  return bundledProfilesV4.get(cutterGridChallengeSignatureV2(challenge));
}
