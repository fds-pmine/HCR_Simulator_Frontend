import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  validateCutterGridContinuousEdge,
} from '../../src/features/cutter-grid/continuousEdge';
import {
  enumerateCutterGridIkCandidates,
  normalizedJointDistance,
} from '../../src/features/cutter-grid/ik';
import {
  CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { cutterGridCoordToWorld } from '../../src/features/cutter-grid/grid';
import {
  findRobotHeadCollision,
  measureRobotHeadClearance,
} from '../../src/features/robot/headCollision';
import { computeRobotPose, createInitialJointAngles } from '../../src/features/robot/kinematics';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge, JointId } from '../../src/types/domain';

describe('Cutter Grid ladder domain — Phase 1', () => {
  let challenge: Challenge;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
  });

  it('retains deterministic, collision-free low-Wrist candidates at the former failure sample', () => {
    const baseOptions = {
      maxError: challenge.voxelConfig.size / 32,
      entryOptions: [{ id: 'low-wrist', jointAngles: CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED }],
      candidateNamespace: 'regression-layer-43',
    } as const;
    const first = enumerateCutterGridIkCandidates(
      challenge,
      CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE.targetWorld,
      { ...baseOptions, seedBudget: 96 },
    );
    const second = enumerateCutterGridIkCandidates(
      challenge,
      CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE.targetWorld,
      { ...baseOptions, seedBudget: 96 },
    );

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.some((candidate) => candidate.jointAngles.wrist < 90)).toBe(true);
    expect(first.some((candidate) => candidate.jointAngles.wrist > 110)).toBe(true);
    for (const candidate of first) {
      expect(candidate.error).toBeLessThanOrEqual(challenge.voxelConfig.size / 32);
      expect(candidate.minimumHeadClearance).toBeGreaterThan(0);
      expect(
        findRobotHeadCollision(
          computeRobotPose(challenge.robotConfig, candidate.jointAngles),
          challenge.voxelConfig,
          challenge.robotConfig.geometry,
        ),
      ).toBeUndefined();
    }
  }, 30_000);

  it('uses strict cumulative Halton prefixes and stable de-duplication', () => {
    const target = CUTTER_GRID_GLOBAL_IK_REGRESSION_FAILURE_SAMPLE.targetWorld;
    const options = {
      maxError: challenge.voxelConfig.size / 32,
      entryOptions: [{ id: 'low-wrist', jointAngles: CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED }],
      candidateNamespace: 'budget-prefix',
    } as const;
    const prefix24 = enumerateCutterGridIkCandidates(challenge, target, {
      ...options,
      seedBudget: 24,
    });
    const prefix96 = enumerateCutterGridIkCandidates(challenge, target, {
      ...options,
      seedBudget: 96,
    });
    const prefix384 = enumerateCutterGridIkCandidates(challenge, target, {
      ...options,
      seedBudget: 384,
    });

    expect(new Set(prefix24.map((candidate) => candidate.id)).size).toBe(prefix24.length);
    expect(prefix96.length).toBeGreaterThanOrEqual(prefix24.length);
    expect(prefix384.length).toBeGreaterThanOrEqual(prefix96.length);
    expect(prefix384).toHaveLength(128);
    for (const candidate of prefix24) {
      expect(prefix96.some((other) => other.id === candidate.id)).toBe(true);
    }
    for (const candidate of prefix96) {
      expect(prefix384.some((other) => other.id === candidate.id)).toBe(true);
    }
    for (let index = 0; index < prefix384.length; index += 1) {
      for (let other = index + 1; other < prefix384.length; other += 1) {
        expect(
          normalizedJointDistance(
            prefix384[index].jointAngles,
            prefix384[other].jointAngles,
            challenge.robotConfig.joints,
          ),
        ).toBeGreaterThan(0.01 - 1e-12);
      }
    }
  }, 60_000);

  it('shares the exact collision primitives with its signed clearance metric', () => {
    const initial = createInitialJointAngles(challenge.robotConfig);
    const initialPose = computeRobotPose(challenge.robotConfig, initial);
    expect(
      findRobotHeadCollision(initialPose, challenge.voxelConfig, challenge.robotConfig.geometry),
    ).toBeUndefined();
    expect(
      measureRobotHeadClearance(initialPose, challenge.voxelConfig, challenge.robotConfig.geometry),
    ).toBeGreaterThan(0);

    // Folded hard into the head: the servo offsets that came with the 90° Home
    // moved the old sample clear of it, and a sample that no longer collides
    // proves nothing about the two primitives agreeing.
    const colliding: Record<JointId, number> = {
      baseYaw: 30,
      shoulderRoll: -45,
      shoulder: 70,
      elbow: 162.5,
      wrist: 90,
    };
    const collidingPose = computeRobotPose(challenge.robotConfig, colliding);
    expect(
      findRobotHeadCollision(collidingPose, challenge.voxelConfig, challenge.robotConfig.geometry),
    ).toBeDefined();
    expect(
      measureRobotHeadClearance(collidingPose, challenge.voxelConfig, challenge.robotConfig.geometry),
    ).toBeLessThanOrEqual(0);
  });

  it('validates a real smooth edge but rejects an Hermite shortcut through the head', () => {
    const origin = cutterGridCoordToWorld([0, 0, 0], [0, -5, 8], challenge.voxelConfig);
    const target = cutterGridCoordToWorld([0, 1, 0], [0, -5, 8], challenge.voxelConfig);
    const startCandidates = enumerateCutterGridIkCandidates(challenge, origin, {
      maxError: challenge.voxelConfig.size / 32,
      entryOptions: [{ id: 'low-wrist', jointAngles: CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED }],
      seedBudget: 96,
    });
    const endCandidates = enumerateCutterGridIkCandidates(challenge, target, {
      maxError: challenge.voxelConfig.size / 32,
      previousLayer: startCandidates,
      entryOptions: [{ id: 'low-wrist', jointAngles: CUTTER_GRID_GLOBAL_IK_LOW_WRIST_SEED }],
      seedBudget: 96,
    });
    const safeStart = startCandidates.find((candidate) => candidate.jointAngles.wrist < 100);
    const safeEnd = endCandidates.find((candidate) => candidate.jointAngles.wrist < 100);
    expect(safeStart).toBeDefined();
    expect(safeEnd).toBeDefined();
    if (!safeStart || !safeEnd) return;

    expect(validateCutterGridContinuousEdge(challenge, {
      startAngles: safeStart.jointAngles,
      endAngles: safeEnd.jointAngles,
      lineStart: origin,
      lineEnd: target,
      startTangentZero: true,
      endTangentZero: true,
    })).toMatchObject({ valid: true });

    const unsafe = validateCutterGridContinuousEdge(challenge, {
      startAngles: safeStart.jointAngles,
      endAngles: { ...safeStart.jointAngles, wrist: 0 },
      lineStart: origin,
      lineEnd: target,
      startTangentZero: true,
      endTangentZero: true,
    });
    expect(unsafe.valid).toBe(false);
    if (!unsafe.valid) expect(['head-collision', 'path-deviation']).toContain(unsafe.reason);
  }, 60_000);
});
