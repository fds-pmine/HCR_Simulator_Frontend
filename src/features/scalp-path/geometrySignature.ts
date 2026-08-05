import type { Challenge } from '../../types/domain';

/**
 * A motion profile is calibrated for geometry, not for one hairstyle or one
 * starting pose. Including either would prevent the same safe profile from
 * serving generated challenges that use the shipped robot.
 */
export function scalpGeometrySignature(
  challenge: Pick<Challenge, 'robotConfig' | 'voxelConfig'>,
): string {
  const { joints, geometry } = challenge.robotConfig;
  return fnv1a64(
    JSON.stringify({
      joints: joints.map((joint) => ({
        id: joint.id,
        axis: joint.axis,
        minAngleDeg: joint.minAngleDeg,
        maxAngleDeg: joint.maxAngleDeg,
        speedDegPerSec: joint.speedDegPerSec,
      })),
      geometry,
      voxelConfig: challenge.voxelConfig,
    }),
  );
}

function fnv1a64(input: string): string {
  const prime = 1_099_511_628_211n;
  const mask = (1n << 64n) - 1n;
  let value = 14_695_981_039_346_656_037n;
  for (let index = 0; index < input.length; index += 1) {
    value = ((value ^ BigInt(input.charCodeAt(index))) * prime) & mask;
  }
  return value.toString(16).padStart(16, '0');
}
