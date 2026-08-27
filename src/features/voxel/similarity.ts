import type { VoxelKey } from '../../types/domain';

/**
 * How well a run performed the cut the challenge asked for.
 *
 * Jaccard overlap between the hair the learner **removed** and the hair the
 * target says to remove:
 *
 *   asked   = initial \ target
 *   removed = initial \ result
 *   score   = |removed ∩ asked| / |removed ∪ asked|
 *
 * # Why not compare the hair left standing
 *
 * That is what this used to do, and its floor was not zero. Most of a hairstyle
 * is never meant to be touched, so an empty program already matched nearly all
 * of it: an earlier challenge target kept 229 of 241 voxels, and doing nothing
 * scored **95.02**. The whole distance between "did nothing" and
 * "perfect" was five points sitting on a 95-point floor that measured the
 * hairstyle rather than the learner.
 *
 * Everything downstream inherited it. The ability seed mapped the entire
 * achievable range to θ ∈ [2.949, 3.000] and pinned every learner at the top of
 * the bank, and someone who genuinely improved saw the number barely move.
 *
 * Scoring the cut fixes it at the source:
 *
 * | Run | Old | New |
 * | --- | --- | --- |
 * | Empty program | 95.02 | 0 |
 * | Half the asked hair | 97.5 | 50 |
 * | Exactly the asked hair | 100 | 100 |
 * | Asked hair plus as much again | ~97.5 | 50 |
 *
 * Over-cutting is charged to the union rather than nearly ignored, which the old
 * metric also got wrong: hair removed that should have stayed cost only the few
 * voxels it touched.
 */
export function calculateTrimScore(
  initial: ReadonlySet<VoxelKey>,
  target: ReadonlySet<VoxelKey>,
  result: ReadonlySet<VoxelKey>,
): number {
  let intersection = 0;
  let union = 0;

  for (const key of initial) {
    const asked = !target.has(key);
    const removed = !result.has(key);
    if (asked || removed) {
      union += 1;
      if (asked && removed) {
        intersection += 1;
      }
    }
  }

  // Hair conjured from nothing is not something the engine can produce, but a
  // score is the wrong place to discover that: count it against the run.
  for (const key of result) {
    if (!initial.has(key)) {
      union += 1;
    }
  }

  // A challenge that asks for nothing is satisfied by doing nothing.
  return union === 0 ? 100 : (intersection / union) * 100;
}
