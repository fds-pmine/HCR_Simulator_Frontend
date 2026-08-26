import type * as Blockly from 'blockly/core';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../blockly/blockConstants';
import { MAX_RUNTIME_COMMANDS } from '../blockly/programCompiler';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  cutterGridDirectionForBlock,
} from './blockConstants';
import {
  CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
  CUTTER_GRID_LADDER_PLANNER_VERSION,
} from './types';
import type {
  CompiledCutterGridProgramV2,
  CompiledCutterGridProgramV1,
  CutterGridCoord,
  CutterGridDirection,
  CutterGridExecutableActionV2,
  CutterGridAtomicActionV1,
  CutterGridMoveV1,
  CutterGridNodeV1,
  CutterGridProgramV1,
  CutterGridRepeatV1,
  CutterGridWaitV1,
} from './types';
import { moveCutterGridCoord } from './grid';

export type CutterGridCompilationErrorCode =
  | 'EMPTY_PROGRAM'
  | 'MULTIPLE_TOP_LEVEL_STACKS'
  | 'DISALLOWED_BLOCK'
  | 'INVALID_DISTANCE'
  | 'INVALID_WAIT'
  | 'INVALID_REPEAT'
  | 'EMPTY_REPEAT'
  | 'COMMAND_LIMIT_EXCEEDED';

export class CutterGridCompilationError extends Error {
  constructor(
    public readonly code: CutterGridCompilationErrorCode,
    message: string,
    public readonly blockId?: string,
  ) {
    super(message);
    this.name = 'CutterGridCompilationError';
  }
}

export function compileCutterGridWorkspace(
  workspace: Blockly.Workspace,
): CompiledCutterGridProgramV1 {
  const topBlocks = workspace
    .getTopBlocks(true)
    .filter((block) => block.isEnabled() && !block.isShadow());

  if (topBlocks.length === 0) {
    throw new CutterGridCompilationError(
      'EMPTY_PROGRAM',
      'The workspace does not contain an executable program.',
    );
  }
  if (topBlocks.length > 1) {
    throw new CutterGridCompilationError(
      'MULTIPLE_TOP_LEVEL_STACKS',
      'The workspace can contain only one top-level program stack.',
      topBlocks[1].id,
    );
  }

  const nodes = compileSequence(topBlocks[0]);
  const program: CutterGridProgramV1 = {
    kind: 'cutter-grid',
    version: 1,
    plannerVersion: CUTTER_GRID_LADDER_PLANNER_VERSION,
    nodes,
    sourceBlockCount: workspace
      .getAllBlocks(false)
      .filter((block) => block.isEnabled() && !block.isShadow()).length,
  };
  const runtimeActions = expandCutterGridProgram(program);
  return {
    program,
    runtimeActions,
    executedCommandCount: runtimeActions.length,
  };
}

export function expandCutterGridProgram(
  program: CutterGridProgramV1,
  limit = MAX_RUNTIME_COMMANDS,
): CutterGridAtomicActionV1[] {
  const actions: CutterGridAtomicActionV1[] = [];

  const append = (nodes: readonly CutterGridNodeV1[]): void => {
    for (const node of nodes) {
      if (node.type === 'repeat') {
        for (let count = 0; count < node.count; count += 1) {
          append(node.body);
        }
        continue;
      }
      if (node.type === 'move') {
        for (let cell = 0; cell < node.distance; cell += 1) {
          push({
            type: 'move-cell',
            direction: node.direction,
            sourceBlockId: node.sourceBlockId,
          });
        }
        continue;
      }
      push({ ...node });
    }
  };

  const push = (action: CutterGridAtomicActionV1): void => {
    actions.push(action);
    if (actions.length > limit) {
      throw new CutterGridCompilationError(
        'COMMAND_LIMIT_EXCEEDED',
        `The expanded program exceeds ${limit} atomic commands.`,
        action.sourceBlockId,
      );
    }
  };

  append(program.nodes);
  return actions;
}

/**
 * Produces the V4 planner input while keeping the Blockly source AST in its
 * existing V1 wire shape. Unlike V1 runtime actions, a Move N remains one
 * visible action; only Repeat expands its leaf occurrences. The command
 * budget remains expressed in the player's original single-cell cost.
 */
export function compileCutterGridExecutableProgramV2(
  program: CutterGridProgramV1,
  limit = MAX_RUNTIME_COMMANDS,
): CompiledCutterGridProgramV2 {
  const executableActions: CutterGridExecutableActionV2[] = [];
  let coord: CutterGridCoord = [0, 0, 0];
  let logicalCommandCount = 0;

  const push = (cost: number, sourceBlockId: string): void => {
    logicalCommandCount += cost;
    if (logicalCommandCount > limit) {
      throw new CutterGridCompilationError(
        'COMMAND_LIMIT_EXCEEDED',
        `The expanded program exceeds ${limit} atomic commands.`,
        sourceBlockId,
      );
    }
  };

  const append = (nodes: readonly CutterGridNodeV1[]): void => {
    for (const node of nodes) {
      if (node.type === 'repeat') {
        assertRepeat(node);
        for (let count = 0; count < node.count; count += 1) append(node.body);
        continue;
      }
      if (node.type === 'move') {
        assertMove(node);
        const startCoord = coord;
        const endCoord = moveByDistance(startCoord, node.direction, node.distance);
        push(node.distance, node.sourceBlockId);
        executableActions.push({
          type: 'move',
          occurrenceId: occurrenceId(node.sourceBlockId, executableActions.length),
          sourceBlockId: node.sourceBlockId,
          direction: node.direction,
          distance: node.distance,
          startCoord,
          endCoord,
          logicalCommandCount: node.distance,
        });
        coord = endCoord;
        continue;
      }
      assertWait(node);
      push(1, node.sourceBlockId);
      executableActions.push({
        type: 'wait',
        occurrenceId: occurrenceId(node.sourceBlockId, executableActions.length),
        sourceBlockId: node.sourceBlockId,
        durationMs: node.durationMs,
        logicalCommandCount: 1,
      });
    }
  };

  append(program.nodes);
  return {
    program: {
      ...program,
      plannerVersion: CUTTER_GRID_COMPACT_PTP_PLANNER_VERSION,
    },
    executableActions,
    executedCommandCount: logicalCommandCount,
  };
}

