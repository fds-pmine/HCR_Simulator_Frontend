import type { Challenge, JointId, VoxelKey } from '../../types/domain';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  certifyCutterGridSyncPtpAdaptiveV4,
  createCutterGridSyncPtpPrimitiveWithBoundaryStatesV4,
  CutterGridCompactPtpV4PlanningError,
  measureCutterGridSyncPtpDynamicsV4,
  type CutterGridPtpAdaptiveCertificationV4,
  type CutterGridPtpDynamicsV4,
} from './compactPtpV4';
import { fnv1a64 } from './signature';
import {
  CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS,
  type CutterGridContactEventV4,
  type CutterGridMovePrimitivesV4,
  type CutterGridSyncPtpPrimitiveV4,
  type CutterGridTrajectoryActionV4,
  type CutterTrajectoryBoundaryStateV4,
  type CutterTrajectoryPlanV4,
} from './types';

const MAX_RETIMING_ATTEMPTS = 48;

interface CertifiedPrimitive {
  primitive: CutterGridSyncPtpPrimitiveV4;
  certificate: Extract<CutterGridPtpAdaptiveCertificationV4, { valid: true }>;
  dynamics: CutterGridPtpDynamicsV4;
}

interface FinalizationMetrics {
  maximumVelocityRatio: number;
  maximumAccelerationRatio: number;
  maximumJerkRatio: number;
  adaptiveValidationSampleCount: number;
  maximumNormalizedJointStep: number;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
}

/**
 * Turns the Phase 3 compact geometry into a fully certified V4 plan. Dense
 * samples are confined to this pure Worker-safe function and are discarded
 * after producing timing, aggregate diagnostics, and contact events.
 */
export function finalizeCutterGridCompactPtpPlanV4(
  challenge: Challenge,
  plan: CutterTrajectoryPlanV4,
): CutterTrajectoryPlanV4 {
  const metrics = emptyMetrics();
  const positioning = retimeOnePrimitive(
    challenge,
    plan.positioning.primitives[0],
    plan.motionLimits,
  );
  mergeMetrics(metrics, positioning);
  assertZeroHairContact(challenge, positioning.certificate.samples, 'system-positioning');

  const remainingHair = new Set(challenge.initialHair.voxels);
  const actions: CutterGridTrajectoryActionV4[] = plan.actions.map((action) => {
    if (action.type === 'wait') return { ...action, expectedCutVoxels: [] };
    const certified = action.primitives.length === 1
      ? [retimeOnePrimitive(challenge, action.primitives[0], plan.motionLimits)]
      : retimeC2Detour(challenge, action.primitives, plan.motionLimits);
    certified.forEach((item) => mergeMetrics(metrics, item));
    const sweep = collectActualSweep(challenge, certified, remainingHair);
    sweep.cutVoxels.forEach((key) => remainingHair.delete(key));
    return {
      ...action,
      primitives: toMovePrimitives(certified),
      contactEvents: sweep.contactEvents,
      expectedCutVoxels: sweep.cutVoxels,
    };
  });
  const requestedSpeedScale = plan.motionLimits.requestedSpeedScale;
  const actualSpeedScale = requestedSpeedScale * Math.min(1, metrics.maximumVelocityRatio);
  const unsigned: Omit<CutterTrajectoryPlanV4, 'trajectorySignature'> = {
    ...plan,
    positioning: {
      ...plan.positioning,
      primitives: [positioning.primitive],
      trajectorySignature: fnv1a64(JSON.stringify(positioning.primitive)),
    },
    actions,
    expectedResultVoxels: [...remainingHair].sort(),
    estimatedDurationMs: actions.reduce((sum, action) => sum + (
      action.type === 'wait'
        ? action.durationMs
        : action.primitives.reduce((duration, primitive) => duration + primitive.durationMs, 0)
    ), 0),
    diagnostics: {
      ...plan.diagnostics,
      requestedSpeedScale,
      actualSpeedScale,
      maximumVelocityRatio: metrics.maximumVelocityRatio,
      maximumAccelerationRatio: metrics.maximumAccelerationRatio,
      maximumJerkRatio: metrics.maximumJerkRatio,
      adaptiveValidationSampleCount: metrics.adaptiveValidationSampleCount,
      maximumNormalizedJointStep: Math.max(
        plan.diagnostics.maximumNormalizedJointStep,
        metrics.maximumNormalizedJointStep,
      ),
      minimumHeadClearance: Math.min(plan.diagnostics.minimumHeadClearance, metrics.minimumHeadClearance),
      minimumJointLimitMargin: Math.min(plan.diagnostics.minimumJointLimitMargin, metrics.minimumJointLimitMargin),
    },
  };
  return { ...unsigned, trajectorySignature: fnv1a64(JSON.stringify(unsigned)) };
}

