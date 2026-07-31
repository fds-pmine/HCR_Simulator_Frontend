/**
 * Live integration against a running HCR backend.
 *
 * Exercises the real client path — `HttpChallengeProvider` → `ApiClient` → HTTP
 * → `hcr_service` → the Rust replay engine — with no mocking anywhere. Unit
 * tests stub `fetch`, which proves the client is self-consistent; only this
 * proves the two halves actually agree.
 *
 * Skips itself when no backend is listening, so `npm test` stays green offline.
 * To run it:
 *
 *   cargo run -p hcr_service --features hotaru --example serve   # in hcr-backend
 *   npm test
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/services/http/apiClient';
import { HttpChallengeProvider } from '../../src/services/http/HttpChallengeProvider';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { ScoreResult } from '../../src/types/domain';

const BASE_URL = process.env.HCR_API_BASE_URL ?? 'http://localhost:8080';
const SHIPPED = 'neat-short-cap';

let reachable = false;

beforeAll(async () => {
  try {
    const response = await fetch(`${BASE_URL}/api/v1/time`, {
      signal: AbortSignal.timeout(1500),
    });
    reachable = response.ok;
  } catch {
    reachable = false;
  }
});

/** The challenge's shipped starter workspace, as Program IR. */
const STARTER_PROGRAM = {
  sourceBlockCount: 5,
  nodes: [
    { type: 'set-joint-angle', jointId: 'shoulderRoll', angleDeg: 15, sourceBlockId: 'starter-shoulder-roll' },
    { type: 'set-joint-angle', jointId: 'shoulder', angleDeg: 80, sourceBlockId: 'starter-shoulder' },
    { type: 'set-joint-angle', jointId: 'elbow', angleDeg: 0, sourceBlockId: 'starter-elbow' },
    { type: 'set-joint-angle', jointId: 'wrist', angleDeg: -80, sourceBlockId: 'starter-wrist' },
    { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 55, sourceBlockId: 'starter-base-sweep' },
  ],
};

describe('live backend', () => {
  const client = () => new ApiClient({ baseUrl: BASE_URL });

  it('serves a challenge the frontend normalizes identically to the local one', async ({
    skip,
  }) => {
    if (!reachable) skip();

    const remote = await new HttpChallengeProvider(client()).getChallenge(SHIPPED);
    const local = await new LocalChallengeProvider().getChallenge(SHIPPED);

    // The backend was seeded from the conformance fixture, which was generated
    // from the TypeScript engine — so this compares the served challenge against
    // the one the frontend ships, through the real normalizer.
    expect(remote.id).toBe(local.id);
    expect(remote.robotConfig).toEqual(local.robotConfig);
    expect(remote.voxelConfig).toEqual(local.voxelConfig);
    expect(remote.initialHair.voxels).toEqual(local.initialHair.voxels);
    expect(remote.targetHair.voxels).toEqual(local.targetHair.voxels);
    expect(remote.scoring).toEqual(local.scoring);
  });

  it('scores the starter program exactly as the TypeScript engine does', async ({
    skip,
  }) => {
    if (!reachable) skip();

    const result = await client().post<{
      status: string;
      score: ScoreResult;
      metrics: { executedCommandCount: number };
      terminal: { reason: string };
    }>('/api/v1/submissions', {
      submissionId: `live-${Date.now()}`,
      challengeId: SHIPPED,
      challengeVersion: 1,
      program: STARTER_PROGRAM,
    });

    expect(result.status).toBe('completed');
    expect(result.terminal.reason).toBe('completed');
    expect(result.metrics.executedCommandCount).toBe(5);
    // The values recorded from the TS engine in the conformance fixture.
    expect(result.score.completionScore).toBeCloseTo(84.6473, 3);
    expect(result.score.finalScore).toBeCloseTo(90.7884, 3);
  });

  it('reports a head collision with the block to highlight', async ({ skip }) => {
    if (!reachable) skip();

    const result = await client().post<{
      status: string;
      terminal: { reason: string; jointId: string; safeAngleDeg: number; sourceBlockId: string };
    }>('/api/v1/submissions', {
      submissionId: `live-crash-${Date.now()}`,
      challengeId: SHIPPED,
      challengeVersion: 1,
      program: {
        sourceBlockCount: 1,
        nodes: [
          { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 0, sourceBlockId: 'reckless' },
        ],
      },
    });

    expect(result.status).toBe('error');
    expect(result.terminal.reason).toBe('head-collision');
    expect(result.terminal.jointId).toBe('baseYaw');
    expect(result.terminal.sourceBlockId).toBe('reckless');
    expect(result.terminal.safeAngleDeg).toBeCloseTo(-34.48, 1);
  });

  it('surfaces a backend validation error with its field', async ({ skip }) => {
    if (!reachable) skip();

    await expect(
      client().post('/api/v1/submissions', {
        submissionId: `live-bad-${Date.now()}`,
        challengeId: SHIPPED,
        challengeVersion: 1,
        program: {
          sourceBlockCount: 1,
          nodes: [
            { type: 'set-joint-angle', jointId: 'noSuchJoint', angleDeg: 0, sourceBlockId: 'b1' },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'PROGRAM_INVALID', field: 'noSuchJoint' });
  });
});
