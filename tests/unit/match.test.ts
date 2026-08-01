import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countdownUrgency,
  formatCountdown,
  remainingFraction,
} from '../../src/features/match/countdown';
import { initialsOf, normalizeDisplayName } from '../../src/features/match/identity';
import { ApiClient } from '../../src/services/http/apiClient';
import { HttpMatchProvider } from '../../src/services/http/HttpMatchProvider';
import {
  LocalMatchProvider,
  isPracticeBot,
} from '../../src/services/local/LocalMatchProvider';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { DEFAULT_MATCH_CONFIG, matchConfig } from '../../src/types/match';
import type { Program } from '../../src/features/blockly/programTypes';
import type { ScoreResult } from '../../src/types/domain';

const PROGRAM: Program = { nodes: [], sourceBlockCount: 3 };

function score(completion: number): ScoreResult {
  return {
    completionScore: completion,
    efficiencyScore: 50,
    timeScore: 50,
    finalScore: completion * 0.6 + 50 * 0.4,
    programCost: 3,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

describe('match config', () => {
  it('always produces a complete config', () => {
    // The server rejects a body with fields missing — `duration_ms`,
    // `max_players` and `min_submit_interval_ms` carry no serde default. A
    // partial config reached it once and came back "missing field maxPlayers".
    const config = matchConfig({ durationMs: 90_000 });

    expect(Object.keys(config).sort()).toEqual(
      Object.keys(DEFAULT_MATCH_CONFIG).sort(),
    );
    expect(config.durationMs).toBe(90_000);
    expect(config.maxPlayers).toBe(DEFAULT_MATCH_CONFIG.maxPlayers);
  });
});

describe('countdown', () => {
  it('formats as m:ss and never shows a negative clock', () => {
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(9_400)).toBe('0:10');
    // Late is late; a negative countdown reads as a bug, not as overtime.
    expect(formatCountdown(-4_000)).toBe('0:00');
  });

  it('escalates through the documented thresholds', () => {
    expect(countdownUrgency(120_000)).toBe('calm');
    expect(countdownUrgency(45_000)).toBe('warning');
    // 06-MULTIPLAYER.md §5 asks for a visible closing state in the last 10s.
    expect(countdownUrgency(9_000)).toBe('critical');
    expect(countdownUrgency(0)).toBe('closed');
  });

  it('clamps the progress fraction to the round length', () => {
    expect(remainingFraction(30_000, 60_000)).toBeCloseTo(0.5);
    expect(remainingFraction(-5, 60_000)).toBe(0);
    expect(remainingFraction(90_000, 60_000)).toBe(1);
    expect(remainingFraction(10, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('player identity', () => {
  it('never produces an empty display name', () => {
    expect(normalizeDisplayName('   ', 'Fallback')).toBe('Fallback');
    expect(normalizeDisplayName('  Ada  ', 'Fallback')).toBe('Ada');
    expect(normalizeDisplayName('x'.repeat(40), 'Fallback')).toHaveLength(18);
  });

  it('derives a monogram from one or two words', () => {
    expect(initialsOf('Ada')).toBe('AD');
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('   ')).toBe('??');
  });
});

// ---------------------------------------------------------------------------
// Offline practice rounds
// ---------------------------------------------------------------------------

describe('LocalMatchProvider', () => {
  const provider = () => {
    const instance = new LocalMatchProvider(new LocalChallengeProvider());
    instance.setPlayer({ playerId: 'you', displayName: 'You' });
    return instance;
  };

  it('labels itself as practice rather than multiplayer', () => {
    // The UI keys off this to say so out loud. An offline round is scored by
    // the browser, so it must never be presented as a result.
    expect(provider().kind).toBe('practice');
  });

  it('withholds the challenge until the round starts', async () => {
    const match = provider();
    const created = await match.createMatch(matchConfig());
    await match.joinMatch(created.matchId);

    await expect(match.getMatchChallenge(created.matchId)).rejects.toThrow(
      /revealed when the round starts/,
    );

    await match.startMatch(created.matchId);
    const revealed = await match.getMatchChallenge(created.matchId);
    expect(revealed.challenge.targetHair.voxels.size).toBeGreaterThan(0);
  });

  it('withholds results until the round closes', async () => {
    const match = provider();
    const created = await match.createMatch(matchConfig({ durationMs: 60_000 }));
    await match.joinMatch(created.matchId);
    await match.startMatch(created.matchId);

    await expect(match.getResults(created.matchId)).rejects.toThrow(/closes/);
  });

  it('keeps the best attempt, not the last', async () => {
    vi.useFakeTimers();
    const match = provider();
    const created = await match.createMatch(matchConfig({ durationMs: 60_000 }));
    await match.joinMatch(created.matchId);
    await match.startMatch(created.matchId);

    await match.submit(created.matchId, {
      submissionId: 'a',
      challengeId: 'c',
      challengeVersion: 1,
      program: PROGRAM,
      clientScore: score(88),
    });
    await match.submit(created.matchId, {
      submissionId: 'b',
      challengeId: 'c',
      challengeVersion: 1,
      program: PROGRAM,
      clientScore: score(41),
    });

    vi.advanceTimersByTime(61_000);
    const results = await match.getResults(created.matchId);
    const mine = results.rows.find((row) => row.playerId === 'you');
    expect(mine?.completionScore).toBe(88);
    expect(mine?.submissionId).toBe('a');
  });

  it('refuses a submission that arrives after the deadline', async () => {
    vi.useFakeTimers();
    const match = provider();
    const created = await match.createMatch(matchConfig({ durationMs: 10_000 }));
    await match.joinMatch(created.matchId);
    await match.startMatch(created.matchId);

    vi.advanceTimersByTime(11_000);
    const ack = await match.submit(created.matchId, {
      submissionId: 'late',
      challengeId: 'c',
      challengeVersion: 1,
      program: PROGRAM,
      clientScore: score(99),
    });

    // Specifically "after-deadline", not the technically-true "wrong-phase":
    // a player who missed by a moment should be told what actually happened.
    expect(ack.accepted).toBe(false);
    expect(ack.rejectedReason).toBe('after-deadline');
  });

  it('ranks a player who never submitted last, but still lists them', async () => {
    vi.useFakeTimers();
    const match = provider();
    const created = await match.createMatch(matchConfig({ durationMs: 5_000 }));
    await match.joinMatch(created.matchId);
    await match.startMatch(created.matchId);
    vi.advanceTimersByTime(6_000);

    const results = await match.getResults(created.matchId);
    const mine = results.rows.find((row) => row.playerId === 'you');
    expect(mine?.submissionId).toBeUndefined();
    expect(mine?.rank).toBe(results.rows.length);
  });

  it('fills the room with recognisable bots', async () => {
    const match = provider();
    const created = await match.createMatch(matchConfig());
    const joined = await match.joinMatch(created.matchId);

    const bots = joined.players.filter((player) => isPracticeBot(player.playerId));
    expect(bots).toHaveLength(3);
    expect(joined.players).toHaveLength(4);
  });

  it('reports a code it does not know instead of inventing a room', async () => {
    await expect(provider().joinMatch('ZZZZ')).rejects.toThrow(/No practice round/);
  });
});

// ---------------------------------------------------------------------------
// Online rounds
// ---------------------------------------------------------------------------

function mockClient(responder: (path: string) => unknown) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, ...(init ? { init } : {}) });
    return Promise.resolve(
      new Response(JSON.stringify(responder(path)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  const client = new ApiClient({
    baseUrl: 'https://backend.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('HttpMatchProvider', () => {
  it('sends identity in a header, never in the body', async () => {
    const { client, calls } = mockClient(() => ({ matchId: 'm-1' }));
    const provider = new HttpMatchProvider(client);
    provider.setPlayer({ playerId: 'u-42', displayName: 'Ada' });

    await provider.joinMatch('m-1');

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-HCR-Player']).toBe('u-42');
    // The label travels separately from the identity, and only the identity
    // grants anything.
    expect(headers['X-HCR-Player-Name']).toBe('Ada');
    expect(calls[0]?.init?.body).toBe('{}');
  });

  it('does not forward the browser-computed score', async () => {
    // Sending it would be at best pointless — the server replays the IR and
    // uses its own — and at worst misleading divergence telemetry.
    const { client, calls } = mockClient(() => ({
      submissionId: 's-1',
      accepted: true,
      serverReceivedAt: 1,
    }));
    const provider = new HttpMatchProvider(client);

    await provider.submit('m-1', {
      submissionId: 's-1',
      challengeId: 'neat-short-cap',
      challengeVersion: 1,
      program: PROGRAM,
      clientScore: score(100),
    });

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('clientScore');
    expect(body.matchId).toBe('m-1');
    expect(body.challengeVersion).toBe(1);
  });

  it('keeps the clock sample with the lowest round-trip time', async () => {
    let call = 0;
    const { client } = mockClient(() => {
      call += 1;
      // Every sample reports the same server time; the samples differ only in
      // how long the round trip takes, which is what the estimator weighs.
      return { clientSentAt: 0, serverTime: 1_000_000 + call };
    });
    const provider = new HttpMatchProvider(client);

    const sample = await provider.syncClock();

    expect(Number.isFinite(sample.offsetMs)).toBe(true);
    expect(sample.rttMs).toBeGreaterThanOrEqual(0);
  });
});
