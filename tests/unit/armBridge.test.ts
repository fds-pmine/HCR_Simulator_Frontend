import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARM_HOME_SETTLE_MS,
  buildArmPlan,
} from '../../src/features/robot/armBridge';
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
import * as sequencer from '../../electron/sequencer.cjs';
import { MAX_RUNTIME_COMMANDS } from '../../src/features/blockly/programCompiler';

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

  it('initializes every firmware servo at 90° with no hidden staging moves', () => {
    const plan = buildArmPlan(challenge, []);
    const mapped = challenge.robotConfig.joints.filter((joint) => joint.servo);
    expect(mapped.map((joint) => joint.initialAngleDeg)).toEqual(
      mapped.map(() => 90),
    );
    expect(plan.steps[0]).toEqual({
      type: 'home',
      durationMs: ARM_HOME_SETTLE_MS,
    });
    expect(plan.steps).toHaveLength(1);
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

  it('produces a Home step accepted by the Electron main-process sequencer', () => {
    expect(sequencer.validatePlan([
      { type: 'home', durationMs: ARM_HOME_SETTLE_MS },
    ])).toEqual([
      { type: 'home', durationMs: ARM_HOME_SETTLE_MS },
    ]);
  });

  it('refuses an Electron plan that bypasses the 90° hardware Home', () => {
    expect(() => sequencer.validatePlan([
      { type: 'move', axis: 'X', value: 90, durationMs: 0 },
    ])).toThrow(/must begin with firmware Home/);
  });

});

/**
 * The two places a simulator-legal program could still be refused by hardware.
 *
 * Both failures land in the worst possible place: `sequencer.validatePlan` runs
 * before anything is sent, so the run is refused whole — but the *prologue* has
 * already driven the arm to the start pose by then on a previous run, and the
 * learner is told their program is broken when nothing about it is.
 */
describe('every simulator-legal program is also arm-legal', () => {
  const move = (jointId: string, angleDeg: number): RobotCommand => ({
    type: 'set-joint-angle',
    jointId,
    angleDeg,
    sourceBlockId: `block-${jointId}-${angleDeg}`,
  });

  it('keeps each joint inside the servo travel the arm actually has', () => {
    for (const joint of challenge.robotConfig.joints) {
      if (!joint.servo) continue;
      const limits = arm.AXES[joint.servo.axis];
      expect(limits, `axis ${joint.servo.axis} is missing from AXES`).toBeDefined();

      // Angles on the wire are servo degrees, so these compare directly. The
      // limits are transcribed from the vendor firmware's own `Min`/`Max`
      // arrays (`ESP8266.ino`), which is the third copy of that table — the
      // firmware, the backend's `servo_travel.rs`, and `arm.cjs`. Nothing makes
      // them agree; this is what notices when they stop.
      expect(joint.minAngleDeg).toBeGreaterThanOrEqual(limits.min);
      expect(joint.maxAngleDeg).toBeLessThanOrEqual(limits.max);
      expect(() => arm.formatAngle(joint.servo!.axis, joint.minAngleDeg)).not.toThrow();
      expect(() => arm.formatAngle(joint.servo!.axis, joint.maxAngleDeg)).not.toThrow();
    }
  });

  it('fits the longest possible program inside the sequencer step budget', () => {
    // The prologue is exactly one firmware Home, followed by compiled commands.
    const worstCase = 1 + MAX_RUNTIME_COMMANDS;

    expect(worstCase).toBeLessThanOrEqual(sequencer.MAX_STEPS);

    // Stated rather than implied: the margin is eleven steps. Raising
    // MAX_RUNTIME_COMMANDS eats into it, and
    // the symptom would be a maximal program refused as "the arm accepts at
    // most 512 steps" with nothing pointing at why.
    expect(sequencer.MAX_STEPS - worstCase).toBe(11);
  });

  it('builds a plan the sequencer accepts, for a program at the joint limits', () => {
    const commands: RobotCommand[] = challenge.robotConfig.joints
      .filter((joint) => joint.servo)
      .flatMap((joint) => [
        move(joint.id, joint.minAngleDeg),
        move(joint.id, joint.maxAngleDeg),
      ]);

    const plan = buildArmPlan(challenge, commands);
    expect(plan.unsupported).toHaveLength(0);
    // Every emitted value survives the main-process range check.
    for (const step of plan.steps) {
      if (step.type === 'move') {
        expect(() => arm.formatAngle(step.axis, step.value)).not.toThrow();
      }
    }
  });
});
