import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_ENTRY_CONFIG,
  planCertifiedCutterGridEntry,
  validateJointSpaceEntrySegment,
} from '../../src/features/cutter-grid/entryPlanning';
import { cutterGridCoordToWorld } from '../../src/features/cutter-grid/grid';
import { solveCutterGridIk } from '../../src/features/cutter-grid/ik';
import { createInitialJointAngles } from '../../src/features/robot/kinematics';
import { findSweptVoxelHits } from '../../src/features/voxel/contactDetection';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge, JointId } from '../../src/types/domain';

describe('Cutter Grid entry certification sampling', () => {
  let challenge: Challenge;
  let originAngles: Record<JointId, number>;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const origin = solveCutterGridIk(
      challenge,
      cutterGridCoordToWorld([0, 0, 0], [0, -5, 8], challenge.voxelConfig),
      createInitialJointAngles(challenge.robotConfig),
      { maxError: challenge.voxelConfig.size / 32 },
    );
    if (!origin) throw new Error('Expected the Cutter Grid origin to be reachable from Home.');
    originAngles = origin.jointAngles;
  });

  // The joint grid alone under-resolves the tool path once the arm is extended,
  // which used to refuse every direct entry from the 90° Home pose and push
  // Profile generation into the PRM for candidates it could reach directly.
  it('refines the sample grid until it resolves the certified tool spacing', () => {
    const initial = createInitialJointAngles(challenge.robotConfig);
    const validated = validateJointSpaceEntrySegment(challenge, initial, originAngles);

    expect(validated).toBeDefined();
    if (!validated) return;
    const maximumSampleDistance =
      challenge.voxelConfig.size / CUTTER_GRID_ENTRY_CONFIG.maxEndEffectorSampleDistanceDivisor;
    for (let index = 1; index < validated.waypoints.length; index += 1) {
      const previous = validated.waypoints[index - 1].endEffector;
      const current = validated.waypoints[index].endEffector;
      expect(Math.hypot(
        current[0] - previous[0],
        current[1] - previous[1],
        current[2] - previous[2],
      )).toBeLessThanOrEqual(maximumSampleDistance + 1e-9);
      expect(findSweptVoxelHits(
        previous,
        current,
        challenge.initialHair.voxels,
        challenge.voxelConfig,
        challenge.robotConfig.geometry.toolRadius,
      )).toEqual([]);
    }
    expect(validated.waypoints[0].jointAngles).toEqual(initial);
    expect(validated.waypoints.at(-1)?.jointAngles).toEqual(originAngles);
    expect(validated.minimumHeadClearance).toBeGreaterThan(0);
  });

  it('reaches the origin directly, without the PRM fallback', () => {
    const direct = planCertifiedCutterGridEntry(
      challenge,
      'entry-test',
      originAngles,
      { allowPrmFallback: false },
    );

    expect(direct).toBeDefined();
    expect(direct?.jointAngles).toEqual(originAngles);
    expect(direct?.positioningTrajectory.length).toBeGreaterThan(1);
  });
});
