import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/cutter-grid-motion-v3.json';

interface V3RegressionSummary {
  executedCommandCount: number;
  estimatedDurationMs: number;
  steps: Array<{ kind: string; sourceBlockId: string; durationMs: number }>;
  diagnostics: {
    cartesianLayerCount: number;
    validationSampleCount: number;
  };
}

interface V3MotionFixture {
  plannerVersion: string;
  input: { motionLimits: { requestedSpeedScale: number } };
  cases: { globalIkRegression: { expected: V3RegressionSummary } };
}

const v3Baseline = fixture as unknown as V3MotionFixture;

/**
 * Phase 1 keeps the old V3 shape measurable before V4 replaces it.  These
 * assertions deliberately describe the historical cost, not V4 acceptance.
 */
describe('Cutter Grid V4 Phase 1 historical V3 baseline', () => {
  const regression = v3Baseline.cases.globalIkRegression.expected;

  it('pins the serialized V3 regression planning and motion costs', () => {
    expect(v3Baseline.plannerVersion).toBe('cutter-grid-ladder-v3');
    expect(v3Baseline.input.motionLimits.requestedSpeedScale).toBe(1.25);
    expect(regression.executedCommandCount).toBe(11);
    expect(regression.steps).toHaveLength(11);
    expect(regression.diagnostics.cartesianLayerCount).toBe(44);
    // Re-measured on the 90° Home arm. The old digits (4286 samples, 6976ms,
    // 91–1318ms steps) described the pre-redesign geometry; what this test
    // keeps is V3's cost being pinned at all, not those particular numbers.
    expect(regression.diagnostics.validationSampleCount).toBe(3990);
    expect(regression.estimatedDurationMs).toBe(9144);
    expect(Math.min(...regression.steps.map((step) => step.durationMs))).toBe(113);
    expect(Math.max(...regression.steps.map((step) => step.durationMs))).toBe(2930);
    expect(new Set(regression.steps.map((step) => step.sourceBlockId))).toEqual(
      new Set(['regression-up', 'regression-left', 'regression-forward']),
    );
  });

  it.fails('records that V3 cannot meet the V4 three-action compactness target', () => {
    expect(regression.steps).toHaveLength(3);
  });

  it.todo('groups Move N into one V4 action while preserving its logical command cost');
  it.todo('emits one direct or at most two detour PTP primitives per visible Move');
  it.todo('certifies actual sweep contacts without serializing dense validation samples');
  it.todo('measures cold Worker P95 targets of 3s for Right 2 and 10s for the global IK regression');
});
