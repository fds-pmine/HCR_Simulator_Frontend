import type * as Blockly from 'blockly/core';
import type { Challenge } from '../../types/domain';
import {
  MAX_RUNTIME_COMMANDS,
  ProgramCompilationError,
} from '../blockly/programCompiler';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../blockly/blockConstants';
import { resolveScalpMotionProfile } from './defaultProfile';
import { verifyScalpCompatibility } from './trajectoryExecutor';
import { SCALP_BLOCK_FIELDS, SCALP_BLOCK_TYPES } from './scalpBlockConstants';
import type {
  CompiledScalpProgram,
  ScalpCommand,
  ScalpProgram,
  ScalpProgramNode,
  TrajectoryPlan,
  TrajectorySegment,
} from './scalpProgramTypes';
import type {
  Heading,
  JointAngles,
  ScalpMotionProfile,
  SafetyEdge,
  ToolMode,
} from './types';

export const MAX_SCALP_ACTIONS = 200;

type CompilerErrorCode =
  | 'SCALP_UNSUPPORTED_PROFILE'
  | 'INVALID_FORWARD'
  | 'INVALID_TURN'
  | 'INVALID_TOOL_MODE'
  | 'UNREACHABLE_GRID_NODE'
  | 'NO_SAFE_ROUTE'
  | 'SCALP_ACTION_LIMIT_EXCEEDED'
  | 'HEAD_COLLISION'
  | 'HOVER_CONTACT'
  | 'COMPATIBILITY_DIVERGENCE';

interface TurtleState {
  nodeId: string;
  heading: Heading;
  toolMode: ToolMode;
  poseId: string;
}

export function compileScalpWorkspace(
  workspace: Blockly.Workspace,
  challenge: Challenge,
): CompiledScalpProgram {
  const resolution = resolveScalpMotionProfile(challenge);
  if (!resolution.profile) {
    throw scalpError('SCALP_UNSUPPORTED_PROFILE', resolution.error ?? 'No calibrated scalp profile is available.');
  }

  const topBlocks = workspace
    .getTopBlocks(true)
    .filter((block) => block.isEnabled() && !block.isShadow());
  if (topBlocks.length === 0) {
    throw new ProgramCompilationError('EMPTY_PROGRAM', 'The workspace does not contain an executable program.');
  }
  if (topBlocks.length > 1) {
    throw new ProgramCompilationError(
      'MULTIPLE_TOP_LEVEL_STACKS',
      'The workspace can contain only one top-level program stack.',
      topBlocks[1].id,
    );
  }

  const nodes = compileSequence(topBlocks[0]);
  if (nodes.length === 0) {
    throw new ProgramCompilationError('EMPTY_PROGRAM', 'The workspace does not contain an executable program.');
  }
  const scalpProgram: ScalpProgram = {
    nodes,
    sourceBlockCount: workspace
      .getAllBlocks(false)
      .filter((block) => block.isEnabled() && !block.isShadow()).length,
  };
  const actions = expandScalpProgram(scalpProgram);
  const trajectoryPlan = planTrajectory(actions, resolution.profile);
  const runtimeCommands = emitCompatibilityCommands(
    trajectoryPlan,
    resolution.profile,
    challenge,
  );
  const compatibility = verifyScalpCompatibility(
    trajectoryPlan,
    runtimeCommands,
    challenge,
  );
  if (!compatibility.valid) {
    const error = compatibility.synchronized.error ?? compatibility.error;
    const code = error?.includes('contact hair')
      ? 'HOVER_CONTACT'
      : error?.includes('contact the head')
        ? 'HEAD_COLLISION'
        : 'COMPATIBILITY_DIVERGENCE';
    throw scalpError(
      code,
      error ?? 'The synchronized path diverges from its compatibility program.',
      compatibility.synchronized.blockId ?? compatibility.legacy.blockId,
    );
  }

  return {
    scalpProgram,
    trajectoryPlan,
    program: { nodes: runtimeCommands, sourceBlockCount: scalpProgram.sourceBlockCount },
    runtimeCommands,
    executedCommandCount: runtimeCommands.length,
  };
}