function retimeC2Detour(
  challenge: Challenge,
  primitives: CutterGridMovePrimitivesV4,
  limits: CutterTrajectoryPlanV4['motionLimits'],
): [CertifiedPrimitive, CertifiedPrimitive] {
  const [firstGeometry, secondGeometry] = primitives;
  if (!secondGeometry) throw new Error('Expected a two-primitive V4 detour.');
  let firstDurationMs = Math.max(CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS, firstGeometry.durationMs);
  let secondDurationMs = Math.max(CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS, secondGeometry.durationMs);
  for (let attempt = 0; attempt < MAX_RETIMING_ATTEMPTS; attempt += 1) {
    const shared = sharedDetourBoundary(
      challenge,
      firstGeometry.start,
      firstGeometry.end,
      secondGeometry.end,
      firstDurationMs,
      secondDurationMs,
    );
    const first = createCutterGridSyncPtpPrimitiveWithBoundaryStatesV4(
      challenge,
      firstGeometry.start,
      shared,
      firstDurationMs,
    );
    const second = createCutterGridSyncPtpPrimitiveWithBoundaryStatesV4(
      challenge,
      shared,
      secondGeometry.end,
      secondDurationMs,
    );
    const firstDynamics = measureCutterGridSyncPtpDynamicsV4(challenge, first, limits);
    const secondDynamics = measureCutterGridSyncPtpDynamicsV4(challenge, second, limits);
    if (firstDynamics.valid && secondDynamics.valid) {
      return [
        certifyRetimedPrimitive(challenge, first, firstDynamics),
        certifyRetimedPrimitive(challenge, second, secondDynamics),
      ];
    }
    const scale = Math.max(requiredDurationScale(firstDynamics), requiredDurationScale(secondDynamics), 1.05);
    firstDurationMs = roundDuration(firstDurationMs * scale);
    secondDurationMs = roundDuration(secondDurationMs * scale);
  }
  throw new CutterGridCompactPtpV4PlanningError(
    'ptp-certificate-failed',
    'Cutter Grid compact detour cannot satisfy its synchronized dynamic limits.',
    { stage: 'motion-certificate' },
  );
}

function retimeOnePrimitive(
  challenge: Challenge,
  geometry: CutterGridSyncPtpPrimitiveV4,
  limits: CutterTrajectoryPlanV4['motionLimits'],
): CertifiedPrimitive {
  let durationMs = Math.max(CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS, geometry.durationMs);
  for (let attempt = 0; attempt < MAX_RETIMING_ATTEMPTS; attempt += 1) {
    const primitive = createCutterGridSyncPtpPrimitiveWithBoundaryStatesV4(
      challenge,
      geometry.start,
      geometry.end,
      durationMs,
    );
    const dynamics = measureCutterGridSyncPtpDynamicsV4(challenge, primitive, limits);
    if (dynamics.valid) return certifyRetimedPrimitive(challenge, primitive, dynamics);
    durationMs = roundDuration(durationMs * requiredDurationScale(dynamics));
  }
  throw new CutterGridCompactPtpV4PlanningError(
    'ptp-certificate-failed',
    'Cutter Grid compact PTP cannot satisfy its synchronized dynamic limits.',
    { stage: 'motion-certificate' },
  );
}

function certifyRetimedPrimitive(
  challenge: Challenge,
  primitive: CutterGridSyncPtpPrimitiveV4,
  dynamics: CutterGridPtpDynamicsV4,
): CertifiedPrimitive {
  const certificate = certifyCutterGridSyncPtpAdaptiveV4(challenge, primitive);
  if (!certificate.valid) {
    throw new CutterGridCompactPtpV4PlanningError(
      'ptp-certificate-failed',
      `Cutter Grid compact PTP ${certificate.reason} certificate failed.`,
      { stage: 'motion-certificate' },
    );
  }
  return { primitive, certificate, dynamics };
}

function sharedDetourBoundary(
  challenge: Challenge,
  start: CutterTrajectoryBoundaryStateV4,
  via: CutterTrajectoryBoundaryStateV4,
  end: CutterTrajectoryBoundaryStateV4,
  firstDurationMs: number,
  secondDurationMs: number,
): CutterTrajectoryBoundaryStateV4 {
  const firstSeconds = firstDurationMs / 1_000;
  const secondSeconds = secondDurationMs / 1_000;
  const jointAngles = {} as Record<JointId, number>;
  const jointVelocitiesDegPerSec = {} as Record<JointId, number>;
  const jointAccelerationsDegPerSec2 = {} as Record<JointId, number>;
  for (const joint of challenge.robotConfig.joints) {
    const towardVia = (via.jointAngles[joint.id] - start.jointAngles[joint.id]) / firstSeconds;
    const awayFromVia = (end.jointAngles[joint.id] - via.jointAngles[joint.id]) / secondSeconds;
    jointAngles[joint.id] = via.jointAngles[joint.id];
    jointVelocitiesDegPerSec[joint.id] = towardVia * awayFromVia > 0
      ? (2 * towardVia * awayFromVia) / (towardVia + awayFromVia)
      : 0;
    // Equal zero accelerations on both sides make the shared state C2. A
    // direction reversal intentionally gives a zero velocity turning point.
    jointAccelerationsDegPerSec2[joint.id] = 0;
  }
  return { jointAngles, jointVelocitiesDegPerSec, jointAccelerationsDegPerSec2 };
}

