import type { Challenge, JointId, Vec3Tuple } from '../../types/domain';
import { computeRobotPose } from '../robot/kinematics';
import {
  certifyCutterGridSyncPtpV4,
  createCutterGridSyncPtpPrimitiveV4,
  CutterGridCompactPtpV4PlanningError,
  evaluateCutterGridSyncPtpV4,
} from './compactPtpV4';
import { finalizeCutterGridCompactPtpPlanV4 } from './compactPtpMotionV4';
import { cutterGridBoundsContain, cutterGridCoordToWorld } from './grid';
import {
  enumerateCutterGridIkCandidates,
  normalizedJointDistance,
  type CutterGridIkCandidate,
} from './ik';
import { cutterGridProfileV4MatchesChallenge } from './profileV4';
import { fnv1a64 } from './signature';
import {
  CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
  CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
  type CompiledCutterGridProgramV2,
  type CutterGridCoord,
  type CutterGridExecutableMoveActionV2,
  type CutterGridMovePrimitivesV4,
  type CutterGridPlanningDiagnosticsV4,
  type CutterGridPlanningPhaseV4,
  type CutterGridProfileV4,
  type CutterGridSyncPtpPrimitiveV4,
  type CutterGridTrajectoryActionV4,
  type CutterTrajectoryPlanV4,
} from './types';

const INITIAL_SEED_BUDGET = 12;
const EXPANDED_SEED_BUDGET = 48;
const INITIAL_CANDIDATE_LIMIT = 12;
const EXPANDED_CANDIDATE_LIMIT = 24;
const EDGE_NEIGHBOR_TIERS = [4, 8, Number.POSITIVE_INFINITY] as const;
const NUMBER_TOLERANCE = 1e-12;

export interface CutterGridCompactPtpPlannerV4Options {
  shouldCancel?: () => boolean;
  onProgress?: (progress: Omit<import('./types').CutterGridPlanningProgressV4, 'type' | 'requestId'>) => void;
}

interface EndpointLayer {
  layerIndex: number;
  actionIndex: number;
  action: CutterGridExecutableMoveActionV2;
  targetWorld: Vec3Tuple;
}

interface PtpConnection {
  primitives: CutterGridMovePrimitivesV4;
  primitiveCount: 1 | 2;
  maximumNormalizedJointStep: number;
  displacementSquared: number;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
  chordDeviation: number;
}

interface CompactPath {
  entryIndex: number;
  candidates: CutterGridIkCandidate[];
  connections: PtpConnection[];
}

interface PathScore {
  primitiveCount: number;
  maximumNormalizedJointStep: number;
  durationMs: number;
  displacementSquared: number;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
  lexicographicAngles: number[];
}

interface GlobalSearchResult {
  path?: CompactPath;
  disconnectedLayer?: number;
}

/**
 * Sparse global endpoint planner for V4. It retains multiple collision-free
 * IK branches at every visible Move endpoint, then connects the entire
 * program with one direct PTP or one certified via configuration per Move.
 */
