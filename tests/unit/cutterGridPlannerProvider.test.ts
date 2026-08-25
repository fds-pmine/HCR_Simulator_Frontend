import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CutterGridPlannerProvider,
  cutterGridRustPlanSignatureV4,
  cutterGridRustPrimitiveSignatureV4,
} from '../../src/features/cutter-grid/plannerProvider';
import { registeredCutterGridProfileV4 } from '../../src/features/cutter-grid/profileRegistry';
import type {
  CompiledCutterGridProgramV2,
  CutterGridProfileV4,
  CutterTrajectoryPlanV4,
} from '../../src/features/cutter-grid/types';
import { CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid Rust planner provider', () => {
  let challenge: Challenge;
  let profile: CutterGridProfileV4;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const registered = registeredCutterGridProfileV4(challenge);
    if (!registered) throw new Error('Expected the certified Cutter Grid V4 Profile.');
    profile = registered;
  }, 120_000);

  it('executes a validated Rust plan without starting the Worker', async () => {
    const worker = workerReturning(planFor(profile, challenge));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseFor(profile, challenge)));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl,
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).resolves.toMatchObject({
      source: 'rust-backend',
    });
    expect(worker.planV4).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      challengeId: challenge.id,
      challengeVersion: 1,
      program: compiledFor(profile).program,
    });
  });

  it('sends the pinned challenge version instead of a provider constant', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(responseFor(profile, challenge)));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      challengeVersion: 7,
      fetchImpl,
      worker: workerReturning(planFor(profile, challenge)),
    });

    await provider.planV4(challenge, compiledFor(profile), profile);

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      challengeVersion: 7,
    });
  });

  it.each([429, 500])('falls back to the Worker for retryable HTTP %s', async (status) => {
    const fallbackPlan = planFor(profile, challenge);
    const worker = workerReturning(fallbackPlan);
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: { message: 'busy' } }, status)),
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).resolves.toEqual({
      plan: fallbackPlan,
      source: 'typescript-fallback',
    });
  });

  it('falls back only for a transport failure', async () => {
    const fallbackPlan = planFor(profile, challenge);
    const worker = workerReturning(fallbackPlan);
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).resolves.toMatchObject({
      source: 'typescript-fallback',
    });
  });

  it('falls back to the Worker after the 30 second-class request timeout', async () => {
    const fallbackPlan = planFor(profile, challenge);
    const worker = workerReturning(fallbackPlan);
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      timeoutMs: 1,
      fetchImpl: vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
      })),
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).resolves.toMatchObject({
      source: 'typescript-fallback',
    });
  });

  it('uses the Worker directly when the deployment is explicitly offline', async () => {
    const fallbackPlan = planFor(profile, challenge);
    const worker = workerReturning(fallbackPlan);
    const provider = new CutterGridPlannerProvider({ offline: true, worker });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).resolves.toMatchObject({
      source: 'typescript-fallback',
    });
    expect(worker.planV4).toHaveBeenCalledOnce();
  });

  it.each([400, 404, 422])('does not hide deterministic HTTP %s behind the Worker', async (status) => {
    const worker = workerReturning(planFor(profile, challenge));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: { message: 'invalid', field: 'move-1' } }, status)),
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).rejects.toMatchObject({
      name: 'CutterGridRemotePlanningError',
      sourceBlockId: 'move-1',
    });
    expect(worker.planV4).not.toHaveBeenCalled();
  });

  it('fails closed on a bad Rust trajectory signature', async () => {
    const malformed = responseFor(profile, challenge);
    malformed.plan.trajectorySignature = '0000000000000000';
    const worker = workerReturning(planFor(profile, challenge));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(malformed)),
      worker,
    });

    await expect(provider.planV4(challenge, compiledFor(profile), profile)).rejects.toThrow('trajectory signature');
    expect(worker.planV4).not.toHaveBeenCalled();
  });

  it('rejects a signed plan whose boundary omits a required joint', async () => {
    const malformed = responseFor(profile, challenge);
    const primitive = malformed.plan.positioning.primitives[0];
    delete (primitive.start.jointAngles as Partial<Record<string, number>>).baseYaw;
    malformed.plan.positioning.trajectorySignature =
      cutterGridRustPrimitiveSignatureV4(primitive);
    malformed.plan.trajectorySignature = cutterGridRustPlanSignatureV4(
      malformed.plan,
    );
    const worker = workerReturning(planFor(profile, challenge));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(malformed)),
      worker,
    });

    await expect(
      provider.planV4(challenge, compiledFor(profile), profile),
    ).rejects.toThrow('contains invalid values');
    expect(worker.planV4).not.toHaveBeenCalled();
  });

  it('rejects a re-signed zero-duration primitive', async () => {
    const malformed = responseFor(profile, challenge);
    const primitive = malformed.plan.positioning.primitives[0];
    primitive.durationMs = 0;
    malformed.plan.positioning.trajectorySignature =
      cutterGridRustPrimitiveSignatureV4(primitive);
    malformed.plan.trajectorySignature = cutterGridRustPlanSignatureV4(
      malformed.plan,
    );
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(malformed)),
      worker: workerReturning(planFor(profile, challenge)),
    });

    await expect(
      provider.planV4(challenge, compiledFor(profile), profile),
    ).rejects.toThrow('contains invalid values');
  });

  it('fails closed when a Rust response changes the compiled action map', async () => {
    const worker = workerReturning(planFor(profile, challenge));
    const provider = new CutterGridPlannerProvider({
      config: { baseUrl: 'http://planner.test' },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(responseFor(profile, challenge))),
      worker,
    });
    const compiled = {
      ...compiledFor(profile),
      executableActions: [{
        type: 'wait' as const,
        occurrenceId: 'wait-1:0',
        sourceBlockId: 'wait-1',
        durationMs: 100,
        logicalCommandCount: 1 as const,
      }],
      executedCommandCount: 1,
    } satisfies CompiledCutterGridProgramV2;

    await expect(provider.planV4(challenge, compiled, profile)).rejects.toThrow('does not match');
    expect(worker.planV4).not.toHaveBeenCalled();
  });
});

