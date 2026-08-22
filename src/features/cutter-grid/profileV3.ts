import type { Challenge } from '../../types/domain';
import { fnv1a64 } from './signature';
import { cutterGridMotionLimitsSignatureV3 } from './motionLimitsV3';
import {
  CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
  CUTTER_GRID_PROFILE_V3_VERSION,
  type CutterGridMotionLimitsV3,
  type CutterGridProfileV2,
  type CutterGridProfileV3,
} from './types';
import { cutterGridProfileV2MatchesChallenge } from './profileV2';

/**
 * Browser-only tuning while the V3 planner is still being validated.  The
 * values are explicitly materialized into the serialized profile; they are
 * not hardware calibration and must be replaced by the signed Rust profile
 * before any backend replay or physical bridge is enabled.
 */
export function frontendTrialMotionLimitsV3(challenge: Challenge): CutterGridMotionLimitsV3 {
  return {
    requestedSpeedScale: 1.25,
    joints: Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
      const nominalVelocityDegPerSec = joint.speedDegPerSec * 4;
      // The browser trial uses intentionally permissive acceleration and jerk
      // ceilings so velocity remains the visual-speed limiter.  They are still
      // finite, signed into the profile, and verified at every sample.
      const nominalAccelerationDegPerSec2 = joint.speedDegPerSec * 5_000;
      const nominalJerkDegPerSec3 = joint.speedDegPerSec * 1_000_000;
      return [joint.id, {
        nominalVelocityDegPerSec,
        nominalAccelerationDegPerSec2,
        nominalJerkDegPerSec3,
        maxVelocityDegPerSec: nominalVelocityDegPerSec * 1.25,
        maxAccelerationDegPerSec2: nominalAccelerationDegPerSec2 * 1.25 ** 2,
        maxJerkDegPerSec3: nominalJerkDegPerSec3 * 1.25 ** 3,
      }];
    })) as CutterGridMotionLimitsV3['joints'],
  };
}

export function upgradeCutterGridProfileV2ToV3(
  challenge: Challenge,
  profile: CutterGridProfileV2,
): CutterGridProfileV3 | undefined {
  if (!cutterGridProfileV2MatchesChallenge(profile, challenge)) return undefined;
  const motionLimits = frontendTrialMotionLimitsV3(challenge);
  const unsigned = {
    ...profile,
    version: CUTTER_GRID_PROFILE_V3_VERSION,
    plannerVersion: CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
    motionLimits,
    motionLimitsSignature: cutterGridMotionLimitsSignatureV3(challenge, motionLimits),
  } satisfies Omit<CutterGridProfileV3, 'profileSignature'>;
  return {
    ...unsigned,
    profileSignature: profileSignature(unsigned),
  };
}

export function cutterGridProfileV3MatchesChallenge(
  profile: CutterGridProfileV3,
  challenge: Challenge,
): boolean {
  const sourceProfile: CutterGridProfileV2 = {
    ...profile,
    version: 2,
    plannerVersion: 'cutter-grid-ladder-v2',
  };
  if (!cutterGridProfileV2MatchesChallenge(sourceProfile, challenge)) return false;
  if (
    profile.version !== CUTTER_GRID_PROFILE_V3_VERSION ||
    profile.plannerVersion !== CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION
  ) return false;
  if (
    profile.motionLimitsSignature !==
    cutterGridMotionLimitsSignatureV3(challenge, profile.motionLimits)
  ) return false;
  const { profileSignature: expectedSignature, ...unsigned } = profile;
  return expectedSignature === profileSignature(unsigned);
}

function profileSignature(profile: Omit<CutterGridProfileV3, 'profileSignature'>): string {
  return fnv1a64(JSON.stringify({
    version: profile.version,
    plannerVersion: profile.plannerVersion,
    challengeSignature: profile.challengeSignature,
    originHairCoord: profile.originHairCoord,
    entryOptions: profile.entryOptions.map((entry) => ({
      id: entry.id,
      jointAngles: entry.jointAngles,
      positioningSignature: entry.positioningSignature,
    })),
    motionLimits: profile.motionLimits,
    motionLimitsSignature: profile.motionLimitsSignature,
  }));
}