export function expandScalpProgram(
  program: ScalpProgram,
  limit = MAX_SCALP_ACTIONS,
): ScalpCommand[] {
  const commands: ScalpCommand[] = [];
  const append = (nodes: readonly ScalpProgramNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'repeat') {
        for (let iteration = 0; iteration < node.count; iteration += 1) {
          append(node.body);
        }
      } else {
        commands.push({ ...node });
        if (commands.length > limit) {
          throw scalpError(
            'SCALP_ACTION_LIMIT_EXCEEDED',
            `The expanded path exceeds ${limit} turtle actions.`,
            node.sourceBlockId,
          );
        }
      }
    }
  };
  append(program.nodes);
  return commands;
}

function compileSequence(first: Blockly.Block): ScalpProgramNode[] {
  const nodes: ScalpProgramNode[] = [];
  let current: Blockly.Block | null = first;
  while (current) {
    if (current.isEnabled() && !current.isShadow()) {
      nodes.push(compileBlock(current));
    }
    current = current.getNextBlock();
  }
  return nodes;
}

function compileBlock(block: Blockly.Block): ScalpProgramNode {
  if (block.type === SCALP_BLOCK_TYPES.moveForward) {
    const steps = readNumber(block, SCALP_BLOCK_FIELDS.steps, 'INVALID_FORWARD');
    if (!Number.isInteger(steps) || steps < 1 || steps > 12) {
      throw scalpError('INVALID_FORWARD', 'Move Forward must use an integer between 1 and 12.', block.id);
    }
    return { type: 'move-forward', steps, sourceBlockId: block.id };
  }
  if (block.type === SCALP_BLOCK_TYPES.turn) {
    const direction = block.getFieldValue(SCALP_BLOCK_FIELDS.direction);
    if (direction !== 'left' && direction !== 'right') {
      throw scalpError('INVALID_TURN', 'Turn direction must be left or right.', block.id);
    }
    return { type: 'turn', direction, sourceBlockId: block.id };
  }
  if (block.type === SCALP_BLOCK_TYPES.setToolMode) {
    const mode = block.getFieldValue(SCALP_BLOCK_FIELDS.mode);
    if (mode !== 'hover' && mode !== 'cut') {
      throw scalpError('INVALID_TOOL_MODE', 'Cutter mode must be Hover or Cut.', block.id);
    }
    return { type: 'set-tool-mode', mode, sourceBlockId: block.id };
  }
  if (block.type === BLOCK_TYPES.wait) {
    const durationMs = readNumber(block, BLOCK_FIELDS.duration, 'INVALID_WAIT');
    if (durationMs < 0 || durationMs > 5_000) {
      throw new ProgramCompilationError('INVALID_WAIT', 'Wait duration must be between 0ms and 5000ms.', block.id);
    }
    return { type: 'wait', durationMs, sourceBlockId: block.id };
  }
  if (block.type === BLOCK_TYPES.repeat) {
    const count = readNumber(block, BLOCK_FIELDS.count, 'INVALID_REPEAT');
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new ProgramCompilationError('INVALID_REPEAT', 'Repeat count must be an integer between 1 and 20.', block.id);
    }
    const bodyBlock = block.getInputTargetBlock(BLOCK_FIELDS.body);
    if (!bodyBlock) {
      throw new ProgramCompilationError('EMPTY_REPEAT', 'Repeat must contain at least one command.', block.id);
    }
    const body = compileSequence(bodyBlock);
    if (body.length === 0) {
      throw new ProgramCompilationError('EMPTY_REPEAT', 'Repeat must contain at least one enabled command.', block.id);
    }
    return { type: 'repeat', count, body, sourceBlockId: block.id };
  }
  throw new ProgramCompilationError('DISALLOWED_BLOCK', `Block "${block.type}" is not allowed in Scalp Turtle mode.`, block.id);
}

