import type * as Blockly from 'blockly/core';
import type { AllowedBlockType, Challenge } from '../../types/domain';
import { BLOCK_FIELDS, BLOCK_TYPES } from './blockConstants';
import { blockTypeToSemantic } from './blockDefinitions';
import type {
  CompiledProgram,
  Program,
  ProgramNode,
  RobotCommand,
} from './programTypes';

export const MAX_RUNTIME_COMMANDS = 500;

export type CompilationErrorCode =
  | 'EMPTY_PROGRAM'
  | 'MULTIPLE_TOP_LEVEL_STACKS'
  | 'DISALLOWED_BLOCK'
  | 'INVALID_JOINT'
  | 'INVALID_ANGLE'
  | 'INVALID_WAIT'
  | 'INVALID_REPEAT'
  | 'EMPTY_REPEAT'
  | 'COMMAND_LIMIT_EXCEEDED';

export class ProgramCompilationError extends Error {
  constructor(
    public readonly code: CompilationErrorCode,
    message: string,
    public readonly blockId?: string,
  ) {
    super(message);
    this.name = 'ProgramCompilationError';
  }
}

export function compileWorkspace(
  workspace: Blockly.Workspace,
  challenge: Challenge,
): CompiledProgram {
  const topBlocks = workspace
    .getTopBlocks(true)
    .filter((block) => block.isEnabled() && !block.isShadow());

  if (topBlocks.length === 0) {
    throw new ProgramCompilationError(
      'EMPTY_PROGRAM',
      'The workspace does not contain an executable program.',
    );
  }
  if (topBlocks.length > 1) {
    throw new ProgramCompilationError(
      'MULTIPLE_TOP_LEVEL_STACKS',
      'The workspace can contain only one top-level program stack.',
      topBlocks[1].id,
    );
  }

  const allowed = new Set(challenge.allowedBlocks);
  const nodes = compileSequence(topBlocks[0], challenge, allowed);
  if (nodes.length === 0) {
    throw new ProgramCompilationError(
      'EMPTY_PROGRAM',
      'The workspace does not contain an executable program.',
    );
  }

  const program: Program = {
    nodes,
    sourceBlockCount: workspace
      .getAllBlocks(false)
      .filter((block) => block.isEnabled() && !block.isShadow()).length,
  };
  const runtimeCommands = expandProgram(program);

  return {
    program,
    runtimeCommands,
    executedCommandCount: runtimeCommands.length,
  };
}

export function expandProgram(
  program: Program,
  limit = MAX_RUNTIME_COMMANDS,
): RobotCommand[] {
  const commands: RobotCommand[] = [];

  const appendNodes = (nodes: readonly ProgramNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'repeat') {
        for (let count = 0; count < node.count; count += 1) {
          appendNodes(node.body);
        }
        continue;
      }

      commands.push({ ...node });
      if (commands.length > limit) {
        throw new ProgramCompilationError(
          'COMMAND_LIMIT_EXCEEDED',
          `The expanded program exceeds ${limit} atomic commands.`,
          node.sourceBlockId,
        );
      }
    }
  };

  appendNodes(program.nodes);
  return commands;
}

function compileSequence(
  firstBlock: Blockly.Block,
  challenge: Challenge,
  allowed: ReadonlySet<AllowedBlockType>,
): ProgramNode[] {
  const nodes: ProgramNode[] = [];
  let current: Blockly.Block | null = firstBlock;

  while (current) {
    if (current.isEnabled() && !current.isShadow()) {
      nodes.push(compileBlock(current, challenge, allowed));
    }
    current = current.getNextBlock();
  }

  return nodes;
}

function compileBlock(
  block: Blockly.Block,
  challenge: Challenge,
  allowed: ReadonlySet<AllowedBlockType>,
): ProgramNode {
  const semanticType = blockTypeToSemantic(block.type);
  if (!semanticType || !allowed.has(semanticType)) {
    throw new ProgramCompilationError(
      'DISALLOWED_BLOCK',
      `Block "${block.type}" is not allowed in the current challenge.`,
      block.id,
    );
  }

  if (block.type === BLOCK_TYPES.setJointAngle) {
    const jointId = block.getFieldValue(BLOCK_FIELDS.jointId);
    const joint = challenge.robotConfig.joints.find(
      (item) => item.id === jointId,
    );
    if (!joint) {
      throw new ProgramCompilationError(
        'INVALID_JOINT',
        `Joint "${jointId}" does not exist.`,
        block.id,
      );
    }

    const angleDeg = readNumberField(block, BLOCK_FIELDS.angle);
    if (
      angleDeg < joint.minAngleDeg ||
      angleDeg > joint.maxAngleDeg
    ) {
      throw new ProgramCompilationError(
        'INVALID_ANGLE',
        `${joint.name} angle must be between ${joint.minAngleDeg}° and ${joint.maxAngleDeg}°.`,
        block.id,
      );
    }

    return {
      type: 'set-joint-angle',
      jointId,
      angleDeg,
      sourceBlockId: block.id,
    };
  }

  if (block.type === BLOCK_TYPES.wait) {
    const durationMs = readNumberField(block, BLOCK_FIELDS.duration);
    if (durationMs < 0 || durationMs > 5_000) {
      throw new ProgramCompilationError(
        'INVALID_WAIT',
        'Wait duration must be between 0ms and 5000ms.',
        block.id,
      );
    }
    return {
      type: 'wait',
      durationMs,
      sourceBlockId: block.id,
    };
  }

  const count = readNumberField(block, BLOCK_FIELDS.count);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new ProgramCompilationError(
      'INVALID_REPEAT',
      'Repeat count must be an integer between 1 and 20.',
      block.id,
    );
  }

  const bodyBlock = block.getInputTargetBlock(BLOCK_FIELDS.body);
  if (!bodyBlock) {
    throw new ProgramCompilationError(
      'EMPTY_REPEAT',
      'Repeat must contain at least one command.',
      block.id,
    );
  }
  const body = compileSequence(bodyBlock, challenge, allowed);
  if (body.length === 0) {
    throw new ProgramCompilationError(
      'EMPTY_REPEAT',
      'Repeat must contain at least one enabled command.',
      block.id,
    );
  }

  return {
    type: 'repeat',
    count,
    body,
    sourceBlockId: block.id,
  };
}

function readNumberField(block: Blockly.Block, fieldName: string): number {
  const value = Number(block.getFieldValue(fieldName));
  if (!Number.isFinite(value)) {
    throw new ProgramCompilationError(
      fieldName === BLOCK_FIELDS.duration
        ? 'INVALID_WAIT'
        : fieldName === BLOCK_FIELDS.count
          ? 'INVALID_REPEAT'
          : 'INVALID_ANGLE',
      `Field "${fieldName}" must be a finite number.`,
      block.id,
    );
  }
  return value;
}
