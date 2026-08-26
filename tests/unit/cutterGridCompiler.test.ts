import * as Blockly from 'blockly/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../src/data/challenges/defaultChallenge';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../../src/features/blockly/blockConstants';
import type { ProgrammingMode } from '../../src/features/blockly/programmingMode';
import {
  createHeadlessWorkspaceForMode,
  saveWorkspaceState,
} from '../../src/features/blockly/workspaceFactory';
import {
  ProgrammingWorkspaceMemory,
  programmingWorkspaceKey,
} from '../../src/features/blockly/workspaceMemory';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  CUTTER_GRID_BLOCK_TYPES,
} from '../../src/features/cutter-grid/blockConstants';
import {
  CutterGridCompilationError,
  compileCutterGridExecutableProgramV2,
  compileCutterGridWorkspace,
  compileCutterGridWorkspaceV4,
} from '../../src/features/cutter-grid/programCompiler';
import type { CutterGridDirection, CutterGridProgramV1 } from '../../src/features/cutter-grid/types';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import type { Challenge } from '../../src/types/domain';

describe('Cutter Grid Blockly compiler', () => {
  let challenge: Challenge;
  let workspace: Blockly.Workspace;

  beforeEach(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
    workspace = createHeadlessWorkspaceForMode(challenge, 'cutter-grid');
  });

  afterEach(() => workspace.dispose());

  it('maps every fixed world direction and expands distance per cell', () => {
    const expected: Array<[CutterGridDirection, number]> = [
      ['right', 1],
      ['left', 2],
      ['up', 3],
      ['down', 4],
      ['forward', 5],
      ['backward', 12],
    ];
    let previous: Blockly.Block | undefined;
    for (const [direction, distance] of expected) {
      const block = createMove(workspace, direction, distance);
      if (previous) connectNext(previous, block);
      previous = block;
    }

    const compiled = compileCutterGridWorkspace(workspace);

    expect(compiled.program.nodes).toEqual(
      expected.map(([direction, distance]) =>
        expect.objectContaining({ type: 'move', direction, distance }),
      ),
    );
    expect(compiled.executedCommandCount).toBe(27);
    expect(compiled.runtimeActions[0]).toMatchObject({
      type: 'move-cell',
      direction: 'right',
    });
    expect(compiled.runtimeActions.at(-1)).toMatchObject({
      type: 'move-cell',
      direction: 'backward',
    });
  });

  it('keeps Move N as one V4 visible action while preserving its logical cost', () => {
    const first = createMove(workspace, 'up', 6);
    const second = createMove(workspace, 'left', 2);
    const third = createMove(workspace, 'forward', 3);
    connectNext(first, second);
    connectNext(second, third);

    const compiled = compileCutterGridWorkspaceV4(workspace);

    expect(compiled.program.plannerVersion).toBe('cutter-grid-compact-ptp-v4');
    expect(compiled.executedCommandCount).toBe(11);
    expect(compiled.executableActions).toEqual([
      expect.objectContaining({
        type: 'move',
        sourceBlockId: first.id,
        occurrenceId: `${first.id}#0`,
        direction: 'up',
        distance: 6,
        startCoord: [0, 0, 0],
        endCoord: [0, 6, 0],
        logicalCommandCount: 6,
      }),
      expect.objectContaining({
        type: 'move',
        sourceBlockId: second.id,
        occurrenceId: `${second.id}#1`,
        direction: 'left',
        distance: 2,
        startCoord: [0, 6, 0],
        endCoord: [-2, 6, 0],
        logicalCommandCount: 2,
      }),
      expect.objectContaining({
        type: 'move',
        sourceBlockId: third.id,
        occurrenceId: `${third.id}#2`,
        direction: 'forward',
        distance: 3,
        startCoord: [-2, 6, 0],
        endCoord: [-2, 6, -3],
        logicalCommandCount: 3,
      }),
    ]);
  });

  it('gives Repeat leaves stable, distinct V4 occurrences without charging Repeat itself', () => {
    const repeat = createRepeat(workspace, 2);
    const move = createMove(workspace, 'right', 2);
    const wait = workspace.newBlock(BLOCK_TYPES.wait);
    wait.setFieldValue(400, BLOCK_FIELDS.duration);
    connectStatement(repeat, move);
    connectNext(move, wait);

    const compiled = compileCutterGridWorkspaceV4(workspace);

    expect(compiled.executedCommandCount).toBe(6);
    expect(compiled.executableActions.map((action) => action.occurrenceId)).toEqual([
      `${move.id}#0`,
      `${wait.id}#1`,
      `${move.id}#2`,
      `${wait.id}#3`,
    ]);
    expect(compiled.executableActions.map((action) => action.type)).toEqual([
      'move',
      'wait',
      'move',
      'wait',
    ]);
  });

  it.each([0, 13, 1.5])('rejects invalid distance %s at its source block', (distance) => {
    const block = createMove(workspace, 'right', 1);
    forceFieldValue(block, CUTTER_GRID_BLOCK_FIELDS.distance, distance);

    expectCompilationError(
      () => compileCutterGridWorkspace(workspace),
      'INVALID_DISTANCE',
      block.id,
    );
  });

  it('supports Wait and nested Repeat while counting Repeat only by its body', () => {
    const repeat = createRepeat(workspace, 2);
    const move = createMove(workspace, 'forward', 3);
    const wait = workspace.newBlock(BLOCK_TYPES.wait);
    wait.setFieldValue(400, BLOCK_FIELDS.duration);
    connectStatement(repeat, move);
    connectNext(move, wait);

    const compiled = compileCutterGridWorkspace(workspace);

    expect(compiled.program.sourceBlockCount).toBe(3);
    expect(compiled.executedCommandCount).toBe(8);
    expect(compiled.runtimeActions.filter((action) => action.type === 'wait')).toHaveLength(2);
  });

  it('accepts 500 atomic actions and rejects 501 at the responsible source block', () => {
    const twentyFive = createRepeat(workspace, 20);
    const twenty = createRepeat(workspace, 20);
    const move = createMove(workspace, 'up', 1);
    connectStatement(twentyFive, twenty);
    connectStatement(twenty, move);
    const oneHundred = createRepeat(workspace, 5);
    const oneHundredMove = createMove(workspace, 'left', 5);
    connectStatement(oneHundred, oneHundredMove);
    connectNext(twentyFive, oneHundred);
    forceFieldValue(oneHundred, BLOCK_FIELDS.count, 20);

    expect(compileCutterGridWorkspace(workspace).executedCommandCount).toBe(500);

    const overflow = workspace.newBlock(BLOCK_TYPES.wait);
    connectNext(oneHundred, overflow);
    expectCompilationError(
      () => compileCutterGridWorkspace(workspace),
      'COMMAND_LIMIT_EXCEEDED',
      overflow.id,
    );
  });

  it('enforces the V4 500 limit by logical cost rather than visible action count', () => {
    const move = {
      type: 'move' as const,
      direction: 'right' as const,
      distance: 1,
      sourceBlockId: 'move-one',
    };
    const program: CutterGridProgramV1 = {
      kind: 'cutter-grid',
      version: 1,
      plannerVersion: 'cutter-grid-ladder-v2',
      sourceBlockCount: 3,
      nodes: [
        { type: 'repeat', count: 20, sourceBlockId: 'outer', body: [
          { type: 'repeat', count: 20, sourceBlockId: 'inner', body: [move] },
        ] },
        { type: 'repeat', count: 20, sourceBlockId: 'fives', body: [{ ...move, distance: 5, sourceBlockId: 'move-five' }] },
      ],
    };

    const exact = compileCutterGridExecutableProgramV2(program);
    expect(exact.executedCommandCount).toBe(500);
    expect(exact.executableActions).toHaveLength(420);

    expectCompilationError(
      () => compileCutterGridExecutableProgramV2({
        ...program,
        nodes: [...program.nodes, { type: 'wait', durationMs: 1, sourceBlockId: 'overflow' }],
      }),
      'COMMAND_LIMIT_EXCEEDED',
      'overflow',
    );
  });

  it('rejects Servo blocks instead of representing them as Cutter Grid IR', () => {
    const block = workspace.newBlock(BLOCK_TYPES.setJointAngle);
    expectCompilationError(
      () => compileCutterGridWorkspace(workspace),
      'DISALLOWED_BLOCK',
      block.id,
    );
  });
});

