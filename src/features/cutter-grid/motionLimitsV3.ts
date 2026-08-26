import type { Challenge } from '../../types/domain';
import { fnv1a64 } from './signature';
import {
  CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
  type CutterGridMotionLimitsV3,
} from './types';

/**
 * Stable, standalone digest of the V3 dynamic contract.  It deliberately
 * includes the Challenge joint order: a map with the same values but applied
 * to a different axis must never be accepted by the future Rust planner.
 */
export function cutterGridMotionLimitsSignatureV3(
  challenge: Challenge,
  motionLimits: CutterGridMotionLimitsV3,
): string {
  return fnv1a64(JSON.stringify({
    plannerVersion: CUTTER_GRID_JERK_LIMITED_PLANNER_VERSION,
    requestedSpeedScale: motionLimits.requestedSpeedScale,
    // Keep this schema and field order explicit: the signature is a browser/Rust
    // hand-off contract, so it must not depend on object insertion order.
    joints: challenge.robotConfig.joints.map((joint) => {
      const limits = motionLimits.joints[joint.id];
      return {
        id: joint.id,
        nominalVelocityDegPerSec: limits?.nominalVelocityDegPerSec ?? null,
        maxVelocityDegPerSec: limits?.maxVelocityDegPerSec ?? null,
        nominalAccelerationDegPerSec2: limits?.nominalAccelerationDegPerSec2 ?? null,
        maxAccelerationDegPerSec2: limits?.maxAccelerationDegPerSec2 ?? null,
        nominalJerkDegPerSec3: limits?.nominalJerkDegPerSec3 ?? null,
        maxJerkDegPerSec3: limits?.maxJerkDegPerSec3 ?? null,
      };
    }),
  }));
}
