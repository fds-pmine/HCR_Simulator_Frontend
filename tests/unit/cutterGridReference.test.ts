import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  findCutterGridReferenceProgram,
  logicalReferenceEnd,
} from '../../src/features/cutter-grid/referenceProgram';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid geometric reference program', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('deterministically cuts exactly the current twelve target voxels', () => {
    const origin = [0, -5, 8] as const;
    const first = findCutterGridReferenceProgram(challenge, origin);
    const second = findCutterGridReferenceProgram(challenge, origin);

    expect(first).toBeDefined();
    expect(first).toEqual(second);
    expect(first?.expectedCutVoxels).toHaveLength(12);
    expect(
      first?.program.nodes.every(
        (node) => node.type !== 'move' || node.distance <= 12,
      ),
    ).toBe(true);
    expect(first?.directions.length).toBeLessThanOrEqual(500);
    expect(logicalReferenceEnd(origin, first?.directions ?? [])).toBeDefined();
  }, 15_000);
});
