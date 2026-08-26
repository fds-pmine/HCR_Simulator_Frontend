import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import type { SimulationEngine } from './SimulationEngine';
import { playbackFrameStepsMs } from './frameTiming';

export function SimulationTicker({
  engine,
}: {
  engine: SimulationEngine;
}) {
  useFrame((state, deltaSeconds) => {
    // Cutter Grid V3 is sampled from its frozen absolute timeline. It must
    // never inherit the legacy Servo visual multiplier or convert a dropped
    // frame into a different cutting path. Servo retains its fast preview
    // sub-stepping behaviour.
    if (engine.getSnapshot().cutterGrid) {
      engine.tickAt(state.clock.elapsedTime * 1_000);
      return;
    }
    for (const stepMs of playbackFrameStepsMs(deltaSeconds)) {
      engine.tick(stepMs);
    }
  });

  useEffect(() => {
    const handleVisibilityChange = () => engine.resetPlaybackClock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [engine]);

  return null;
}
