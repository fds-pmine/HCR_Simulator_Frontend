/**
 * Reachability fixture generator.
 *
 * Sweeps the collision-free joint space and records every hair voxel the tool
 * can touch, for each authored challenge. `tests/unit/reachability.test.ts`
 * audits authored targets against the result — a target asking for hair outside
 * this set can never be finished by any program.
 *
 * The sweep is minutes of CPU, which is why it is cached rather than run inside
 * `npm test`. Every entry carries a signature over the geometry, lattice and
 * hair it was measured from; the audit refuses a fixture whose signature has
 * moved rather than trusting a stale one.
 *
 * Run from the frontend package:
 *
 *   npm run reachability
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

import { defaultChallengeDefinition } from '../src/data/challenges/defaultChallenge';
import { LESSONS } from '../src/data/challenges/lessons';
import { buildLessonChallenge } from '../src/services/local/lessonChallenges';
import { normalizeChallenge } from '../src/services/normalizeChallenge';
import {
  computeReachableVoxels,
  reachabilitySignature,
} from '../src/features/robot/reachability';
import type { Challenge } from '../src/types/domain';

// Relative to this file, not to `process.cwd()`: the generator runs through a
// config whose root is the repository, so the working directory is not
// something it can assume.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../tests/fixtures/reachability.json');

it('records what the arm can reach for every authored challenge', () => {
  const challenges: Challenge[] = [
    normalizeChallenge(defaultChallengeDefinition),
    ...LESSONS.map((lesson) => normalizeChallenge(buildLessonChallenge(lesson))),
  ];

  // Keyed by signature: the lessons share the shipped head and arm and differ
  // only in opening pose, which the sweep does not depend on. Measuring per
  // challenge would run the same two-minute sweep nine times.
  const measured = new Map<string, string[]>();
  const entries: Record<string, unknown> = {};

  for (const challenge of challenges) {
    const signature = reachabilitySignature(challenge);
    let reachable = measured.get(signature);
    if (reachable) {
      process.stdout.write(`${challenge.id}: reused sweep ${signature}\n`);
    } else {
      const started = Date.now();
      reachable = [...computeReachableVoxels(challenge)].sort();
      measured.set(signature, reachable);
      process.stdout.write(
        `${challenge.id}: ${reachable.length}/${challenge.initialHair.voxels.size} ` +
          `reachable in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
      );
    }
    entries[challenge.id] = {
      name: challenge.name,
      signature,
      hairVoxels: challenge.initialHair.voxels.size,
      reachable,
    };
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ challenges: entries }, null, 2)}\n`);
  process.stdout.write(`wrote ${OUT}\n`);
}, 1_800_000);
