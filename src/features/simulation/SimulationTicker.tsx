import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from './SimulationEngine';
import { playbackFrameStepsMs } from './frameTiming';

export function SimulationTicker({
  engine,
}: {
  engine: SimulationEngine;
}) {
  useFrame((_, deltaSeconds) => {
    // A slow frame owes several ticks. `tick` is a no-op once the run leaves
    // `running`/`positioning`, so a pause or completion mid-frame simply ends
    // the catch-up rather than overshooting past it.
    for (const stepMs of playbackFrameStepsMs(deltaSeconds)) {
      engine.tick(stepMs);
    }
  });

  return null;
}