function planTrajectory(
  actions: readonly ScalpCommand[],
  profile: ScalpMotionProfile,
): TrajectoryPlan {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const poses = new Map(profile.poses.map((pose) => [pose.id, pose]));
  const startNode = nodes.get(profile.startNodeId);
  if (!startNode?.hoverPoseId) {
    throw scalpError('NO_SAFE_ROUTE', 'The scalp profile does not define a reachable start node.');
  }
  const park = poses.get(profile.parkPoseId);
  if (!park) {
    throw scalpError('NO_SAFE_ROUTE', 'The scalp profile does not define a Park pose.');
  }

  const segments: TrajectorySegment[] = [];
  let state: TurtleState = {
    nodeId: startNode.id,
    heading: profile.startHeading,
    toolMode: 'hover',
    poseId: startNode.hoverPoseId,
  };
  let segmentIndex = 0;
  const add = (
    edge: SafetyEdge,
    sourceBlockId: string,
    actionIndex: number,
    stateAfter: TurtleState = state,
  ) => {
    segments.push({
      id: `segment-${segmentIndex++}`,
      sourceBlockId,
      actionIndex,
      kind: edge.kind,
      edge,
      cutterEnabled: edge.cuttingEnabled,
      gridNodeId: stateAfter.nodeId,
      heading: stateAfter.heading,
      toolMode: stateAfter.toolMode,
    });
  };

  // The first target is park; Phase 3 certifies this initial-pose transition
  // with the same continuous validator used at runtime.
  add(syntheticEdge('initial-to-park', 'initial', park.id, 'entry', false, park.jointAngles), '__scalp_entry__', -1);
  const entry = profile.edges.find((edge) => edge.kind === 'entry' && edge.from === park.id && edge.to === state.poseId);
  if (!entry) {
    throw scalpError('NO_SAFE_ROUTE', 'The scalp profile does not define a safe entry route.');
  }
  add(entry, '__scalp_entry__', -1);

  actions.forEach((action, actionIndex) => {
    if (action.type === 'turn') {
      state = { ...state, heading: rotate(state.heading, action.direction) };
      segments.push({
        id: `segment-${segmentIndex++}`,
        sourceBlockId: action.sourceBlockId,
        actionIndex,
        kind: 'turn',
        cutterEnabled: false,
        gridNodeId: state.nodeId,
        heading: state.heading,
        toolMode: state.toolMode,
      });
      return;
    }
    if (action.type === 'wait') {
      segments.push({
        id: `segment-${segmentIndex++}`,
        sourceBlockId: action.sourceBlockId,
        actionIndex,
        kind: 'wait',
        cutterEnabled: state.toolMode === 'cut',
        durationMs: action.durationMs,
        gridNodeId: state.nodeId,
        heading: state.heading,
        toolMode: state.toolMode,
      });
      return;
    }
    if (action.type === 'set-tool-mode') {
      if (action.mode === state.toolMode) {
        return;
      }
      const node = requireNode(nodes, state.nodeId, action.sourceBlockId);
      const targetPoseId = action.mode === 'cut' ? node.cutPoseId : node.hoverPoseId;
      if (!targetPoseId) {
        throw scalpError('UNREACHABLE_GRID_NODE', `Grid node ${node.id} does not support ${action.mode}.`, action.sourceBlockId);
      }
      const edge = requireEdge(profile, state.poseId, targetPoseId, action.sourceBlockId);
      const nextState = { ...state, toolMode: action.mode, poseId: targetPoseId };
      add(edge, action.sourceBlockId, actionIndex, nextState);
      state = nextState;
      return;
    }

    const moveStart = state;
    const route: Array<{ id: string; poseId: string }> = [];
    let cursor = state;
    for (let step = 0; step < action.steps; step += 1) {
      const node = requireNode(nodes, cursor.nodeId, action.sourceBlockId);
      const nextId = node.neighbors[cursor.heading];
      const next = nextId ? nodes.get(nextId) : undefined;
      if (!next || !next.reachable) {
        throw scalpError('UNREACHABLE_GRID_NODE', 'The path leaves the calibrated reachable grid.', action.sourceBlockId);
      }
      const targetPoseId = cursor.toolMode === 'cut' ? next.cutPoseId : next.hoverPoseId;
      if (!targetPoseId) {
        throw scalpError('UNREACHABLE_GRID_NODE', `Grid node ${next.id} is disabled.`, action.sourceBlockId);
      }
      route.push({ id: next.id, poseId: targetPoseId });
      cursor = { ...cursor, nodeId: next.id, poseId: targetPoseId };
    }
    const destination = route.at(-1);
    if (!destination) {
      return;
    }
    state = cursor;
    // Horizontal multi-cell moves use their profile's certified continuous
    // sweep edge. Vertical movement keeps a per-cell route because its poses
    // can change elbow and shoulder geometry between rows.
    if (
      route.length > 1 &&
      (moveStart.heading === 'east' || moveStart.heading === 'west')
    ) {
      const edge = requireEdge(
        profile,
        moveStart.poseId,
        destination.poseId,
        action.sourceBlockId,
      );
      add(edge, action.sourceBlockId, actionIndex, state);
      return;
    }
    let replayState = moveStart;
    for (const next of route) {
      const edge = requireEdge(profile, replayState.poseId, next.poseId, action.sourceBlockId);
      replayState = { ...replayState, nodeId: next.id, poseId: next.poseId };
      add(edge, action.sourceBlockId, actionIndex, replayState);
    }
  });

  if (state.toolMode === 'cut') {
    const node = requireNode(nodes, state.nodeId, '__scalp_exit__');
    const hoverPoseId = node.hoverPoseId;
    if (!hoverPoseId) {
      throw scalpError('NO_SAFE_ROUTE', 'The final Cut node cannot retract to Hover.');
    }
    const nextState: TurtleState = {
      ...state,
      toolMode: 'hover',
      poseId: hoverPoseId,
    };
    add(requireEdge(profile, state.poseId, hoverPoseId, '__scalp_exit__'), '__scalp_exit__', actions.length, nextState);
    state = nextState;
  }

  for (const edge of shortestPath(profile, state.poseId, startNode.hoverPoseId)) {
    const nextState = { ...state, poseId: edge.to };
    add(edge, '__scalp_exit__', actions.length, nextState);
    state = nextState;
  }
  const exit = profile.edges.find((edge) => edge.kind === 'exit' && edge.from === state.poseId && edge.to === park.id);
  if (!exit) {
    throw scalpError('NO_SAFE_ROUTE', 'The scalp profile does not define a safe exit route.');
  }
  add(exit, '__scalp_exit__', actions.length, state);

  return {
    segments,
    initialNodeId: startNode.id,
    finalNodeId: state.nodeId,
    finalHeading: state.heading,
    finalToolMode: state.toolMode,
  };
}

