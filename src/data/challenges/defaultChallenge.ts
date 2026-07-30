import { generateDefaultHairstyles } from '../../features/voxel/hairGenerator';
import type { ChallengeDefinition } from '../../types/domain';
import { starterWorkspaceState } from './starterWorkspace';

const { initialHair, targetHair } = generateDefaultHairstyles();

export const DEFAULT_CHALLENGE_ID = 'neat-short-cap';

export const defaultChallengeDefinition: ChallengeDefinition = {
  id: DEFAULT_CHALLENGE_ID,
  name: 'Neat Short Haircut',
  description:
    'Use the five-joint robot arm to safely remove the thick cap hairstyle’s outer voxels, avoid contact between the mechanism and the head, and preserve as much of the symmetric neat crop target as possible.',
  robotConfig: {
    joints: [
      {
        id: 'baseYaw',
        name: 'Base Yaw',
        axis: 'y',
        minAngleDeg: -60,
        maxAngleDeg: 60,
        initialAngleDeg: -45,
        speedDegPerSec: 60,
      },
      {
        id: 'shoulderRoll',
        name: 'Shoulder Roll',
        axis: 'x',
        minAngleDeg: -45,
        maxAngleDeg: 45,
        initialAngleDeg: 0,
        speedDegPerSec: 45,
      },
      {
        id: 'shoulder',
        name: 'Shoulder',
        axis: 'z',
        minAngleDeg: -20,
        maxAngleDeg: 100,
        initialAngleDeg: 45,
        speedDegPerSec: 45,
      },
      {
        id: 'elbow',
        name: 'Elbow',
        axis: 'z',
        minAngleDeg: -135,
        maxAngleDeg: 10,
        initialAngleDeg: -80,
        speedDegPerSec: 60,
      },
      {
        id: 'wrist',
        name: 'Wrist',
        axis: 'z',
        minAngleDeg: -100,
        maxAngleDeg: 100,
        initialAngleDeg: 35,
        speedDegPerSec: 75,
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
    referenceProgramCost: 6.25,
    referenceTimeMs: 5_645,
    commandWeight: 0.25,
  },
};
