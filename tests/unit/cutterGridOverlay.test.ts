import { describe, expect, it } from 'vitest';
import { plannedMovePaths } from '../../src/features/cutter-grid/overlayPaths';
import { createCutterGridSyncPtpPrimitiveV4 } from '../../src/features/cutter-grid/compactPtpV4';
import type { CutterTrajectoryPlanV4 } from '../../src/features/cutter-grid/types';
import { createInitialJointAngles } from '../../src/features/robot/kinematics';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';

describe('Cutter Grid overlay sampling', () => {
  it('caps display samples while keeping both endpoints of a long primitive', async () => {
    const challenge = await new LocalChallengeProvider().getChallenge('neat-short-cap');
    const start = createInitialJointAngles(challenge.robotConfig);
    const end = { ...start, baseYaw: start.baseYaw + 1 };
    const primitive = createCutterGridSyncPtpPrimitiveV4(challenge, start, end, 40_000);
    const plan = {
      version: 4,
      actions: [{ type: 'move', occurrenceId: 'move:0', primitives: [primitive] }],
    } as unknown as CutterTrajectoryPlanV4;

    const paths = plannedMovePaths(challenge, plan);
    expect(paths).toHaveLength(1);
    expect(paths[0].points.length).toBeLessThanOrEqual(257);
    expect(paths[0].points[0]).not.toEqual(paths[0].points.at(-1));
  });
});
