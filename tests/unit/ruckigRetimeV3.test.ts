import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
  regressionProgramRuntimeActions,
} from '../../src/features/cutter-grid/ladderDiagnostics';
import { planCutterGridLadderTrajectory } from '../../src/features/cutter-grid/ladderPlanner';
import { retimeCutterGridTrajectoryV3 } from '../../src/features/cutter-grid/motionV3';
import { registeredCutterGridProfileV2 } from '../../src/features/cutter-grid/profileRegistry';
import { frontendTrialMotionLimitsV3 } from '../../src/features/cutter-grid/profileV3';
import { RuckigLocalWasmError, type RuckigLocalStateToStateInput, type RuckigLocalTrajectoryResult } from '../../src/features/cutter-grid/ruckigLocalWasm';
import {
  CutterGridRuckigRetimingError,
  retimeCutterGridGeometryWithRuckigV3,
  type CutterGridRuckigMotionLimitsV3,
  type CutterGridRuckigSolverV3,
} from '../../src/features/cutter-grid/ruckigRetimeV3';
import { CutterGridRuckigSpatialValidationError } from '../../src/features/cutter-grid/ruckigSpatialValidationV3';
import { CUTTER_GRID_LADDER_PLANNER_VERSION, type CutterTrajectoryGeometryV3 } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid V3 local Ruckig segment retiming', () => {
  let challenge: Challenge;
  let geometry: CutterTrajectoryGeometryV3;
  let limits: CutterGridRuckigMotionLimitsV3;

  beforeAll(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(DEFAULT_CHALLENGE_ID);
    const profile = registeredCutterGridProfileV2(challenge);
    if (!profile) throw new Error('Expected a bundled Cutter Grid V2 Profile.');
    const v2Plan = planCutterGridLadderTrajectory(challenge, {
      program: {
        ...CUTTER_GRID_GLOBAL_IK_REGRESSION_PROGRAM,
        plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
      },
      runtimeActions: regressionProgramRuntimeActions(),
      executedCommandCount: regressionProgramRuntimeActions().length,
    }, profile);
    const v3Plan = retimeCutterGridTrajectoryV3(challenge, v2Plan, frontendTrialMotionLimitsV3(challenge));
    const firstMove = v3Plan.steps.find((step) => step.kind === 'move-cell');
    if (!firstMove?.motion.geometry) throw new Error('Expected V3 motion geometry.');
    geometry = firstMove.motion.geometry;
    const profileLimits = frontendTrialMotionLimitsV3(challenge);
    limits = Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
      const source = profileLimits.joints[joint.id];
      return [joint.id, {
        velocityDegPerSec: Math.min(source.maxVelocityDegPerSec, source.nominalVelocityDegPerSec * profileLimits.requestedSpeedScale),
        accelerationDegPerSec2: Math.min(source.maxAccelerationDegPerSec2, source.nominalAccelerationDegPerSec2 * profileLimits.requestedSpeedScale ** 2),
        jerkDegPerSec3: Math.min(source.maxJerkDegPerSec3, source.nominalJerkDegPerSec3 * profileLimits.requestedSpeedScale ** 3),
      }];
    })) as CutterGridRuckigMotionLimitsV3;
  }, 240_000);

  it('passes shared q/v/a nodes to deterministic local segments at 5ms-or-finer resolution', () => {
    const solver = new DeterministicRuckigSolver();
    const retimed = retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8);

    expect(retimed.algorithm).toBe('toppra-ruckig-local-v1');
    expect(retimed.segments).toHaveLength(8);
    expect(solver.inputs).toHaveLength(16);
    expect(retimed.maximumVelocityRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(retimed.maximumAccelerationRatio).toBeLessThanOrEqual(1 + 1e-7);
    expect(retimed.maximumJerkRatio).toBe(0);
    for (const [index, segment] of retimed.segments.entries()) {
      expect(segment.durationSeconds).toBeGreaterThanOrEqual(segment.requestedMinimumDurationSeconds);
      expect(segment.samples).toHaveLength(Math.ceil(segment.durationSeconds / 0.005) + 1);
      if (index > 0) {
        const previous = retimed.segments[index - 1];
        expectVectorsNear(segment.samples[0]?.position, previous.samples.at(-1)?.position);
        expectVectorsNear(segment.samples[0]?.velocity, previous.samples.at(-1)?.velocity);
        expectVectorsNear(segment.samples[0]?.acceleration, previous.samples.at(-1)?.acceleration);
      }
    }
  }, 60_000);

  it('retries the same shared boundary with the deterministic 1.1x minimum duration', () => {
    const solver = new DeterministicRuckigSolver(1, -1);
    retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8);

    expect(solver.inputs).toHaveLength(17);
    const firstMinimum = solver.inputs[0]?.minimumDurationSeconds;
    const secondMinimum = solver.inputs[1]?.minimumDurationSeconds;
    expect(firstMinimum).toBeGreaterThan(0);
    expect(secondMinimum).toBeCloseTo((firstMinimum ?? 0) * 1.1, 12);
  }, 60_000);

  it('fails closed without duration retries for a Ruckig-invalid shared boundary', () => {
    const solver = new DeterministicRuckigSolver(1, -100);

    expect(() => retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8)).toThrow(
      CutterGridRuckigRetimingError,
    );
    expect(solver.inputs).toHaveLength(1);
  }, 60_000);

  it('does not retry after the caller rejects a spatially invalid local segment', () => {
    const solver = new DeterministicRuckigSolver();

    try {
      retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8, {
        validateSegment: () => {
          throw new CutterGridRuckigSpatialValidationError(
            'cartesian-pipe',
            'Synthetic local Ruckig pipe violation.',
            {},
          );
        },
      });
      throw new Error('Expected spatial validation to fail closed.');
    } catch (error) {
      expect(error).toBeInstanceOf(CutterGridRuckigRetimingError);
      expect((error as CutterGridRuckigRetimingError).code).toBe('trajectory-smoothing-path-deviation');
    }
    // Probe plus the immutable 5ms sample request; no duration-extension retry.
    expect(solver.inputs).toHaveLength(2);
  }, 60_000);

  it('densifies the same local Ruckig segment before treating sparse samples as a path failure', () => {
    const solver = new DeterministicRuckigSolver();
    let rejectedSparseSampleSet = false;
    const acceptedSampleCounts: number[] = [];
    const retimed = retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8, {
      validateSegment: ({ samples }) => {
        if (!rejectedSparseSampleSet) {
          rejectedSparseSampleSet = true;
          throw new CutterGridRuckigSpatialValidationError(
            'sample-resolution',
            'Synthetic sparse Ruckig output.',
            {},
          );
        }
        acceptedSampleCounts.push(samples.length);
      },
    });

    expect(rejectedSparseSampleSet).toBe(true);
    expect(acceptedSampleCounts[0]).toBeGreaterThan(2);
    expect(retimed.segments).toHaveLength(8);
    // First segment uses probe + 5ms sample stream + denser stream; every
    // remaining segment has exactly probe + 5ms stream.
    expect(solver.inputs).toHaveLength(17);
  }, 60_000);

  it('fails closed when aggregate Move contact validation rejects otherwise valid segments', () => {
    const solver = new DeterministicRuckigSolver();

    try {
      retimeCutterGridGeometryWithRuckigV3(challenge, geometry, limits, solver, 8, {
        finalizeSpatialValidation: () => {
          throw new CutterGridRuckigSpatialValidationError(
            'unexpected-hair-contact',
            'Synthetic aggregate contact mismatch.',
            {},
          );
        },
      });
      throw new Error('Expected aggregate spatial validation to fail closed.');
    } catch (error) {
      expect(error).toBeInstanceOf(CutterGridRuckigRetimingError);
      expect((error as CutterGridRuckigRetimingError).code).toBe('trajectory-smoothing-path-deviation');
    }
    expect(solver.inputs).toHaveLength(16);
  }, 60_000);
});

