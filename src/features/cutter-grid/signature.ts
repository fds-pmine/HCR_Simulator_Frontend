import type { Challenge } from '../../types/domain';
import { CUTTER_GRID_PLANNER_VERSION } from './types';

export const CUTTER_GRID_PROFILE_VERSION = 1;

export function cutterGridChallengeSignature(challenge: Challenge): string {
  const { joints, geometry } = challenge.robotConfig;
  return fnv1a64(
    JSON.stringify({
      profileVersion: CUTTER_GRID_PROFILE_VERSION,
      plannerVersion: CUTTER_GRID_PLANNER_VERSION,
      joints: joints.map((joint) => ({
        id: joint.id,
        axis: joint.axis,
        minAngleDeg: joint.minAngleDeg,
        maxAngleDeg: joint.maxAngleDeg,
        initialAngleDeg: joint.initialAngleDeg,
        speedDegPerSec: joint.speedDegPerSec,
        servo: joint.servo,
      })),
      geometry,
      voxelConfig: challenge.voxelConfig,
      initialHair: [...challenge.initialHair.voxels].sort(),
      targetHair: [...challenge.targetHair.voxels].sort(),
      cutterRadius: geometry.toolRadius,
    }),
  );
}

export function fnv1a64(input: string): string {
  const prime = 1_099_511_628_211n;
  const mask = (1n << 64n) - 1n;
  let value = 14_695_981_039_346_656_037n;
  for (let index = 0; index < input.length; index += 1) {
    value = ((value ^ BigInt(input.charCodeAt(index))) * prime) & mask;
  }
  return value.toString(16).padStart(16, '0');
}

