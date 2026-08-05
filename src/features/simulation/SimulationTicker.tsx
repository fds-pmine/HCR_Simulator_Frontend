import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from './SimulationEngine';
import { clampFrameDeltaMs } from './frameTiming';

export function SimulationTicker({
  engine,
}: {
  engine: SimulationEngine;
}) {
  const accumulatedMs = useRef(0);

  useEffect(() => {
    accumulatedMs.current = 0;
  }, [engine]);

  useFrame((_, deltaSeconds) => {
    accumulatedMs.current += clampFrameDeltaMs(deltaSeconds);
    // Simulation is quantized in simulated time, not renderer time. This is
    // what keeps a voxel sweep, score and source-block highlight identical on
    // a fast monitor, a throttled tab and the fixed-step headless verifier.
    while (accumulatedMs.current >= 16) {
      engine.tick(16);
      accumulatedMs.current -= 16;
    }
  });

  return null;
}
