import * as Blockly from 'blockly/core';
import * as en from 'blockly/msg/en';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../blockly/blockConstants';
import { SCALP_BLOCK_FIELDS, SCALP_BLOCK_TYPES } from './scalpBlockConstants';

/** Register the player-facing Scalp Turtle language without any servo fields. */
export function registerScalpTurtleBlocks(): void {
  const locale = Object.fromEntries(
    Object.entries(en).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
  Blockly.setLocale(locale);

  Blockly.Blocks[SCALP_BLOCK_TYPES.moveForward] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('Move forward')
        .appendField(
          new Blockly.FieldNumber(1, 1, 12, 1),
          SCALP_BLOCK_FIELDS.steps,
        )
        .appendField('cells');
      statements(this, '#18a6a6', 'Move along the current grid direction');
    },
  };

  Blockly.Blocks[SCALP_BLOCK_TYPES.turn] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('Turn')
        .appendField(
          new Blockly.FieldDropdown([
            ['left', 'left'],
            ['right', 'right'],
          ]),
          SCALP_BLOCK_FIELDS.direction,
        );
      statements(this, '#6e7fe6', 'Turn the turtle without moving the tool');
    },
  };

  Blockly.Blocks[SCALP_BLOCK_TYPES.setToolMode] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('Set cutter')
        .appendField(
          new Blockly.FieldDropdown([
            ['Hover', 'hover'],
            ['Cut', 'cut'],
          ]),
          SCALP_BLOCK_FIELDS.mode,
        );
      statements(this, '#e67750', 'Raise to Hover or lower into the Cut pose');
    },
  };
}

export function createScalpTurtleToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Path',
        colour: '#18a6a6',
        contents: [
          { kind: 'block', type: SCALP_BLOCK_TYPES.moveForward },
          { kind: 'block', type: SCALP_BLOCK_TYPES.turn },
          { kind: 'block', type: SCALP_BLOCK_TYPES.setToolMode },
        ],
      },
      {
        kind: 'category',
        name: 'Control',
        colour: '#7c6ee6',
        contents: [
          { kind: 'block', type: BLOCK_TYPES.wait },
          { kind: 'block', type: BLOCK_TYPES.repeat },
        ],
      },
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}

/**
 * Existing wait/repeat definitions are stable wire-compatible controls. The
 * editor calls this before registering the turtle blocks so users see no Servo
 * category while old workspaces can still be decoded by the legacy compiler.
 */
export const SCALP_CONTROL_FIELDS = {
  waitDuration: BLOCK_FIELDS.duration,
  repeatCount: BLOCK_FIELDS.count,
  repeatBody: BLOCK_FIELDS.body,
} as const;

function statements(block: Blockly.Block, colour: string, tooltip: string): void {
  block.setPreviousStatement(true);
  block.setNextStatement(true);
  block.setColour(colour);
  block.setTooltip(tooltip);
}
