import { useEffect, useState } from 'react';

/**
 * The round clock, as the player sees it.
 *
 * Every value here is advisory. `06-MULTIPLAYER.md` §5: acceptance is decided
 * solely by server *receive* time, so a browser whose clock is wrong can be
 * surprised by a rejection but can never gain anything from the discrepancy.
 */
export type CountdownUrgency = 'calm' | 'warning' | 'critical' | 'closed';

/** Under a minute: worth noticing. */
export const WARNING_MS = 60_000;
/** The "closing" state the design calls for in the last ten seconds. */
export const CRITICAL_MS = 10_000;

/**
 * A ceiling on every threshold, as a share of the round.
 *
 * The absolute values were written for rounds of two to five minutes. Applied
 * unchanged to a sixty-second blitz round they are nonsense: the timer would be
 * amber from the first second and red for the last sixth, so "running out of
 * time" would be the round's only state and would mean nothing. A threshold
 * that is never more than a share of the whole round keeps each state rare
 * enough to still be a signal.
 */
const WARNING_SHARE = 1 / 3;
const ENDGAME_SHARE = 1 / 4;
const CRITICAL_SHARE = 1 / 6;

function thresholdFor(absoluteMs: number, share: number, durationMs: number): number {
  return durationMs > 0 ? Math.min(absoluteMs, durationMs * share) : absoluteMs;
}

/**
 * The last thirty seconds, when the round stops being work and becomes a
 * deadline.
 *
 * Separate from {@link CountdownUrgency} rather than another value in it: the
 * urgency states colour one widget, and this one changes the whole screen —
 * the stage, the submit button, and every roster chip belonging to somebody who
 * has not got an attempt in. Ten seconds is too late for that to be useful;
 * thirty is long enough for a person to actually press the button.
 */
export const ENDGAME_MS = 30_000;

/** Whether the round is in its closing stretch. A closed round is not. */
export function isEndgame(remainingMs: number, durationMs = 0): boolean {
  return (
    remainingMs > 0 &&
    remainingMs <= thresholdFor(ENDGAME_MS, ENDGAME_SHARE, durationMs)
  );
}

/**
 * The pause between the round opening and the editor appearing.
 *
 * Twenty laptops poll the room up to a poll interval apart, so without it the
 * round began at a different instant on every screen and the difference was
 * pure luck of when each client last asked. Counting down to a moment on the
 * *server's* clock removes that: everybody sees 3, 2, 1 and starts together,
 * whatever their poll happened to land on.
 *
 * It is a hold, not an extension: the deadline belongs to the server and a
 * client cannot move it, so online this is the first three seconds of the
 * round. The offline room, which owns its own clock, grants the three seconds
 * instead of charging the round for them.
 */
export const ROUND_COUNTDOWN_MS = 3_000;

/**
 * Whether the editor is still being held back, given the time left until GO.
 *
 * Bounded above as well as below. A browser whose clock is set days ahead
 * reports a huge remainder against a deadline it has not really got wrong, and
 * an unbounded test would hold that player out of a round everybody else is
 * already playing — the one failure mode worse than starting late.
 */
export function isCountingIn(msToGo: number): boolean {
  return msToGo > 0 && msToGo <= ROUND_COUNTDOWN_MS;
}

/** How often the countdown re-renders. Fine enough to animate the last seconds. */
const TICK_MS = 100;

export function countdownUrgency(
  remainingMs: number,
  durationMs = 0,
): CountdownUrgency {
  if (remainingMs <= 0) return 'closed';
  if (remainingMs <= thresholdFor(CRITICAL_MS, CRITICAL_SHARE, durationMs)) {
    return 'critical';
  }
  if (remainingMs <= thresholdFor(WARNING_MS, WARNING_SHARE, durationMs)) {
    return 'warning';
  }
  return 'calm';
}

/** `m:ss`, clamped at zero — a negative countdown reads as a bug, not as late. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Fraction of the round still to run, for a progress ring. */
export function remainingFraction(
  remainingMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, remainingMs / durationMs));
}

/**
 * Milliseconds left, on the server's clock.
 *
 * `offsetMs` is what {@link import('../../services/contracts').MatchProvider.syncClock}
 * measured; adding it to local time is what makes two players on differently-set
 * machines see the same number.
 */
export function useRemainingMs(
  closesAt: number | undefined,
  offsetMs: number,
): number {
  // The clock is the only thing held in state; what is left of the round is
  // derived from it. Storing the remainder instead would mean re-syncing it
  // every time `closesAt` or the offset changed, for no gain.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return closesAt === undefined ? 0 : closesAt - (now + offsetMs);
}

/**
 * Where a relay round is: which leg is being played, and how long is left of it.
 *
 * Derived from the round's own clock rather than from a timer started when the
 * component mounted, so twenty laptops prompt the swap on the same second even
 * though they polled up to 1.2 seconds apart. Nothing observes who is actually
 * typing — this is a prompt, and the honest word for it is a prompt.
 */
export interface RelayLeg {
  /** 1-based, so the first leg is "leg 1" and not "leg 0". */
  leg: number;
  /** Milliseconds until the machine should change hands. */
  swapInMs: number;
}

export function relayLeg(
  remainingMs: number,
  durationMs: number,
  swapMs: number,
): RelayLeg | undefined {
  if (swapMs <= 0 || durationMs <= 0 || remainingMs <= 0) return undefined;

  const elapsed = Math.max(0, durationMs - remainingMs);
  const intoLeg = elapsed % swapMs;
  return {
    leg: Math.floor(elapsed / swapMs) + 1,
    // The last leg is short rather than overrunning the deadline: a prompt to
    // hand over with two seconds left would be a prompt to lose the round.
    swapInMs: Math.min(swapMs - intoLeg, remainingMs),
  };
}
