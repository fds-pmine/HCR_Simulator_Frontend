import type * as Blockly from 'blockly/core';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../blockly/blockConstants';
import { MAX_RUNTIME_COMMANDS } from '../blockly/programCompiler';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  cutterGridDirectionForBlock,
} from './blockConstants';
import { CUTTER_GRID_PLANNER_VERSION } from './types';
import type {
  CompiledCutterGridProgramV1,
  CutterGridAtomicActionV1,
  CutterGridNodeV1,
  CutterGridProgramV1,
} from './types';

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
    plannerVersion: CUTTER_GRID_PLANNER_VERSION,
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
