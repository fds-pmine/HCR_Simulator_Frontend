import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/reachability.json';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { LESSONS } from '../../src/data/challenges/lessons';
import { buildLessonChallenge } from '../../src/services/local/lessonChallenges';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import {
  askedVoxels,
  reachabilitySignature,
  unreachableAsked,
} from '../../src/features/robot/reachability';
import type { Challenge, JointConfig, VoxelKey } from '../../src/types/domain';

interface Entry {
  name: string;
  signature: string;
  hairVoxels: number;
  reachable: VoxelKey[];
}

const CACHE = (fixture as { challenges: Record<string, Entry> }).challenges;

const authored = (): Challenge[] => [
  normalizeChallenge(defaultChallengeDefinition),
  ...LESSONS.map((lesson) => normalizeChallenge(buildLessonChallenge(lesson))),
];

/**
 * No authored target may ask for hair the arm cannot reach.
 *
 * Generated items get this constructively — their targets are defined as what a
 * replayed reference solution leaves standing, so a solution exists by
 * definition. Authored ones have no reference to derive from, so they are
 * audited against a measured sweep of the collision-free joint space instead.
 *
 * The sweep costs minutes, so it is cached by `npm run reachability`. Each entry
 * carries a signature over the geometry, lattice and hair it was measured from,
 * and a mismatch fails rather than trusting the cache — a stale reachable set
 * would clear an arm that can no longer reach any of it.
 *
 * This proves a target *possible*, not *solvable*: touching every asked voxel in
 * some pose is not the same as one program touching them all. It is the cheap
 * half of the guarantee, and it is the half that would have caught the three
 * unwinnable generated items that shipped.
 */
describe('authored targets ask only for hair the arm can reach', () => {
  it('covers every authored challenge', () => {
    const ids = authored().map((challenge) => challenge.id);
    expect(Object.keys(CACHE).sort()).toEqual([...ids].sort());
  });

  it.each(authored().map((challenge) => [challenge.id, challenge] as const))(
    '%s',
    (id, challenge) => {
      const entry = CACHE[id];
      expect(entry, `no reachability fixture for "${id}"`).toBeDefined();
      expect(
        entry.signature,
        `"${id}" changed since the sweep — run \`npm run reachability\``,
      ).toBe(reachabilitySignature(challenge));

      const unreachable = unreachableAsked(challenge, new Set(entry.reachable));

      expect(askedVoxels(challenge).size, `"${id}" asks for nothing`)
        .toBeGreaterThan(0);
      expect(
        unreachable,
        `"${id}" asks for ${unreachable.length} voxel(s) the arm cannot touch`,
      ).toEqual([]);
    },
  );

  /**
   * The audit has to be able to fail.
   *
   * Every challenge in the repository passes, which is exactly the condition
   * under which a broken check looks identical to a working one. This plants a
   * target that asks for hair from the dead zone and requires the same function
   * the audit uses to catch it.
   */
  it('rejects a target that asks for hair in the dead zone', () => {
    const challenge = normalizeChallenge(defaultChallengeDefinition);
    const reachable = new Set(CACHE[challenge.id].reachable);
    const dead = [...challenge.initialHair.voxels].find(
      (key) => !reachable.has(key),
    );
    expect(dead, 'the shipped head has a dead zone to plant in').toBeDefined();

    const target = new Set(challenge.initialHair.voxels);
    target.delete(dead!);
    const planted: Challenge = {
      ...challenge,
      targetHair: { ...challenge.targetHair, voxels: target },
    };

    expect(unreachableAsked(planted, reachable)).toEqual([dead]);
  });

  /**
   * The signature has to move when the sweep would, and stay put when it would
   * not. Both halves are load-bearing: the first is what stops a stale cache
   * clearing an arm that can no longer reach any of it, and the second is what
   * lets the eight lessons share one measurement.
   */
  describe('the cache signature', () => {
    const base = normalizeChallenge(defaultChallengeDefinition);
    const withJoints = (map: (joint: JointConfig) => JointConfig): Challenge => ({
      ...base,
      robotConfig: {
        ...base.robotConfig,
        joints: base.robotConfig.joints.map(map),
      },
    });

    it('moves when a joint limit changes', () => {
      const narrower = withJoints((joint) =>
        joint.id === 'baseYaw'
          ? { ...joint, maxAngleDeg: joint.maxAngleDeg - 10 }
          : joint,
      );
      expect(reachabilitySignature(narrower)).not.toBe(
        reachabilitySignature(base),
      );
    });

    it('moves when a servo calibration changes', () => {
      const recalibrated = withJoints((joint) =>
        joint.servo
          ? {
              ...joint,
              servo: { ...joint.servo, offsetDeg: joint.servo.offsetDeg + 1 },
            }
          : joint,
      );
      expect(reachabilitySignature(recalibrated)).not.toBe(
        reachabilitySignature(base),
      );
    });

    it('moves when the tool or hair changes', () => {
      const thinner: Challenge = {
        ...base,
        robotConfig: {
          ...base.robotConfig,
          geometry: {
            ...base.robotConfig.geometry,
            toolRadius: base.robotConfig.geometry.toolRadius / 2,
          },
        },
      };
      expect(reachabilitySignature(thinner)).not.toBe(
        reachabilitySignature(base),
      );

      const shaved = new Set(base.initialHair.voxels);
      shaved.delete([...shaved][0]);
      expect(
        reachabilitySignature({
          ...base,
          initialHair: { ...base.initialHair, voxels: shaved },
        }),
      ).not.toBe(reachabilitySignature(base));
    });

    it('ignores the opening pose', () => {
      // The sweep enumerates each joint's whole range, so where a program
      // starts cannot change which poses exist.
      const posed = withJoints((joint) => ({
        ...joint,
        initialAngleDeg: joint.minAngleDeg,
      }));
      expect(reachabilitySignature(posed)).toBe(reachabilitySignature(base));
    });
  });

  it('leaves a dead zone worth knowing about', () => {
    // Not a target check but a standing measurement: on the shipped head 91 of
    // 241 voxels are unreachable. If that ever drops to zero the sweep has
    // stopped measuring anything and every audit above is vacuous.
    const entry = CACHE[defaultChallengeDefinition.id];
    expect(entry.reachable.length).toBeLessThan(entry.hairVoxels);
    expect(entry.reachable.length).toBeGreaterThan(0);
  });
});
