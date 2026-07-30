import * as Blockly from 'blockly/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import {
  BLOCK_FIELDS,
  BLOCK_TYPES,
} from '../../src/features/blockly/blockConstants';
import {
  createToolbox,
  registerHcrBlocks,
} from '../../src/features/blockly/blockDefinitions';
import {
  MAX_RUNTIME_COMMANDS,
  ProgramCompilationError,
  compileWorkspace,
} from '../../src/features/blockly/programCompiler';
import {
  createHeadlessWorkspace,
  loadWorkspaceState,
  saveWorkspaceState,
} from '../../src/features/blockly/workspaceFactory';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Blockly program compiler', () => {
  let challenge: Challenge;
  let workspace: Blockly.Workspace;

  beforeEach(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
    registerHcrBlocks(challenge.robotConfig.joints);
    workspace = new Blockly.Workspace();
  });

  afterEach(() => {
    workspace.dispose();
  });

  it('loads and compiles the starter workspace deterministically', () => {
    loadWorkspaceState(workspace, challenge.starterWorkspace);

    const first = compileWorkspace(workspace, challenge);
    const serialized = saveWorkspaceState(workspace);
    const secondWorkspace = createHeadlessWorkspace({
      ...challenge,
      starterWorkspace: serialized,
    });
    const second = compileWorkspace(secondWorkspace, challenge);

    expect(first.program.sourceBlockCount).toBe(5);
    expect(first.executedCommandCount).toBe(5);
    expect(first.runtimeCommands).toEqual(second.runtimeCommands);
    expect(first.runtimeCommands[0]).toMatchObject({
      type: 'set-joint-angle',
      jointId: 'shoulderRoll',
      angleDeg: 15,
      sourceBlockId: 'starter-shoulder-roll',
    });
    expect(
      first.runtimeCommands.filter(
        (command) => command.type === 'set-joint-angle',
      ),
    ).toHaveLength(5);

    secondWorkspace.dispose();
  });

  it('builds a toolbox from the Challenge allow-list', () => {
    const toolbox = createToolbox({
      allowedBlocks: ['set-joint-angle', 'wait'],
    });

    expect(JSON.stringify(toolbox)).toContain(BLOCK_TYPES.setJointAngle);
    expect(JSON.stringify(toolbox)).toContain(BLOCK_TYPES.wait);
    expect(JSON.stringify(toolbox)).not.toContain(BLOCK_TYPES.repeat);
    expect(JSON.stringify(toolbox)).toContain('"name":"Servo"');
    expect(JSON.stringify(toolbox)).toContain('"name":"Control"');
  });

  it('rejects empty and multiple top-level programs', () => {
    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'EMPTY_PROGRAM',
    );

    workspace.newBlock(BLOCK_TYPES.wait);
    workspace.newBlock(BLOCK_TYPES.wait);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'MULTIPLE_TOP_LEVEL_STACKS',
    );
  });

  it('rejects angles that are invalid for the selected joint', () => {
    const block = workspace.newBlock(BLOCK_TYPES.setJointAngle);
    block.setFieldValue('wrist', BLOCK_FIELDS.jointId);
    block.setFieldValue(90, BLOCK_FIELDS.angle);
    block.setFieldValue('baseYaw', BLOCK_FIELDS.jointId);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'INVALID_ANGLE',
    );
  });

  it('rejects empty repeat bodies', () => {
    workspace.newBlock(BLOCK_TYPES.repeat);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'EMPTY_REPEAT',
    );
  });

  it('rejects invalid Wait and Repeat numeric fields', () => {
    const waitBlock = workspace.newBlock(BLOCK_TYPES.wait);
    forceFieldValue(waitBlock, BLOCK_FIELDS.duration, -1);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'INVALID_WAIT',
    );

    workspace.clear();
    const repeatBlock = createRepeat(workspace, 2);
    const repeatBody = workspace.newBlock(BLOCK_TYPES.wait);
    connectStatement(repeatBlock, repeatBody);
    forceFieldValue(repeatBlock, BLOCK_FIELDS.count, 21);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'INVALID_REPEAT',
    );
  });

  it('expands nested repeats and enforces the 500 command limit', () => {
    const outer = createRepeat(workspace, 20);
    const middle = createRepeat(workspace, 20);
    const inner = createRepeat(workspace, 2);
    const wait = workspace.newBlock(BLOCK_TYPES.wait);

    connectStatement(outer, middle);
    connectStatement(middle, inner);
    connectStatement(inner, wait);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'COMMAND_LIMIT_EXCEEDED',
    );

    expect(MAX_RUNTIME_COMMANDS).toBe(500);
  });

  it('excludes disabled blocks from source and runtime counts', () => {
    const first = workspace.newBlock(BLOCK_TYPES.wait);
    const disabled = workspace.newBlock(BLOCK_TYPES.wait);
    if (!first.nextConnection || !disabled.previousConnection) {
      throw new Error('Expected statement connections.');
    }
    first.nextConnection.connect(disabled.previousConnection);
    disabled.setDisabledReason(true, 'test');

    const compiled = compileWorkspace(workspace, challenge);

    expect(compiled.program.sourceBlockCount).toBe(1);
    expect(compiled.executedCommandCount).toBe(1);
  });

  it('rejects blocks disallowed by the current Challenge', () => {
    workspace.newBlock(BLOCK_TYPES.setJointAngle);

    expectCompilationError(
      () =>
        compileWorkspace(workspace, {
          ...challenge,
          allowedBlocks: ['wait', 'repeat'],
        }),
      'DISALLOWED_BLOCK',
    );
  });

  it('rejects unknown Blockly block types', () => {
    Blockly.Blocks.hcr_unknown = {
      init(this: Blockly.Block) {
        this.appendDummyInput().appendField('Unknown');
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      },
    };
    workspace.newBlock('hcr_unknown');

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'DISALLOWED_BLOCK',
    );
  });
});

function createRepeat(
  workspace: Blockly.Workspace,
  count: number,
): Blockly.Block {
  const block = workspace.newBlock(BLOCK_TYPES.repeat);
  block.setFieldValue(count, BLOCK_FIELDS.count);
  return block;
}

function connectStatement(parent: Blockly.Block, child: Blockly.Block): void {
  const input = parent.getInput(BLOCK_FIELDS.body);
  if (!input?.connection || !child.previousConnection) {
    throw new Error('Expected statement connections.');
  }
  input.connection.connect(child.previousConnection);
}

function forceFieldValue(
  block: Blockly.Block,
  fieldName: string,
  value: unknown,
): void {
  const field = block.getField(fieldName);
  if (!field) {
    throw new Error(`Field "${fieldName}" was not found.`);
  }
  (field as unknown as { value_: unknown }).value_ = value;
}

function expectCompilationError(
  run: () => unknown,
  code: ProgramCompilationError['code'],
): void {
  try {
    run();
    throw new Error('Expected compilation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProgramCompilationError);
    expect((error as ProgramCompilationError).code).toBe(code);
  }
}
