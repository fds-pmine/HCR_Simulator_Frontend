import type { Challenge, JointId, Vec3Tuple, VoxelKey } from '../../types/domain';
import { findRobotHeadCollision } from '../robot/headCollision';
import { computeRobotPose } from '../robot/kinematics';
import { findSweptVoxelHits } from '../voxel/contactDetection';
import {
  cutterGridHermiteAngleDerivative,
  sampleCutterGridHermiteEdge,
  validateCutterGridContinuousEdge,
} from './continuousEdge';
import {
  enumerateCutterGridIkCandidates,
  type CutterGridIkCandidate,
  type CutterGridSeedBudget,
} from './ik';
import { cutterGridBoundsContain, cutterGridCoordToWorld, moveCutterGridCoord } from './grid';
import { fnv1a64 } from './signature';
import {
  CUTTER_GRID_LADDER_PLANNER_VERSION,
  type CompiledCutterGridProgramV1,
  type CutterGridAtomicActionV1,
  type CutterGridCoord,
  type CutterGridPlanningDiagnosticsV2,
  type CutterGridPlanningErrorCodeV2,
  type CutterGridPlanningPhaseV2,
  type CutterGridProfileV2,
  type CutterTrajectoryPlanV2,
  type CutterTrajectoryStepV2,
  type CutterTrajectoryWaypointV2,
} from './types';

const SUBDIVISIONS_PER_CELL = 4;
const NUMBER_TOLERANCE = 1e-12;

export class CutterGridLadderPlanningError extends Error {
  constructor(
    public readonly code: CutterGridPlanningErrorCodeV2 | 'out-of-bounds' | 'planning-cancelled',
    message: string,
    public readonly details: {
      sourceBlockId?: string;
      actionIndex?: number;
      layerIndex?: number;
      startCoord?: CutterGridCoord;
      targetCoord?: CutterGridCoord;
      stage?: 'candidate' | 'entry' | 'edge' | 'serialization';
      seedBudget?: CutterGridSeedBudget;
    } = {},
  ) {
    super(message);
    this.name = 'CutterGridLadderPlanningError';
  }
}

export interface CutterGridLadderPlannerOptions {
  shouldCancel?: () => boolean;
  onProgress?: (progress: {
    phase: CutterGridPlanningPhaseV2;
    completedLayers: number;
    totalLayers: number;
    seedBudget: CutterGridSeedBudget;
    disconnectedLayer?: number;
  }) => void;
}

interface CartesianLayer {
  index: number;
  actionIndex: number;
  sourceBlockId: string;
  startCoord: CutterGridCoord;
  targetCoord: CutterGridCoord;
  lineStart: Vec3Tuple;
  lineEnd: Vec3Tuple;
  target: Vec3Tuple;
  directionChangedBefore: boolean;
  directionChangedAfter: boolean;
}

interface LadderPath {
  entryIndex: number;
  candidates: CutterGridIkCandidate[];
  edgeMetrics: Array<Extract<ReturnType<typeof validateCutterGridContinuousEdge>, { valid: true }>>;
}

/**
 * Whole-program layered search used by Cutter Grid V2.  Candidates are never
 * greedily selected by their predecessor: all safe branches remain available
 * until a single deterministic global path is selected.
 */