class DeterministicRuckigSolver implements CutterGridRuckigSolverV3 {
  readonly inputs: RuckigLocalStateToStateInput[] = [];

  constructor(
    private failuresRemaining = 0,
    private readonly failureCode = -1,
  ) {}

  sample(input: RuckigLocalStateToStateInput): RuckigLocalTrajectoryResult {
    this.inputs.push(structuredClone(input));
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new RuckigLocalWasmError('Synthetic local Ruckig failure.', this.failureCode);
    }
    const durationSeconds = input.minimumDurationSeconds ?? 0;
    return {
      resultCode: 0,
      durationSeconds,
      samples: Array.from({ length: input.sampleCount }, (_, sampleIndex) => {
        const progress = sampleIndex / (input.sampleCount - 1);
        return {
          position: interpolate(input.current.position, input.target.position, progress),
          velocity: interpolate(input.current.velocity, input.target.velocity, progress),
          acceleration: interpolate(input.current.acceleration, input.target.acceleration, progress),
          jerk: [0, 0, 0, 0, 0] as const,
        };
      }),
    };
  }
}

function interpolate(
  start: readonly number[],
  end: readonly number[],
  progress: number,
): [number, number, number, number, number] {
  return start.map((value, index) => value + (end[index] - value) * progress) as [
    number,
    number,
    number,
    number,
    number,
  ];
}

function expectVectorsNear(actual: readonly number[] | undefined, expected: readonly number[] | undefined): void {
  expect(actual).toHaveLength(5);
  expect(expected).toHaveLength(5);
  for (const [index, value] of (actual ?? []).entries()) {
    expect(value).toBeCloseTo(expected?.[index] ?? Number.NaN, 7);
  }
}