function emitCompatibilityCommands(
  plan: TrajectoryPlan,
  profile: ScalpMotionProfile,
  challenge: Challenge,
) {
  const current = Object.fromEntries(
    challenge.robotConfig.joints.map((joint) => [joint.id, joint.initialAngleDeg]),
  ) as JointAngles;
  const commands: import('../blockly/programTypes').RobotCommand[] = [];
  for (const segment of plan.segments) {
    if (segment.kind === 'turn') {
      segment.compatibilityCommandCount = 0;
      continue;
    }
    if (segment.kind === 'wait') {
      const durationMs = segment.durationMs;
      if (durationMs === undefined || !Number.isFinite(durationMs)) {
        throw new Error('Scalp wait segment is missing its duration.');
      }
      commands.push({ type: 'wait', durationMs, sourceBlockId: segment.sourceBlockId });
      segment.compatibilityCommandCount = 1;
      continue;
    }
    const commandStart = commands.length;
    for (const waypoint of segment.edge?.legacyWaypoints ?? []) {
      for (const joint of challenge.robotConfig.joints) {
        const target = waypoint[joint.id];
        if (!Number.isFinite(target)) {
          throw new Error(`Scalp edge ${segment.edge?.id} is missing ${joint.id}.`);
        }
        if (current[joint.id] === target) {
          continue;
        }
        commands.push({
          type: 'set-joint-angle',
          jointId: joint.id,
          angleDeg: target,
          sourceBlockId: segment.sourceBlockId,
        });
        current[joint.id] = target;
        if (commands.length > MAX_RUNTIME_COMMANDS) {
          throw new ProgramCompilationError('COMMAND_LIMIT_EXCEEDED', `The generated compatibility program exceeds ${MAX_RUNTIME_COMMANDS} atomic commands.`, segment.sourceBlockId);
        }
      }
    }
    segment.compatibilityCommandCount = commands.length - commandStart;
  }
  return commands;
}