describe('mode-specific Blockly workspace memory', () => {
  let challenge: Challenge;
  const workspaces: Blockly.Workspace[] = [];

  beforeEach(async () => {
    challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
  });

  afterEach(() => workspaces.splice(0).forEach((workspace) => workspace.dispose()));

  it('isolates Servo and Cutter Grid state by challenge signature and mode', () => {
    const memory = new ProgrammingWorkspaceMemory();
    const servo = trackedWorkspace(challenge, 'servo');
    const cutter = trackedWorkspace(challenge, 'cutter-grid');
    cutter.newBlock(CUTTER_GRID_BLOCK_TYPES.right);
    memory.save(challenge, 'servo', saveWorkspaceState(servo));
    memory.save(challenge, 'cutter-grid', saveWorkspaceState(cutter));

    expect(memory.load(challenge, 'servo')).not.toEqual(
      memory.load(challenge, 'cutter-grid'),
    );
    expect(programmingWorkspaceKey(challenge, 'servo')).not.toBe(
      programmingWorkspaceKey(challenge, 'cutter-grid'),
    );
  });

  function trackedWorkspace(
    item: Challenge,
    mode: ProgrammingMode,
  ): Blockly.Workspace {
    const workspace = createHeadlessWorkspaceForMode(item, mode);
    workspaces.push(workspace);
    return workspace;
  }
});

function createMove(
  workspace: Blockly.Workspace,
  direction: CutterGridDirection,
  distance: number,
): Blockly.Block {
  const block = workspace.newBlock(CUTTER_GRID_BLOCK_TYPES[direction]);
  block.setFieldValue(distance, CUTTER_GRID_BLOCK_FIELDS.distance);
  return block;
}

function createRepeat(workspace: Blockly.Workspace, count: number): Blockly.Block {
  const block = workspace.newBlock(BLOCK_TYPES.repeat);
  block.setFieldValue(count, BLOCK_FIELDS.count);
  return block;
}

function connectNext(first: Blockly.Block, second: Blockly.Block): void {
  if (!first.nextConnection || !second.previousConnection) {
    throw new Error('Expected statement connections.');
  }
  first.nextConnection.connect(second.previousConnection);
}

function connectStatement(parent: Blockly.Block, child: Blockly.Block): void {
  const connection = parent.getInput(BLOCK_FIELDS.body)?.connection;
  if (!connection || !child.previousConnection) {
    throw new Error('Expected statement connections.');
  }
  connection.connect(child.previousConnection);
}

function forceFieldValue(block: Blockly.Block, fieldName: string, value: unknown): void {
  const field = block.getField(fieldName);
  if (!field) throw new Error(`Field "${fieldName}" was not found.`);
  (field as unknown as { value_: unknown }).value_ = value;
}

function expectCompilationError(
  run: () => unknown,
  code: CutterGridCompilationError['code'],
  blockId: string,
): void {
  try {
    run();
    throw new Error('Expected compilation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(CutterGridCompilationError);
    expect(error).toMatchObject({ code, blockId });
  }
}
