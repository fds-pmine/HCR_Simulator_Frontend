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
import { HttpMatchProvider } from '../../src/services/http/HttpMatchProvider';
import { HttpSessionProvider } from '../../src/services/http/HttpSessionProvider';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { matchConfig } from '../../src/types/match';
import type { ScoreResult } from '../../src/types/domain';

const BASE_URL = process.env.HCR_API_BASE_URL ?? 'http://localhost:18623';
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
    { type: 'set-joint-angle', jointId: 'shoulder', angleDeg: 130, sourceBlockId: 'starter-shoulder' },
    { type: 'set-joint-angle', jointId: 'elbow', angleDeg: 152.5, sourceBlockId: 'starter-elbow' },
    { type: 'set-joint-angle', jointId: 'wrist', angleDeg: 10, sourceBlockId: 'starter-wrist' },
    { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 145, sourceBlockId: 'starter-base-sweep' },
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
    // The values recorded from the TS engine in the conformance fixture. The
    // starter removes 11 of the 12 voxels the target asks for, and completion
    // is Jaccard over the *cut* — 11 removed against a 12-voxel union — so it
    // lands at 11/12. Under the old metric, which compared the hair left
    // standing, the same run scored 99.5652 and an empty program scored 95.02;
    // see `calculateTrimScore`.
    expect(result.score.completionScore).toBeCloseTo(91.6667, 3);
    // Efficiency and time both clamp at 100 here, so this is 0.6 × 91.6667 + 40.
    expect(result.score.finalScore).toBeCloseTo(95.0, 3);
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
          { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 90, sourceBlockId: 'reckless' },
        ],
      },
    });

    expect(result.status).toBe('error');
    expect(result.terminal.reason).toBe('head-collision');
    expect(result.terminal.jointId).toBe('baseYaw');
    expect(result.terminal.sourceBlockId).toBe('reckless');
    // Servo degrees, like every angle crossing the wire; geometric -34.48°.
    expect(result.terminal.safeAngleDeg).toBeCloseTo(55.52, 1);
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

/**
 * A whole competitive round, driven by the class the versus UI actually uses.
 *
 * The unit tests stub `fetch`, so they prove `HttpMatchProvider` builds the
 * requests it means to. Only this proves the server agrees — that the challenge
 * really is withheld, that the acknowledgement really carries no score, and that
 * the deadline really is judged on the server's clock.
 */
describe('live competitive round', () => {
  const provider = (playerId: string, displayName: string) => {
    const instance = new HttpMatchProvider(new ApiClient({ baseUrl: BASE_URL }));
    instance.setPlayer({ playerId, displayName });
    return instance;
  };

  it('runs lobby → round → results with the server as the only authority', async ({
    skip,
  }) => {
    if (!reachable) skip();

    const alice = provider('u-live-alice', 'Alice');
    const bob = provider('u-live-bob', 'Bob');

    // Built through `matchConfig` — the same overrides-onto-defaults path the
    // versus UI uses. Hand-writing a complete config here would stop this test
    // noticing if the UI ever sent a partial one, which it did once.
    // A short round, so the test closes it by waiting rather than by asking.
    const created = await alice.createMatch(
      matchConfig({
        durationMs: 3_000,
        minSubmitIntervalMs: 0,
        challengeRef: { challengeId: SHIPPED, version: 1 },
      }),
    );
    expect(created.phase).toBe('lobby');

    // Withheld during the lobby: revealing it early is a head start.
    await expect(alice.getMatchChallenge(created.matchId)).rejects.toMatchObject({
      code: 'MATCH_NOT_READY',
    });

    await alice.joinMatch(created.matchId);
    const roster = await bob.joinMatch(created.matchId);
    // The display name is cosmetic; the id is what the server acts on.
    expect(roster.players.map((player) => player.displayName).sort()).toEqual([
      'Alice',
      'Bob',
    ]);

    const started = await alice.startMatch(created.matchId);
    expect(started.phase).toBe('running');
    expect((started.closesAt ?? 0) - (started.opensAt ?? 0)).toBe(3_000);

    const revealed = await alice.getMatchChallenge(created.matchId);
    expect(revealed.challenge.id).toBe(SHIPPED);
    expect(revealed.version).toBe(1);

    const ack = await alice.submit(created.matchId, {
      submissionId: `live-round-${Date.now()}`,
      challengeId: SHIPPED,
      challengeVersion: 1,
      program: STARTER_PROGRAM,
      // Ignored by the online provider; the server replays and uses its own.
      clientScore: {
        completionScore: 100,
        efficiencyScore: 100,
        timeScore: 100,
        finalScore: 100,
        programCost: 0,
      },
    });
    expect(ack.accepted).toBe(true);
    // The rule made checkable: an acknowledgement carries no score at all.
    expect(Object.keys(ack).sort()).toEqual([
      'accepted',
      'serverReceivedAt',
      'submissionId',
    ]);

    // Standings stay sealed while the round is open.
    await expect(alice.getResults(created.matchId)).rejects.toMatchObject({
      code: 'MATCH_NOT_READY',
      message: 'Results are published when the round closes.',
    });

    await new Promise((resolve) => setTimeout(resolve, 3_400));
    await alice.getMatch(created.matchId); // settles the phase on the server clock

    const results = await alice.getResults(created.matchId);
    expect(results.rankBy).toBe('completion');
    expect(results.rows[0]?.displayName).toBe('Alice');
    // The server's own replay, not the 100 the client claimed.
    expect(results.rows[0]?.completionScore).toBeCloseTo(91.6667, 3);
    expect(results.rows[1]?.displayName).toBe('Bob');
    expect(results.rows[1]?.submissionId).toBeUndefined();

    const late = await bob.submit(created.matchId, {
      submissionId: `live-late-${Date.now()}`,
      challengeId: SHIPPED,
      challengeVersion: 1,
      program: STARTER_PROGRAM,
    });
    expect(late.accepted).toBe(false);
    expect(late.rejectedReason).toBe('after-deadline');
  }, 20_000);

  it('estimates a clock offset small enough for a countdown to be honest', async ({
    skip,
  }) => {
    if (!reachable) skip();

    const sample = await provider('u-live-clock', 'Clock').syncClock();

    // Against a server on this machine the offset is a rounding error. The
    // assertion is loose because the point is that the estimator works at all —
    // the countdown is advisory, and only server receive time decides anything.
    expect(Math.abs(sample.offsetMs)).toBeLessThan(1_000);
    expect(sample.rttMs).toBeLessThan(1_000);
  });
});

