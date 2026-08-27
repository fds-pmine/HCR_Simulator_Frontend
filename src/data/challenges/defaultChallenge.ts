import { generateDefaultHairstyles } from '../../features/voxel/hairGenerator';
import type { ChallengeDefinition } from '../../types/domain';
import { starterWorkspaceState } from './starterWorkspace';

const { initialHair, targetHair } = generateDefaultHairstyles();

export const DEFAULT_CHALLENGE_ID = 'neat-short-cap';

export const defaultChallengeDefinition: ChallengeDefinition = {
  id: DEFAULT_CHALLENGE_ID,
  name: 'Neat Short Haircut',
  description:
    // Says what to do *and* how to start. The old wording promised a
    // "symmetric neat crop", which the arm cannot cut, and offered no way in —
    // so the honest reading of a low score was "this is broken", not "try
    // something else".
    'Eleven voxels on the crown have to come off, and nothing else. Every ' +
    'hardware motor starts at 90°. Sweep X · Base Yaw from 90° to 150° while ' +
    'leaving Y, Z, B, and E at Home. Finish the Lessons if you want the motion ' +
    'broken down step by step.',
  robotConfig: {
    joints: [
      // Angles are servo degrees — what the arm's servo is commanded to, and
      // what `hcr-fw` reports back. See `features/robot/servoMapping.ts`.
      {
        id: 'baseYaw',
        name: 'Base Yaw',
        axis: 'y',
        // 底座 X. The 90° Home pose faces safely along the left side of the head.
        minAngleDeg: 30,
        maxAngleDeg: 150,
        initialAngleDeg: 90,
        speedDegPerSec: 60,
        servo: { axis: 'X', centerDeg: 90, direction: 1, offsetDeg: -45 },
      },
      {
        id: 'shoulderRoll',
        name: 'Shoulder Roll',
        axis: 'x',
        // Simulation-only: the arm has five servos and none of them rolls the
        // shoulder. No mapping, so these stay geometric. `T` (GPIO 12) is free
        // on the legacy board if this ever gets a real axis.
        minAngleDeg: -45,
        maxAngleDeg: 45,
        initialAngleDeg: 0,
        speedDegPerSec: 45,
      },
      {
        id: 'shoulder',
        name: 'Shoulder',
        axis: 'z',
        // 前后 Y. Home holds the upper arm at its certified cutting height.
        minAngleDeg: 30,
        maxAngleDeg: 150,
        initialAngleDeg: 90,
        speedDegPerSec: 45,
        servo: { axis: 'Y', centerDeg: 90, direction: 1, offsetDeg: 70 },
      },
      {
        id: 'elbow',
        name: 'Elbow',
        axis: 'z',
        // 上下 Z. Home opens the elbow clear of the head.
        minAngleDeg: 17.5,
        maxAngleDeg: 162.5,
        initialAngleDeg: 90,
        speedDegPerSec: 60,
        servo: { axis: 'Z', centerDeg: 90, direction: 1, offsetDeg: 10 },
      },
      {
        id: 'wrist',
        name: 'Wrist',
        axis: 'z',
        // 平衡 B. Geometric −90…90 — the full servo throw. The simulator used
        // to allow ±100°, which needs 200° of travel from a 180° servo, so the
        // arm would have silently disagreed with the screen at the extremes.
        minAngleDeg: 0,
        maxAngleDeg: 180,
        initialAngleDeg: 90,
        speedDegPerSec: 75,
        servo: { axis: 'B', centerDeg: 90, direction: 1, offsetDeg: -80 },
      },
    ],
    geometry: {
      basePosition: [0, 0, 0],
      shoulderHeight: 0.4,
      upperArmLength: 1.05,
      forearmLength: 0.9,
      toolLength: 0.35,
      toolRadius: 0.12,
      collision: {
        linkRadius: 0.075,
        jointRadius: 0.18,
        toolShaftRadius: 0.075,
        headClearance: 0.02,
      },
    },
  },
  voxelConfig: {
    origin: [1.35, 1.5, 0],
    size: 0.16,
    headCenter: [1.35, 1.42, 0],
    headScale: [0.68, 0.86, 0.68],
  },
  initialHair,
  targetHair,
  allowedBlocks: ['set-joint-angle', 'wait', 'repeat'],
  starterWorkspace: starterWorkspaceState,
  scoring: {
    weights: {
      completion: 0.6,
      efficiency: 0.25,
      time: 0.15,
    },
    referenceProgramCost: 1.25,
    referenceTimeMs: 1_000,
    commandWeight: 0.25,
  },
};
