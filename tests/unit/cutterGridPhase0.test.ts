import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/cutter-grid-geometric-audit.json';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_DIRECTION_DELTA,
  CUTTER_GRID_DIRECTIONS,
  compareOriginCandidates,
  computeCutterGridGeometricAudit,
  cutterGridChallengeSignature,
  cutterGridCoordToWorld,
  deriveCutterGridBounds,
  hairToLogicalCoord,
  logicalToHairCoord,
  nearestHairLatticeCoord,
} from '../../src/features/cutter-grid';
import { computeRobotPose, createInitialJointAngles } from '../../src/features/robot/kinematics';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import type { Challenge } from '../../src/types/domain';

const challenge = normalizeChallenge(defaultChallengeDefinition);

describe('Cutter Grid Phase 0 domain', () => {
  it('locks the six world-axis directions', () => {
    expect(CUTTER_GRID_DIRECTION_DELTA).toEqual({
      right: [1, 0, 0],
      left: [-1, 0, 0],
      up: [0, 1, 0],
      down: [0, -1, 0],
      forward: [0, 0, -1],
      backward: [0, 0, 1],
    });
    expect(CUTTER_GRID_DIRECTIONS).toEqual([
      'right',
      'left',
      'up',
      'down',
      'forward',
      'backward',
    ]);
  });

  it('derives the padded box and includes the snapped start candidate', () => {
    const pose = computeRobotPose(
      challenge.robotConfig,
      createInitialJointAngles(challenge.robotConfig),
    );
    const origin = nearestHairLatticeCoord(
      pose.endEffector,
      challenge.voxelConfig,
    );
    expect(origin).toEqual([0, -5, 8]);
    expect(deriveCutterGridBounds(challenge, origin)).toEqual({
      min: [-6, -5, -6],
      max: [6, 7, 8],
    });
  });

  it('round-trips logical, hair-lattice and world coordinates', () => {
    const origin = [0, -5, 8] as const;
    const logical = [-2, 9, -9] as const;
    const hair = logicalToHairCoord(logical, origin);
    expect(hair).toEqual([-2, 4, -1]);
    expect(hairToLogicalCoord(hair, origin)).toEqual(logical);
    expect(cutterGridCoordToWorld(logical, origin, challenge.voxelConfig)).toEqual([
      1.03,
      2.14,
      -0.16,
    ]);
  });

  it('uses distance then coordinate order for origin candidates', () => {
    const point = [1.35, 0.7, 1.28] as const;
    expect(
      compareOriginCandidates(
        point,
        [0, -5, 8],
        [1, -5, 8],
        challenge.voxelConfig,
      ),
    ).toBeLessThan(0);
    expect(
      compareOriginCandidates(
        point,
        [-1, -5, 8],
        [1, -5, 8],
        challenge.voxelConfig,
      ),
    ).toBeLessThan(0);
  });

  it('moves the complete signature for every certified input family', () => {
    const base = cutterGridChallengeSignature(challenge);
    const changed: Challenge[] = [
      {
        ...challenge,
        robotConfig: {
          ...challenge.robotConfig,
          joints: challenge.robotConfig.joints.map((joint, index) =>
            index === 0
              ? { ...joint, initialAngleDeg: joint.initialAngleDeg + 1 }
              : joint,
          ),
        },
      },
      {
        ...challenge,
        robotConfig: {
          ...challenge.robotConfig,
          geometry: {
            ...challenge.robotConfig.geometry,
            toolRadius: challenge.robotConfig.geometry.toolRadius + 0.01,
          },
        },
      },
      {
        ...challenge,
        voxelConfig: {
          ...challenge.voxelConfig,
          size: challenge.voxelConfig.size + 0.01,
        },
      },
      {
        ...challenge,
        targetHair: {
          ...challenge.targetHair,
          voxels: new Set(
            [...challenge.targetHair.voxels].slice(1),
          ),
        },
      },
    ];

    changed.forEach((candidate) =>
      expect(cutterGridChallengeSignature(candidate)).not.toBe(base),
    );
  });
});

describe('Cutter Grid geometric feasibility cache', () => {
  const cached = fixture as unknown as ReturnType<
    typeof computeCutterGridGeometricAudit
  >;

  it('is bound to the current default challenge', () => {
    expect(cached.version).toBe(1);
    expect(cached.challengeSignature).toBe(
      cutterGridChallengeSignature(challenge),
    );
    expect(cached).toEqual(computeCutterGridGeometricAudit(challenge));
  });

  it('passes only the geometry gate and leaves trajectory certification pending', () => {
    expect(cached.originCandidate.hairCoord).toEqual([0, -5, 8]);
    expect(cached.originCandidate.hairHits).toEqual([]);
    expect(cached.targetVoxelKeys).toHaveLength(12);
    expect(cached.uncoveredTargetVoxelKeys).toEqual([]);
    expect(cached.directionsWithoutSafeEdge).toEqual([]);
    expect(cached.safeCutEdgeCount).toBeGreaterThan(0);
    expect(cached.geometricGatePassed).toBe(true);
    expect(cached.trajectoryCertification).toBe('pending-planner');
  });
});
