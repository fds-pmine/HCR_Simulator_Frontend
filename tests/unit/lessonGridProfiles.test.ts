import { describe, expect, it } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { buildLessonChallenge } from '../../src/services/local/lessonChallenges';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import {
  cutterGridAvailableForChallenge,
  registeredCutterGridProfileV4,
} from '../../src/features/cutter-grid/profileRegistry';

/**
 * Cutter Grid in Solo Practice rests entirely on these profiles being found.
 *
 * They are located by a glob, so nothing fails to compile if the glob stops
 * matching — the map simply comes up empty and every lesson silently falls back
 * to Servo. That has already happened once. These tests are the alarm.
 */
describe('lesson Cutter Grid profiles', () => {
  const challenges = LESSONS.map((lesson) => ({
    lesson,
    challenge: normalizeChallenge(buildLessonChallenge(lesson)),
  }));

  it.each(challenges.map(({ lesson }) => lesson.id))(
    'offers Cutter Grid on %s',
    (id) => {
      const entry = challenges.find(({ lesson }) => lesson.id === id);
      expect(entry).toBeDefined();
      expect(cutterGridAvailableForChallenge(entry!.challenge)).toBe(true);
    },
  );

  it('certifies every lesson profile it serves', { timeout: 60_000 }, () => {
    for (const { lesson, challenge } of challenges) {
      const profile = registeredCutterGridProfileV4(challenge);
      expect(profile, `${lesson.id} has no profile`).toBeDefined();
      expect(profile!.certification.passed, `${lesson.id} is uncertified`).toBe(
        true,
      );
      // Two entries is the format's own floor; below it the lattice cannot be
      // entered reliably.
      expect(profile!.entryOptions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('serves a profile whose reference removes exactly the target', { timeout: 60_000 }, () => {
    for (const { lesson, challenge } of challenges) {
      const profile = registeredCutterGridProfileV4(challenge)!;
      const wanted = [...challenge.initialHair.voxels]
        .filter((key) => !challenge.targetHair.voxels.has(key))
        .sort();
      expect(
        [...profile.certification.referenceCutVoxels].sort(),
        `${lesson.id} cuts the wrong voxels`,
      ).toEqual(wanted);
      expect(profile.certification.referenceExtraCutVoxels).toHaveLength(0);
    }
  });
});
