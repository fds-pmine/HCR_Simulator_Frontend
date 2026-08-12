import type { HairstyleDefinition, VoxelCoord } from '../../types/domain';
import { coordToKey } from './voxelKey';

const TARGET_INNER_BOUND = 0.68;
const INITIAL_OUTER_BOUND = 1.24;

export interface GeneratedHairstyles {
  initialHair: HairstyleDefinition;
  targetHair: HairstyleDefinition;
}

/**
 * The hair the challenge asks to be cut away.
 *
 * **Measured, not designed.** These are exactly the voxels the arm removes when
 * driven by the reference solution in `REFERENCE_SOLUTION`, so the challenge is
 * achievable at 100% by construction. `hairGenerator.test.ts` re-derives them
 * from the engine and fails if the two ever disagree.
 *
 * # Why it is measured
 *
 * The previous target was a hand-drawn band across the front of the head, and
 * the arm could not reach **any of it**: those voxels need `baseYaw` inside
 * 25.4°, and the elbow contacts the head at 30.4°. Of the 26 voxels it asked
 * for, 4 were reachable and no program could remove them without removing more
 * hair that should have stayed. The best score was 89.21 — which is what you get
 * by running nothing at all — and the shipped starter program scored 84.65,
 * *below* doing nothing, because the 11 voxels it removed were all hair meant to
 * stay and none of the hair meant to go.
 *
 * Across 5,880 programs the tool can ever touch only 50 of the 241 hair voxels,
 * and no single program removes more than 12. Anything a challenge asks for
 * outside that set is unwinnable, so the target is now derived from a program
 * that demonstrably works rather than drawn by eye.
 */
const TRIM_KEYS: ReadonlySet<string> = new Set([
  '-2,1,4',
  '-2,4,-1',
  '-2,4,-2',
  '-2,4,0',
  '-2,4,1',
  '-2,4,2',
  '-2,5,-1',
  '-2,5,0',
  '-2,5,1',
  '-3,4,-1',
  '-3,4,0',
  '-3,4,1',
]);

/**
 * The program the target was derived from — the challenge's existence proof.
 *
 * Kept beside the target so the two cannot drift apart silently, and so the
 * "how do I solve this?" question has an answer in the source rather than in
 * somebody's head.
 */
export const REFERENCE_SOLUTION: readonly {
  jointId: string;
  angleDeg: number;
}[] = [
  // Servo degrees; geometric equivalents in comments.
  { jointId: 'shoulder', angleDeg: 140 }, // 90
  { jointId: 'elbow', angleDeg: 112.5 }, // -40
  { jointId: 'wrist', angleDeg: 70 }, // -20
  { jointId: 'baseYaw', angleDeg: 145 }, // 55
  { jointId: 'baseYaw', angleDeg: 35 }, // -55
  { jointId: 'shoulder', angleDeg: 120 }, // 70
  { jointId: 'elbow', angleDeg: 152.5 }, // 0
  { jointId: 'baseYaw', angleDeg: 145 }, // 55
];

export function generateDefaultHairstyles(): GeneratedHairstyles {
  const initial = generateShell(TARGET_INNER_BOUND, INITIAL_OUTER_BOUND, -2);
  const target = initial.filter(
    (voxel) => !TRIM_KEYS.has(coordToKey(voxel)),
  );

  return {
    initialHair: {
      id: 'thick-cap',
      name: 'Thick Cap Initial Hairstyle',
      voxels: initial,
    },
    targetHair: {
      id: 'neat-short-cap',
      // Not "Symmetric" any more, and the name should not claim otherwise: the
      // trim is what the arm can actually reach, and the arm sweeps from one
      // side, so a mirror-symmetric cut is not something it can perform.
      name: 'Neat Crown Trim',
      voxels: target,
    },
  };
}

function generateShell(
  innerBound: number,
  outerBound: number,
  minimumY: number,
): VoxelCoord[] {
  const voxels: VoxelCoord[] = [];

  for (let x = -6; x <= 6; x += 1) {
    for (let y = minimumY; y <= 7; y += 1) {
      for (let z = -6; z <= 6; z += 1) {
        const normalized =
          (x * x) / (4.2 * 4.2) +
          (y * y) / (5.2 * 5.2) +
          (z * z) / (4.2 * 4.2);

        if (normalized >= innerBound && normalized <= outerBound) {
          voxels.push({ x, y, z });
        }
      }
    }
  }

  return voxels.sort(compareCoords);
}

function compareCoords(a: VoxelCoord, b: VoxelCoord): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

export function hasDuplicateVoxels(voxels: readonly VoxelCoord[]): boolean {
  return new Set(voxels.map(coordToKey)).size !== voxels.length;
}

export function isSymmetricAcrossZ(voxels: readonly VoxelCoord[]): boolean {
  const keys = new Set(voxels.map(coordToKey));
  return voxels.every((voxel) =>
    keys.has(coordToKey({ ...voxel, z: -voxel.z })),
  );
}
