import type { MatchResultRow } from '../../types/match';

/**
 * A co-op bar for the whole room, agreed before the round.
 *
 * The server scores each player against the same target independently and has
 * no notion of a joint objective, so this is not a different scoring rule — it
 * is one number read off the standings the server already produced. Every
 * individual row stays visible underneath it.
 *
 * What it changes is the incentive. In a ranked round the strongest programmer
 * spends the last minute polishing; when the room clears the bar together or
 * not at all, the same minute is spent explaining the cutting procedure to
 * whoever has not cleared it. That is the behaviour a lecture cannot force, and
 * it is the one this class needs.
 *
 * The bar is measured on similarity to the target, never on the weighted score:
 * "everyone got the haircut close enough" is a sentence a room can act on, and
 * "everyone's accuracy-efficiency-time blend cleared 60" is not.
 */
export interface ClassTargetResult {
  cleared: boolean;
  /** Lowest similarity in the room. A player who never submitted counts as zero. */
  lowest: number;
  /** How far the lowest player is from the bar; zero once it is cleared. */
  missingBy: number;
  submitted: number;
  players: number;
}

/**
 * Judge the room against the bar.
 *
 * A player who got no submission in counts as zero rather than being skipped:
 * a bar that ignores whoever ran out of time would be cleared by the room
 * abandoning its slowest member, which is the opposite of the point.
 */
export function classTargetResult(
  rows: readonly MatchResultRow[],
  target: number,
): ClassTargetResult {
  const scores = rows.map((row) =>
    row.submissionId === undefined ? 0 : row.completionScore,
  );
  const lowest = scores.length === 0 ? 0 : Math.min(...scores);

  return {
    cleared: scores.length > 0 && lowest >= target,
    lowest,
    missingBy: Math.max(0, target - lowest),
    submitted: rows.filter((row) => row.submissionId !== undefined).length,
    players: rows.length,
  };
}

/** Bars worth offering. Zero is off, and off is the default. */
export const CLASS_TARGETS = [0, 40, 60, 80] as const;