/** A non-production convenience entry point for the future V4 runtime. */
export function compileCutterGridWorkspaceV4(
  workspace: Blockly.Workspace,
): CompiledCutterGridProgramV2 {
  return compileCutterGridExecutableProgramV2(
    compileCutterGridWorkspace(workspace).program,
  );
}

function compileSequence(firstBlock: Blockly.Block): CutterGridNodeV1[] {
  const nodes: CutterGridNodeV1[] = [];
  let current: Blockly.Block | null = firstBlock;
  while (current) {
    if (current.isEnabled() && !current.isShadow()) {
      nodes.push(compileBlock(current));
    }
    current = current.getNextBlock();
  }
  return nodes;
}

function compileBlock(block: Blockly.Block): CutterGridNodeV1 {
  const direction = cutterGridDirectionForBlock(block.type);
  if (direction) {
    const distance = readNumberField(
      block,
      CUTTER_GRID_BLOCK_FIELDS.distance,
      'INVALID_DISTANCE',
    );
    if (!Number.isInteger(distance) || distance < 1 || distance > 12) {
      throw new CutterGridCompilationError(
        'INVALID_DISTANCE',
        'Move distance must be an integer between 1 and 12 voxels.',
        block.id,
      );
    }
    return {
      type: 'move',
      direction,
      distance,
      sourceBlockId: block.id,
    };
  }

  if (block.type === BLOCK_TYPES.wait) {
    const durationMs = readNumberField(
      block,
      BLOCK_FIELDS.duration,
      'INVALID_WAIT',
    );
    if (durationMs < 0 || durationMs > 5_000) {
      throw new CutterGridCompilationError(
        'INVALID_WAIT',
        'Wait duration must be between 0ms and 5000ms.',
        block.id,
      );
    }
    return { type: 'wait', durationMs, sourceBlockId: block.id };
  }

  if (block.type !== BLOCK_TYPES.repeat) {
    throw new CutterGridCompilationError(
      'DISALLOWED_BLOCK',
      `Block "${block.type}" is not allowed in Cutter Grid.`,
      block.id,
    );
  }

  const count = readNumberField(
    block,
    BLOCK_FIELDS.count,
    'INVALID_REPEAT',
  );
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new CutterGridCompilationError(
      'INVALID_REPEAT',
      'Repeat count must be an integer between 1 and 20.',
      block.id,
    );
  }
  const bodyBlock = block.getInputTargetBlock(BLOCK_FIELDS.body);
  if (!bodyBlock) {
    throw new CutterGridCompilationError(
      'EMPTY_REPEAT',
      'Repeat must contain at least one command.',
      block.id,
    );
  }
  const body = compileSequence(bodyBlock);
  if (body.length === 0) {
    throw new CutterGridCompilationError(
      'EMPTY_REPEAT',
      'Repeat must contain at least one enabled command.',
      block.id,
    );
  }
  return { type: 'repeat', count, body, sourceBlockId: block.id };
}

function readNumberField(
  block: Blockly.Block,
  fieldName: string,
  code: CutterGridCompilationErrorCode,
): number {
  const value = Number(block.getFieldValue(fieldName));
  if (!Number.isFinite(value)) {
    throw new CutterGridCompilationError(
      code,
      `Field "${fieldName}" must be a finite number.`,
      block.id,
    );
  }
  return value;
}

function assertMove(node: CutterGridMoveV1): void {
  if (!Number.isInteger(node.distance) || node.distance < 1 || node.distance > 12) {
    throw new CutterGridCompilationError(
      'INVALID_DISTANCE',
      'Move distance must be an integer between 1 and 12 voxels.',
      node.sourceBlockId,
    );
  }
}

function assertWait(node: CutterGridWaitV1): void {
  if (!Number.isFinite(node.durationMs) || node.durationMs < 0 || node.durationMs > 5_000) {
    throw new CutterGridCompilationError(
      'INVALID_WAIT',
      'Wait duration must be between 0ms and 5000ms.',
      node.sourceBlockId,
    );
  }
}

function assertRepeat(node: CutterGridRepeatV1): void {
  if (!Number.isInteger(node.count) || node.count < 1 || node.count > 20) {
    throw new CutterGridCompilationError(
      'INVALID_REPEAT',
      'Repeat count must be an integer between 1 and 20.',
      node.sourceBlockId,
    );
  }
  if (node.body.length === 0) {
    throw new CutterGridCompilationError(
      'EMPTY_REPEAT',
      'Repeat must contain at least one command.',
      node.sourceBlockId,
    );
  }
}

function moveByDistance(
  startCoord: CutterGridCoord,
  direction: CutterGridDirection,
  distance: number,
): CutterGridCoord {
  let result = startCoord;
  for (let cell = 0; cell < distance; cell += 1) {
    result = moveCutterGridCoord(result, direction);
  }
  return result;
}

function occurrenceId(sourceBlockId: string, actionIndex: number): string {
  return `${sourceBlockId}#${actionIndex}`;
}
