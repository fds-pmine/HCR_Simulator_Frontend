import type { JointId, Vec3Tuple } from '../../types/domain';

/** A browser frame is diagnostically long once it exceeds three 60 Hz frames. */
export const CUTTER_GRID_LONG_FRAME_MS = 50;
export const CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT = 1_024;

export type CutterGridMotionPlaybackPhase = 'positioning' | 'player';

/**
 * One immutable V3 playback observation. The plan values are analytic values
 * sampled at the frozen plan time; actual values are what the controller was
 * asked to render in the same rAF callback.
 */
export interface CutterGridMotionFrameSample {
  renderedAtMs: number;
  frameIntervalMs: number;
  planTimeMs: number;
  phase: CutterGridMotionPlaybackPhase;
  stepIndex: number;
  sourceBlockId?: string;
  entryOptionId: string;
  plannedJointAngles: Readonly<Record<JointId, number>>;
  plannedJointVelocitiesDegPerSec: Readonly<Record<JointId, number>>;
  plannedJointAccelerationsDegPerSec2: Readonly<Record<JointId, number>>;
  plannedJointJerksDegPerSec3: Readonly<Record<JointId, number>>;
  actualJointAngles: Readonly<Record<JointId, number>>;
  plannedEndEffector: Vec3Tuple;
  actualEndEffector: Vec3Tuple;
  maximumJointTrackingErrorDeg: number;
  endEffectorTrackingError: number;
}

/** A compact value that may safely be included in the 10 Hz React snapshot. */
export interface CutterGridMotionDiagnosticsSummary {
  frameCount: number;
  longFrameCount: number;
  maximumFrameIntervalMs: number;
  maximumJointTrackingErrorDeg: number;
  maximumEndEffectorTrackingError: number;
  lastFrame?: CutterGridMotionFrameSample;
}

/** Full bounded trace for tests and an opt-in developer inspection surface. */
export interface CutterGridMotionDiagnostics extends CutterGridMotionDiagnosticsSummary {
  samples: readonly CutterGridMotionFrameSample[];
}

export type CutterGridMotionFrameInput = Omit<
  CutterGridMotionFrameSample,
  'maximumJointTrackingErrorDeg' | 'endEffectorTrackingError'
>;

/**
 * A bounded recorder intentionally kept outside React. It observes an already
 * chosen V3 trajectory and never feeds any value back into planning or motion.
 */
export class CutterGridMotionDiagnosticsRecorder {
  private readonly samples: CutterGridMotionFrameSample[] = [];
  private frameCount = 0;
  private longFrameCount = 0;
  private maximumFrameIntervalMs = 0;
  private maximumJointTrackingErrorDeg = 0;
  private maximumEndEffectorTrackingError = 0;

  record(input: CutterGridMotionFrameInput): void {
    const jointTrackingError = Math.max(
      ...Object.keys(input.plannedJointAngles).map((jointId) =>
        Math.abs(
          input.plannedJointAngles[jointId as JointId] -
            input.actualJointAngles[jointId as JointId],
        ),
      ),
      0,
    );
    const endEffectorTrackingError = distance(
      input.plannedEndEffector,
      input.actualEndEffector,
    );
    const sample: CutterGridMotionFrameSample = {
      ...input,
      plannedJointAngles: copyJointRecord(input.plannedJointAngles),
      plannedJointVelocitiesDegPerSec: copyJointRecord(input.plannedJointVelocitiesDegPerSec),
      plannedJointAccelerationsDegPerSec2: copyJointRecord(input.plannedJointAccelerationsDegPerSec2),
      plannedJointJerksDegPerSec3: copyJointRecord(input.plannedJointJerksDegPerSec3),
      actualJointAngles: copyJointRecord(input.actualJointAngles),
      plannedEndEffector: [...input.plannedEndEffector] as Vec3Tuple,
      actualEndEffector: [...input.actualEndEffector] as Vec3Tuple,
      maximumJointTrackingErrorDeg: jointTrackingError,
      endEffectorTrackingError,
    };
    this.frameCount += 1;
    this.samples.push(sample);
    if (this.samples.length > CUTTER_GRID_MOTION_DIAGNOSTIC_SAMPLE_LIMIT) {
      this.samples.shift();
    }
    if (input.frameIntervalMs > CUTTER_GRID_LONG_FRAME_MS) {
      this.longFrameCount += 1;
    }
    this.maximumFrameIntervalMs = Math.max(this.maximumFrameIntervalMs, input.frameIntervalMs);
    this.maximumJointTrackingErrorDeg = Math.max(
      this.maximumJointTrackingErrorDeg,
      jointTrackingError,
    );
    this.maximumEndEffectorTrackingError = Math.max(
      this.maximumEndEffectorTrackingError,
      endEffectorTrackingError,
    );
  }

  summary(): CutterGridMotionDiagnosticsSummary {
    const lastFrame = this.samples.at(-1);
    return {
      frameCount: this.frameCount,
      longFrameCount: this.longFrameCount,
      maximumFrameIntervalMs: this.maximumFrameIntervalMs,
      maximumJointTrackingErrorDeg: this.maximumJointTrackingErrorDeg,
      maximumEndEffectorTrackingError: this.maximumEndEffectorTrackingError,
      ...(lastFrame ? { lastFrame: cloneSample(lastFrame) } : {}),
    };
  }

  snapshot(): CutterGridMotionDiagnostics {
    return {
      ...this.summary(),
      samples: this.samples.map(cloneSample),
    };
  }
}

function cloneSample(sample: CutterGridMotionFrameSample): CutterGridMotionFrameSample {
  return {
    ...sample,
    plannedJointAngles: copyJointRecord(sample.plannedJointAngles),
    plannedJointVelocitiesDegPerSec: copyJointRecord(sample.plannedJointVelocitiesDegPerSec),
    plannedJointAccelerationsDegPerSec2: copyJointRecord(sample.plannedJointAccelerationsDegPerSec2),
    plannedJointJerksDegPerSec3: copyJointRecord(sample.plannedJointJerksDegPerSec3),
    actualJointAngles: copyJointRecord(sample.actualJointAngles),
    plannedEndEffector: [...sample.plannedEndEffector] as Vec3Tuple,
    actualEndEffector: [...sample.actualEndEffector] as Vec3Tuple,
  };
}

function copyJointRecord(
  values: Readonly<Record<JointId, number>>,
): Record<JointId, number> {
  return { ...values };
}

function distance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}