export function planCutterGridCompactPtpV4(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV2,
  profile: CutterGridProfileV4,
  options: CutterGridCompactPtpPlannerV4Options = {},
): CutterTrajectoryPlanV4 {
  assertInputs(challenge, compiled, profile);
  const layers = buildEndpointLayers(challenge, compiled, profile);
  if (layers.length === 0) {
    throw new CutterGridCompactPtpV4PlanningError(
      'endpoint-ik-not-converged',
      'Cutter Grid V4 program contains no Move endpoints to plan.',
    );
  }
  const candidates = generateEndpointCandidates(challenge, profile, layers, INITIAL_SEED_BUDGET, INITIAL_CANDIDATE_LIMIT, options);
  let expandedActionIndex: number | undefined;
  let firstMissing = candidates.findIndex((layer) => layer.length === 0);
  if (firstMissing >= 0) {
    expandedActionIndex = layers[firstMissing].actionIndex;
    candidates[firstMissing] = generateCandidatesForLayer(
      challenge,
      profile,
      layers[firstMissing],
      candidates[firstMissing - 1],
      EXPANDED_SEED_BUDGET,
      EXPANDED_CANDIDATE_LIMIT,
      layers.length,
      options,
    );
    firstMissing = candidates.findIndex((layer) => layer.length === 0);
    if (firstMissing >= 0) throw noEndpointCandidate(layers[firstMissing]);
  }
  let firstDisconnectedLayer: number | undefined;
  for (let graphAttempt = 0; graphAttempt < 2; graphAttempt += 1) {
    for (const neighborLimit of EDGE_NEIGHBOR_TIERS) {
      throwIfCancelled(options);
      report(options, 'connecting-ptp-edges', 0, layers.length, expandedActionIndex);
      const selected = selectGlobalPath(challenge, profile, layers, candidates, neighborLimit, options);
      if (selected.path) {
        report(options, 'selecting-compact-path', layers.length, layers.length, expandedActionIndex);
        return buildFrozenPlan(
          challenge,
          compiled,
          profile,
          layers,
          selected.path,
          candidates,
          expandedActionIndex,
          options,
        );
      }
      firstDisconnectedLayer ??= selected.disconnectedLayer;
    }
    // A graph disconnect is allowed one targeted candidate expansion, just
    // like an empty endpoint layer. Do not inflate every endpoint's budget.
    if (expandedActionIndex !== undefined) break;
    const disconnectedLayer = firstDisconnectedLayer ?? 0;
    expandedActionIndex = layers[disconnectedLayer].actionIndex;
    candidates[disconnectedLayer] = generateCandidatesForLayer(
      challenge,
      profile,
      layers[disconnectedLayer],
      candidates[disconnectedLayer - 1],
      EXPANDED_SEED_BUDGET,
      EXPANDED_CANDIDATE_LIMIT,
      layers.length,
      options,
    );
    if (candidates[disconnectedLayer].length === 0) {
      throw noEndpointCandidate(layers[disconnectedLayer]);
    }
  }
  const layer = layers[firstDisconnectedLayer ?? 0];
  throw new CutterGridCompactPtpV4PlanningError(
    'motion-primitive-budget-exhausted',
    `No compact collision-free PTP route to ${formatCoord(layer.action.endCoord)} fits the one-via primitive budget.`,
    {
      sourceBlockId: layer.action.sourceBlockId,
      targetCoord: layer.action.endCoord,
      startCoord: layer.action.startCoord,
      actionIndex: layer.actionIndex,
      stage: 'ptp-edge',
    },
  );
}

function buildEndpointLayers(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV2,
  profile: CutterGridProfileV4,
): EndpointLayer[] {
  const layers: EndpointLayer[] = [];
  for (const [actionIndex, action] of compiled.executableActions.entries()) {
    if (action.type === 'wait') continue;
    if (!cutterGridBoundsContain(profile.bounds, action.endCoord)) {
      throw new CutterGridCompactPtpV4PlanningError(
        'out-of-bounds',
        `Cutter Grid coordinate ${formatCoord(action.endCoord)} is outside the certified boundary.`,
        {
          sourceBlockId: action.sourceBlockId,
          targetCoord: action.endCoord,
          startCoord: action.startCoord,
          actionIndex,
          stage: 'endpoint',
        },
      );
    }
    layers.push({
      layerIndex: layers.length,
      actionIndex,
      action,
      targetWorld: cutterGridCoordToWorld(action.endCoord, profile.originHairCoord, challenge.voxelConfig),
    });
  }
  return layers;
}

function generateEndpointCandidates(
  challenge: Challenge,
  profile: CutterGridProfileV4,
  layers: readonly EndpointLayer[],
  seedBudget: typeof INITIAL_SEED_BUDGET | typeof EXPANDED_SEED_BUDGET,
  candidateLimit: number,
  options: CutterGridCompactPtpPlannerV4Options,
): CutterGridIkCandidate[][] {
  const result: CutterGridIkCandidate[][] = [];
  for (const layer of layers) {
    result.push(generateCandidatesForLayer(
      challenge,
      profile,
      layer,
      result.at(-1),
      seedBudget,
      candidateLimit,
      layers.length,
      options,
    ));
  }
  return result;
}

