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

/** How often the countdown re-renders. Fine enough to animate the last seconds. */
const TICK_MS = 100;

export function countdownUrgency(remainingMs: number): CountdownUrgency {
  if (remainingMs <= 0) return 'closed';
  if (remainingMs <= CRITICAL_MS) return 'critical';
  if (remainingMs <= WARNING_MS) return 'warning';
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
