import { describe, expect, it } from 'vitest';
import type { MatchResultRow, MatchResults } from '../../src/types/match';
import {
  FINISH_POINT,
  PERSONAL_BEST_POINT,
  PODIUM_POINTS,
  crewStandings,
  recordCrewRound,
  recordRound,
  standings,
} from '../../src/features/match/season';
import {
  assignCrew,
  crewCountFor,
  crewTotals,
  crewsFor,
  drawCrews,
  nextCrew,
} from '../../src/features/match/crews';
import { classTargetResult } from '../../src/features/match/classTarget';
import { marginsFor } from '../../src/features/match/margins';
import {
  countdownUrgency,
  isEndgame,
  relayLeg,
} from '../../src/features/match/countdown';
import {
  DURATIONS,
  resubmitIntervalFor,
  roundLengthUnits,
} from '../../src/features/match/roundRules';

function row(
  overrides: Partial<MatchResultRow> & Pick<MatchResultRow, 'rank' | 'playerId'>,
): MatchResultRow {
  return {
    displayName: overrides.playerId,
    completionScore: 50,
    finalScore: 50,
    metrics: { sourceBlockCount: 3, commandCount: 3, estimatedDurationMs: 1_000 },
    submissionId: `sub-${overrides.playerId}`,
    ...overrides,
  } as MatchResultRow;
}

function results(
  matchId: string,
  rows: readonly MatchResultRow[],
  rankBy: MatchResults['rankBy'] = 'completion',
): MatchResults {
  return {
    matchId,
    challengeId: 'neat-short-cap',
    challengeVersion: 1,
    rankBy,
    rows: [...rows],
  };
}

