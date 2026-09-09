import type { MatchResults } from '../../types/match';
import type { CrewId, CrewTotal } from './crews';

/**
 * A season: several rounds played back to back, scored on a points table.
 *
 * A single round rewards one good haircut. A table rewards turning up and
 * improving, which is what a three-hour class needs — losing round two costs
 * two points, not the afternoon, so nobody stops trying at the half hour mark.
 *
 * Nothing here re-scores anything. Every round's standings still come from the
 * server, and a season entry is only an arithmetic sum over rows the server
 * ranked. Points, not raw scores: adding similarity totals would let one lucky
 * round decide a season, and would quietly punish the harder challenges.
 */
export interface SeasonEntry {
  playerId: string;
  displayName: string;
  points: number;
  /** Rounds this player was ranked in. */
  rounds: number;
  wins: number;
  /**
   * Consecutive rounds finishing on the podium, counting this one.
   *
   * A leaderboard tells one player they are winning. A streak tells the fourth
   * and fifth places whether they are on the way up, which is the difference
   * between five people still playing at round six and one.
   */
  podiumStreak: number;
  /** Whether this player's latest round beat their own previous best. */
  improvedThisRound: boolean;
  /**
   * Best single-round similarity to the target.
   *
   * Always similarity, never the weighted score, even in a round ranked by the
   * weighted one: a host who switches metric between rounds would otherwise be
   * comparing a player's best against a number measured differently, and every
   * such switch would hand out a personal best that was not one.
   */
  best: number;
}

export type Season = readonly SeasonEntry[];

/** Points for the podium, first place first. Everyone else scores {@link FINISH_POINT}. */
export const PODIUM_POINTS = [5, 3, 2] as const;

/** For submitting at all. A round you turned up to is worth more than one you skipped. */
export const FINISH_POINT = 1;

/**
 * For beating your own best.
 *
 * Awarded from a player's second round onwards — everybody's first score is a
 * personal best by definition, and a point every player always scores ranks
 * nobody.
 */
export const PERSONAL_BEST_POINT = 1;

/** Points for one row, before the personal-best bonus. */
export function pointsForRank(rank: number, submitted: boolean): number {
  if (!submitted) return 0;
  return PODIUM_POINTS[rank - 1] ?? FINISH_POINT;
}

/**
 * Fold one round's standings into the table.
 *
 * Keyed by `playerId`, which survives a rejoin: the room changes every round
 * but the identity in local storage does not, so a player keeps their row
 * across the whole session. The display name is taken from the latest round,
 * so renaming yourself mid-season moves your name rather than splitting you in
 * two.
 */
export function recordRound(season: Season, results: MatchResults): Season {
  const byId = new Map(season.map((entry) => [entry.playerId, entry]));

  for (const row of results.rows) {
    const submitted = row.submissionId !== undefined;
    const previous = byId.get(row.playerId);
    const beatenOwnBest =
      previous !== undefined && submitted && row.completionScore > previous.best;

    const onPodium = submitted && row.rank <= PODIUM_POINTS.length;

    byId.set(row.playerId, {
      playerId: row.playerId,
      displayName: row.displayName,
      points:
        (previous?.points ?? 0) +
        pointsForRank(row.rank, submitted) +
        (beatenOwnBest ? PERSONAL_BEST_POINT : 0),
      rounds: (previous?.rounds ?? 0) + 1,
      wins: (previous?.wins ?? 0) + (row.rank === 1 && submitted ? 1 : 0),
      podiumStreak: onPodium ? (previous?.podiumStreak ?? 0) + 1 : 0,
      improvedThisRound: beatenOwnBest,
      best: Math.max(previous?.best ?? 0, submitted ? row.completionScore : 0),
    });
  }

  return standings([...byId.values()]);
}

/**
 * The table, leader first.
 *
 * Ties break on wins, then on best single round, then on name so the order is
 * stable between renders rather than dependent on insertion.
 */
export function standings(season: Season): Season {
  return [...season].sort(
    (left, right) =>
      right.points - left.points ||
      right.wins - left.wins ||
      right.best - left.best ||
      left.displayName.localeCompare(right.displayName),
  );
}

/**
 * A crew's standing across the whole session.
 *
 * The individual table answers "who is best"; this one answers "which crew",
 * and over a run of rounds those are different questions. A crew that never
 * produces the top individual can still win the session by finishing second
 * every round, which is exactly the story a league table is for and exactly
 * the one a single scoreboard cannot tell.
 */
export interface CrewSeasonEntry {
  crew: CrewId;
  points: number;
  rounds: number;
  wins: number;
}

export type CrewSeason = readonly CrewSeasonEntry[];

/** Fold one round's crew standings into the league. */
export function recordCrewRound(
  season: CrewSeason,
  standings: readonly CrewTotal[],
): CrewSeason {
  const byCrew = new Map(season.map((entry) => [entry.crew, entry]));

  standings.forEach((standing, index) => {
    const previous = byCrew.get(standing.crew);
    byCrew.set(standing.crew, {
      crew: standing.crew,
      // The same shape as the individual table, so one explanation covers both.
      points: (previous?.points ?? 0) + (PODIUM_POINTS[index] ?? FINISH_POINT),
      rounds: (previous?.rounds ?? 0) + 1,
      wins: (previous?.wins ?? 0) + (index === 0 ? 1 : 0),
    });
  });

  return crewStandings([...byCrew.values()]);
}

/** The league, leader first. Ties break on wins, then on the letter. */
export function crewStandings(season: CrewSeason): CrewSeason {
  return [...season].sort(
    (left, right) =>
      right.points - left.points ||
      right.wins - left.wins ||
      left.crew.localeCompare(right.crew),
  );
}
