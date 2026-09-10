/**
 * Certify a Cutter Grid profile for each Servo Angles lesson.
 *
 *   npm run lessons:profiles
 *
 * A challenge may only be offered in Cutter Grid if a profile proves the
 * lattice is reachable, that entry cuts nothing, and that a reference route
 * removes *exactly* the target (SPEC v0.3 §15.5). The eight lessons share
 * their geometry, robot config and starting hair with the shipped challenge and
 * differ only in target, so each one needs its own certificate and gets it
 * here.
 *
 * V4 is what ships. The V2 it is derived from is ~1.2 MB of entry options; the
 * V4 upgrade compresses those to a few kilobytes, so the bundled artefact is
 * around 170 KB rather than 1.2 MB, and the node map is left out because
 * nothing on the V4 execution path reads it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { LESSONS } from '../src/data/challenges/lessons';
import { buildLessonChallenge } from '../src/services/local/lessonChallenges';
import { generateCutterGridProfileV2 } from '../src/features/cutter-grid/profileV2';
import { upgradeCutterGridProfileV2ToV4 } from '../src/features/cutter-grid/profileV4';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../src/data/cutter-grid-profiles');

it.each(LESSONS.map((lesson, index) => [index + 1, lesson] as const))(
  'certifies Cutter Grid for lesson %i',
  (index, lesson) => {
    const challenge = normalizeChallenge(buildLessonChallenge(lesson));
    const v2 = generateCutterGridProfileV2(challenge, [0, -5, 8], {
      includeNodeMap: false,
    });
    expect(v2.certification.passed).toBe(true);

    const v4 = upgradeCutterGridProfileV2ToV4(challenge, v2);
    expect(v4.certification.passed).toBe(true);

    // The certificate is only worth anything if the reference route removes
    // exactly the target and nothing else.
    const wanted = [...challenge.initialHair.voxels]
      .filter((key) => !challenge.targetHair.voxels.has(key))
      .sort();
    expect([...v4.certification.referenceCutVoxels].sort()).toEqual(wanted);
    expect(v4.certification.referenceExtraCutVoxels).toHaveLength(0);

    mkdirSync(outDir, { recursive: true });
    const file = resolve(outDir, `${lesson.id}.json`);
    const json = `${JSON.stringify(v4, null, 2)}\n`;
    writeFileSync(file, json);
    process.stdout.write(
      `${lesson.id}: ${wanted.length} cut voxels, ` +
        `${v4.entryOptions.length} entries, ${Math.round(json.length / 1024)} KB\n`,
    );
  },
);