describe('the season table', () => {
  it('pays the podium and a point for turning up', () => {
    const table = recordRound(
      [],
      results('r1', [
        row({ rank: 1, playerId: 'ana' }),
        row({ rank: 2, playerId: 'bo' }),
        row({ rank: 3, playerId: 'cy' }),
        row({ rank: 4, playerId: 'di' }),
      ]),
    );

    expect(table.map((entry) => [entry.playerId, entry.points])).toEqual([
      ['ana', PODIUM_POINTS[0]],
      ['bo', PODIUM_POINTS[1]],
      ['cy', PODIUM_POINTS[2]],
      ['di', FINISH_POINT],
    ]);
  });

  it('scores nothing for a round nobody submitted to', () => {
    const [entry] = recordRound(
      [],
      results('r1', [row({ rank: 1, playerId: 'ana', submissionId: undefined })]),
    );
    expect(entry.points).toBe(0);
    expect(entry.rounds).toBe(1);
    expect(entry.best).toBe(0);
  });

  it('adds a point for beating your own best, but never on the first round', () => {
    const first = recordRound(
      [],
      results('r1', [row({ rank: 2, playerId: 'ana', completionScore: 40 })]),
    );
    // Second place only: the first round cannot beat a best that did not exist.
    expect(first[0].points).toBe(PODIUM_POINTS[1]);

    const second = recordRound(
      first,
      results('r2', [row({ rank: 2, playerId: 'ana', completionScore: 61 })]),
    );
    expect(second[0].points).toBe(PODIUM_POINTS[1] * 2 + PERSONAL_BEST_POINT);
    expect(second[0].best).toBeCloseTo(61);

    const third = recordRound(
      second,
      results('r3', [row({ rank: 2, playerId: 'ana', completionScore: 12 })]),
    );
    expect(third[0].points).toBe(PODIUM_POINTS[1] * 3 + PERSONAL_BEST_POINT);
    expect(third[0].best).toBeCloseTo(61);
  });

  it('follows a player who renames themselves rather than splitting them', () => {
    const first = recordRound([], results('r1', [row({ rank: 1, playerId: 'ana' })]));
    const second = recordRound(
      first,
      results('r2', [row({ rank: 1, playerId: 'ana', displayName: 'Buzz' })]),
    );
    expect(second).toHaveLength(1);
    expect(second[0].displayName).toBe('Buzz');
    expect(second[0].wins).toBe(2);
  });

  it('measures a personal best on similarity even in an efficiency round', () => {
    // Round one is ranked by similarity, round two by the weighted score. The
    // weighted score is lower on both, so comparing it against the recorded
    // best would award a personal best for getting worse.
    const first = recordRound(
      [],
      results('r1', [row({ rank: 1, playerId: 'ana', completionScore: 90, finalScore: 30 })]),
    );
    expect(first[0].best).toBeCloseTo(90);

    const second = recordRound(
      first,
      results(
        'r2',
        [row({ rank: 1, playerId: 'ana', completionScore: 40, finalScore: 35 })],
        'final',
      ),
    );
    expect(second[0].best).toBeCloseTo(90);
    expect(second[0].points).toBe(PODIUM_POINTS[0] * 2);
  });

  it('counts a podium streak and breaks it on a bad round', () => {
    const podium = (playerId: string, rank: number) =>
      results('r', [row({ rank, playerId })]);

    let table = recordRound([], podium('ana', 2));
    expect(table[0].podiumStreak).toBe(1);
    table = recordRound(table, podium('ana', 1));
    expect(table[0].podiumStreak).toBe(2);
    table = recordRound(table, podium('ana', 3));
    expect(table[0].podiumStreak).toBe(3);
    // Fourth is off the podium, so the run ends rather than pausing.
    table = recordRound(table, podium('ana', 4));
    expect(table[0].podiumStreak).toBe(0);
  });

  it('marks the round in which a player beat their own best', () => {
    let table = recordRound(
      [],
      results('r1', [row({ rank: 1, playerId: 'ana', completionScore: 40 })]),
    );
    // Nobody's first round is an improvement on anything.
    expect(table[0].improvedThisRound).toBe(false);

    table = recordRound(
      table,
      results('r2', [row({ rank: 1, playerId: 'ana', completionScore: 65 })]),
    );
    expect(table[0].improvedThisRound).toBe(true);

    table = recordRound(
      table,
      results('r3', [row({ rank: 1, playerId: 'ana', completionScore: 12 })]),
    );
    expect(table[0].improvedThisRound).toBe(false);
  });

  it('ranks on points, then wins, then the best single round', () => {
    const table = standings([
      { playerId: 'a', displayName: 'A', points: 6, rounds: 2, wins: 0, best: 80, podiumStreak: 0, improvedThisRound: false },
      { playerId: 'b', displayName: 'B', points: 6, rounds: 2, wins: 1, best: 10, podiumStreak: 1, improvedThisRound: false },
      { playerId: 'c', displayName: 'C', points: 9, rounds: 2, wins: 1, best: 10, podiumStreak: 2, improvedThisRound: false },
    ]);
    expect(table.map((entry) => entry.playerId)).toEqual(['c', 'b', 'a']);
  });
});

describe('crews', () => {
  it('cycles a player through the crews and back to unassigned', () => {
    expect(nextCrew(undefined)).toBe('A');
    expect(nextCrew('A')).toBe('B');
    expect(nextCrew('F')).toBeUndefined();

    let crews = assignCrew({}, 'ana');
    expect(crews).toEqual({ ana: 'A' });
    crews = assignCrew(crews, 'ana');
    expect(crews).toEqual({ ana: 'B' });
    // B → C → D → E → F → unassigned.
    for (let step = 0; step < 5; step += 1) crews = assignCrew(crews, 'ana');
    expect(crews).toEqual({});
  });

  it('sums a crew and counts who actually submitted', () => {
    const crews = { ana: 'A', bo: 'A', cy: 'B' } as const;
    const totals = crewTotals(
      [
        row({ rank: 1, playerId: 'ana', completionScore: 70 }),
        row({ rank: 3, playerId: 'bo', completionScore: 20, submissionId: undefined }),
        row({ rank: 2, playerId: 'cy', completionScore: 60 }),
      ],
      crews,
      'completion',
    );

    expect(totals[0]).toMatchObject({ crew: 'A', total: 70, members: 2, submitted: 1 });
    expect(totals[1]).toMatchObject({ crew: 'B', total: 60, members: 1, submitted: 1 });
  });

  it('leaves unassigned players out entirely', () => {
    expect(crewTotals([row({ rank: 1, playerId: 'ana' })], {}, 'completion')).toEqual([]);
  });
});

