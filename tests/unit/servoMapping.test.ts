import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import {
  servoAnglesFromJointAngles,
  servoJointLabel,
} from '../../src/features/robot/servoMapping';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);

describe('servo telemetry mapping', () => {
  it('maps the live robot pose to firmware axes and keeps E parked', () => {
    expect(
      servoAnglesFromJointAngles(challenge.robotConfig, {
        baseYaw: 35,
        shoulderRoll: 12,
        shoulder: 120,
        elbow: 162.5,
        wrist: 10,
      }),
    ).toEqual({ X: 35, Y: 120, Z: 162.5, B: 10, E: 90 });
  });

  it('puts firmware axis names on hardware-backed joint labels', () => {
    expect(
      challenge.robotConfig.joints.map((joint) => servoJointLabel(joint)),
    ).toEqual([
      'X · Base Yaw',
      'Shoulder Roll',
      'Y · Shoulder',
      'Z · Elbow',
      'B · Wrist',
    ]);
  });
});
