import * as Blockly from 'blockly/core';
import { describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { registerHcrBlocks } from '../../src/features/blockly/blockDefinitions';
import { ProgramCompilationError } from '../../src/features/blockly/programCompiler';
import {
  compileScalpWorkspace,
  registerScalpTurtleBlocks,
  SCALP_BLOCK_FIELDS,
  SCALP_BLOCK_TYPES,
} from '../../src/features/scalp-path';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

const challenge = normalizeChallenge(defaultChallengeDefinition);

function workspace(): Blockly.Workspace {
  registerHcrBlocks(challenge.robotConfig.joints);
  registerScalpTurtleBlocks();
  return new Blockly.Workspace();
}

function connect(first: Blockly.Block, second: Blockly.Block): void {
  if (!first.nextConnection || !second.previousConnection) {
    throw new Error('Expected statement connections.');
  }
  first.nextConnection.connect(second.previousConnection);
}

describe('Scalp Turtle Blockly compiler', () => {
  it('compiles relative turtle actions into a frozen hcr.v1 Program', () => {
    const program = workspace();
    const cut = program.newBlock(SCALP_BLOCK_TYPES.setToolMode);
    cut.setFieldValue('cut', SCALP_BLOCK_FIELDS.mode);
    const forward = program.newBlock(SCALP_BLOCK_TYPES.moveForward);
    forward.setFieldValue(2, SCALP_BLOCK_FIELDS.steps);
    const turn = program.newBlock(SCALP_BLOCK_TYPES.turn);
    turn.setFieldValue('right', SCALP_BLOCK_FIELDS.direction);
    const hover = program.newBlock(SCALP_BLOCK_TYPES.setToolMode);
    hover.setFieldValue('hover', SCALP_BLOCK_FIELDS.mode);
    connect(cut, forward);
    connect(forward, turn);
    connect(turn, hover);

    const compiled = compileScalpWorkspace(program, challenge);

    expect(compiled.scalpProgram.sourceBlockCount).toBe(4);
    expect(compiled.trajectoryPlan.segments.some((segment) => segment.kind === 'cut')).toBe(true);
    expect(compiled.trajectoryPlan.segments.some((segment) => segment.kind === 'turn')).toBe(true);
    expect(compiled.program.nodes).toEqual(compiled.runtimeCommands);
    expect(compiled.runtimeCommands.length).toBeGreaterThan(0);
    expect(
      compiled.runtimeCommands.every(
        (command) =>
          command.type === 'set-joint-angle' || command.type === 'wait',
      ),
    ).toBe(true);
    expect(compiled.executedCommandCount).toBe(compiled.runtimeCommands.length);
  });

  it('maps repeat bodies into repeated turtle actions', () => {
    const program = workspace();
    const repeat = program.newBlock('hcr_repeat');
    repeat.setFieldValue(2, 'COUNT');
    const forward = program.newBlock(SCALP_BLOCK_TYPES.moveForward);
    forward.setFieldValue(1, SCALP_BLOCK_FIELDS.steps);
    const body = repeat.getInput('DO')?.connection;
    if (!body || !forward.previousConnection) {
      throw new Error('Expected Repeat body connections.');
    }
    body.connect(forward.previousConnection);

    const compiled = compileScalpWorkspace(program, challenge);
    const movementSegments = compiled.trajectoryPlan.segments.filter(
      (segment) => segment.sourceBlockId === forward.id,
    );

    expect(movementSegments).toHaveLength(2);
  });

  it('points at a forward block that leaves the reachable patch', () => {
    const program = workspace();
    const turn = program.newBlock(SCALP_BLOCK_TYPES.turn);
    turn.setFieldValue('left', SCALP_BLOCK_FIELDS.direction);
    const forward = program.newBlock(SCALP_BLOCK_TYPES.moveForward);
    forward.setFieldValue(3, SCALP_BLOCK_FIELDS.steps);
    connect(turn, forward);

    expect(() => compileScalpWorkspace(program, challenge)).toThrow(
      ProgramCompilationError,
    );
    try {
      compileScalpWorkspace(program, challenge);
    } catch (error) {
      expect(error).toMatchObject({ blockId: forward.id });
    }
  });
});