describe('round length', () => {
  it('offers blitz rounds as well as the original three', () => {
    expect(DURATIONS.map((option) => option.ms)).toContain(60_000);
    expect(DURATIONS.map((option) => option.ms)).toContain(90_000);
  });

  it('halves the resubmit gap for a blitz round only', () => {
    expect(resubmitIntervalFor(60_000)).toBe(1_000);
    expect(resubmitIntervalFor(90_000)).toBe(1_000);
    expect(resubmitIntervalFor(3 * 60_000)).toBe(2_000);
  });

  it('states a blitz round in seconds, never as rounded minutes', () => {
    // "1 minutes" for a 60-second round and "2 minutes" for a 90-second one
    // are not rounding artefacts to a reader — they are the wrong length on
    // the one screen whose job is to state the rules.
    expect(roundLengthUnits(60_000)).toEqual({ value: 60, unit: 'seconds' });
    expect(roundLengthUnits(90_000)).toEqual({ value: 90, unit: 'seconds' });
    expect(roundLengthUnits(2 * 60_000)).toEqual({ value: 2, unit: 'minutes' });
    expect(roundLengthUnits(5 * 60_000)).toEqual({ value: 5, unit: 'minutes' });
  });
});

describe('the class target', () => {
  it('clears only when every player in the room is at or above the bar', () => {
    const rows = [
      row({ rank: 1, playerId: 'ana', completionScore: 90 }),
      row({ rank: 2, playerId: 'bo', completionScore: 61 }),
    ];
    expect(classTargetResult(rows, 60).cleared).toBe(true);
    expect(classTargetResult(rows, 60).missingBy).toBe(0);

    const missed = classTargetResult(rows, 80);
    expect(missed.cleared).toBe(false);
    expect(missed.lowest).toBeCloseTo(61);
    expect(missed.missingBy).toBeCloseTo(19);
  });

  it('counts a player who never submitted as zero rather than skipping them', () => {
    // A bar that ignored whoever ran out of time would be cleared by the room
    // abandoning its slowest member, which is the opposite of the point.
    const result = classTargetResult(
      [
        row({ rank: 1, playerId: 'ana', completionScore: 95 }),
        row({ rank: 2, playerId: 'bo', completionScore: 88, submissionId: undefined }),
      ],
      40,
    );
    expect(result.cleared).toBe(false);
    expect(result.lowest).toBe(0);
    expect(result.submitted).toBe(1);
    expect(result.players).toBe(2);
  });

  it('never clears an empty room', () => {
    expect(classTargetResult([], 0).cleared).toBe(false);
  });
});

