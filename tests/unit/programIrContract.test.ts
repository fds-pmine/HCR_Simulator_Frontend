import fixture from '../fixtures/program-ir-contract.json';
import {
  expandProgram,
  MAX_RUNTIME_COMMANDS,
} from '../../src/features/blockly/programCompiler';
import type { Program } from '../../src/features/blockly/programTypes';

/**
 * The old servo-facing Blockly editor is going away, but this wire shape is
 * not: hcr.v1's backend receives exactly this Program and expands Repeat on
 * its own. Scalp Turtle may create the IR, never replace it.
 */
describe('hcr.v1 Program IR compatibility baseline', () => {
  const contract = fixture as {
    protocol: string;
    program: Program;
    expandedTypes: string[];
  };

  it('keeps the protocol and serializable command discriminators frozen', () => {
    expect(contract.protocol).toBe('hcr.v1');
    expect(JSON.parse(JSON.stringify(contract.program))).toEqual(
      contract.program,
    );

    const nodes = contract.program.nodes;
    expect(nodes[0]).toMatchObject({
      type: 'set-joint-angle',
      jointId: 'baseYaw',
      angleDeg: -45,
      sourceBlockId: 'move-base',
    });
    expect(nodes[1]).toMatchObject({
      type: 'repeat',
      count: 2,
      sourceBlockId: 'repeat-sweep',
    });
  });

  it('continues to expand on the frontend using the server command cap', () => {
    const expanded = expandProgram(contract.program);

    expect(expanded).toHaveLength(5);
    expect(expanded.map((command) => command.type)).toEqual(
      contract.expandedTypes,
    );
    expect(MAX_RUNTIME_COMMANDS).toBe(500);
  });
});
