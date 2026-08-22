import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CutterGridPlannerClient,
  type CutterGridPlannerWorkerLike,
} from '../../src/features/cutter-grid/plannerClient';
import {
  cutterGridAvailableForChallenge,
  registeredCutterGridProfile,
  registeredCutterGridProfileV2,
  registeredCutterGridProfileV3,
} from '../../src/features/cutter-grid/profileRegistry';
import { CutterGridMotionV3Error } from '../../src/features/cutter-grid/motionV3';
import { CutterGridPlanningError } from '../../src/features/cutter-grid/trajectory';
import type {
  CutterGridWorkerRequest,
  CutterGridWorkerResponse,
} from '../../src/features/cutter-grid/workerProtocol';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

class FakeWorker implements CutterGridPlannerWorkerLike {
  onmessage: ((event: MessageEvent<CutterGridWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(message: CutterGridWorkerRequest) => void>();
  terminate = vi.fn();
}

describe('Cutter Grid Profile registry and Worker client', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  it('enables only a fully signed, certified Challenge', () => {
    expect(cutterGridAvailableForChallenge(challenge)).toBe(true);
    expect(registeredCutterGridProfile(challenge)?.certification.passed).toBe(true);
    expect(
      cutterGridAvailableForChallenge({
        ...challenge,
        voxelConfig: { ...challenge.voxelConfig, size: 0.17 },
      }),
    ).toBe(false);
  });

  it('terminates and rejects the previous request before starting a new one', async () => {
    const workers: FakeWorker[] = [];
    const client = new CutterGridPlannerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const profile = registeredCutterGridProfile(challenge);
    expect(profile).toBeDefined();
    if (!profile) return;
    const compiled = {
      program: profile.referenceProgram,
      runtimeActions: [],
      executedCommandCount: 0,
    };
    const first = client.plan(challenge, compiled, profile);
    const second = client.plan(challenge, compiled, profile);

    await expect(first).rejects.toMatchObject({ code: 'planning-cancelled' });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[0].postMessage.mock.calls[0][0].requestId).toBe(1);
    expect(workers[1].postMessage.mock.calls[0][0].requestId).toBe(2);

    const plan = {
      kind: 'cutter-grid-trajectory' as const,
      version: 1 as const,
      plannerVersion: profile.plannerVersion,
      challengeSignature: profile.challengeSignature,
      startCoord: [0, 0, 0] as const,
      endCoord: [0, 0, 0] as const,
      steps: [],
      expectedResultVoxels: [],
      estimatedDurationMs: 0,
      executedCommandCount: 0,
      trajectorySignature: 'test',
    };
    workers[1].onmessage?.({
      data: { type: 'planned', requestId: 2, plan },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);
    await expect(second).resolves.toEqual(plan);
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('preserves structured planning errors from the Worker', async () => {
    const worker = new FakeWorker();
    const client = new CutterGridPlannerClient(() => worker);
    const profile = registeredCutterGridProfile(challenge);
    if (!profile) throw new Error('Expected bundled Profile.');
    const pending = client.plan(
      challenge,
      {
        program: profile.referenceProgram,
        runtimeActions: [],
        executedCommandCount: 0,
      },
      profile,
    );
    worker.onmessage?.({
      data: {
        type: 'failed',
        requestId: 1,
        code: 'out-of-bounds',
        message: 'Outside.',
        sourceBlockId: 'move-1',
        targetCoord: [7, 0, 0],
      },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);

    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        code: 'out-of-bounds',
        details: {
          sourceBlockId: 'move-1',
          targetCoord: [7, 0, 0],
        },
      }),
    );
    await pending.catch((error: unknown) =>
      expect(error).toBeInstanceOf(CutterGridPlanningError),
    );
  });

  it('forwards V2 progress and preserves V2 failure location', async () => {
    const worker = new FakeWorker();
    const client = new CutterGridPlannerClient(() => worker);
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected bundled V2 Profile.');
    const progress = vi.fn();
    const pending = client.planV2(
      challenge,
      { program: { ...profile.referenceProgram, plannerVersion: profile.plannerVersion }, runtimeActions: [], executedCommandCount: 0 },
      profile,
      progress,
    );
    worker.onmessage?.({
      data: { type: 'progress', requestId: 1, phase: 'generating-candidates', completedLayers: 2, totalLayers: 8, seedBudget: 24 },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);
    worker.onmessage?.({
      data: { type: 'failed', requestId: 1, code: 'no-continuous-joint-path', message: 'Disconnected.', sourceBlockId: 'move-2', actionIndex: 2, layerIndex: 9, targetCoord: [1, 2, 3], stage: 'edge', seedBudget: 96 },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);

    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'generating-candidates', seedBudget: 24 }));
    await expect(pending).rejects.toMatchObject({
      code: 'no-continuous-joint-path',
      details: { sourceBlockId: 'move-2', actionIndex: 2, layerIndex: 9, targetCoord: [1, 2, 3], stage: 'edge', seedBudget: 96 },
    });
  });

  it('sends the signed V3 profile and preserves V3 retiming failures', async () => {
    const worker = new FakeWorker();
    const client = new CutterGridPlannerClient(() => worker);
    const profile = registeredCutterGridProfileV3(challenge);
    if (!profile) throw new Error('Expected bundled V3 Profile.');
    const progress = vi.fn();
    const pending = client.planV3(
      challenge,
      {
        // The command IR remains V2 while V3 changes only the frozen motion
        // plan; the worker adapts the certified global branch before retiming.
        program: profile.referenceProgram,
        runtimeActions: [],
        executedCommandCount: 0,
      },
      profile,
      progress,
    );
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plan-v3',
      profile: expect.objectContaining({
        version: 3,
        plannerVersion: 'cutter-grid-ladder-v3',
        motionLimits: profile.motionLimits,
      }),
    }));
    worker.onmessage?.({
      data: {
        type: 'progress-v3',
        requestId: 1,
        phase: 'geometric-smoothing',
        completedItems: 3,
        totalItems: 12,
        unit: 'motion-segments',
      },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);
    expect(progress).toHaveBeenCalledWith({
      phase: 'geometric-smoothing',
      completedItems: 3,
      totalItems: 12,
      unit: 'motion-segments',
    });
    worker.onmessage?.({
      data: {
        type: 'failed',
        requestId: 1,
        code: 'jerk-smoothing-infeasible',
        message: 'Limit exceeded.',
        sourceBlockId: 'move-3',
        actionIndex: 4,
        targetCoord: [-2, 6, -3],
      },
    } as unknown as MessageEvent<CutterGridWorkerResponse>);

    await expect(pending).rejects.toBeInstanceOf(CutterGridMotionV3Error);
    await pending.catch((error: unknown) => {
      expect(error).toMatchObject({
        code: 'jerk-smoothing-infeasible',
        details: { sourceBlockId: 'move-3', actionIndex: 4, targetCoord: [-2, 6, -3] },
      });
    });
  });

  it('actively terminates a pending V3 Worker and returns a normal cancellation', async () => {
    const worker = new FakeWorker();
    const client = new CutterGridPlannerClient(() => worker);
    const profile = registeredCutterGridProfileV3(challenge);
    if (!profile) throw new Error('Expected bundled V3 Profile.');

    const pending = client.planV3(
      challenge,
      {
        program: profile.referenceProgram,
        runtimeActions: [],
        executedCommandCount: 0,
      },
      profile,
    );
    client.cancel();

    await expect(pending).rejects.toMatchObject({ code: 'planning-cancelled' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
