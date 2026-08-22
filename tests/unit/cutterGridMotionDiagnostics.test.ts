import { describe, expect, it } from 'vitest';
import {
  CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT,
  CutterGridMotionDiagnosticsRecorder,
} from '../../src/features/simulation/cutterGridMotionDiagnostics';

const zeroAngles = {
  baseYaw: 0,
  shoulderRoll: 0,
  shoulder: 0,
  elbow: 0,
  wrist: 0,
} as const;

describe('Cutter Grid V3 motion diagnostics', () => {
  it('keeps a bounded immutable trace while retaining aggregate long-frame evidence', () => {
    const recorder = new CutterGridMotionDiagnosticsRecorder();
    for (let frame = 0; frame <= CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT; frame += 1) {
      recorder.record({
        renderedAtMs: frame * 16,
        frameIntervalMs: frame === 1 ? 75 : 16,
        planTimeMs: frame * 16,
        phase: 'player',
        stepIndex: 0,
        entryOptionId: 'entry-0',
        plannedJointAngles: { ...zeroAngles, wrist: frame },
        plannedJointVelocitiesDegPerSec: zeroAngles,
        plannedJointAccelerationsDegPerSec2: zeroAngles,
        plannedJointJerksDegPerSec3: zeroAngles,
        actualJointAngles: { ...zeroAngles, wrist: frame + 0.25 },
        plannedEndEffector: [0, 0, 0],
        actualEndEffector: [0.1, 0, 0],
      });
    }

    const snapshot = recorder.snapshot();
    expect(snapshot.frameCount).toBe(CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT + 1);
    expect(snapshot.samples).toHaveLength(CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT);
    expect(snapshot.samples[0]?.renderedAtMs).toBe(16);
    expect(snapshot.longFrameCount).toBe(1);
    expect(snapshot.maximumFrameIntervalMs).toBe(75);
    expect(snapshot.maximumJointTrackingErrorDeg).toBe(0.25);
    expect(snapshot.maximumEndEffectorTrackingError).toBeCloseTo(0.1, 12);

    const copy = recorder.snapshot();
    const first = copy.samples[0];
    if (!first) throw new Error('Expected a bounded diagnostic sample.');
    (first.plannedJointAngles as Record<'wrist', number>).wrist = -999;
    expect(recorder.snapshot().samples[0]?.plannedJointAngles.wrist).not.toBe(-999);
  });
});