function shortestPath(
  profile: ScalpMotionProfile,
  from: string,
  to: string,
): SafetyEdge[] {
  if (from === to) {
    return [];
  }
  const queue: Array<{ poseId: string; path: SafetyEdge[] }> = [{ poseId: from, path: [] }];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const candidates = profile.edges
      .filter((edge) => edge.from === current.poseId && !edge.cuttingEnabled)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const edge of candidates) {
      if (visited.has(edge.to)) {
        continue;
      }
      const path = [...current.path, edge];
      if (edge.to === to) {
        return path;
      }
      visited.add(edge.to);
      queue.push({ poseId: edge.to, path });
    }
  }
  throw scalpError('NO_SAFE_ROUTE', 'No safe Hover route reaches the Park exit.');
}

function requireEdge(profile: ScalpMotionProfile, from: string, to: string, blockId: string): SafetyEdge {
  const edge = profile.edges.find((item) => item.from === from && item.to === to);
  if (!edge) {
    throw scalpError('NO_SAFE_ROUTE', `No certified route connects ${from} to ${to}.`, blockId);
  }
  return edge;
}

function requireNode(
  nodes: ReadonlyMap<string, ScalpMotionProfile['nodes'][number]>,
  id: string,
  blockId: string,
) {
  const node = nodes.get(id);
  if (!node) {
    throw scalpError('UNREACHABLE_GRID_NODE', `Grid node ${id} does not exist.`, blockId);
  }
  return node;
}

function rotate(heading: Heading, direction: 'left' | 'right'): Heading {
  const headings: Heading[] = ['north', 'east', 'south', 'west'];
  const index = headings.indexOf(heading);
  return headings[(index + (direction === 'left' ? 3 : 1)) % headings.length];
}

function syntheticEdge(
  id: string,
  from: string,
  to: string,
  kind: SafetyEdge['kind'],
  cuttingEnabled: boolean,
  target: JointAngles,
): SafetyEdge {
  return {
    id,
    from,
    to,
    kind,
    cuttingEnabled,
    synchronousWaypoints: [{ ...target }],
    legacyWaypoints: [{ ...target }],
  };
}

function readNumber(
  block: Blockly.Block,
  fieldName: string,
  code: CompilerErrorCode | 'INVALID_WAIT' | 'INVALID_REPEAT',
): number {
  const value = Number(block.getFieldValue(fieldName));
  if (Number.isFinite(value)) {
    return value;
  }
  if (code === 'INVALID_WAIT' || code === 'INVALID_REPEAT') {
    throw new ProgramCompilationError(code, `Field "${fieldName}" must be a finite number.`, block.id);
  }
  throw scalpError(code, `Field "${fieldName}" must be a finite number.`, block.id);
}

function scalpError(code: CompilerErrorCode, message: string, blockId?: string): ProgramCompilationError {
  return new ProgramCompilationError(code as never, message, blockId);
}
