import type { Challenge, JointId } from '../../types/domain';
import { createInitialJointAngles } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  certifyCutterGridSyncPtpV4,
  createCutterGridSyncPtpPrimitiveV4,
  evaluateCutterGridSyncPtpV4,
} from './compactPtpV4';
import { cutterGridChallengeSignatureV2, fnv1a64 } from './signature';
import {
  CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
  CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
  CUTTER_GRID_PROFILE_V4_VERSION,
  type CutterGridEntryOptionV4,
  type CutterGridMotionLimitsV4,
  type CutterGridProfileV2,
  type CutterGridProfileV4,
  type CutterGridRoadmapV4,
} from './types';
import { cutterGridProfileV2MatchesChallenge } from './profileV2';
import { normalizedJointDistance } from './ik';

export const CUTTER_GRID_PROFILE_V4_CONFIG = Object.freeze({
  roadmapNodeCount: 256,
  roadmapNeighborsPerNode: 8,
  maximumHaltonSamples: 4_096,
});

export interface CutterGridProfileV4GenerationOptions {
  roadmapNodeCount?: number;
  roadmapNeighborsPerNode?: number;
  shouldCancel?: () => boolean;
}

/**
 * Derives a compact V4 Profile from the already-certified V2 geometry. V2's
 * dense entry samples are verification evidence only: V4 serializes a direct
 * synchronized PTP entry primitive and refuses candidates for which that
 * compact route cannot be re-certified without hair contact.
 */
export function upgradeCutterGridProfileV2ToV4(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  options: CutterGridProfileV4GenerationOptions = {},
): CutterGridProfileV4 {
  if (!cutterGridProfileV2MatchesChallenge(profile, challenge)) {
    throw new Error('A signed Cutter Grid V2 Profile is required to derive V4.');
  }
  const motionLimits = frontendCompactPtpMotionLimitsV4(challenge);
  const entryOptions = compactEntryOptions(challenge, profile, options);
  if (entryOptions.length < 2) {
    throw new Error(`Cutter Grid V4 requires at least two compact certified entries; found ${entryOptions.length}.`);
  }
  const roadmap = generateCutterGridRoadmapV4(challenge, options);
  const unsigned: Omit<CutterGridProfileV4, 'profileSignature'> = {
    ...profile,
    version: CUTTER_GRID_PROFILE_V4_VERSION,
    plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
    entryOptions,
    referenceProgram: {
      ...profile.referenceProgram,
      plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
    },
    certification: {
      ...profile.certification,
      entryZeroContact: true,
      authenticatedEntryOptionIds: entryOptions.map((entry) => entry.id),
    },
    motionLimits,
    motionLimitsSignature: cutterGridMotionLimitsSignatureV4(challenge, motionLimits),
    roadmap,
  };
  return { ...unsigned, profileSignature: cutterGridProfileSignatureV4(unsigned) };
}

export function cutterGridProfileV4MatchesChallenge(
  profile: CutterGridProfileV4,
  challenge: Challenge,
): boolean {
  if (
    profile.version !== CUTTER_GRID_PROFILE_V4_VERSION ||
    profile.plannerVersion !== CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION ||
    profile.challengeSignature !== cutterGridChallengeSignatureV2(challenge) ||
    !profile.certification.passed ||
    !profile.certification.entryZeroContact ||
    profile.entryOptions.length < 2 ||
    profile.roadmap.nodes.length !== CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNodeCount ||
    profile.roadmap.nodes.some((node) =>
      profile.roadmap.edges.filter((edge) => edge.fromNodeId === node.id).length !==
        CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNeighborsPerNode,
    ) ||
    profile.roadmap.signature !== roadmapSignature(profile.roadmap.nodes, profile.roadmap.edges) ||
    profile.motionLimitsSignature !== cutterGridMotionLimitsSignatureV4(challenge, profile.motionLimits)
  ) return false;
  const { profileSignature, ...unsigned } = profile;
  return profileSignature === cutterGridProfileSignatureV4(unsigned);
}

