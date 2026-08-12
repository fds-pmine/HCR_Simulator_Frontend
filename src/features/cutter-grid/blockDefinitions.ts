import * as Blockly from 'blockly/core';
import { BLOCK_TYPES } from '../blockly/blockConstants';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  CUTTER_GRID_BLOCK_TYPES,
} from './blockConstants';
import type { CutterGridDirection } from './types';

const DIRECTION_LABEL: Readonly<Record<CutterGridDirection, string>> = {
  right: 'right',
  left: 'left',
  up: 'up',
  down: 'down',
  forward: 'forward',
  backward: 'backward',
};

export function registerCutterGridBlocks(): void {
  for (const [direction, blockType] of Object.entries(
    CUTTER_GRID_BLOCK_TYPES,
  ) as Array<[CutterGridDirection, string]>) {
    Blockly.Blocks[blockType] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField(`Move ${DIRECTION_LABEL[direction]}`)
          .appendField(
            new Blockly.FieldNumber(1, 1, 12, 1),
            CUTTER_GRID_BLOCK_FIELDS.distance,
          )
          .appendField('voxels');
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour('#18a6a6');
        this.setTooltip(
          `Move the cutter ${DIRECTION_LABEL[direction]} on the fixed world grid`,
        );
      },
    };
  }
}

export function createCutterGridToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Cutter Grid',
        colour: '#18a6a6',
        contents: Object.values(CUTTER_GRID_BLOCK_TYPES).map((type) => ({
          kind: 'block',
          type,
        })),
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