describe('margins', () => {
  const board = (
    rows: readonly MatchResultRow[],
    rankBy: MatchResults['rankBy'] = 'completion',
  ): MatchResults => ({
    matchId: 'm',
    challengeId: 'c',
    challengeVersion: 1,
    rankBy,
    rows: [...rows],
  });

  it('measures the gap to the row above and the row below', () => {
    const margins = marginsFor(
      board([
        row({ rank: 1, playerId: 'ana', completionScore: 90 }),
        row({ rank: 2, playerId: 'bo', completionScore: 82 }),
        row({ rank: 3, playerId: 'cy', completionScore: 30 }),
      ]),
    );

    expect(margins[0]).toMatchObject({ behind: 0, ahead: 8 });
    expect(margins[0].chasing).toBeUndefined();
    expect(margins[1]).toMatchObject({ behind: 8, chasing: 'ana', ahead: 52 });
    expect(margins[2]).toMatchObject({ behind: 52, chasing: 'bo' });
    expect(margins[2].ahead).toBeUndefined();
  });

  it('calls a hairline gap a photo finish, and a clear one not', () => {
    const margins = marginsFor(
      board([
        row({ rank: 1, playerId: 'ana', completionScore: 90.4 }),
        row({ rank: 2, playerId: 'bo', completionScore: 90.1 }),
        row({ rank: 3, playerId: 'cy', completionScore: 60 }),
      ]),
    );
    expect(margins[1].photoFinish).toBe(true);
    expect(margins[2].photoFinish).toBe(false);
    // The leader is not in a photo finish with nobody.
    expect(margins[0].photoFinish).toBe(false);
  });

  it('calls an exact tie a photo finish too', () => {
    // The server still ordered them, on efficiency then duration then arrival.
    // Printing two identical numbers says the haircut decided it; it did not.
    const margins = marginsFor(
      board([
        row({ rank: 1, playerId: 'ana', completionScore: 100 }),
        row({ rank: 2, playerId: 'bo', completionScore: 100 }),
      ]),
    );
    expect(margins[1]).toMatchObject({ behind: 0, photoFinish: true });
  });

  it('never calls a missing attempt a photo finish', () => {
    const margins = marginsFor(
      board([
        row({ rank: 1, playerId: 'ana', completionScore: 0 }),
        row({ rank: 2, playerId: 'bo', completionScore: 0, submissionId: undefined }),
      ]),
    );
    expect(margins[1].photoFinish).toBe(false);
  });

  it('reads the margin on the metric the round was ranked by', () => {
    const margins = marginsFor(
      board(
        [
          row({ rank: 1, playerId: 'ana', completionScore: 10, finalScore: 90 }),
          row({ rank: 2, playerId: 'bo', completionScore: 99, finalScore: 40 }),
        ],
        'final',
      ),
      undefined,
    );
    expect(margins[1].behind).toBeCloseTo(50);
  });

  it('reports how close to the deadline an attempt landed', () => {
    const closesAt = 100_000;
    const margins = marginsFor(
      board([
        row({ rank: 1, playerId: 'ana', completionScore: 90, serverReceivedAt: 96_900 }),
        row({ rank: 2, playerId: 'bo', completionScore: 80, serverReceivedAt: 20_000 }),
      ]),
      closesAt,
    );
    expect(margins[0].secondsToSpare).toBeCloseTo(3.1);
    expect(margins[1].secondsToSpare).toBeCloseTo(80);
  });
});

describe('the closing stretch', () => {
  it('scales the thresholds to short rounds', () => {
    // The absolute values were written for rounds of minutes. Applied to a
    // sixty-second round they would make "running out of time" the only state.
    expect(countdownUrgency(50_000, 60_000)).toBe('calm');
    expect(countdownUrgency(19_000, 60_000)).toBe('warning');
    expect(countdownUrgency(9_000, 60_000)).toBe('critical');
    expect(isEndgame(20_000, 60_000)).toBe(false);
    expect(isEndgame(14_000, 60_000)).toBe(true);
  });

  it('leaves a long round on the absolute thresholds', () => {
    expect(countdownUrgency(120_000, 5 * 60_000)).toBe('calm');
    expect(countdownUrgency(45_000, 5 * 60_000)).toBe('warning');
    expect(countdownUrgency(9_000, 5 * 60_000)).toBe('critical');
    expect(isEndgame(29_000, 5 * 60_000)).toBe(true);
    expect(isEndgame(31_000, 5 * 60_000)).toBe(false);
  });

  it('is never in the closing stretch of a round that has closed', () => {
    expect(isEndgame(0, 60_000)).toBe(false);
    expect(isEndgame(-1_000, 60_000)).toBe(false);
  });
});

