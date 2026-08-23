import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { buildCutterArmMotionProgramV1, validateCutterArmMotionProgramV1 } from '../../src/features/cutter-grid/cutterArmMotionProgramV1';
import { evaluateCutterGridSyncPtpV4 } from '../../src/features/cutter-grid/compactPtpV4';
import { planCutterGridCompactPtpV4 } from '../../src/features/cutter-grid/compactPtpPlannerV4';
import { compileCutterGridExecutableProgramV2 } from '../../src/features/cutter-grid/programCompiler';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import type { CutterTrajectoryPlanV4 } from '../../src/features/cutter-grid/types';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid compact PTP V4 execution', () => {
  let challenge: Challenge;
  let plan: CutterTrajectoryPlanV4;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const profile = registeredCutterGridProfileV4(challenge);
    if (!profile) throw new Error('Expected bundled Cutter Grid V4 Profile.');
    plan = planCutterGridCompactPtpV4(
      challenge,
      compileCutterGridExecutableProgramV2(profile.referenceProgram),
      profile,
    );
  }, 240_000);

  it('replays the same compact plan for small and long ticks', async () => {
    const small = new SimulationEngine(challenge, new LocalScoreProvider());
    const large = new SimulationEngine(challenge, new LocalScoreProvider());

    small.runCutterGrid(plan, plan.actions.length);
    for (let tick = 0; tick < 10_000 && ['positioning', 'running'].includes(small.getSnapshot().status); tick += 1) {
      small.tick(7);
    }
    large.runCutterGrid(plan, plan.actions.length);
    large.tick(1_000_000);
    large.tick(1_000_000);
    await Promise.all([small.waitForScore(), large.waitForScore()]);

    expect(small.getSnapshot().status).toBe('completed');
    expect(large.getSnapshot().status).toBe('completed');
    expect(small.getSnapshot().jointAngles).toEqual(large.getSnapshot().jointAngles);
    expect(small.getSnapshot().hairVoxels).toEqual(large.getSnapshot().hairVoxels);
    expect([...small.getSnapshot().hairVoxels].sort()).toEqual(plan.expectedResultVoxels);
    expect(small.getSnapshot().metrics).toEqual(large.getSnapshot().metrics);
    expect(small.getSnapshot().metrics.executedCommandCount).toBe(plan.executedCommandCount);
    expect(small.getSnapshot().scoreResult?.completionScore).toBe(100);
  }, 120_000);

  it('uses one visible action per Step and replays the exact zero-contact entry curve', async () => {
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    const primitive = plan.positioning.primitives[0];
    if (!primitive) throw new Error('Expected a compact V4 positioning primitive.');
    const middleMs = primitive.durationMs / 2;
    const expected = evaluateCutterGridSyncPtpV4(challenge, primitive, middleMs);

    engine.runCutterGrid(plan, plan.actions.length);
    engine.tick(middleMs);
    expect(engine.getSnapshot().status).toBe('positioning');
    expect(engine.getSnapshot().jointAngles).toEqual(expected.jointAngles);
    expect(engine.getSnapshot().hairVoxels).toEqual(new Set(challenge.initialHair.voxels));

    engine.reset();
    engine.stepCutterGrid(plan, plan.actions.length);
    engine.tick(1_000_000);
    engine.tick(1_000_000);
    expect(engine.getSnapshot().status).toBe('paused');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(plan.actions[0].logicalCommandCount);

    while (engine.getSnapshot().status === 'paused') {
      engine.stepCutterGrid();
      engine.tick(1_000_000);
    }
    await engine.waitForScore();
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(plan.executedCommandCount);
  }, 120_000);

  it('serializes and validates the future hardware contract without exposing transport', () => {
    const program = buildCutterArmMotionProgramV1(challenge, plan);

    expect(() => validateCutterArmMotionProgramV1(challenge, program)).not.toThrow();
    expect(program.instructions.filter((instruction) => instruction.kind === 'sync-ptp')).toHaveLength(
      plan.positioning.primitives.length +
        plan.actions
          .filter((action) => action.type === 'move')
          .reduce((sum, action) => sum + action.primitives.length, 0),
    );
    expect(JSON.stringify(program)).not.toContain('contactEvents');
    expect(() => validateCutterArmMotionProgramV1(challenge, {
      ...program,
      programSignature: 'corrupted',
    })).toThrow('signature mismatch');
  });
});