function generateCandidatesForLayer(
  challenge: Challenge,
  profile: CutterGridProfileV4,
  layer: EndpointLayer,
  previousLayer: readonly CutterGridIkCandidate[] | undefined,
  seedBudget: typeof INITIAL_SEED_BUDGET | typeof EXPANDED_SEED_BUDGET,
  candidateLimit: number,
  totalLayers: number,
  options: CutterGridCompactPtpPlannerV4Options,
): CutterGridIkCandidate[] {
  throwIfCancelled(options);
  const candidates = enumerateCutterGridIkCandidates(challenge, layer.targetWorld, {
    maxError: challenge.voxelConfig.size / 16,
    ...(previousLayer ? { previousLayer } : {}),
    entryOptions: profile.entryOptions.map((entry) => ({ id: entry.id, jointAngles: entry.jointAngles })),
    seedBudget,
    candidateLimit,
    candidateNamespace: `v4-endpoint-${layer.action.occurrenceId}`,
    shouldCancel: options.shouldCancel,
  });
  report(options, 'generating-endpoint-candidates', layer.layerIndex + 1, totalLayers, undefined);
  return candidates;
}

function selectGlobalPath(
  challenge: Challenge,
  profile: CutterGridProfileV4,
  layers: readonly EndpointLayer[],
  candidates: readonly CutterGridIkCandidate[][],
  neighborLimit: number,
  options: CutterGridCompactPtpPlannerV4Options,
): GlobalSearchResult {
  interface State { path: CompactPath; score: PathScore; }
  const connectionCache = new Map<string, PtpConnection | undefined>();
  const connect = (
    startId: string,
    start: Readonly<Record<JointId, number>>,
    endId: string,
    end: Readonly<Record<JointId, number>>,
  ): PtpConnection | undefined => {
    const key = `${startId}>${endId}`;
    if (connectionCache.has(key)) return connectionCache.get(key);
    const direct = validatedPrimitive(challenge, start, end);
    if (direct) {
      connectionCache.set(key, direct);
      return direct;
    }
    const detour = singleRoadmapDetour(challenge, profile, start, end);
    connectionCache.set(key, detour);
    return detour;
  };

  const firstLayer = candidates[0] ?? [];
  const states = new Map<string, State>();
  for (const [entryIndex, entry] of profile.entryOptions.entries()) {
    for (const candidate of nearestCandidates(challenge, entry.jointAngles, firstLayer, neighborLimit)) {
      const connection = connect(entry.id, entry.jointAngles, candidate.id, candidate.jointAngles);
      if (!connection) continue;
      const path: CompactPath = { entryIndex, candidates: [candidate], connections: [connection] };
      acceptState(states, path, challenge);
    }
  }
  if (states.size === 0) return { disconnectedLayer: 0 };
  let active = states;
  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    throwIfCancelled(options);
    const next = new Map<string, State>();
    for (const state of active.values()) {
      const previous = state.path.candidates.at(-1)!;
      for (const candidate of nearestCandidates(challenge, previous.jointAngles, candidates[layerIndex], neighborLimit)) {
        const connection = connect(previous.id, previous.jointAngles, candidate.id, candidate.jointAngles);
        if (!connection) continue;
        acceptState(next, {
          entryIndex: state.path.entryIndex,
          candidates: [...state.path.candidates, candidate],
          connections: [...state.path.connections, connection],
        }, challenge);
      }
    }
    report(options, 'connecting-ptp-edges', layerIndex + 1, layers.length, undefined);
    if (next.size === 0) return { disconnectedLayer: layerIndex };
    active = next;
  }
  const selected = [...active.values()]
    .sort((left, right) => comparePathScore(left.score, right.score))[0];
  return selected ? { path: selected.path } : { disconnectedLayer: layers.length - 1 };
}