describe('drawing crews', () => {
  const roster = (n: number) =>
    Array.from({ length: n }, (_, index) => `player-${index}`);

  it('gives every player a crew and keeps the crews balanced', () => {
    const crews = drawCrews(roster(12), 'ABC234', 4);
    expect(Object.keys(crews)).toHaveLength(12);

    const sizes = new Map<string, number>();
    for (const crew of Object.values(crews)) {
      sizes.set(crew, (sizes.get(crew) ?? 0) + 1);
    }
    expect([...sizes.values()]).toEqual([3, 3, 3, 3]);
  });

  it('is the same on every laptop, whatever order people joined in', () => {
    // The whole reason crews can be shared without a wire field.
    const players = roster(9);
    const shuffled = [players[4], players[0], players[8], ...players.slice(1, 4), players[5], players[6], players[7]];
    expect(drawCrews(shuffled, 'ABC234', 3)).toEqual(drawCrews(players, 'ABC234', 3));
  });

  it('re-deals in a different room, so a session is not one fixed team', () => {
    const players = roster(8);
    expect(drawCrews(players, 'ABC234', 4)).not.toEqual(drawCrews(players, 'ZZZ999', 4));
  });

  it('aims at crews of three or four, and never a crew of one', () => {
    expect(crewCountFor(2)).toBe(1);
    expect(crewCountFor(5)).toBe(2);
    expect(crewCountFor(8)).toBe(2);
    expect(crewCountFor(12)).toBe(3);
    expect(crewCountFor(20)).toBe(6);
    expect(crewCountFor(24)).toBe(6);
    // Six letters is the ceiling; a bigger room gets bigger crews, not a
    // seventh letter nobody can name.
    expect(crewCountFor(40)).toBe(6);
    const crews = drawCrews(roster(5), 'ABC234', crewCountFor(5));
    const sizes = new Map<string, number>();
    for (const crew of Object.values(crews)) sizes.set(crew, (sizes.get(crew) ?? 0) + 1);
    expect(Math.min(...sizes.values())).toBeGreaterThan(1);
  });

  it('deals an empty roster to nobody rather than throwing', () => {
    expect(drawCrews([], 'ABC234', 4)).toEqual({});
  });
});

describe('scoring a crew on its two weakest', () => {
  const crews = { ana: 'A', bo: 'A', cy: 'A' } as const;

  it('ignores the star and counts the bottom two', () => {
    const totals = crewTotals(
      [
        row({ rank: 1, playerId: 'ana', completionScore: 100 }),
        row({ rank: 2, playerId: 'bo', completionScore: 40 }),
        row({ rank: 3, playerId: 'cy', completionScore: 30 }),
      ],
      crews,
      'completion',
      'weakestTwo',
    );
    expect(totals[0].total).toBe(70);
    expect(totals[0].scores).toEqual([30, 40, 100]);
  });

  it('makes carrying arithmetically impossible', () => {
    // The same crew, with the star scoring perfectly instead of well: under
    // `sum` that lifts the crew, and under `weakestTwo` it changes nothing.
    const weak = [
      row({ rank: 2, playerId: 'bo', completionScore: 40 }),
      row({ rank: 3, playerId: 'cy', completionScore: 30 }),
    ];
    const good = crewTotals(
      [row({ rank: 1, playerId: 'ana', completionScore: 70 }), ...weak],
      crews,
      'completion',
      'weakestTwo',
    );
    const perfect = crewTotals(
      [row({ rank: 1, playerId: 'ana', completionScore: 100 }), ...weak],
      crews,
      'completion',
      'weakestTwo',
    );
    expect(perfect[0].total).toBe(good[0].total);
  });

  it('counts a member who never submitted as one of the weakest', () => {
    const totals = crewTotals(
      [
        row({ rank: 1, playerId: 'ana', completionScore: 90 }),
        row({ rank: 2, playerId: 'bo', completionScore: 80 }),
        row({ rank: 3, playerId: 'cy', completionScore: 70, submissionId: undefined }),
      ],
      crews,
      'completion',
      'weakestTwo',
    );
    expect(totals[0].total).toBe(80);
    expect(totals[0].submitted).toBe(2);
  });

  it('scores a crew smaller than two on everyone it has', () => {
    const totals = crewTotals(
      [row({ rank: 1, playerId: 'ana', completionScore: 55 })],
      { ana: 'A' },
      'completion',
      'weakestTwo',
    );
    expect(totals[0].total).toBe(55);
  });
});