/**
 * Adaptive practice against the real CAT engine.
 *
 * Solo is a session now, not a menu: the server picks each challenge from the
 * learner's ability estimate. Only a live run proves the loop closes — that a
 * response moves theta and that the next item arrives.
 */
describe('live adaptive practice', () => {
  it('serves items and moves the ability estimate', async ({ skip }) => {
    if (!reachable) skip();

    const client = new ApiClient({ baseUrl: BASE_URL });
    const sessions = new HttpSessionProvider(client);

    const opened = await sessions.start();
    expect(opened.sessionId).toBeTruthy();
    expect(opened.responseCount).toBe(0);

    const seen: string[] = [];
    let theta = opened.theta;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let item;
      try {
        item = await sessions.next(opened.sessionId);
      } catch {
        break; // The bank ran dry, which is a legitimate finish.
      }
      seen.push(item.challengeId);

      const submissionId = `live-cat-${Date.now()}-${attempt}`;
      await client.post('/api/v1/submissions', {
        submissionId,
        challengeId: item.challengeId,
        challengeVersion: item.challengeVersion,
        sessionId: opened.sessionId,
        program: STARTER_PROGRAM,
      });

      const outcome = await sessions.respond(
        opened.sessionId,
        item.itemRef,
        submissionId,
      );
      expect(Number.isFinite(outcome.theta)).toBe(true);
      theta = outcome.theta;
      if (outcome.terminated) break;
    }

    expect(seen.length).toBeGreaterThan(0);
    // The estimate has to actually respond to evidence; a theta pinned at its
    // starting value would mean the loop is not closing.
    expect(theta).not.toBe(opened.theta);

    // `finalize` returns the session's *history*, not a snapshot — one item
    // record per attempt, with the ability before and after each.
    const closed = await sessions.finalize(opened.sessionId);
    expect(closed.totalItems).toBe(seen.length);
    expect(closed.items).toHaveLength(seen.length);
    expect(closed.items[0].thetaBefore).not.toBe(closed.items[0].thetaAfter);
    expect(closed.terminationReason).toBeTruthy();
  }, 30_000);

  it('refuses a forged item reference', async ({ skip }) => {
    if (!reachable) skip();

    const sessions = new HttpSessionProvider(new ApiClient({ baseUrl: BASE_URL }));
    const opened = await sessions.start();

    await expect(
      sessions.respond(opened.sessionId, 'forged.token', 'nope'),
    ).rejects.toMatchObject({ code: 'ITEM_REF_INVALID' });
  });
});
