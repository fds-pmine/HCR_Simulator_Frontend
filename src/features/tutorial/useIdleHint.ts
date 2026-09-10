import { useEffect, useState } from 'react';

/**
 * Reveal something only after the learner has gone quiet for `delayMs`.
 *
 * This is an *inactivity* timer, not a dwell timer: it restarts on every
 * keypress and every pointer press, so it fires for somebody staring at the
 * screen and never for somebody dragging blocks around. That distinction is
 * the whole point — a lesson goal that states the answer is a nudge for a
 * learner who is stuck and a spoiler for one who is working.
 *
 * Pointer *movement* deliberately does not count. A hand resting on a trackpad
 * would otherwise hold the hint off forever, and moving a mouse is not
 * evidence that anybody is solving anything.
 *
 * Once revealed it stays revealed until `resetKey` changes — usually the
 * section index. Hiding it again the moment somebody typed would punish the
 * learner for acting on what they just read, and would flicker.
 */
export function useIdleHint({
  delayMs,
  resetKey,
  disabled = false,
}: {
  delayMs: number;
  /** Changing this hides the hint again and restarts the clock. */
  resetKey: unknown;
  /** When true, never reveal — the work is already done. */
  disabled?: boolean;
}): boolean {
  const [revealed, setRevealed] = useState(false);
  // Adjusting state during render rather than in an effect: React re-renders
  // immediately with the new value and never paints the stale one, so moving
  // to a new section cannot flash the previous section's answer.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setRevealed(false);
  }

  useEffect(() => {
    // `revealed` is a dependency so that revealing tears this down: the
    // listeners and the timer both stop mattering the moment the hint is out,
    // and there is nothing left running until the section changes.
    if (disabled || revealed) return;

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevealed(true), delayMs);
    };

    arm();
    window.addEventListener('keydown', arm, { passive: true });
    window.addEventListener('pointerdown', arm, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', arm);
      window.removeEventListener('pointerdown', arm);
    };
  }, [delayMs, disabled, resetKey, revealed]);

  return revealed;
}
