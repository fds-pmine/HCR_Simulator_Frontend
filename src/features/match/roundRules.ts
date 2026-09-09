import type { CrewScoring, RankBy, RoundFormat } from '../../types/match';

/**
 * Round lengths worth offering.
 *
 * The short two exist because a class that finished the whole curriculum in
 * under an hour does not need a longer round, it needs more rounds. A minute is
 * enough to write four servo blocks and not enough to polish them, which is the
 * point: eight blitz rounds produce eight winners, eight arguments and eight
 * fresh starts, where one five-minute round produces one of each.
 */
export const DURATIONS = [
  { label: '60 s', ms: 60_000 },
  { label: '90 s', ms: 90_000 },
  { label: '2 min', ms: 2 * 60_000 },
  { label: '3 min', ms: 3 * 60_000 },
  { label: '5 min', ms: 5 * 60_000 },
] as const;

/** The default, unchanged: long enough for a first round nobody has practised. */
export const DEFAULT_DURATION_MS = 3 * 60_000;

/** Rounds at or below this length get the faster resubmit interval. */
const BLITZ_MAX_MS = 90_000;

const STANDARD_RESUBMIT_MS = 2_000;
const BLITZ_RESUBMIT_MS = 1_000;

/**
 * Minimum gap between one player's submissions, which the server enforces.
 *
 * The cap exists to stop one player burning the replay capacity of the room,
 * not to slow anybody down, and two seconds of a sixty-second round is a
 * twelfth of the time available. Short rounds get half of it.
 */
export function resubmitIntervalFor(durationMs: number): number {
  return durationMs <= BLITZ_MAX_MS ? BLITZ_RESUBMIT_MS : STANDARD_RESUBMIT_MS;
}

/**
 * What the round is ranked on.
 *
 * `completion` is similarity to the target hairstyle — the plain game rule.
 * `final` folds in program length and running time, so it ranks the tidy
 * six-block haircut above the sprawling forty-block one that scores the same.
 * They reward genuinely different things, and which one is official is a
 * teaching decision, so the host makes it rather than the default.
 */
export const RANKINGS: readonly RankBy[] = ['completion', 'final'];

/**
 * How to say a round's length in the lobby.
 *
 * Minutes rounded from milliseconds reads "1 minutes" for a sixty-second round
 * and "2 minutes" for a ninety-second one, which is not a rounding error the
 * reader can see — it is simply the wrong length, stated confidently, on the
 * one screen that exists to state the rules.
 */
export function roundLengthUnits(durationMs: number): {
  value: number;
  unit: 'seconds' | 'minutes';
} {
  return durationMs < 2 * 60_000
    ? { value: Math.round(durationMs / 1_000), unit: 'seconds' }
    : { value: Math.round(durationMs / 60_000), unit: 'minutes' };
}

/** The formats a host can open a room in. */
export const FORMATS: readonly RoundFormat[] = ['solo', 'crews', 'coop'];

/** Crew scoring rules a crew round can use. */
export const CREW_SCORINGS: readonly CrewScoring[] = ['sum', 'weakestTwo'];

/** Bars a co-op round can be set to. Similarity, never the weighted score. */
export const COOP_TARGETS = [40, 60, 80] as const;

/** Swap intervals a relay round can prompt on, in milliseconds. */
export const RELAY_SWAPS = [30_000, 60_000, 90_000] as const;

/**
 * The default bar for a co-op round.
 *
 * Low enough that a room which has met the challenge once can clear it, because
 * a bar nobody clears twice stops being a goal and becomes a formality.
 */
export const DEFAULT_COOP_TARGET = 60;

/** Gaps between rounds an endless session can run on. */
export const AUTO_ADVANCE = [10_000, 20_000, 30_000] as const;
