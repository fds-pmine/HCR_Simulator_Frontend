import type { ScoreResult } from '../../types/domain';
import type { SimulationEngine } from './SimulationEngine';
import type { ExecutableProgram } from './executableProgram';

/**
 * Fixed step used when evaluating without rendering.
 *
 * A constant rather than a frame delta: the point of a headless run is that its
 * result does not depend on how fast the machine drawing it happens to be.
 */
export const HEADLESS_TICK_MS = 16;

/** Wall-clock guard, so a pathological program cannot freeze the tab. */
const DEFAULT_BUDGET_MS = 2_000;

/**
 * Evaluate a program as fast as the CPU allows, with no animation.
 *
 * `SimulationTicker` advances the engine off `useFrame`, so watching a
 * 60-second program takes 60 seconds — and on a stuttering machine, longer,
 * because `clampFrameDeltaMs` discards anything past 100 ms per frame. In a
 * wall-clock round that turns iteration speed into a hardware advantage, which
 * `06-MULTIPLAYER.md` §4 identifies as the real lag disadvantage and this as the
 * fix: the same engine, the same commands, the same score, in a few
 * milliseconds.
 *
 * The loop is synchronous, so `useFrame` cannot interleave with it. If the
 * budget runs out first the run is simply left where it stands — the animated
 * ticker picks it up from there, which is the least surprising outcome.
 */
export async function runHeadless(
  engine: SimulationEngine,
  compiled: ExecutableProgram,
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<ScoreResult | undefined> {
  engine.run(compiled);

  const startedAt = performance.now();
  while (engine.getSnapshot().status === 'running') {
    engine.tick(HEADLESS_TICK_MS);
    if (performance.now() - startedAt > budgetMs) {
      break;
    }
  }

  return engine.waitForScore();
}