export function planCutterGridLadderTrajectory(
  challenge: Challenge,
  compiled: CompiledCutterGridProgramV1,
  profile: CutterGridProfileV2,
  options: CutterGridLadderPlannerOptions = {},
): CutterTrajectoryPlanV2 {
  assertInputs(challenge, compiled, profile);
  const layers = buildCartesianLayers(challenge, compiled.runtimeActions, profile);
  if (layers.length === 0) {
    throw new CutterGridLadderPlanningError(
      'planning-search-exhausted',
      'Cutter Grid program contains no Cartesian move layers.',
    );
  }
  let lastDisconnectedLayer: number | undefined;
  let expandedRange: readonly [number, number] | undefined;
  for (const seedBudget of [24, 96, 384] as const) {
    throwIfCancelled(options);
    const layersWithCandidates = generateLayerCandidates(
      challenge, profile, layers, seedBudget, options,
    );
    const missing = layersWithCandidates.findIndex((candidates) => candidates.length === 0);
    if (missing >= 0) {
      const layer = layers[missing];
      if (seedBudget === 384) {
        throw new CutterGridLadderPlanningError(
          'no-safe-ik-candidate',
          `No safe IK candidate was found for ${formatCoord(layer.targetCoord)}.`,
          layerDetails(layer, 'candidate', seedBudget),
        );
      }
      lastDisconnectedLayer = missing;
      expandedRange ??= expansionRangeFor(layers, missing);
      continue;
    }
    options.onProgress?.({
      phase: 'connecting-graph',
      completedLayers: layers.length,
      totalLayers: layers.length,
      seedBudget,
    });
    const selected = selectGlobalPath(challenge, profile, layers, layersWithCandidates, options);
    if (!selected) {
      lastDisconnectedLayer = findFirstDisconnectedLayer(
        challenge, profile, layers, layersWithCandidates,
      );
      expandedRange ??= expansionRangeFor(layers, lastDisconnectedLayer);
      if (seedBudget !== 384) continue;
      const layer = layers[lastDisconnectedLayer ?? 0];
      const hasInitialConnection = hasAnyEntryConnection(
        challenge, profile, layers[0], layersWithCandidates[0],
      );
      throw new CutterGridLadderPlanningError(
        hasInitialConnection ? 'planning-search-exhausted' : 'no-compatible-entry',
        hasInitialConnection
          ? `Cutter Grid exhausted its deterministic branch budget near ${formatCoord(layer.targetCoord)} without proving physical unreachability.`
          : 'Safe IK branches exist, but none connect to a certified Cutter Grid entry.',
        layerDetails(layer, hasInitialConnection ? 'edge' : 'entry', seedBudget),
      );
    }
    options.onProgress?.({
      phase: 'selecting-path',
      completedLayers: layers.length,
      totalLayers: layers.length,
      seedBudget,
    });
    const plan = buildFrozenPlan(challenge, compiled, profile, layers, layersWithCandidates, selected, seedBudget, expandedRange);
    options.onProgress?.({
      phase: 'validating-trajectory',
      completedLayers: layers.length,
      totalLayers: layers.length,
      seedBudget,
    });
    return plan;
  }
  throw new CutterGridLadderPlanningError(
    'planning-search-exhausted',
    'Cutter Grid planning exhausted its deterministic search budget without proving physical unreachability.',
    { layerIndex: lastDisconnectedLayer, stage: 'edge', seedBudget: 384 },
  );
}

function buildCartesianLayers(
  challenge: Challenge,
  actions: readonly CutterGridAtomicActionV1[],
  profile: CutterGridProfileV2,
): CartesianLayer[] {
  const layers: CartesianLayer[] = [];
  let coord: CutterGridCoord = [0, 0, 0];
  let previousDirection: string | undefined;
  let mustStopBefore = true;
  for (const [actionIndex, action] of actions.entries()) {
    if (action.type === 'wait') {
      previousDirection = undefined;
      mustStopBefore = true;
      continue;
    }
    const targetCoord = moveCutterGridCoord(coord, action.direction);
    if (!cutterGridBoundsContain(profile.bounds, targetCoord)) {
      throw new CutterGridLadderPlanningError(
        'out-of-bounds',
        `Cutter Grid coordinate ${formatCoord(targetCoord)} is outside the certified boundary.`,
        { sourceBlockId: action.sourceBlockId, actionIndex, startCoord: coord, targetCoord },
      );
    }
    const lineStart = cutterGridCoordToWorld(coord, profile.originHairCoord, challenge.voxelConfig);
    const lineEnd = cutterGridCoordToWorld(targetCoord, profile.originHairCoord, challenge.voxelConfig);
    for (let subdivision = 1; subdivision <= SUBDIVISIONS_PER_CELL; subdivision += 1) {
      const target = interpolate(lineStart, lineEnd, subdivision / SUBDIVISIONS_PER_CELL);
      layers.push({
        index: layers.length,
        actionIndex,
        sourceBlockId: action.sourceBlockId,
        startCoord: coord,
        targetCoord,
        lineStart,
        lineEnd,
        target,
        directionChangedBefore: subdivision === 1 && (
          mustStopBefore ||
          (previousDirection !== undefined && previousDirection !== action.direction)
        ),
        directionChangedAfter: false,
      });
    }
    const nextAction = actions[actionIndex + 1];
    const last = layers.at(-1);
    if (last && (nextAction?.type !== 'move-cell' || nextAction.direction !== action.direction)) {
      last.directionChangedAfter = true;
    }
    coord = targetCoord;
    previousDirection = action.direction;
    mustStopBefore = false;
  }
  return layers;
}

