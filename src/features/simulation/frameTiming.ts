/**
 * Largest slice of simulated time one `engine.tick` may advance.
 *
 * Collision and cut sampling happen per tick, so a single huge step would let
 * the cutter jump across voxels without cutting them and pass through the head
 * between samples. This bound is about integration resolution, not about how
 * fast playback runs — see `playbackFrameStepsMs` for that distinction.
 */
const MAX_FRAME_DELTA_MS = 100;

/**
 * Ceiling on how much simulated time a single rendered frame may catch up on.
 *
 * A frame that has been stalled for seconds — a backgrounded tab, a laptop
 * waking up — should not dump all of it into the engine at once, both because
 * the catch-up work is unbounded and because nobody wants to watch the arm
 * teleport. Time past this is dropped, which is the one case where playback
 * legitimately falls behind the wall clock.
 */
const MAX_CATCH_UP_MS = 1_000;

/**
 * Visual playback only. Planning, scoring, and headless Test runs keep their
 * certified physical durations; this simply makes the on-screen simulation
 * advance through that timeline more quickly.
 */
export const SIMULATION_PLAYBACK_RATE = 2;

/**
 * Split one rendered frame into the tick sizes the engine should be advanced by.
 *
 * Clamping a frame to `MAX_FRAME_DELTA_MS` and advancing once *discards* the
 * remainder, which quietly ties playback speed to frame rate: a frame carries
 * at most 100 ms, so below 20 fps the simulation runs at `fps × 100 ms` per
 * second instead of the intended rate, and keeps slowing as the machine does.
 * That is a fairness problem in a wall-clock round — `06-MULTIPLAYER.md` §4
 * calls hardware advantage the real lag disadvantage — and it is why a loaded
 * CI runner drawing through a software rasteriser used to miss step deadlines
 * that a developer's GPU met comfortably.
 *
 * Sub-stepping keeps both properties: no tick exceeds the sampling bound, and
 * a slow frame still hands over all the time it owes, so simulated time tracks
 * the wall clock down to roughly 1 fps.
 */
export function playbackFrameStepsMs(deltaSeconds: number): number[] {
  const total = Math.min(
    Math.max(deltaSeconds * 1_000 * SIMULATION_PLAYBACK_RATE, 0),
    MAX_CATCH_UP_MS,
  );

  // Counted rather than accumulated by subtraction, so the tail step cannot
  // pick up floating-point drift.
  const wholeSteps = Math.floor(total / MAX_FRAME_DELTA_MS);
  const remainder = total - wholeSteps * MAX_FRAME_DELTA_MS;

  const steps = new Array<number>(wholeSteps).fill(MAX_FRAME_DELTA_MS);
  if (remainder > 0) {
    steps.push(remainder);
  }
  return steps;
}
