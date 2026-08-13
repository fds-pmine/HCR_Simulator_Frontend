import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { CUTTER_GRID_LADDER_PLANNER_VERSION } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid V2 global IK ladder', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
  });

  it('finds a deterministic collision-free global branch for Up 6, Left 2, Forward 3', () => {
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    const compiled = {
      program: {
        ...CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
        plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
      },
      runtimeActions: regressionProgramRuntimeActions(),
      executedCommandCount: 11,
    };
    const first = planCutterGridLadderTrajectory(challenge, compiled, profile);
    const second = planCutterGridLadderTrajectory(challenge, compiled, profile);

    expect(first.trajectorySignature).toBe(second.trajectorySignature);
    expect(first.endCoord).toEqual(CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD);
    expect([...challenge.initialHair.voxels].filter((key) => !first.expectedResultVoxels.includes(key)).sort()).toEqual(
      [...CUTTER_GRID_GLOBAL_IK_REGRESSION_CUT_VOXELS].sort(),
    );
    expect(first.diagnostics.seedBudgetUsed).toBeGreaterThanOrEqual(24);
    expect(first.diagnostics.minimumHeadClearance).toBeGreaterThan(0);
    expect(first.steps.at(-1)?.waypoints.at(-1)?.jointAngles.wrist).toBeLessThan(100);
  }, 240_000);
});