function collectActualSweep(
  challenge: Challenge,
  primitives: readonly CertifiedPrimitive[],
  remainingHair: ReadonlySet<VoxelKey>,
): { cutVoxels: VoxelKey[]; contactEvents: CutterGridContactEventV4[] } {
  const hits = new Set<VoxelKey>();
  const eventsByTime = new Map<number, Set<VoxelKey>>();
  let elapsedMs = 0;
  let previous: CertifiedPrimitive['certificate']['samples'][number] | undefined;
  for (const item of primitives) {
    for (const sample of item.certificate.samples) {
      if (!previous) {
        previous = sample;
        continue;
      }
      const segmentHits = findSweptVoxelHits(
        previous.endEffector,
        sample.endEffector,
        remainingHair,
        challenge.voxelConfig,
        challenge.robotConfig.geometry.toolRadius,
      ).filter((key) => !hits.has(key));
      if (segmentHits.length > 0) {
        const timeMs = roundTime(elapsedMs + sample.timeMs);
        const event = eventsByTime.get(timeMs) ?? new Set<VoxelKey>();
        segmentHits.forEach((key) => {
          hits.add(key);
          event.add(key);
        });
        eventsByTime.set(timeMs, event);
      }
      previous = sample;
    }
    elapsedMs += item.primitive.durationMs;
    previous = undefined;
  }
  return {
    cutVoxels: [...hits].sort(),
    contactEvents: [...eventsByTime.entries()]
      .sort(([left], [right]) => left - right)
      .map(([timeMs, voxelKeys]) => ({ timeMs, voxelKeys: [...voxelKeys].sort() })),
  };
}

function assertZeroHairContact(
  challenge: Challenge,
  samples: readonly CertifiedPrimitive['certificate']['samples'][number][],
  sourceBlockId: string,
): void {
  for (let index = 1; index < samples.length; index += 1) {
    if (findSweptVoxelHits(
      samples[index - 1].endEffector,
      samples[index].endEffector,
      challenge.initialHair.voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    ).length > 0) {
      throw new CutterGridCompactPtpV4PlanningError(
        'actual-sweep-certification-failed',
        'Cutter Grid system positioning would touch hair.',
        { sourceBlockId, stage: 'sweep-certificate' },
      );
    }
  }
}

function mergeMetrics(metrics: FinalizationMetrics, item: CertifiedPrimitive): void {
  metrics.maximumVelocityRatio = Math.max(metrics.maximumVelocityRatio, item.dynamics.maximumVelocityRatio);
  metrics.maximumAccelerationRatio = Math.max(metrics.maximumAccelerationRatio, item.dynamics.maximumAccelerationRatio);
  metrics.maximumJerkRatio = Math.max(metrics.maximumJerkRatio, item.dynamics.maximumJerkRatio);
  metrics.adaptiveValidationSampleCount += item.certificate.samples.length;
  metrics.maximumNormalizedJointStep = Math.max(metrics.maximumNormalizedJointStep, item.certificate.maximumNormalizedJointStep);
  metrics.minimumHeadClearance = Math.min(metrics.minimumHeadClearance, item.certificate.minimumHeadClearance);
  metrics.minimumJointLimitMargin = Math.min(metrics.minimumJointLimitMargin, item.certificate.minimumJointLimitMargin);
}

function emptyMetrics(): FinalizationMetrics {
  return {
    maximumVelocityRatio: 0,
    maximumAccelerationRatio: 0,
    maximumJerkRatio: 0,
    adaptiveValidationSampleCount: 0,
    maximumNormalizedJointStep: 0,
    minimumHeadClearance: Number.POSITIVE_INFINITY,
    minimumJointLimitMargin: Number.POSITIVE_INFINITY,
  };
}

function requiredDurationScale(dynamics: CutterGridPtpDynamicsV4): number {
  return Math.max(
    1.05,
    dynamics.maximumVelocityRatio * 1.01,
    Math.sqrt(dynamics.maximumAccelerationRatio) * 1.01,
    Math.cbrt(dynamics.maximumJerkRatio) * 1.01,
  );
}

function roundDuration(value: number): number {
  return Math.ceil(Math.max(CUTTER_GRID_COMPACT_PTP_MIN_PRIMITIVE_DURATION_MS, value));
}

function roundTime(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function toMovePrimitives(
  certified: readonly CertifiedPrimitive[],
): CutterGridMovePrimitivesV4 {
  const [first, second] = certified;
  if (!first) throw new Error('Cutter Grid V4 move has no certified PTP primitive.');
  return second ? [first.primitive, second.primitive] : [first.primitive];
}