function generateLayerCandidates(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  layers: readonly CartesianLayer[],
  seedBudget: CutterGridSeedBudget,
  options: CutterGridLadderPlannerOptions,
): CutterGridIkCandidate[][] {
  const result: CutterGridIkCandidate[][] = [];
  for (const layer of layers) {
    throwIfCancelled(options);
    const previousLayer = result.at(-1);
    const candidates = enumerateCutterGridIkCandidates(challenge, layer.target, {
      maxError: challenge.voxelConfig.size / 32,
      ...(previousLayer ? { previousLayer } : {}),
      entryOptions: profile.entryOptions.map((entry) => ({ id: entry.id, jointAngles: entry.jointAngles })),
      seedBudget,
      // The deterministic search budget scales both seeds and the retained
      // farthest-point set.  We do not omit candidate-to-candidate edges;
      // only a proven disconnected graph triggers the next (8/16/32)
      // diversity tier.  All tiers remain within the V2 128-candidate cap.
      candidateLimit: seedBudget === 24 ? 8 : seedBudget === 96 ? 16 : 32,
      candidateNamespace: `layer-${layer.index}`,
      shouldCancel: options.shouldCancel,
    });
    result.push(candidates);
    options.onProgress?.({
      phase: 'generating-candidates',
      completedLayers: layer.index + 1,
      totalLayers: layers.length,
      seedBudget,
    });
  }
  return result;
}

