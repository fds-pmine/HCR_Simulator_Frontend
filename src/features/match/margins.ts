import type { MatchResultRow, MatchResults } from '../../types/match';

/**
 * The distance between one standing and the one above it.
 *
 * A rank says where you came; a margin says what it cost you. "Second" is a
 * fact to accept and "0.4 behind Kite" is an argument to have, and the second
 * one is what a room says out loud. Both numbers are already on the row the
 * server ranked — nothing here re-scores anything.
 */
export interface Margin {
  /** Points behind the row above. Zero for the leader. */
  behind: number;
  /** Who is directly above, absent for the leader. */
  chasing?: string;
  /** Points ahead of the row below, absent for last place. */
  ahead?: number;
  /**
   * A gap small enough that it reads as a dead heat.
   *
   * Includes an exact tie, which is the purest case: the server still ordered
   * them — on efficiency, then duration, then arrival time — but the haircut
   * did not decide it, and printing two identical numbers with one above the
   * other says the opposite. Saying "photo finish" is the honest version.
   */
  photoFinish: boolean;
  /** Seconds before the deadline this attempt landed, when it can be known. */
  secondsToSpare?: number;
}

/** Under this, two scores are a dead heat rather than a ranking. */
export const PHOTO_FINISH = 0.5;

const scoreOf = (row: MatchResultRow, rankBy: MatchResults['rankBy']) =>
  rankBy === 'final' ? row.finalScore : row.completionScore;

/**
 * Margins for a whole scoreboard, in the order the rows were ranked.
 *
 * `closesAt` is the round's deadline in server time. It is optional because a
 * scoreboard can outlive the state that carried it, and a missing deadline
 * costs the "with 3 seconds to spare" line and nothing else.
 */
export function marginsFor(
  results: MatchResults,
  closesAt?: number,
): readonly Margin[] {
  return results.rows.map((row, index) => {
    const above = results.rows[index - 1];
    const below = results.rows[index + 1];
    const mine = scoreOf(row, results.rankBy);
    const scored = row.submissionId !== undefined;
    const behind = above ? Math.max(0, scoreOf(above, results.rankBy) - mine) : 0;

    const spare =
      closesAt !== undefined && row.serverReceivedAt !== undefined && scored
        ? (closesAt - row.serverReceivedAt) / 1_000
        : undefined;

    return {
      behind,
      ...(above ? { chasing: above.displayName } : {}),
      ...(below
        ? { ahead: Math.max(0, mine - scoreOf(below, results.rankBy)) }
        : {}),
      // A player with no attempt is not in a photo finish with anybody; they
      // are on zero, and so is everyone else who did not submit.
      photoFinish:
        scored &&
        above !== undefined &&
        above.submissionId !== undefined &&
        behind < PHOTO_FINISH,
      ...(spare !== undefined && spare >= 0 ? { secondsToSpare: spare } : {}),
    };
  });
}