function nearestCandidates(
  challenge: Challenge,
  start: Readonly<Record<JointId, number>>,
  candidates: readonly CutterGridIkCandidate[],
  limit: number,
): CutterGridIkCandidate[] {
  return [...candidates]
    .sort((left, right) =>
      normalizedJointDistance(start, left.jointAngles, challenge.robotConfig.joints) -
        normalizedJointDistance(start, right.jointAngles, challenge.robotConfig.joints) ||
      left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

function validatedPrimitive(
  challenge: Challenge,
  start: Readonly<Record<JointId, number>>,
  end: Readonly<Record<JointId, number>>,
): PtpConnection | undefined {
  const primitive = createCutterGridSyncPtpPrimitiveV4(challenge, start, end);
  const certificate = certifyCutterGridSyncPtpV4(challenge, primitive);
  if (!certificate.valid) return undefined;
  return {
    primitives: [primitive],
    primitiveCount: 1,
    maximumNormalizedJointStep: certificate.maximumNormalizedJointStep,
    displacementSquared: normalizedJointDistance(start, end, challenge.robotConfig.joints) ** 2,
    minimumHeadClearance: certificate.minimumHeadClearance,
    minimumJointLimitMargin: certificate.minimumJointLimitMargin,
    chordDeviation: chordDeviation(challenge, primitive),
  };
}

function singleRoadmapDetour(
  challenge: Challenge,
  profile: CutterGridProfileV4,
  start: Readonly<Record<JointId, number>>,
  end: Readonly<Record<JointId, number>>,
): PtpConnection | undefined {
  const connectedNodeIds = new Set(profile.roadmap.edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]));
  const nodes = profile.roadmap.nodes
    .filter((node) => connectedNodeIds.has(node.id))
    .sort((left, right) => {
      const leftDistance = normalizedJointDistance(start, left.jointAngles, challenge.robotConfig.joints) +
        normalizedJointDistance(left.jointAngles, end, challenge.robotConfig.joints);
      const rightDistance = normalizedJointDistance(start, right.jointAngles, challenge.robotConfig.joints) +
        normalizedJointDistance(right.jointAngles, end, challenge.robotConfig.joints);
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
  for (const node of nodes) {
    const first = validatedPrimitive(challenge, start, node.jointAngles);
    if (!first) continue;
    const second = validatedPrimitive(challenge, node.jointAngles, end);
    if (!second) continue;
    return {
      primitives: [first.primitives[0], second.primitives[0]],
      primitiveCount: 2,
      maximumNormalizedJointStep: Math.max(first.maximumNormalizedJointStep, second.maximumNormalizedJointStep),
      displacementSquared: first.displacementSquared + second.displacementSquared,
      minimumHeadClearance: Math.min(first.minimumHeadClearance, second.minimumHeadClearance),
      minimumJointLimitMargin: Math.min(first.minimumJointLimitMargin, second.minimumJointLimitMargin),
      chordDeviation: Math.max(first.chordDeviation, second.chordDeviation),
    };
  }
  return undefined;
}

function chordDeviation(challenge: Challenge, primitive: CutterGridSyncPtpPrimitiveV4): number {
  const start = computeRobotPose(challenge.robotConfig, primitive.start.jointAngles).endEffector;
  const end = computeRobotPose(challenge.robotConfig, primitive.end.jointAngles).endEffector;
  return Math.max(...[0.25, 0.5, 0.75].map((progress) => {
    const actual = evaluateCutterGridSyncPtpV4(
      challenge,
      primitive,
      primitive.durationMs * progress,
    ).endEffector;
    return pointSegmentDistance(actual, start, end);
  }));
}

function acceptState(
  states: Map<string, { path: CompactPath; score: PathScore }>,
  path: CompactPath,
  challenge: Challenge,
): void {
  const score = scorePath(path, challenge);
  const key = `${path.entryIndex}|${path.candidates.at(-1)?.id}`;
  const known = states.get(key);
  if (!known || comparePathScore(score, known.score) < 0) states.set(key, { path, score });
}

function scorePath(path: CompactPath, challenge: Challenge): PathScore {
  return {
    primitiveCount: path.connections.reduce((sum, connection) => sum + connection.primitiveCount, 0),
    maximumNormalizedJointStep: Math.max(0, ...path.connections.map((connection) => connection.maximumNormalizedJointStep)),
    durationMs: path.connections.reduce(
      (sum, connection) => sum + connection.primitives.reduce((total, primitive) => total + primitive.durationMs, 0),
      0,
    ),
    displacementSquared: path.connections.reduce((sum, connection) => sum + connection.displacementSquared, 0),
    minimumHeadClearance: Math.min(...path.connections.map((connection) => connection.minimumHeadClearance)),
    minimumJointLimitMargin: Math.min(...path.connections.map((connection) => connection.minimumJointLimitMargin)),
    lexicographicAngles: [
      path.entryIndex,
      ...path.candidates.flatMap((candidate) => challenge.robotConfig.joints.map((joint) => candidate.jointAngles[joint.id])),
    ],
  };
}

function comparePathScore(left: PathScore, right: PathScore): number {
  for (const [leftValue, rightValue, direction] of [
    [left.primitiveCount, right.primitiveCount, 1],
    [left.maximumNormalizedJointStep, right.maximumNormalizedJointStep, 1],
    [left.durationMs, right.durationMs, 1],
    [left.displacementSquared, right.displacementSquared, 1],
    [left.minimumHeadClearance, right.minimumHeadClearance, -1],
    [left.minimumJointLimitMargin, right.minimumJointLimitMargin, -1],
  ] as const) {
    const difference = leftValue - rightValue;
    if (Math.abs(difference) > NUMBER_TOLERANCE) return difference * direction;
  }
  for (let index = 0; index < Math.max(left.lexicographicAngles.length, right.lexicographicAngles.length); index += 1) {
    const difference = (left.lexicographicAngles[index] ?? 0) - (right.lexicographicAngles[index] ?? 0);
    if (Math.abs(difference) > NUMBER_TOLERANCE) return difference;
  }
  return 0;
}

function buildFrozenPlan(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV2,
  profile: CutterGridProfileV4,
  layers: readonly EndpointLayer[],
  selected: CompactPath,
  candidates: readonly CutterGridIkCandidate[][],
  expandedActionIndex: number | undefined,
  options: CutterGridCompactPtpPlannerV4Options,
): CutterTrajectoryPlanV4 {
  const connectionByAction = new Map(
    layers.map((layer, index) => [layer.actionIndex, selected.connections[index]]),
  );
  const actions = compiled.executableActions.map((action, actionIndex) => {
    if (action.type === 'wait') {
      return { ...action, expectedCutVoxels: [] } satisfies CutterGridTrajectoryActionV4;
    }
    const connection = connectionByAction.get(actionIndex);
    if (!connection) {
      throw new CutterGridCompactPtpV4PlanningError(
        'motion-primitive-budget-exhausted',
        'Selected V4 path has no compact PTP motion for a Move action.',
        {
          sourceBlockId: action.sourceBlockId,
          targetCoord: action.endCoord,
          startCoord: action.startCoord,
          actionIndex,
          stage: 'serialization',
        },
      );
    }
    return {
      ...action,
      primitives: connection.primitives,
      contactEvents: [],
      expectedCutVoxels: [],
    } satisfies CutterGridTrajectoryActionV4;
  });
  const entry = profile.entryOptions[selected.entryIndex];
  const diagnostics = diagnosticsForPath(selected, candidates, expandedActionIndex);
  const unsigned: Omit<CutterTrajectoryPlanV4, 'trajectorySignature'> = {
    kind: 'cutter-grid-trajectory',
    version: 4,
    plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
    challengeSignature: profile.challengeSignature,
    positioning: {
      entryOptionId: entry.id,
      primitives: [entry.positioningPrimitive],
      trajectorySignature: entry.positioningSignature,
    },
    startCoord: [0, 0, 0],
    endCoord: layers.at(-1)?.action.endCoord ?? [0, 0, 0],
    actions,
    // Finalization below replaces this placeholder with certified actual-sweep
    // contacts before the plan can leave the planner.
    expectedResultVoxels: [...challenge.initialHair.voxels].sort(),
    estimatedDurationMs: actions.reduce((sum, action) => sum + (
      action.type === 'wait'
        ? action.durationMs
        : action.primitives.reduce((duration, primitive) => duration + primitive.durationMs, 0)
    ), 0),
    executedCommandCount: compiled.executedCommandCount,
    motionLimits: profile.motionLimits,
    motionLimitsSignature: profile.motionLimitsSignature,
    diagnostics,
  };
  report(options, 'certifying-motion', 0, actions.length, expandedActionIndex);
  const finalized = finalizeCutterGridCompactPtpPlanV4(challenge, {
    ...unsigned,
    trajectorySignature: fnv1a64(JSON.stringify(unsigned)),
  });
  report(options, 'certifying-sweep', actions.length, actions.length, expandedActionIndex);
  return finalized;
}

function diagnosticsForPath(
  selected: CompactPath,
  candidates: readonly CutterGridIkCandidate[][],
  expandedActionIndex: number | undefined,
): CutterGridPlanningDiagnosticsV4 {
  return {
    endpointLayerCount: candidates.length,
    candidateCounts: candidates.map((layer) => layer.length),
    ...(expandedActionIndex === undefined ? {} : { expandedActionIndex }),
    directPrimitiveCount: selected.connections.filter((connection) => connection.primitiveCount === 1).length,
    detourPrimitiveCount: selected.connections.filter((connection) => connection.primitiveCount === 2).length * 2,
    minimumHeadClearance: Math.min(...selected.connections.map((connection) => connection.minimumHeadClearance)),
    minimumJointLimitMargin: Math.min(...selected.connections.map((connection) => connection.minimumJointLimitMargin)),
    maximumNormalizedJointStep: Math.max(...selected.connections.map((connection) => connection.maximumNormalizedJointStep)),
    maximumEndEffectorChordDeviation: Math.max(...selected.connections.map((connection) => connection.chordDeviation)),
    requestedSpeedScale: CUTTER_GRID_COMPACT_PTP_DEFAULT_SPEED_SCALE,
    actualSpeedScale: 0,
    maximumVelocityRatio: Number.POSITIVE_INFINITY,
    maximumAccelerationRatio: Number.POSITIVE_INFINITY,
    maximumJerkRatio: Number.POSITIVE_INFINITY,
    adaptiveValidationSampleCount: 0,
  };
}

function assertInputs(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV2,
  profile: CutterGridProfileV4,
): void {
  if (
    compiled.program.plannerVersion !== CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION ||
    !cutterGridProfileV4MatchesChallenge(profile, challenge)
  ) {
    throw new CutterGridCompactPtpV4PlanningError(
      'profile-v4-mismatch',
      'Cutter Grid V4 program and Profile must match the signed compact PTP contract.',
      { stage: 'profile' },
    );
  }
}

function noEndpointCandidate(layer: EndpointLayer): CutterGridCompactPtpV4PlanningError {
  return new CutterGridCompactPtpV4PlanningError(
    'endpoint-ik-not-converged',
    `No collision-free V4 endpoint IK candidate was found for ${formatCoord(layer.action.endCoord)}.`,
    {
      sourceBlockId: layer.action.sourceBlockId,
      targetCoord: layer.action.endCoord,
      startCoord: layer.action.startCoord,
      actionIndex: layer.actionIndex,
      stage: 'endpoint',
    },
  );
}

function report(
  options: CutterGridCompactPtpPlannerV4Options,
  phase: CutterGridPlanningPhaseV4,
  completedActions: number,
  totalActions: number,
  expandedActionIndex: number | undefined,
): void {
  options.onProgress?.({
    phase,
    completedActions,
    totalActions,
    ...(expandedActionIndex === undefined ? {} : { expandedActionIndex }),
  });
}

function throwIfCancelled(options: CutterGridCompactPtpPlannerV4Options): void {
  if (options.shouldCancel?.()) {
    throw new CutterGridCompactPtpV4PlanningError(
      'planning-cancelled',
      'Cutter Grid compact PTP planning was cancelled because its inputs changed.',
    );
  }
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction: Vec3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (
      (point[0] - start[0]) * direction[0] +
      (point[1] - start[1]) * direction[1] +
      (point[2] - start[2]) * direction[2]
    ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + direction[0] * progress),
    point[1] - (start[1] + direction[1] * progress),
    point[2] - (start[2] + direction[2] * progress),
  );
}

function formatCoord(coord: CutterGridCoord): string {
  return `(${coord.join(', ')})`;
}
