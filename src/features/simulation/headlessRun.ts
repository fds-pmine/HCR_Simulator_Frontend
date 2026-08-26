import type { CompiledProgram } from '../blockly/programTypes';
import type {
  CutterTrajectoryPlanV1,
  CutterTrajectoryPlanV2,
  CutterTrajectoryPlanV3,
  CutterTrajectoryPlanV4,
} from '../cutter-grid/types';
import type { ScoreResult } from '../../types/domain';
import type { SimulationEngine } from './SimulationEngine';

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
 * 60-second program still costs tens of seconds even at the accelerated
 * playback rate. In a wall-clock round that turns iteration speed into a
 * hardware advantage, which `06-MULTIPLAYER.md` §4 identifies as the real lag
 * disadvantage and this as the fix: the same engine, the same commands, the
 * same score, in a few milliseconds. (Playback speed itself no longer varies
 * with frame rate — `playbackFrameStepsMs` sub-steps a slow frame instead of
 * dropping the time it owes.)
 *
 * The loop is synchronous, so `useFrame` cannot interleave with it. If the
 * budget runs out first the run is simply left where it stands — the animated
 * ticker picks it up from there, which is the least surprising outcome.
 */
export async function runHeadless(
  engine: SimulationEngine,
  compiled: CompiledProgram,
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

export async function runCutterGridHeadless(
  engine: SimulationEngine,
  plan: CutterTrajectoryPlanV1 | CutterTrajectoryPlanV2 | CutterTrajectoryPlanV3 | CutterTrajectoryPlanV4,
  sourceBlockCount: number,
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<ScoreResult | undefined> {
  engine.runCutterGrid(plan, sourceBlockCount);
  const startedAt = performance.now();
  while (['positioning', 'running'].includes(engine.getSnapshot().status)) {
    engine.tick(HEADLESS_TICK_MS);
    if (performance.now() - startedAt > budgetMs) break;
  }
  return engine.waitForScore();
}