function compiledFor(profile: CutterGridProfileV4): CompiledCutterGridProgramV2 {
  return {
    program: {
      ...profile.referenceProgram,
      plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
    },
    executableActions: [],
    executedCommandCount: 0,
  };
}

function planFor(profile: CutterGridProfileV4, challenge: Challenge): CutterTrajectoryPlanV4 {
  const primitive = profile.entryOptions[0].positioningPrimitive;
  const plan: CutterTrajectoryPlanV4 = {
    kind: 'cutter-grid-trajectory',
    version: 4,
    plannerVersion: profile.plannerVersion,
    challengeSignature: profile.challengeSignature,
    positioning: {
      entryOptionId: profile.entryOptions[0].id,
      primitives: [primitive],
      trajectorySignature: cutterGridRustPrimitiveSignatureV4(primitive),
    },
    startCoord: [0, 0, 0],
    endCoord: [0, 0, 0],
    actions: [],
    expectedResultVoxels: [...challenge.initialHair.voxels].sort(),
    estimatedDurationMs: 0,
    executedCommandCount: 0,
    motionLimits: profile.motionLimits,
    motionLimitsSignature: profile.motionLimitsSignature,
    diagnostics: {
      endpointLayerCount: 0,
      candidateCounts: [],
      directPrimitiveCount: 0,
      detourPrimitiveCount: 0,
      minimumHeadClearance: 0.2,
      minimumJointLimitMargin: 1,
      maximumNormalizedJointStep: 0,
      maximumEndEffectorChordDeviation: 0,
      requestedSpeedScale: 1,
      actualSpeedScale: 1,
      maximumVelocityRatio: 1,
      maximumAccelerationRatio: 1,
      maximumJerkRatio: 1,
      adaptiveValidationSampleCount: 3,
    },
    trajectorySignature: '',
  };
  return { ...plan, trajectorySignature: cutterGridRustPlanSignatureV4(plan) };
}

function responseFor(profile: CutterGridProfileV4, challenge: Challenge) {
  return {
    kind: 'cutter-grid-plan-result',
    version: 1,
    plannerImplementation: 'hcr-sim-rust',
    plannerBuild: 'hcr_sim/test',
    profileSignature: profile.profileSignature,
    planningDurationMs: 1,
    plan: planFor(profile, challenge),
  };
}

function workerReturning(plan: CutterTrajectoryPlanV4) {
  return {
    planV4: vi.fn().mockResolvedValue(plan),
    cancel: vi.fn(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
