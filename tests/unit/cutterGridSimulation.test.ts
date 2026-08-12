import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { expandCutterGridProgram } from '../../src/features/cutter-grid/programCompiler';
import { registeredCutterGridProfile } from '../../src/features/cutter-grid/profileRegistry';
import {
  planCutterGridTrajectory,
  serializeCutterTrajectoryPlan,
} from '../../src/features/cutter-grid/trajectory';
import type { CutterTrajectoryPlanV1 } from '../../src/features/cutter-grid/types';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import type { Challenge } from '../../src/types/domain';
import type { ScoreProvider } from '../../src/services/contracts';

describe('Cutter Grid frozen trajectory simulation', () => {
  let challenge: Challenge;
  let plan: CutterTrajectoryPlanV1;
  let sourceBlockCount: number;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Cutter Grid Profile.');
    const runtimeActions = expandCutterGridProgram(profile.referenceProgram);
    sourceBlockCount = profile.referenceProgram.sourceBlockCount;
    plan = serializeCutterTrajectoryPlan(
      challenge,
      profile.originHairCoord,
      planCutterGridTrajectory(challenge,
      {
        program: profile.referenceProgram,
        runtimeActions,
        executedCommandCount: runtimeActions.length,
      },
      {
        challengeSignature: profile.challengeSignature,
        originHairCoord: profile.originHairCoord,
        bounds: profile.bounds,
        startJointAngles: profile.entryJointAngles,
      },
      ),
    );
  }, 120_000);

  it('replays the same final pose, cuts and metrics for small and large ticks', async () => {
    const small = createPositionedEngine();
    const large = createPositionedEngine();
    small.runCutterGrid(plan, sourceBlockCount);
    while (small.getSnapshot().status === 'running') small.tick(7);
    large.runCutterGrid(plan, sourceBlockCount);
    large.tick(1_000_000);
    await Promise.all([small.waitForScore(), large.waitForScore()]);

    expect(small.getSnapshot().status).toBe('completed');
    expect(large.getSnapshot().status).toBe('completed');
    expect(small.getSnapshot().jointAngles).toEqual(large.getSnapshot().jointAngles);
    expect(small.getSnapshot().hairVoxels).toEqual(large.getSnapshot().hairVoxels);
    expect([...small.getSnapshot().hairVoxels].sort()).toEqual(
      plan.expectedResultVoxels,
    );
    expect(small.getSnapshot().metrics).toEqual(large.getSnapshot().metrics);
    expect(small.getSnapshot().metrics.executedCommandCount).toBe(plan.steps.length);
    expect(small.getSnapshot().scoreResult?.completionScore).toBe(100);
  });

  it('executes exactly one grid cell or Wait per Step', async () => {
    const engine = createPositionedEngine();
    engine.stepCutterGrid(plan, sourceBlockCount);
    engine.tick(1_000_000);
    expect(engine.getSnapshot().status).toBe('paused');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(1);

    while (engine.getSnapshot().status === 'paused') {
      engine.stepCutterGrid();
      engine.tick(1_000_000);
    }
    await engine.waitForScore();
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(plan.steps.length);
  });

  it('counts Wait as one timed action without cutting hair', async () => {
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const engine = createPositionedEngine();
    const endEffector = engine.getSnapshot().endEffector;
    const zeroVelocity = Object.fromEntries(
      challenge.robotConfig.joints.map((joint) => [joint.id, 0]),
    );
    const waitPlan: CutterTrajectoryPlanV1 = {
      kind: 'cutter-grid-trajectory',
      version: 1,
      plannerVersion: profile.plannerVersion,
      challengeSignature: profile.challengeSignature,
      startCoord: [0, 0, 0],
      endCoord: [0, 0, 0],
      steps: [
        {
          index: 0,
          kind: 'wait',
          sourceBlockId: 'wait-only',
          startCoord: [0, 0, 0],
          endCoord: [0, 0, 0],
          durationMs: 400,
          waypoints: [
            {
              timeMs: 0,
              jointAngles: profile.entryJointAngles,
              jointVelocitiesDegPerSec: zeroVelocity,
              endEffector,
            },
            {
              timeMs: 400,
              jointAngles: profile.entryJointAngles,
              jointVelocitiesDegPerSec: zeroVelocity,
              endEffector,
            },
          ],
          expectedCutVoxels: [],
        },
      ],
      expectedResultVoxels: [...challenge.initialHair.voxels].sort(),
      estimatedDurationMs: 400,
      executedCommandCount: 1,
      trajectorySignature: 'wait-only-test',
    };
    const initialHair = engine.getSnapshot().hairVoxels;

    engine.runCutterGrid(waitPlan, 1);
    engine.tick(400);
    await engine.waitForScore();

    expect(engine.getSnapshot().hairVoxels).toEqual(initialHair);
    expect(engine.getSnapshot().metrics).toEqual({
      sourceBlockCount: 1,
      executedCommandCount: 1,
      estimatedDurationMs: 400,
    });
  });

  it('does not cut or score during certified positioning and exposes planning state', () => {
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    const initialHair = engine.getSnapshot().hairVoxels;

    engine.positionCutterGrid(profile);
    expect(engine.getSnapshot().status).toBe('positioning');
    engine.tick(1_000_000);
    expect(engine.getSnapshot().status).toBe('idle');
    expect(engine.getSnapshot().hairVoxels).toEqual(initialHair);
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(0);
    expect(engine.getSnapshot().scoreResult).toBeUndefined();

    engine.beginPlanning();
    expect(engine.getSnapshot().status).toBe('planning');
    engine.cancelPlanning();
    expect(engine.getSnapshot().status).toBe('idle');
  });

  it('fails closed if a corrupted entry trajectory violates runtime safety', () => {
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.positionCutterGrid({
      ...profile,
      entryTrajectory: [
        profile.entryTrajectory[0],
        {
          timeMs: 1,
          jointAngles: {
            baseYaw: -24,
            shoulderRoll: 0,
            shoulder: 50,
            elbow: -15,
            wrist: -30,
          },
          jointVelocitiesDegPerSec: {
            baseYaw: 0,
            shoulderRoll: 0,
            shoulder: 0,
            elbow: 0,
            wrist: 0,
          },
          endEffector: [0, 0, 0],
        },
      ],
    });

    expect(() => engine.tick(10)).not.toThrow();
    expect(engine.getSnapshot().status).toBe('error');
    expect(engine.getSnapshot().scoreResult).toBeUndefined();
    expect(engine.getSnapshot().metrics.executedCommandCount).toBe(0);
  });

  it('scores Cutter Grid locally without calling the configured provider', async () => {
    let providerCalls = 0;
    const remoteLikeProvider: ScoreProvider = {
      score: async () => {
        providerCalls += 1;
        throw new Error('Cutter Grid must not reach the configured provider.');
      },
    };
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const engine = new SimulationEngine(challenge, remoteLikeProvider);
    engine.positionCutterGrid(profile);
    engine.tick(1_000_000);
    engine.runCutterGrid(plan, sourceBlockCount);
    engine.tick(1_000_000);
    const score = await engine.waitForScore();

    expect(providerCalls).toBe(0);
    expect(score?.completionScore).toBe(100);
    expect(engine.getSnapshot().cutterGrid).toMatchObject({
      currentCoord: plan.endCoord,
      stepIndex: plan.steps.length,
      totalSteps: plan.steps.length,
      trajectorySignature: plan.trajectorySignature,
    });
  });

  function createPositionedEngine(): SimulationEngine {
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.positionCutterGrid(profile);
    engine.tick(1_000_000);
    return engine;
  }
});