function selectGlobalPath(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  layers: readonly CartesianLayer[],
  candidates: readonly CutterGridIkCandidate[][],
  options: CutterGridLadderPlannerOptions,
): LadderPath | undefined {
  interface State { path: LadderPath; score: PathScore; }
  const edgeCache = new Map<string, Extract<ReturnType<typeof validateCutterGridContinuousEdge>, { valid: true }> | undefined>();
  const validateEdge = (
    previous: Readonly<Record<JointId, number>> | undefined,
    start: Readonly<Record<JointId, number>>,
    end: Readonly<Record<JointId, number>>,
    next: Readonly<Record<JointId, number>> | undefined,
    lineStart: Vec3Tuple,
    lineEnd: Vec3Tuple,
    previousId: string | undefined,
    startId: string,
    endId: string,
    nextId: string | undefined,
    startTangentZero: boolean,
    endTangentZero: boolean,
  ) => {
    const key = `${previousId ?? 'zero'}>${startId}>${endId}>${nextId ?? 'zero'}|${lineStart.join(',')}>${lineEnd.join(',')}|${startTangentZero ? 1 : 0}${endTangentZero ? 1 : 0}`;
    if (edgeCache.has(key)) return edgeCache.get(key);
    const edge = validateCutterGridContinuousEdge(challenge, {
      ...(previous ? { previousAngles: previous } : {}),
      startAngles: start,
      endAngles: end,
      ...(next ? { nextAngles: next } : {}),
      lineStart,
      lineEnd,
      startTangentZero,
      endTangentZero,
    });
    const valid = edge.valid ? edge : undefined;
    edgeCache.set(key, valid);
    return valid;
  };
  let states: State[] = [];
  for (const [entryIndex, entry] of profile.entryOptions.entries()) {
    for (const candidate of candidates[0]) {
      states.push({
        path: { entryIndex, candidates: [candidate], edgeMetrics: [] },
        score: scorePath(challenge, entryIndex, [candidate], []),
      });
    }
  }
  if (states.length === 0) return undefined;
  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    throwIfCancelled(options);
    const nextStates = new Map<string, State>();
    for (const state of states) {
      for (const candidate of candidates[layerIndex]) {
        const previous = state.path.candidates.at(-1)!;
        const beforePrevious = state.path.candidates.at(-2);
        const entry = profile.entryOptions[state.path.entryIndex];
        const segmentStart = beforePrevious?.jointAngles ?? entry.jointAngles;
        const segmentStartId = beforePrevious?.id ?? entry.id;
        const segmentEnd = previous.jointAngles;
        const segmentEndId = previous.id;
        const segmentPrevious = beforePrevious
          ? (state.path.candidates.at(-3)?.jointAngles ?? entry.jointAngles)
          : undefined;
        const segmentPreviousId = beforePrevious
          ? (state.path.candidates.at(-3)?.id ?? entry.id)
          : undefined;
        const segmentLayer = layers[layerIndex - 1];
        const edge = validateEdge(
          segmentPrevious,
          segmentStart,
          segmentEnd,
          candidate.jointAngles,
          segmentLayer.lineStart,
          segmentLayer.lineEnd,
          segmentPreviousId,
          segmentStartId,
          segmentEndId,
          candidate.id,
          !beforePrevious || layers[layerIndex - 2]?.directionChangedAfter === true,
          segmentLayer.directionChangedAfter,
        );
        if (!edge) continue;
        const path: LadderPath = {
          entryIndex: state.path.entryIndex,
          candidates: [...state.path.candidates, candidate],
          edgeMetrics: [...state.path.edgeMetrics, edge],
        };
        const nextState = { path, score: scorePath(challenge, path.entryIndex, path.candidates, path.edgeMetrics) };
        const stateKey = `${path.candidates.at(-2)?.id}|${path.candidates.at(-1)?.id}`;
        const known = nextStates.get(stateKey);
        // The pair (q[i-1], q[i]) is the full Markov state for a C1
        // second-order ladder.  Retaining its best prefix is a sound dominance
        // reduction; no nearest-neighbour predecessor branch is discarded.
        if (!known || comparePathScore(nextState.score, known.score) < 0) {
          nextStates.set(stateKey, nextState);
        }
      }
    }
    if (nextStates.size === 0) return undefined;
    states = [...nextStates.values()];
  }
  const finished = states.flatMap((state) => {
    const end = state.path.candidates.at(-1)!;
    const start = state.path.candidates.at(-2);
    const entry = profile.entryOptions[state.path.entryIndex];
    const finalLayer = layers.at(-1)!;
    const edge = validateEdge(
      start ? (state.path.candidates.at(-3)?.jointAngles ?? entry.jointAngles) : undefined,
      start?.jointAngles ?? entry.jointAngles,
      end.jointAngles,
      undefined,
      finalLayer.lineStart,
      finalLayer.lineEnd,
      start ? (state.path.candidates.at(-3)?.id ?? entry.id) : undefined,
      start?.id ?? entry.id,
      end.id,
      undefined,
      start ? layers[layers.length - 2]?.directionChangedAfter === true : true,
      true,
    );
    if (!edge) return [];
    const path: LadderPath = {
      entryIndex: state.path.entryIndex,
      candidates: state.path.candidates,
      edgeMetrics: [...state.path.edgeMetrics, edge],
    };
    return [{ path, score: scorePath(challenge, path.entryIndex, path.candidates, path.edgeMetrics) }];
  });
  finished.sort((left, right) => comparePathScore(left.score, right.score));
  return finished[0]?.path;
}

interface PathScore {
  maximumStep: number;
  displacementSquared: number;
  secondDifferenceSquared: number;
  minimumHeadClearance: number;
  minimumJointLimitMargin: number;
  lexicographicAngles: number[];
}