export function frontendCompactPtpMotionLimitsV4(challenge: Challenge): CutterGridMotionLimitsV4 {
  return {
    requestedSpeedScale: CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
    joints: Object.fromEntries(challenge.robotConfig.joints.map((joint) => {
      const nominalVelocityDegPerSec = joint.speedDegPerSec * 4;
      const nominalAccelerationDegPerSec2 = joint.speedDegPerSec * 1_250;
      const nominalJerkDegPerSec3 = joint.speedDegPerSec * 200_000;
      return [joint.id, {
        nominalVelocityDegPerSec,
        nominalAccelerationDegPerSec2,
        nominalJerkDegPerSec3,
        maxVelocityDegPerSec: nominalVelocityDegPerSec * CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
        maxAccelerationDegPerSec2: nominalAccelerationDegPerSec2 * CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE ** 2,
        maxJerkDegPerSec3: nominalJerkDegPerSec3 * CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE ** 3,
      }];
    })) as CutterGridMotionLimitsV4['joints'],
  };
}

export function generateCutterGridRoadmapV4(
  challenge: Challenge,
  options: CutterGridProfileV4GenerationOptions = {},
): CutterGridRoadmapV4 {
  const nodeCount = options.roadmapNodeCount ?? CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNodeCount;
  const neighborCount = options.roadmapNeighborsPerNode ?? CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNeighborsPerNode;
  if (!Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNodeCount) {
    throw new Error(`Cutter Grid V4 roadmap node count must be 1 to ${CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNodeCount}.`);
  }
  if (!Number.isInteger(neighborCount) || neighborCount < 1 || neighborCount > CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNeighborsPerNode) {
    throw new Error(`Cutter Grid V4 roadmap neighbor count must be 1 to ${CUTTER_GRID_PROFILE_V4_CONFIG.roadmapNeighborsPerNode}.`);
  }
  const nodes: CutterGridRoadmapV4['nodes'] = [];
  for (let index = 1; index <= CUTTER_GRID_PROFILE_V4_CONFIG.maximumHaltonSamples && nodes.length < nodeCount; index += 1) {
    throwIfCancelled(options);
    const jointAngles = haltonJointAngles(challenge, index);
    const primitive = createCutterGridSyncPtpPrimitiveV4(challenge, jointAngles, jointAngles);
    const certificate = certifyCutterGridSyncPtpV4(challenge, primitive);
    if (!certificate.valid) continue;
    nodes.push({
      id: `roadmap-${nodes.length.toString().padStart(3, '0')}`,
      jointAngles,
      minimumHeadClearance: certificate.minimumHeadClearance,
    });
  }
  if (nodes.length !== nodeCount) {
    throw new Error(`Cutter Grid V4 could not find ${nodeCount} safe roadmap nodes.`);
  }
  const edges: CutterGridRoadmapV4['edges'] = [];
  for (const [index, node] of nodes.entries()) {
    throwIfCancelled(options);
    const neighbors = nodes
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidateIndex }) => candidateIndex !== index)
      .sort((left, right) =>
        normalizedJointDistance(node.jointAngles, left.candidate.jointAngles, challenge.robotConfig.joints) -
          normalizedJointDistance(node.jointAngles, right.candidate.jointAngles, challenge.robotConfig.joints) ||
        left.candidate.id.localeCompare(right.candidate.id),
      );
    let accepted = 0;
    for (const { candidate } of neighbors) {
      if (accepted >= neighborCount) break;
      const certificate = certifyCutterGridSyncPtpV4(
        challenge,
        createCutterGridSyncPtpPrimitiveV4(challenge, node.jointAngles, candidate.jointAngles),
      );
      if (!certificate.valid) continue;
      edges.push({ fromNodeId: node.id, toNodeId: candidate.id });
      accepted += 1;
    }
    if (accepted !== neighborCount) {
      throw new Error(`Cutter Grid V4 roadmap could not certify ${neighborCount} neighbors for ${node.id}.`);
    }
  }
  return { nodes, edges, signature: roadmapSignature(nodes, edges) };
}

