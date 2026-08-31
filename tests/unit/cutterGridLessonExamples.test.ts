import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { CutterGridCoord, CutterGridProfileV4 } from '../../src/features/cutter-grid/types';

const STEP: Readonly<Record<string, CutterGridCoord>> = {
  Right: [1, 0, 0], Left: [-1, 0, 0],
  Up: [0, 1, 0], Down: [0, -1, 0],
  Forward: [0, 0, -1], Backward: [0, 0, 1],
};

/** Expand `Repeat N × [body]` and drop Waits: neither changes a coordinate. */
function movesOf(example: string): string {
  return example
    .replace(/Repeat (\d+) × \[([^\]]+)\]/g, (_match, count: string, body: string) =>
      Array.from({ length: Number(count) }, () => body.trim()).join(' → '))
    .replace(/Wait \d+ ms( →)?/g, '')
    .replace(/→\s*$/, '')
    .trim();
}

/** The waypoints a learner visits when they build the lesson's example. */
function waypointsOf(example: string): CutterGridCoord[] {
  const coords: CutterGridCoord[] = [];
  let at: CutterGridCoord = [0, 0, 0];
  for (const move of example.split('→')) {
    const [direction, distance] = move.trim().split(/\s+/);
    const step = STEP[direction];
    if (!step) throw new Error(`"${example}" is not a route: ${move.trim()}`);
    const cells = Number(distance);
    expect(Number.isInteger(cells) && cells >= 1 && cells <= 12).toBe(true);
    for (let cell = 0; cell < cells; cell += 1) {
      at = [at[0] + step[0], at[1] + step[1], at[2] + step[2]];
      coords.push(at);
    }
  }
  return coords;
}

/**
 * Three sections template the example as a program the learner reads, traces
 * and then builds. An example that is prose rather than a route makes all
 * three unbuildable, and leaves English inside every translated lesson because
 * routes are deliberately not localized.
 */
describe('every Grid lesson example is a route a learner can build', () => {
  let profile: CutterGridProfileV4;

  beforeAll(async () => {
    const challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const registered = registeredCutterGridProfileV4(challenge);
    if (!registered) throw new Error('Expected the certified Cutter Grid V4 Profile.');
    profile = registered;
  }, 120_000);

  it('parses as Move blocks and never leaves the reachable grid', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      const waypoints = waypointsOf(movesOf(lesson.example));
      expect(waypoints.length).toBeGreaterThan(0);

      for (const coord of waypoints) {
        const node = profile.nodes.find(
          (entry) => entry.coord[0] === coord[0]
            && entry.coord[1] === coord[1]
            && entry.coord[2] === coord[2],
        );
        expect(
          node?.staticIkStatus,
          `${lesson.id} example visits (${coord.join(', ')})`,
        ).toBe('safe-candidate-known');
      }
    }
  });
});
