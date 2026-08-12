import { beforeAll, describe, expect, it } from 'vitest';
import { buildArmPlan } from '../../src/features/robot/armBridge';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';
import type { RobotCommand } from '../../src/features/blockly/programTypes';

/**
 * `electron/arm.cjs` runs in Electron's main process, but everything asserted
 * below is pure validation that never touches the Electron API — the module
 * requires it lazily, precisely so these checks stay reachable from here.
 */
import * as arm from '../../electron/arm.cjs';

let challenge: Challenge;

beforeAll(async () => {
  challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
});

describe('arm address validation', () => {
  it('accepts the access point address and private ranges', () => {
    expect(arm.parseAddress('192.168.4.1')).toEqual({ host: '192.168.4.1', port: 80 });
    expect(arm.parseAddress('10.0.0.7:8080')).toEqual({ host: '10.0.0.7', port: 8080 });
    expect(arm.parseAddress('172.20.1.5')).toEqual({ host: '172.20.1.5', port: 80 });
    expect(arm.parseAddress('169.254.9.9')).toEqual({ host: '169.254.9.9', port: 80 });
    expect(arm.parseAddress('127.0.0.1')).toEqual({ host: '127.0.0.1', port: 80 });
  });

  it('refuses public addresses so the bridge cannot become a general client', () => {
    expect(() => arm.parseAddress('8.8.8.8')).toThrow(/public address/);
    expect(() => arm.parseAddress('172.32.0.1')).toThrow(/public address/);
  });

  it('refuses hostnames, which the firmware never answers to', () => {
    expect(() => arm.parseAddress('arm.local')).toThrow(/IPv4 address/);
    expect(() => arm.parseAddress('example.com')).toThrow(/IPv4 address/);
  });

  it('refuses anything that could smuggle a path or another host', () => {
    expect(() => arm.parseAddress('192.168.4.1/../admin')).toThrow(/IPv4 address/);
    expect(() => arm.parseAddress('192.168.4.1@evil.test')).toThrow(/IPv4 address/);
    expect(() => arm.parseAddress('192.168.4.1:80/api/angles?X=0')).toThrow(/IPv4 address/);
    expect(() => arm.parseAddress('999.1.1.1')).toThrow(/valid IPv4/);
  });
});

describe('arm angle formatting', () => {
  it('emits the one-fractional-digit form the firmware parses', () => {
    expect(arm.formatAngle('X', 90)).toBe('90.0');
    expect(arm.formatAngle('X', 162.5)).toBe('162.5');
    expect(arm.formatAngle('X', 162.54)).toBe('162.5');
  });

  it('enforces each axis range, including the gripper', () => {
    expect(() => arm.formatAngle('X', 181)).toThrow(/travels 0–180/);
    expect(() => arm.formatAngle('X', -1)).toThrow(/travels 0–180/);
    expect(() => arm.formatAngle('E', 44)).toThrow(/travels 45–100/);
    expect(arm.formatAngle('E', 100)).toBe('100.0');
  });

  it('rejects unknown axes and non-numbers', () => {
    expect(() => arm.axisName('T')).toThrow(/Unknown axis/);
    expect(() => arm.formatAngle('X', Number.NaN)).toThrow(/finite angle/);
  });

  it('accepts axis letters case-insensitively, as the firmware does', () => {
    expect(arm.axisName('x')).toBe('X');
    expect(arm.axisName('b')).toBe('B');
  });
});

describe('buildArmPlan', () => {
  const move = (jointId: string, angleDeg: number): RobotCommand => ({
    type: 'set-joint-angle',
    jointId,
    angleDeg,
    sourceBlockId: `block-${jointId}-${angleDeg}`,
  });

  it('opens by driving every mapped joint to the challenge start pose', () => {
    const plan = buildArmPlan(challenge, []);
    const mapped = challenge.robotConfig.joints.filter((joint) => joint.servo);
    expect(plan.steps).toHaveLength(mapped.length);
    for (const joint of mapped) {
      expect(plan.steps).toContainEqual(
        expect.objectContaining({
          type: 'move',
          axis: joint.servo?.axis,
          value: joint.initialAngleDeg,
        }),
      );
    }
    // Only the last of the prologue holds; the rest are issued back to back.
    expect(plan.steps.at(-1)?.durationMs).toBeGreaterThan(0);
  });

  it('derives each move duration from the joint speed', () => {
    const joint = challenge.robotConfig.joints.find((entry) => entry.id === 'baseYaw');
    if (!joint?.servo) {
      throw new Error('baseYaw should be servo-mapped.');
    }
    const target = joint.initialAngleDeg + 30;
    const plan = buildArmPlan(challenge, [move('baseYaw', target)]);
    const last = plan.steps.at(-1);
    expect(last).toMatchObject({ type: 'move', axis: joint.servo.axis, value: target });
    expect(last?.durationMs).toBe(Math.round((30 / joint.speedDegPerSec) * 1000));
  });

  it('reports joints with no servo instead of silently dropping them', () => {
    const plan = buildArmPlan(challenge, [move('shoulderRoll', 10)]);
    expect(plan.unsupported).toEqual([
      { jointId: 'shoulderRoll', name: expect.any(String) },
    ]);
    expect(plan.steps.every((step) => step.type !== 'move' || step.value !== 10)).toBe(true);
  });

  it('passes waits through unchanged', () => {
    const plan = buildArmPlan(challenge, [
      { type: 'wait', durationMs: 250, sourceBlockId: 'w1' },
    ]);
    expect(plan.steps.at(-1)).toEqual({ type: 'wait', durationMs: 250 });
  });
});
