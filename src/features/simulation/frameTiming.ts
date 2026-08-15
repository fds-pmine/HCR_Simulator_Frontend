const MAX_FRAME_DELTA_MS = 100;

/**
 * Visual playback only. Planning, scoring, and headless Test runs keep their
 * certified physical durations; this simply makes the on-screen simulation
 * advance through that timeline more quickly.
 */
export const SIMULATION_PLAYBACK_RATE = 2;

export function clampFrameDeltaMs(deltaSeconds: number): number {
  return Math.min(
    Math.max(deltaSeconds * 1_000, 0),
    MAX_FRAME_DELTA_MS,
  );
}

export function playbackFrameDeltaMs(deltaSeconds: number): number {
  return clampFrameDeltaMs(deltaSeconds * SIMULATION_PLAYBACK_RATE);
}
