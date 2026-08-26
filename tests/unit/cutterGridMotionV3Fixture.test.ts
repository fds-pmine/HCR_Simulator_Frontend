import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../fixtures/cutter-grid-motion-v3.json';
import { expandCutterGridProgram } from '../../src/features/cutter-grid/programCompiler';
import {
  cutterGridTrajectoryConformanceSummaryV3,
  type CutterGridTrajectoryConformanceSummaryV3,
} from '../../src/features/cutter-grid/conformanceV3';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import { CutterGridMotionV3Error, retimeCutterGridTrajectoryV3 } from '../../src/features/cutter-grid/motionV3';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import type { CutterGridMotionLimitsV3, CutterGridProgramV1 } from '../../src/features/cutter-grid/types';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import type { Challenge, ChallengeDefinition } from '../../src/types/domain';

interface CutterGridMotionV3Fixture {
  schemaVersion: 1;
  plannerVersion: 'cutter-grid-ladder-v3';
  input: {
    challengeDefinition: ChallengeDefinition;
    profileV2Fixture: {
      path: string;
      challengeSignature: string;
      referenceTrajectorySignature: string;
    };
    motionLimits: CutterGridMotionLimitsV3;
  };
  cases: {
    reference: CutterGridMotionV3PlanCase;
    globalIkRegression: CutterGridMotionV3PlanCase;
    missingMotionLimit: {
      program: CutterGridProgramV1;
      motionLimits: CutterGridMotionLimitsV3;
      expectedError: {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
    };
  };
}

interface CutterGridMotionV3PlanCase {
  program: CutterGridProgramV1;
  expected: CutterGridTrajectoryConformanceSummaryV3;
}

const conformanceFixture = fixture as unknown as CutterGridMotionV3Fixture;

describe('Cutter Grid V3 frontend/Rust conformance fixture', () => {
  let challenge: Challenge;

  beforeAll(() => {
    challenge = normalizeChallenge(conformanceFixture.input.challengeDefinition);
  });

  it('reproduces both full-plan signatures and every atomic checkpoint summary', () => {
    expect(conformanceFixture.schemaVersion).toBe(1);
    expect(conformanceFixture.plannerVersion).toBe('cutter-grid-ladder-v3');
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected the V2 Profile referenced by the conformance fixture.');
    expect(conformanceFixture.input.profileV2Fixture).toEqual({
      path: 'cutter-grid-profile-v2.json',
      challengeSignature: profile.challengeSignature,
      referenceTrajectorySignature: profile.referenceTrajectorySignature,
    });

    for (const planCase of [
      conformanceFixture.cases.reference,
      conformanceFixture.cases.globalIkRegression,
    ]) {
      const runtimeActions = expandCutterGridProgram(planCase.program);
      const v2Plan = planCutterGridLadderTrajectory(challenge, {
        program: planCase.program,
        runtimeActions,
        executedCommandCount: runtimeActions.length,
      }, profile);
      const v3Plan = retimeCutterGridTrajectoryV3(
        challenge,
        v2Plan,
        conformanceFixture.input.motionLimits,
      );
      expect(cutterGridTrajectoryConformanceSummaryV3(v3Plan)).toEqual(planCase.expected);
    }
  }, 300_000);

  it('preserves the structured fail-closed missing-limit error', () => {
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected the V2 Profile referenced by the conformance fixture.');
    const program = conformanceFixture.cases.missingMotionLimit.program;
    const runtimeActions = expandCutterGridProgram(program);
    const v2Plan = planCutterGridLadderTrajectory(challenge, {
      program,
      runtimeActions,
      executedCommandCount: runtimeActions.length,
    }, profile);

    try {
      retimeCutterGridTrajectoryV3(
        challenge,
        v2Plan,
        conformanceFixture.cases.missingMotionLimit.motionLimits,
      );
      throw new Error('Expected missing V3 limits to fail closed.');
    } catch (error) {
      expect(error).toBeInstanceOf(CutterGridMotionV3Error);
      const motionError = error as CutterGridMotionV3Error;
      expect({
        code: motionError.code,
        message: motionError.message,
        details: motionError.details,
      }).toEqual(conformanceFixture.cases.missingMotionLimit.expectedError);
    }
  }, 300_000);
});
