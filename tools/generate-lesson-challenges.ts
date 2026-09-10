/**
 * Emit the eight Servo Angles lesson challenges as a backend fixture.
 *
 *   npm run lessons:fixture
 *
 * The lessons live in the frontend as a seed plus a *solution*, and each
 * target is derived by running that solution through the engine — which is why
 * the data file alone cannot describe them and this tool has to exist. The
 * backend catalog needs the finished challenges, so it gets them from here and
 * `crates/hcr/tests/assets.rs` asserts the vendored copy has not drifted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { LESSONS } from '../src/data/challenges/lessons';
import { buildLessonChallenge } from '../src/services/local/lessonChallenges';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../tests/fixtures/lesson-challenges.json');

it('generates the lesson challenge fixture', () => {
  const challenges = LESSONS.map((lesson) => {
    const challenge = buildLessonChallenge(lesson);
    // Voxels are `{x, y, z}` objects, so they compare by identity unless
    // reduced to a key first. Counting them by reference silently reported
    // every voxel as removed.
    const key = (voxel: { x: number; y: number; z: number }) =>
      `${voxel.x},${voxel.y},${voxel.z}`;
    const kept = new Set(challenge.targetHair.voxels.map(key));
    const removed = challenge.initialHair.voxels.filter(
      (voxel) => !kept.has(key(voxel)),
    );
    // A lesson whose target equals its start would be unsolvable-by-doing-
    // nothing and would quietly poison an adaptive session's difficulty
    // estimate, so it is caught here rather than in a classroom.
    expect(removed.length).toBeGreaterThan(0);
    return { challenge, removedVoxelCount: removed.length };
  });

  const document = {
    generator: 'HCR_Simulator_Frontend/tools/generate-lesson-challenges.ts',
    engine: 'typescript',
    lessons: challenges.map(({ challenge, removedVoxelCount }) => ({
      removedVoxelCount,
      challenge,
    })),
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(
    `Lesson challenges: ${document.lessons.length} items, ` +
      `${document.lessons.map((l) => l.removedVoxelCount).join('/')} voxels removed\n`,
  );
  expect(document.lessons).toHaveLength(8);
});