export function cutterGridMotionLimitsSignatureV4(
  challenge: Challenge,
  limits: CutterGridMotionLimitsV4,
): string {
  return fnv1a64(JSON.stringify({
    requestedSpeedScale: limits.requestedSpeedScale,
    joints: challenge.robotConfig.joints.map((joint) => [joint.id, limits.joints[joint.id]]),
  }));
}

function compactEntryOptions(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  options: CutterGridProfileV4GenerationOptions,
): CutterGridEntryOptionV4[] {
  const initialJointAngles = createInitialJointAngles(challenge.robotConfig);
  return profile.entryOptions.flatMap((entry) => {
    throwIfCancelled(options);
    const positioningPrimitive = createCutterGridSyncPtpPrimitiveV4(
      challenge,
      initialJointAngles,
      entry.jointAngles,
    );
    const certificate = certifyCutterGridSyncPtpV4(challenge, positioningPrimitive);
    if (!certificate.valid || !positioningHasNoHairContact(challenge, positioningPrimitive)) return [];
    return [{
      id: entry.id,
      jointAngles: { ...entry.jointAngles },
      positioningPrimitive,
      positioningSignature: fnv1a64(JSON.stringify({ id: entry.id, positioningPrimitive })),
      minimumHeadClearance: certificate.minimumHeadClearance,
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function positioningHasNoHairContact(
  challenge: Challenge,
  primitive: CutterGridEntryOptionV4['positioningPrimitive'],
): boolean {
  const maximumJointDelta = Math.max(...challenge.robotConfig.joints.map((joint) =>
    Math.abs(primitive.end.jointAngles[joint.id] - primitive.start.jointAngles[joint.id]),
  ));
  const sampleCount = Math.max(1, Math.ceil(maximumJointDelta / 0.5));
  let previous = evaluateCutterGridSyncPtpV4(challenge, primitive, 0).endEffector;
  for (let index = 1; index <= sampleCount; index += 1) {
    const next = evaluateCutterGridSyncPtpV4(
      challenge,
      primitive,
      (primitive.durationMs * index) / sampleCount,
    ).endEffector;
    if (findSweptVoxelHits(
      previous,
      next,
      challenge.initialHair.voxels,
      challenge.voxelConfig,
      challenge.robotConfig.geometry.toolRadius,
    ).length > 0) return false;
    previous = next;
  }
  return true;
}

function cutterGridProfileSignatureV4(
  profile: Omit<CutterGridProfileV4, 'profileSignature'>,
): string {
  return fnv1a64(JSON.stringify({
    version: profile.version,
    plannerVersion: profile.plannerVersion,
    challengeSignature: profile.challengeSignature,
    originHairCoord: profile.originHairCoord,
    entryOptions: profile.entryOptions.map((entry) => ({
      id: entry.id,
      jointAngles: entry.jointAngles,
      positioningSignature: entry.positioningSignature,
    })),
    motionLimits: profile.motionLimits,
    motionLimitsSignature: profile.motionLimitsSignature,
    roadmapSignature: profile.roadmap.signature,
  }));
}

function roadmapSignature(
  nodes: CutterGridRoadmapV4['nodes'],
  edges: CutterGridRoadmapV4['edges'],
): string {
  return fnv1a64(JSON.stringify({ nodes, edges }));
}

function haltonJointAngles(challenge: Challenge, index: number): Record<JointId, number> {
  const primes = [2, 3, 5, 7, 11];
  return Object.fromEntries(challenge.robotConfig.joints.map((joint, jointIndex) => [
    joint.id,
    joint.minAngleDeg + radicalInverse(index, primes[jointIndex] ?? 13) *
      (joint.maxAngleDeg - joint.minAngleDeg),
  ])) as Record<JointId, number>;
}

function radicalInverse(value: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let remaining = value;
  while (remaining > 0) {
    result += (remaining % base) * fraction;
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return result;
}

function throwIfCancelled(options: CutterGridProfileV4GenerationOptions): void {
  if (options.shouldCancel?.()) throw new Error('Cutter Grid V4 Profile generation cancelled.');
}