function scorePath(
  challenge: Challenge,
  entryIndex: number,
  candidates: readonly CutterGridIkCandidate[],
  edges: readonly Extract<ReturnType<typeof validateCutterGridContinuousEdge>, { valid: true }>[],
): PathScore {
  return {
    maximumStep: Math.max(0, ...edges.map((edge) => edge.metrics.maximumNormalizedJointStep)),
    displacementSquared: edges.reduce((sum, edge) => sum + edge.metrics.cumulativeNormalizedJointDisplacementSquared, 0),
    secondDifferenceSquared: edges.reduce((sum, edge) => sum + edge.metrics.secondDifferenceSquared, 0),
    minimumHeadClearance: edges.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...edges.map((edge) => edge.metrics.minimumHeadClearance)),
    minimumJointLimitMargin: edges.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...edges.map((edge) => edge.metrics.minimumJointLimitMargin)),
    lexicographicAngles: [entryIndex, ...candidates.flatMap((candidate) =>
      challenge.robotConfig.joints.map((joint) => candidate.jointAngles[joint.id]),
    )],
  };
}

function comparePathScore(left: PathScore, right: PathScore): number {
  for (const [leftValue, rightValue, direction] of [
    [left.maximumStep, right.maximumStep, 1],
    [left.displacementSquared, right.displacementSquared, 1],
    [left.secondDifferenceSquared, right.secondDifferenceSquared, 1],
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
  compiled: CompiledCutterGridProgramV1,
  profile: CutterGridProfileV2,
  layers: readonly CartesianLayer[],
  allCandidates: readonly CutterGridIkCandidate[][],
  selected: LadderPath,
  seedBudget: CutterGridSeedBudget,
  expandedRange: readonly [number, number] | undefined,
): CutterTrajectoryPlanV2 {
  const selectedEntry = profile.entryOptions[selected.entryIndex];
  const sampledLayers = layers.map((layer, index) => ({ layer, candidate: selected.candidates[index], index }));
  const actionWaypoints = new Map<number, CutterTrajectoryWaypointV2[]>();
  for (const { layer, candidate, index } of sampledLayers) {
    const action = actionWaypoints.get(layer.actionIndex) ?? [];
    const segment = sampleFrozenLayer(
      challenge,
      index > 0 ? selected.candidates[index - 1].jointAngles : selectedEntry.jointAngles,
      candidate.jointAngles,
      index > 1 ? selected.candidates[index - 2].jointAngles : undefined,
      selected.candidates[index + 1]?.jointAngles,
      layer,
    );
    const offset = action.at(-1)?.timeMs ?? 0;
    segment.forEach((waypoint, index) => {
      if (action.length > 0 && index === 0) return;
      action.push({ ...waypoint, timeMs: offset + waypoint.timeMs });
    });
    actionWaypoints.set(layer.actionIndex, action);
  }
  const steps = buildSteps(
    challenge,
    compiled.runtimeActions,
    actionWaypoints,
    profile.originHairCoord,
    selectedEntry.jointAngles,
  );
  validateSteps(challenge, steps, profile.originHairCoord);
  const expectedResultVoxels = applyContacts(challenge, steps);
  const diagnostics = diagnosticsForPath(challenge, selected, allCandidates, seedBudget, expandedRange);
  const unsigned: Omit<CutterTrajectoryPlanV2, 'trajectorySignature'> = {
    kind: 'cutter-grid-trajectory',
    version: 2,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
    challengeSignature: profile.challengeSignature,
    entryOptionId: selectedEntry.id,
    positioningTrajectory: selectedEntry.positioningTrajectory,
    startCoord: [0, 0, 0],
    endCoord: steps.at(-1)?.endCoord ?? [0, 0, 0],
    steps,
    expectedResultVoxels,
    estimatedDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    executedCommandCount: compiled.executedCommandCount,
    diagnostics,
  };
  return { ...unsigned, trajectorySignature: fnv1a64(JSON.stringify(unsigned)) };
}

function buildSteps(
  challenge: Challenge,
  actions: readonly CutterGridAtomicActionV1[],
  actionWaypoints: ReadonlyMap<number, CutterTrajectoryWaypointV2[]>,
  originHairCoord: CutterGridCoord,
  entryAngles: Record<JointId, number>,
): CutterTrajectoryStepV2[] {
  let coord: CutterGridCoord = [0, 0, 0];
  let previousAngles: Record<JointId, number> = entryAngles;
  return actions.map((action, index) => {
    if (action.type === 'wait') {
      const angles = previousAngles;
      const pose = computeRobotPose(challenge.robotConfig, angles).endEffector;
      return {
        index,
        kind: 'wait' as const,
        sourceBlockId: action.sourceBlockId,
        startCoord: coord,
        endCoord: coord,
        durationMs: action.durationMs,
        waypoints: [
          { timeMs: 0, jointAngles: angles, jointVelocitiesDegPerSec: zeroVelocities(challenge), endEffector: pose },
          { timeMs: action.durationMs, jointAngles: angles, jointVelocitiesDegPerSec: zeroVelocities(challenge), endEffector: pose },
        ],
        expectedCutVoxels: [],
      };
    }
    const endCoord = moveCutterGridCoord(coord, action.direction);
    const samples = actionWaypoints.get(index) ?? [];
    const start = previousAngles;
    if (!start || samples.length === 0) {
      throw new CutterGridLadderPlanningError('planning-search-exhausted', 'Selected ladder path has an incomplete action trajectory.', {
        sourceBlockId: action.sourceBlockId, actionIndex: index, targetCoord: endCoord, stage: 'serialization',
      });
    }
    const waypoints = [
      {
        timeMs: 0,
        jointAngles: start,
        jointVelocitiesDegPerSec: zeroVelocities(challenge),
        endEffector: computeRobotPose(challenge.robotConfig, start).endEffector,
      },
      ...samples.slice(1),
    ];
    previousAngles = samples.at(-1)!.jointAngles;
    const step = {
      index,
      kind: 'move-cell' as const,
      sourceBlockId: action.sourceBlockId,
      startCoord: coord,
      endCoord,
      durationMs: samples.at(-1)!.timeMs,
      waypoints,
      expectedCutVoxels: [],
    };
    coord = endCoord;
    return step;
  });
}

function validateSteps(challenge: Challenge, steps: readonly CutterTrajectoryStepV2[], originHairCoord: CutterGridCoord): void {
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    const start = cutterGridCoordToWorld(step.startCoord, originHairCoord, challenge.voxelConfig);
    const end = cutterGridCoordToWorld(step.endCoord, originHairCoord, challenge.voxelConfig);
    for (const waypoint of step.waypoints) {
      const pose = computeRobotPose(challenge.robotConfig, waypoint.jointAngles);
      if (findRobotHeadCollision(pose, challenge.voxelConfig, challenge.robotConfig.geometry)) {
        throw new CutterGridLadderPlanningError('no-continuous-joint-path', 'Quantized V2 trajectory collides with the head.', {
          sourceBlockId: step.sourceBlockId, actionIndex: step.index, targetCoord: step.endCoord, stage: 'serialization',
        });
      }
      if (pointSegmentDistance(pose.endEffector, start, end) > challenge.voxelConfig.size / 16 + 1e-9) {
        throw new CutterGridLadderPlanningError('no-continuous-joint-path', 'Quantized V2 trajectory deviates from its fixed-axis path.', {
          sourceBlockId: step.sourceBlockId, actionIndex: step.index, targetCoord: step.endCoord, stage: 'serialization',
        });
      }
    }
  }
}

function applyContacts(challenge: Challenge, steps: CutterTrajectoryStepV2[]): VoxelKey[] {
  const remaining = new Set(challenge.initialHair.voxels);
  for (const step of steps) {
    if (step.kind === 'wait') continue;
    const hits = new Set<VoxelKey>();
    for (let index = 1; index < step.waypoints.length; index += 1) {
      findSweptVoxelHits(step.waypoints[index - 1].endEffector, step.waypoints[index].endEffector, remaining, challenge.voxelConfig, challenge.robotConfig.geometry.toolRadius)
        .forEach((key) => hits.add(key));
    }
    step.expectedCutVoxels = [...hits].sort();
    hits.forEach((key) => remaining.delete(key));
  }
  return [...remaining].sort();
}

function diagnosticsForPath(
  challenge: Challenge,
  selected: LadderPath,
  candidates: readonly CutterGridIkCandidate[][],
  seedBudget: CutterGridSeedBudget,
  expandedRange: readonly [number, number] | undefined,
): CutterGridPlanningDiagnosticsV2 {
  const score = scorePath(challenge, selected.entryIndex, selected.candidates, selected.edgeMetrics);
  return {
    entryOptionId: `entry-${selected.entryIndex.toString().padStart(2, '0')}`,
    cartesianLayerCount: candidates.length,
    candidateCounts: candidates.map((layer) => layer.length),
    seedBudgetUsed: seedBudget,
    ...(expandedRange ? { expandedRange } : {}),
    minimumHeadClearance: score.minimumHeadClearance,
    minimumJointLimitMargin: score.minimumJointLimitMargin,
    maximumNormalizedJointStep: score.maximumStep,
  };
}

function sampleFrozenLayer(
  challenge: Challenge,
  start: Readonly<Record<JointId, number>>,
  end: Readonly<Record<JointId, number>>,
  previous: Readonly<Record<JointId, number>> | undefined,
  next: Readonly<Record<JointId, number>> | undefined,
  layer: CartesianLayer,
): CutterTrajectoryWaypointV2[] {
  const input = {
    ...(previous ? { previousAngles: previous } : {}),
    startAngles: start,
    endAngles: end,
    ...(next ? { nextAngles: next } : {}),
    lineStart: layer.lineStart,
    lineEnd: layer.lineEnd,
    startTangentZero: layer.directionChangedBefore,
    endTangentZero: layer.directionChangedAfter,
  };
  const sampled = sampleCutterGridHermiteEdge(challenge, input);
  if (!sampled.valid || !sampled.samples || !sampled.tangents) {
    throw new CutterGridLadderPlanningError(
      'no-continuous-joint-path',
      `Quantized V2 trajectory is invalid after selecting ${formatCoord(layer.targetCoord)}.`,
      layerDetails(layer, 'serialization', 24),
    );
  }
  const durationMs = Math.max(1, Math.ceil(Math.max(...Array.from({ length: 33 }, (_, index) => {
    const derivative = cutterGridHermiteAngleDerivative(challenge, input, sampled.tangents!, index / 32);
    return Math.max(...challenge.robotConfig.joints.map((joint) =>
      (Math.abs(derivative[joint.id]) / joint.speedDegPerSec) * 1000,
    ));
  }))));
  return sampled.samples.map((sample) => {
    const derivative = cutterGridHermiteAngleDerivative(challenge, input, sampled.tangents!, sample.progress);
    return {
      timeMs: Math.round(durationMs * sample.progress),
      jointAngles: sample.angles,
      jointVelocitiesDegPerSec: Object.fromEntries(challenge.robotConfig.joints.map((joint) => [
        joint.id,
        derivative[joint.id] / (durationMs / 1000),
      ])) as Record<JointId, number>,
      endEffector: sample.endEffector,
    };
  });
}

function zeroVelocities(challenge: Challenge): Record<JointId, number> {
  return Object.fromEntries(challenge.robotConfig.joints.map((joint) => [joint.id, 0])) as Record<JointId, number>;
}

function findFirstDisconnectedLayer(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  layers: readonly CartesianLayer[],
  candidates: readonly CutterGridIkCandidate[][],
): number {
  for (let index = 0; index < candidates.length; index += 1) {
    if (index === 0 && !hasAnyEntryConnection(challenge, profile, layers[0], candidates[0])) return 0;
    if (index > 0 && !candidates[index - 1].some((left) => candidates[index].some((right) =>
      validateCutterGridContinuousEdge(challenge, {
        startAngles: left.jointAngles, endAngles: right.jointAngles,
        lineStart: layers[index].lineStart, lineEnd: layers[index].lineEnd,
        startTangentZero: layers[index - 1].directionChangedAfter,
        endTangentZero: layers[index].directionChangedAfter,
      }).valid,
    ))) return index;
  }
  return 0;
}

function expansionRangeFor(layers: readonly CartesianLayer[], disconnectedLayer: number): readonly [number, number] {
  // A C1 edge depends on its immediate predecessor and successor.  Expanding
  // one neighbour on either side is therefore sufficient for the first
  // disconnected interval while preserving the baseline candidate set for
  // unrelated parts of the player program.
  return [
    Math.max(0, disconnectedLayer - 1),
    Math.min(layers.length - 1, disconnectedLayer + 1),
  ];
}

function hasAnyEntryConnection(
  challenge: Challenge,
  profile: CutterGridProfileV2,
  layer: CartesianLayer,
  candidates: readonly CutterGridIkCandidate[],
): boolean {
  return profile.entryOptions.some((entry) => candidates.some((candidate) =>
    validateCutterGridContinuousEdge(challenge, {
      startAngles: entry.jointAngles,
      endAngles: candidate.jointAngles,
      lineStart: profile.originWorldPosition,
      lineEnd: layer.target,
      startTangentZero: true,
      endTangentZero: layer.directionChangedAfter,
    }).valid,
  ));
}

function normalizedDistanceBetween(
  left: CutterGridIkCandidate,
  right: CutterGridIkCandidate,
  challenge: Challenge,
): number {
  return Math.sqrt(challenge.robotConfig.joints.reduce((sum, joint) => {
    const span = joint.maxAngleDeg - joint.minAngleDeg;
    return sum + ((left.jointAngles[joint.id] - right.jointAngles[joint.id]) / span) ** 2;
  }, 0));
}

function assertInputs(challenge: Challenge, compiled: CompiledCutterGridProgramV1, profile: CutterGridProfileV2): void {
  if (compiled.program.plannerVersion !== CUTTER_GRID_LADDER_PLANNER_VERSION) {
    throw new CutterGridLadderPlanningError('planning-search-exhausted', 'Cutter Grid V2 rejects a V1 Program IR.', { stage: 'candidate' });
  }
  if (profile.plannerVersion !== CUTTER_GRID_LADDER_PLANNER_VERSION || profile.entryOptions.length < 2) {
    throw new CutterGridLadderPlanningError('no-compatible-entry', 'Cutter Grid V2 Profile is incomplete.', { stage: 'entry' });
  }
  if (!profile.challengeSignature) {
    throw new CutterGridLadderPlanningError('planning-search-exhausted', 'Cutter Grid V2 Profile has no challenge signature.', { stage: 'candidate' });
  }
}

function throwIfCancelled(options: CutterGridLadderPlannerOptions): void {
  if (options.shouldCancel?.()) {
    throw new CutterGridLadderPlanningError('planning-cancelled', 'Cutter Grid planning was cancelled.');
  }
}

function layerDetails(layer: CartesianLayer, stage: 'candidate' | 'entry' | 'edge' | 'serialization', seedBudget: CutterGridSeedBudget) {
  return {
    sourceBlockId: layer.sourceBlockId,
    actionIndex: layer.actionIndex,
    layerIndex: layer.index,
    startCoord: layer.startCoord,
    targetCoord: layer.targetCoord,
    stage,
    seedBudget,
  } as const;
}

function interpolate(start: Vec3Tuple, end: Vec3Tuple, progress: number): Vec3Tuple {
  return [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
    start[2] + (end[2] - start[2]) * progress,
  ];
}

function pointSegmentDistance(point: Vec3Tuple, start: Vec3Tuple, end: Vec3Tuple): number {
  const direction: Vec3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const progress = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (
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
