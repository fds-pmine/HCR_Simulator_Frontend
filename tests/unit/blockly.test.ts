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
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { LocalChallengeProvider } from '../../src/services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
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

    expect(first.program.sourceBlockCount).toBe(1);
    expect(first.executedCommandCount).toBe(1);
    expect(first.runtimeCommands).toEqual(second.runtimeCommands);
    expect(first.runtimeCommands[0]).toMatchObject({
      type: 'set-joint-angle',
      jointId: 'baseYaw',
      angleDeg: 150,
      sourceBlockId: 'starter-base-sweep',
    });
    expect(
      first.runtimeCommands.filter(
        (command) => command.type === 'set-joint-angle',
      ),
    ).toHaveLength(1);

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
    block.setFieldValue('baseYaw', BLOCK_FIELDS.jointId);

    // Written past the field rather than through it, because the field no
    // longer permits this: the angle is retuned to the selected joint's range
    // whenever the dropdown changes, so `Set Wrist to 170` becomes
    // `Set Base Yaw to 150` instead of staying 20° past where the base turns.
    //
    // The compiler check stays regardless, and this is what still exercises it.
    // Blocks do not only come from the editor — they arrive from saved
    // workspaces, from a challenge's starter, and from a `registerHcrBlocks`
    // call whose joints came from a different challenge than the one being
    // compiled against. Any of those can carry an angle the joint cannot reach,
    // and this is the check that catches it. The backend enforces the same
    // bound independently (`hcr_sim::SimError::AngleOutOfRange`).
    forceFieldValue(block, BLOCK_FIELDS.angle, 170);

    expectCompilationError(
      () => compileWorkspace(workspace, challenge),
      'INVALID_ANGLE',
    );
  });

  it('retunes the angle when the joint changes rather than leaving it invalid', () => {
    const block = workspace.newBlock(BLOCK_TYPES.setJointAngle);
    block.setFieldValue('wrist', BLOCK_FIELDS.jointId);
    block.setFieldValue(170, BLOCK_FIELDS.angle);

    block.setFieldValue('baseYaw', BLOCK_FIELDS.jointId);

    // Clamped to the base's maximum, and compiling now rather than failing at
    // Run time on a block the editor built without complaint.
    expect(Number(block.getFieldValue(BLOCK_FIELDS.angle))).toBe(150);
    expect(() => compileWorkspace(workspace, challenge)).not.toThrow();
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

describe('workspace deserialization is independent of field order', () => {
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

  /** The shipped starter, with each block's fields emitted alphabetically. */
  function angleFirstStarter(): Record<string, unknown> {
    const reorder = (block: Record<string, unknown>): Record<string, unknown> => {
      const fields = block.fields as Record<string, unknown> | undefined;
      const next = block.next as { block: Record<string, unknown> } | undefined;
      return {
        ...block,
        ...(fields
          ? {
              fields: Object.fromEntries(
                Object.keys(fields)
                  .sort()
                  .map((key) => [key, fields[key]]),
              ),
            }
          : {}),
        ...(next ? { next: { block: reorder(next.block) } } : {}),
      };
    };
    const state = structuredClone(challenge.starterWorkspace) as {
      blocks: { blocks: Record<string, unknown>[] };
    };
    return {
      ...state,
      blocks: { ...state.blocks, blocks: state.blocks.blocks.map(reorder) },
    };
  }

  it('loads the angles it was given, not the ones the default joint allows', () => {
    // `serde_json::Value` is a BTreeMap, so the backend emits ANGLE before
    // JOINT_ID. Blockly applies fields in key order and the angle validator
    // reads the joint, so an angle arriving first was judged against whichever
    // joint the dropdown defaulted to — silently replacing every value outside
    // that joint's range with the field's fallback.
    loadWorkspaceState(workspace, angleFirstStarter());

    const angles = workspace
      .getAllBlocks(true)
      .filter((block) => block.type === BLOCK_TYPES.setJointAngle)
      .map((block) => [
        block.getFieldValue(BLOCK_FIELDS.jointId) as string,
        Number(block.getFieldValue(BLOCK_FIELDS.angle)),
      ]);

    expect(angles).toEqual([['baseYaw', 150]]);
  });

  it('compiles both field orders to the identical program', () => {
    loadWorkspaceState(workspace, angleFirstStarter());
    const fromAngleFirst = compileWorkspace(workspace, challenge);

    loadWorkspaceState(workspace, challenge.starterWorkspace);
    const fromJointFirst = compileWorkspace(workspace, challenge);

    expect(fromAngleFirst.program).toEqual(fromJointFirst.program);
  });
});

describe('repeat', () => {
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

  const setJoint = (
    id: string,
    jointId: string,
    angleDeg: number,
    next?: unknown,
  ) => ({
    type: BLOCK_TYPES.setJointAngle,
    id,
    fields: { [BLOCK_FIELDS.jointId]: jointId, [BLOCK_FIELDS.angle]: angleDeg },
    ...(next ? { next: { block: next } } : {}),
  });

  const repeatOf = (count: number, body: unknown) => ({
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: BLOCK_TYPES.repeat,
          id: 'rep',
          fields: { [BLOCK_FIELDS.count]: count },
          inputs: { [BLOCK_FIELDS.body]: { block: body } },
        },
      ],
    },
  });

  it('nests the body in the IR and expands it once per iteration', () => {
    loadWorkspaceState(
      workspace,
      // Both angles sit inside the head-safe yaw band, so the run is about
      // repetition rather than about the collision constraint.
      repeatOf(3, setJoint('a', 'baseYaw', 35, setJoint('b', 'baseYaw', 52))),
    );

    const compiled = compileWorkspace(workspace, challenge);

    // The IR keeps `repeat` nested — the server expands it itself, which is
    // what gives the command cap any force.
    expect(compiled.program.nodes).toEqual([
      {
        type: 'repeat',
        count: 3,
        sourceBlockId: 'rep',
        body: [
          { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 35, sourceBlockId: 'a' },
          { type: 'set-joint-angle', jointId: 'baseYaw', angleDeg: 52, sourceBlockId: 'b' },
        ],
      },
    ]);
    expect(compiled.runtimeCommands).toHaveLength(6);
  });

  it('runs every iteration through the engine', async () => {
    loadWorkspaceState(
      workspace,
      repeatOf(3, setJoint('a', 'baseYaw', 35, setJoint('b', 'baseYaw', 52))),
    );
    const compiled = compileWorkspace(workspace, challenge);

    const engine = new SimulationEngine(challenge, new LocalScoreProvider());
    engine.run(compiled);
    for (let tick = 0; tick < 20_000; tick += 1) {
      if (engine.getSnapshot().status !== 'running') break;
      engine.tick(16);
    }

    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.metrics.executedCommandCount).toBe(6);
  });

  it('repeating one absolute angle changes nothing after the first move', async () => {
    // Not a defect — `set-joint-angle` is absolute, so iterations 2..n drive a
    // joint to where it already is. It is recorded because it is exactly what
    // "repeat doesn't work" looks like from the outside: five commands run, the
    // arm moves once, and the extra commands only cost efficiency.
    const run = async (state: Record<string, unknown>) => {
      const compiled = compileWorkspace(
        (workspace.clear(), loadWorkspaceState(workspace, state), workspace),
        challenge,
      );
      const engine = new SimulationEngine(challenge, new LocalScoreProvider());
      engine.run(compiled);
      for (let tick = 0; tick < 20_000; tick += 1) {
        if (engine.getSnapshot().status !== 'running') break;
        engine.tick(16);
      }
      return {
        voxels: engine.getSnapshot().hairVoxels.size,
        commands: engine.getSnapshot().metrics.executedCommandCount,
      };
    };

    const repeated = await run(repeatOf(5, setJoint('a', 'baseYaw', 35)));
    const once = await run({
      blocks: { languageVersion: 0, blocks: [setJoint('a', 'baseYaw', 35)] },
    });

    expect(repeated.commands).toBe(5);
    expect(once.commands).toBe(1);
    // Five times the work, identical outcome.
    expect(repeated.voxels).toBe(once.voxels);
  });
});