describe('which crews the room is playing', () => {
  const player = (playerId: string, crew?: string) => ({
    playerId,
    displayName: playerId,
    connected: true,
    submitted: false,
    ...(crew ? { crew } : {}),
  });

  it('draws its own when nobody has assigned any', () => {
    const players = ['ana', 'bo', 'cy', 'di'].map((id) => player(id));
    expect(crewsFor(players, 'ABC234')).toEqual(
      drawCrews(['ana', 'bo', 'cy', 'di'], 'ABC234', crewCountFor(4)),
    );
  });

  it('lets an assignment win, because it was made for a reason a draw cannot know', () => {
    const players = [player('ana', 'A'), player('bo', 'A'), player('cy', 'B')];
    expect(crewsFor(players, 'ABC234')).toEqual({ ana: 'A', bo: 'A', cy: 'B' });
  });

  it('stops drawing entirely the moment anybody is assigned', () => {
    // Half-drawn, half-chosen crews would shift under an instructor's hands as
    // they assigned them one at a time.
    const players = [player('ana', 'A'), player('bo'), player('cy')];
    expect(crewsFor(players, 'ABC234')).toEqual({ ana: 'A' });
  });

  it('gives an empty room no crews rather than throwing', () => {
    expect(crewsFor([], 'ABC234')).toEqual({});
  });
});

describe('the relay', () => {
  it('names the leg and counts down to the swap, from the round clock', () => {
    // From the round's own clock, so twenty laptops prompt on the same second.
    const duration = 4 * 60_000;
    const swap = 60_000;
    expect(relayLeg(duration, duration, swap)).toMatchObject({ leg: 1, swapInMs: 60_000 });
    expect(relayLeg(duration - 20_000, duration, swap)).toMatchObject({ leg: 1, swapInMs: 40_000 });
    expect(relayLeg(duration - 60_000, duration, swap)).toMatchObject({ leg: 2, swapInMs: 60_000 });
    expect(relayLeg(duration - 150_000, duration, swap)).toMatchObject({ leg: 3, swapInMs: 30_000 });
  });

  it('shortens the last leg rather than prompting a handover nobody can survive', () => {
    // Telling a pair to change hands with two seconds left is telling them to
    // lose the round.
    const leg = relayLeg(2_000, 4 * 60_000, 60_000);
    expect(leg?.swapInMs).toBe(2_000);
  });

  it('is absent when the round is not a relay or has closed', () => {
    expect(relayLeg(30_000, 60_000, 0)).toBeUndefined();
    expect(relayLeg(0, 60_000, 30_000)).toBeUndefined();
    expect(relayLeg(-1, 60_000, 30_000)).toBeUndefined();
  });
});

describe('the crew league', () => {
  const standing = (crew: 'A' | 'B' | 'C', total: number) => ({
    crew,
    total,
    members: 3,
    submitted: 3,
    scores: [total],
  });

  it('pays the podium and a point for turning up, like the individual table', () => {
    const league = recordCrewRound([], [standing('A', 90), standing('B', 70), standing('C', 40)]);
    expect(league.map((entry) => [entry.crew, entry.points])).toEqual([
      ['A', 5],
      ['B', 3],
      ['C', 2],
    ]);
  });

  it('lets consistency beat one big round', () => {
    // The story a league tells that a scoreboard cannot: a crew that never wins
    // a round can still win the session.
    let league = recordCrewRound([], [standing('A', 99), standing('B', 80)]);
    league = recordCrewRound(league, [standing('B', 80), standing('A', 10)]);
    league = recordCrewRound(league, [standing('B', 80), standing('A', 10)]);

    expect(league[0].crew).toBe('B');
    expect(league[0].points).toBe(13);
    expect(league[0].wins).toBe(2);
  });

  it('breaks a tie on wins, then on the letter', () => {
    const league = crewStandings([
      { crew: 'B', points: 8, rounds: 2, wins: 0 },
      { crew: 'A', points: 8, rounds: 2, wins: 1 },
      { crew: 'C', points: 8, rounds: 2, wins: 0 },
    ]);
    expect(league.map((entry) => entry.crew)).toEqual(['A', 'B', 'C']);
  });
});
