import { beforeAll, describe, expect, it } from 'vitest';
import compactPtpFixture from '../fixtures/cutter-grid-compact-ptp-v4.json';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  certifyCutterGridSyncPtpAdaptiveV4,
  certifyCutterGridSyncPtpV4,
  createCutterGridSyncPtpPrimitiveV4,
  evaluateCutterGridSyncPtpV4,
} from '../../src/features/cutter-grid/compactPtpV4';
import { planCutterGridCompactPtpV4 } from '../../src/features/cutter-grid/compactPtpPlannerV4';
import { calculateScore } from '../../src/features/scoring/scoring';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD,
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { compileCutterGridExecutableProgramV2 } from '../../src/features/cutter-grid/programCompiler';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import {
  cutterGridProfileV4MatchesChallenge,
  upgradeCutterGridProfileV2ToV4,
} from '../../src/features/cutter-grid/profileV4';
import {
  CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
  type CutterGridProfileV4,
} from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid compact PTP V4 geometry', () => {
  let challenge: Challenge;
  let profile: CutterGridProfileV4;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const v2Profile = registeredCutterGridProfileV2(challenge);
    if (!v2Profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    profile = upgradeCutterGridProfileV2ToV4(challenge, v2Profile);
  }, 240_000);

  it('serializes a finite synchronized quintic PTP with exact endpoint states', () => {
    const entry = profile.entryOptions[0];
    const primitive = createCutterGridSyncPtpPrimitiveV4(
      challenge,
      entry.positioningPrimitive.start.jointAngles,
      entry.positioningPrimitive.end.jointAngles,
    );
    const start = evaluateCutterGridSyncPtpV4(challenge, primitive, 0);
    const end = evaluateCutterGridSyncPtpV4(challenge, primitive, primitive.durationMs);

    expect(primitive.durationMs).toBeGreaterThanOrEqual(160);
    expect(start.jointAngles).toEqual(primitive.start.jointAngles);
    expect(end.jointAngles).toEqual(primitive.end.jointAngles);
    expect(start.jointVelocitiesDegPerSec).toEqual(primitive.start.jointVelocitiesDegPerSec);
    expect(end.jointAccelerationsDegPerSec2).toEqual(primitive.end.jointAccelerationsDegPerSec2);
    expect(certifyCutterGridSyncPtpV4(challenge, primitive)).toMatchObject({ valid: true });
    const adaptive = certifyCutterGridSyncPtpAdaptiveV4(challenge, primitive);
    expect(adaptive).toMatchObject({ valid: true });
    if (adaptive.valid) expect(adaptive.samples.length).toBeGreaterThan(2);
  });

  it('rejects a head-colliding compact PTP before it can become a primitive', () => {
    const colliding = {
      baseYaw: 30,
      shoulderRoll: -45,
      shoulder: 90,
      elbow: 17.5,
      wrist: 0,
    };
    const primitive = createCutterGridSyncPtpPrimitiveV4(challenge, colliding, colliding);

    expect(certifyCutterGridSyncPtpV4(challenge, primitive)).toEqual({
      valid: false,
      reason: 'head-collision',
      sampleProgress: 0,
    });
  });

  it('derives a signed 256-node, eight-neighbor-or-fewer safe V4 roadmap', () => {
    expect(cutterGridProfileV4MatchesChallenge(profile, challenge)).toBe(true);
    expect(profile.entryOptions.length).toBeGreaterThanOrEqual(2);
    expect(profile.roadmap.nodes).toHaveLength(256);
    expect(profile.roadmap.edges).not.toHaveLength(0);
    for (const node of profile.roadmap.nodes) {
      expect(profile.roadmap.edges.filter((edge) => edge.fromNodeId === node.id).length).toBe(8);
    }
  });

  it('globally selects compact safe endpoint branches for Up 6, Left 2, Forward 3', () => {
    const compiled = compileCutterGridExecutableProgramV2(CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM);
    const first = planCutterGridCompactPtpV4(challenge, compiled, profile);
    const second = planCutterGridCompactPtpV4(challenge, compiled, profile);
    const moves = first.actions.filter((action) => action.type === 'move');

    expect(first.trajectorySignature).toBe(second.trajectorySignature);
    expect(first.endCoord).toEqual(CUTTER_GRID_GLOBAL_IK_REGRESSION_FINAL_COORD);
    expect(moves).toHaveLength(3);
    expect(moves.every((action) => action.primitives.length >= 1 && action.primitives.length <= 2)).toBe(true);
    expect(moves.reduce((sum, action) => sum + action.primitives.length, 0)).toBeLessThanOrEqual(6);
    expect(moves.at(-1)?.primitives.at(-1)?.end.jointAngles.wrist).toBeLessThan(100);
    expect(CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE).toBe(1);
    expect(first.diagnostics.requestedSpeedScale).toBe(CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE);
    expect(first.diagnostics.actualSpeedScale).toBeLessThanOrEqual(CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE);
    expect(first.diagnostics.maximumVelocityRatio).toBeLessThanOrEqual(1);
    expect(first.diagnostics.maximumAccelerationRatio).toBeLessThanOrEqual(1);
    expect(first.diagnostics.maximumJerkRatio).toBeLessThanOrEqual(1);
    expect(first.estimatedDurationMs).toBeLessThanOrEqual(5_000);
    expect(first.diagnostics.adaptiveValidationSampleCount).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toContain('"samples"');
    expect(moves.flatMap((action) => action.primitives).every((primitive) => primitive.durationMs >= 160)).toBe(true);
    for (const action of moves) {
      if (action.primitives.length !== 2) continue;
      const [firstPrimitive, secondPrimitive] = action.primitives;
      expect(firstPrimitive.end).toEqual(secondPrimitive.start);
    }
    expect([...challenge.initialHair.voxels]
      .filter((key) => !first.expectedResultVoxels.includes(key))
      .sort()).toEqual([
      '-1,0,4',
      '-1,1,4',
      '-1,2,4',
      '-2,0,4',
      '-2,1,4',
    ]);
    const contactVoxels = moves.flatMap((action) => action.contactEvents.flatMap((event) => event.voxelKeys)).sort();
    expect(contactVoxels).toEqual([
      '-1,0,4',
      '-1,1,4',
      '-1,2,4',
      '-2,0,4',
      '-2,1,4',
    ]);
    for (const action of moves) {
      expect(action.contactEvents.map((event) => event.timeMs)).toEqual(
        [...action.contactEvents.map((event) => event.timeMs)].sort((left, right) => left - right),
      );
    }
  }, 120_000);

  it('certifies the bundled V4 reference program against actual compact sweeps', () => {
    const compiled = compileCutterGridExecutableProgramV2(profile.referenceProgram);
    const plan = planCutterGridCompactPtpV4(challenge, compiled, profile);
    const score = calculateScore({
      initialVoxels: challenge.initialHair.voxels,
      targetVoxels: challenge.targetHair.voxels,
      resultVoxels: new Set(plan.expectedResultVoxels),
      programMetrics: {
        sourceBlockCount: profile.referenceProgram.sourceBlockCount,
        executedCommandCount: plan.executedCommandCount,
        estimatedDurationMs: plan.estimatedDurationMs,
      },
      scoring: challenge.scoring,
    });

    expect(score.completionScore).toBe(100);
    expect(plan.estimatedDurationMs).toBeLessThanOrEqual(5_000);
    expect([...challenge.initialHair.voxels]
      .filter((key) => !plan.expectedResultVoxels.includes(key))
      .sort()).toEqual(
      [...challenge.initialHair.voxels]
        .filter((key) => !challenge.targetHair.voxels.has(key))
        .sort(),
    );
    expect({
      plannerVersion: plan.plannerVersion,
      trajectorySignature: plan.trajectorySignature,
      entryOptionId: plan.positioning.entryOptionId,
      executedCommandCount: plan.executedCommandCount,
      estimatedDurationMs: plan.estimatedDurationMs,
      movePrimitiveCounts: plan.actions
        .filter((action) => action.type === 'move')
        .map((action) => action.primitives.length),
      cutVoxels: [...challenge.initialHair.voxels]
        .filter((key) => !plan.expectedResultVoxels.includes(key))
        .sort(),
      resultVoxelCount: plan.expectedResultVoxels.length,
      maximumVelocityRatio: plan.diagnostics.maximumVelocityRatio,
      maximumAccelerationRatio: plan.diagnostics.maximumAccelerationRatio,
      maximumJerkRatio: plan.diagnostics.maximumJerkRatio,
      adaptiveValidationSampleCount: plan.diagnostics.adaptiveValidationSampleCount,
    }).toEqual(compactPtpFixture);
  }, 120_000);
});
