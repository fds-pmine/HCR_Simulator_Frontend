/**
 * Live integration against a running HCR backend.
 *
 * Exercises the real client path — `HttpChallengeProvider` → `ApiClient` → HTTP
 * → `hcr` → the Rust replay engine — with no mocking anywhere. Unit
 * tests stub `fetch`, which proves the client is self-consistent; only this
 * proves the two halves actually agree.
 *
 * Skips itself when no backend is listening, so `npm test` stays green offline.
 * To run it:
 *
 *   cargo run -p hcr --features hotaru --example serve   # in hcr-backend
 *   npm test
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/services/http/apiClient';
import { HttpChallengeProvider } from '../../src/services/http/HttpChallengeProvider';
import { HttpMatchProvider } from '../../src/services/http/HttpMatchProvider';
import { HttpSessionProvider } from '../../src/services/http/HttpSessionProvider';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { matchConfig } from '../../src/types/match';
import {
  CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
  type CutterGridProgramV1,
} from '../../src/features/cutter-grid/types';
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

/**
 * The certified Cutter Grid route for the shipped challenge, as lattice IR.
 *
 * The same nine moves the Grid tutorial teaches and the server's own Profile
 * carries as its reference program — so the expected score is not a number
 * chosen here, it is what a perfect cut is worth.
 */
const CERTIFIED_ROUTE: CutterGridProgramV1 = {
  kind: 'cutter-grid',
  version: 1,
  plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
  nodes: (
    [
      ['left', 3],
      ['up', 6],
      ['up', 2],
      ['forward', 1],
      ['up', 1],
      ['forward', 1],
      ['up', 1],
      ['forward', 6],
      ['forward', 1],
    ] as const
  ).map(([direction, distance], index) => ({
    type: 'move' as const,
    direction,
    distance,
    sourceBlockId: `route-${index}`,
  })),
  sourceBlockCount: 9,
};

/** The challenge's shipped starter workspace, as Program IR. */
const STARTER_PROGRAM = {
  sourceBlockCount: 1,
  nodes: [
    { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 150, sourceBlockId: 'starter-base-sweep' },
  ],
};

/**
 * A sweep that stops short of the target.
 *
 * The Versus round needs a program whose real score is not the one a client
 * can claim, and the shipped starter now cuts the target exactly — a perfect
 * 100 proves nothing about whose number won.
 */
const PARTIAL_SWEEP_PROGRAM = {
  sourceBlockCount: 1,
  nodes: [
    { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 130, sourceBlockId: 'partial-base-sweep' },
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
    expect(result.metrics.executedCommandCount).toBe(1);
    // Crown Trim is one sweep: X from its 90° Home to 150°, which removes
    // exactly the eleven target voxels. One block also keeps efficiency and
    // time at their ceilings, so the final score is the completion score.
    expect(result.score.completionScore).toBeCloseTo(100, 3);
    expect(result.score.finalScore).toBeCloseTo(100, 3);
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
        // Base Yaw 90° is the Home pose now and reaches nothing; rolling the
        // shoulder to its limit still drives the End Effector into the head.
        nodes: [
          { type: 'set-joint-angle', jointId: 'shoulderRoll', angleDeg: -45, sourceBlockId: 'reckless' },
        ],
      },
    });

    expect(result.status).toBe('error');
    expect(result.terminal.reason).toBe('head-collision');
    expect(result.terminal.jointId).toBe('shoulderRoll');
    expect(result.terminal.sourceBlockId).toBe('reckless');
    // Servo degrees, like every angle crossing the wire.
    expect(result.terminal.safeAngleDeg).toBeCloseTo(-14.36, 1);
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
      program: PARTIAL_SWEEP_PROGRAM,
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
    expect(results.rows[0]?.completionScore).toBeCloseTo(63.6364, 3);
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

  /**
   * A Cutter Grid round, played against the real planner.
   *
   * The client sends the route and nothing else: no profile, no roadmap, no
   * trajectory, not even the plan the browser ran for the preview. Everything
   * the score turns on is produced on the server — which is exactly what the
   * unit tests cannot show, because there the server is a `fetch` stub.
   */
  it('plays a Cutter Grid round the server plans and scores', async ({ skip }) => {
    if (!reachable) skip();

    const alice = provider('u-live-grid', 'Alice');
    const created = await alice.createMatch(
      matchConfig({
        durationMs: 3_000,
        minSubmitIntervalMs: 0,
        programmingMode: 'cutter-grid',
        challengeRef: { challengeId: SHIPPED, version: 1 },
      }),
    );
    await alice.joinMatch(created.matchId);
    await alice.startMatch(created.matchId);

    const ack = await alice.submit(created.matchId, {
      submissionId: `live-grid-${Date.now()}`,
      challengeId: SHIPPED,
      challengeVersion: 1,
      // Empty: a Cutter Grid entry has no joint commands to replay, and the
      // block count is the one part of it that is the player's.
      program: { nodes: [], sourceBlockCount: CERTIFIED_ROUTE.sourceBlockCount },
      cutterGridV4: CERTIFIED_ROUTE,
    });
    expect(ack.accepted).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 3_400));
    await alice.getMatch(created.matchId);

    const results = await alice.getResults(created.matchId);
    // The table says which task it ranks; a Cutter Grid score is not a servo one.
    expect(results.programmingMode).toBe('cutter-grid');
    // The certified route removes exactly the target and nothing else. The
    // server planned the motion that did it.
    expect(results.rows[0]?.completionScore).toBeCloseTo(100, 6);
    expect(results.rows[0]?.metrics.sourceBlockCount).toBe(9);
    // Expanded by the server, from the route it was given.
    expect(results.rows[0]?.metrics.executedCommandCount).toBeGreaterThan(0);
  }, 30_000);

  it('refuses a Cutter Grid round on a challenge the server cannot plan', async ({
    skip,
  }) => {
    if (!reachable) skip();

    // A lesson challenge: the catalog advertises Cutter Grid for it, because
    // its profile ships with the frontend — and the server holds no profile of
    // its own, so it refuses the room rather than the submissions.
    await expect(
      provider('u-live-grid-2', 'Alice').createMatch(
        matchConfig({
          programmingMode: 'cutter-grid',
          challengeRef: { challengeId: 'lesson-1-first-cut', version: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'PROGRAM_INVALID' });
  }, 15_000);

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
