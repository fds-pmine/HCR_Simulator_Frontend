/**
 * Generate the frontend-owned V3 conformance bundle for the future Rust
 * planner.  This intentionally writes only under tests/fixtures: Rust can
 * consume a copy later, but backend migration is not part of this phase.
 *
 *   npm run cutter-grid:motion-v3-fixture
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../src/data/challenges/defaultChallenge';
import { cutterGridTrajectoryConformanceSummaryV3 } from '../src/features/cutter-grid/conformanceV3';
import { expandCutterGridProgram } from '../src/features/cutter-grid/programCompiler';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
} from '../src/features/cutter-grid/ladderDiagnostics';
import { planCutterGridLadderTrajectory } from '../src/features/cutter-grid/ladderPlanner';
import { CutterGridMotionV3Error, retimeCutterGridTrajectoryV3 } from '../src/features/cutter-grid/motionV3';
import { registeredCutterGridProfileV2 } from '../src/features/cutter-grid/profileRegistry';
import { frontendTrialMotionLimitsV3 } from '../src/features/cutter-grid/profileV3';
import {
  CUTTER_GRID_LADDER_PLANNER_VERSION,
  type CutterGridMotionLimitsV3,
  type CutterGridProgramV1,
} from '../src/features/cutter-grid/types';
import { normalizeChallenge } from '../src/services/normalizeChallenge';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../tests/fixtures/cutter-grid-motion-v3.json');

it('generates the frontend Cutter Grid V3 conformance bundle', () => {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const profile = registeredCutterGridProfileV2(challenge);
  expect(profile, 'the bundled V2 profile must match the shipped challenge').toBeDefined();
  if (!profile) return;
  const motionLimits = frontendTrialMotionLimitsV3(challenge);

  const referenceProgram: CutterGridProgramV1 = {
    ...profile.referenceProgram,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
  };
  const referenceCompiled = {
    program: referenceProgram,
    runtimeActions: expandCutterGridProgram(referenceProgram),
    executedCommandCount: expandCutterGridProgram(referenceProgram).length,
  };
  const referenceV2 = planCutterGridLadderTrajectory(challenge, referenceCompiled, profile);
  const reference = retimeCutterGridTrajectoryV3(challenge, referenceV2, motionLimits);

  const regressionProgram: CutterGridProgramV1 = {
    ...CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
  };
  const regressionCompiled = {
    program: regressionProgram,
    runtimeActions: regressionProgramRuntimeActions(),
    executedCommandCount: regressionProgramRuntimeActions().length,
  };
  const regressionV2 = planCutterGridLadderTrajectory(challenge, regressionCompiled, profile);
  const regression = retimeCutterGridTrajectoryV3(challenge, regressionV2, motionLimits);

  let missingLimitsError: Pick<CutterGridMotionV3Error, 'code' | 'message' | 'details'> | undefined;
  try {
    retimeCutterGridTrajectoryV3(challenge, regressionV2, {
      requestedSpeedScale: motionLimits.requestedSpeedScale,
      joints: {},
    } as CutterGridMotionLimitsV3);
  } catch (error) {
    if (error instanceof CutterGridMotionV3Error) {
      missingLimitsError = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
    } else {
      throw error;
    }
  }
  expect(missingLimitsError).toBeDefined();

  const fixture = {
    schemaVersion: 1,
    plannerVersion: 'cutter-grid-ladder-v3',
    description: 'Frontend V3 conformance bundle. profileV2Fixture is part of this bundle; Rust must reproduce each full plan from those inputs, then match the signatures and atomic checkpoints below.',
    input: {
      challengeDefinition: defaultChallengeDefinition,
      profileV2Fixture: {
        path: 'cutter-grid-profile-v2.json',
        challengeSignature: profile.challengeSignature,
        referenceTrajectorySignature: profile.referenceTrajectorySignature,
      },
      motionLimits,
    },
    cases: {
      reference: {
        program: referenceProgram,
        expected: cutterGridTrajectoryConformanceSummaryV3(reference),
      },
      globalIkRegression: {
        program: regressionProgram,
        expected: cutterGridTrajectoryConformanceSummaryV3(regression),
      },
      missingMotionLimit: {
        program: regressionProgram,
        motionLimits: {
          requestedSpeedScale: motionLimits.requestedSpeedScale,
          joints: {},
        },
        expectedError: missingLimitsError,
      },
    },
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(fixture)}\n`);
  process.stdout.write(
    `Cutter Grid V3 fixture: ${reference.steps.length} reference actions, ` +
      `${regression.steps.length} regression actions\n`,
  );
}, 300_000);
