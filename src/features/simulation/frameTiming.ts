/** Largest legacy Servo integration slice; Cutter Grid V3 has its own clock. */
const MAX_FRAME_DELTA_MS = 100;

/** Servo-only visual catch-up bound; V3 resets its absolute-time anchor instead. */
const MAX_CATCH_UP_MS = 1_000;

/** Legacy Servo preview rate; never applied to Cutter Grid V3. */
export const SIMULATION_PLAYBACK_RATE = 2;

/**
 * Split a rendered Servo frame into bounded integration steps. It deliberately
 * remains separate from the Cutter Grid V3 absolute-time contract.
 */
export function playbackFrameStepsMs(deltaSeconds: number): number[] {
  const total = Math.min(
    Math.max(deltaSeconds * 1_000 * SIMULATION_PLAYBACK_RATE, 0),
    MAX_CATCH_UP_MS,
  );
  const wholeSteps = Math.floor(total / MAX_FRAME_DELTA_MS);
  const remainder = total - wholeSteps * MAX_FRAME_DELTA_MS;
  const steps = new Array<number>(wholeSteps).fill(MAX_FRAME_DELTA_MS);
  if (remainder > 0) steps.push(remainder);
  return steps;
}
