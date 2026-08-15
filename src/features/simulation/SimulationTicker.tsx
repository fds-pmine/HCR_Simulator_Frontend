import { useFrame } from '@react-three/fiber';
import type { SimulationEngine } from './SimulationEngine';
import { playbackFrameDeltaMs } from './frameTiming';

export function SimulationTicker({
  engine,
}: {
  engine: SimulationEngine;
}) {
  useFrame((_, deltaSeconds) => {
    engine.tick(playbackFrameDeltaMs(deltaSeconds));
  });

  return null;
}
