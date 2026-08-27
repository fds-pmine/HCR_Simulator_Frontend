import * as Blockly from 'blockly/core';
import { BLOCK_TYPES } from '../blockly/blockConstants';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  CUTTER_GRID_BLOCK_TYPES,
} from './blockConstants';
import type { CutterGridDirection } from './types';
import type { AppLocale } from '../preferences/localization';
import { hcrBlockCopy } from '../blockly/blocklyLocalization';

export function registerCutterGridBlocks(appLocale: AppLocale = 'en'): void {
  const copy = hcrBlockCopy(appLocale);
  for (const [direction, blockType] of Object.entries(
    CUTTER_GRID_BLOCK_TYPES,
  ) as Array<[CutterGridDirection, string]>) {
    Blockly.Blocks[blockType] = {
      init(this: Blockly.Block) {
        this.appendDummyInput()
          .appendField(copy.moveDirection[direction])
          .appendField(
            new Blockly.FieldNumber(1, 1, 12, 1),
            CUTTER_GRID_BLOCK_FIELDS.distance,
          )
          .appendField(copy.voxelUnit);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour('#18a6a6');
        this.setTooltip(
          copy.moveTooltip(copy.moveDirection[direction]),
        );
      },
    };
  }
}

export function createCutterGridToolbox(
  appLocale: AppLocale = 'en',
): Blockly.utils.toolbox.ToolboxDefinition {
  const copy = hcrBlockCopy(appLocale);
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: copy.cutterGridCategory,
        colour: '#18a6a6',
        contents: Object.values(CUTTER_GRID_BLOCK_TYPES).map((type) => ({
          kind: 'block',
          type,
        })),
      },
      {
        kind: 'category',
        name: copy.controlCategory,
        colour: '#7c6ee6',
        contents: [
          { kind: 'block', type: BLOCK_TYPES.wait },
          { kind: 'block', type: BLOCK_TYPES.repeat },
        ],
      },
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}
