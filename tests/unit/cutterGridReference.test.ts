import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  findCutterGridReferenceProgram,
  logicalReferenceEnd,
} from '../../src/features/cutter-grid/referenceProgram';
import { moveCutterGridCoord } from '../../src/features/cutter-grid/grid';
import type {
  CutterGridCoord,
  CutterGridDirection,
} from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid geometric reference program', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('deterministically cuts exactly the current eleven target voxels', () => {
    const origin = [0, -5, 8] as const;
    const first = findCutterGridReferenceProgram(challenge, origin);
    const second = findCutterGridReferenceProgram(challenge, origin);

    expect(first).toBeDefined();
    expect(first).toEqual(second);
    expect(first?.expectedCutVoxels).toHaveLength(11);
    expect(
      first?.program.nodes.every(
        (node) => node.type !== 'move' || node.distance <= 12,
      ),
    ).toBe(true);
    expect(first?.directions.length).toBeLessThanOrEqual(500);
    expect(logicalReferenceEnd(origin, first?.directions ?? [])).toBeDefined();
  }, 15_000);

  // Geometry alone will happily route the cutter through cells no arm pose
  // reaches; the Profile generators supply the kinematic filter.
  it('never routes through a cell its reachability check refuses', () => {
    const origin = [0, -5, 8] as const;
    const unfiltered = findCutterGridReferenceProgram(challenge, origin);
    const refused = unfiltered?.directions.length
      ? walkHairCoords(origin, unfiltered.directions).at(-1)
      : undefined;
    expect(refused).toBeDefined();
    if (!refused) return;

    const filtered = findCutterGridReferenceProgram(challenge, origin, {
      isReachable: (coord) => coord.join(',') !== refused.join(','),
    });

    expect(filtered).toBeDefined();
    expect(
      walkHairCoords(origin, filtered?.directions ?? [])
        .some((coord) => coord.join(',') === refused.join(',')),
    ).toBe(false);
  }, 15_000);
});

function walkHairCoords(
  origin: readonly [number, number, number],
  directions: readonly CutterGridDirection[],
): CutterGridCoord[] {
  let coord = [...origin] as unknown as CutterGridCoord;
  const visited: CutterGridCoord[] = [coord];
  for (const direction of directions) {
    coord = moveCutterGridCoord(coord, direction);
    visited.push(coord);
  }
  return visited;
}
