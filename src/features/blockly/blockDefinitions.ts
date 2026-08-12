import * as Blockly from 'blockly/core';
import * as en from 'blockly/msg/en';
import type {
  AllowedBlockType,
  Challenge,
  JointConfig,
} from '../../types/domain';
import { BLOCK_FIELDS, BLOCK_TYPES } from './blockConstants';

const semanticToBlocklyType: Record<AllowedBlockType, string> = {
  'set-joint-angle': BLOCK_TYPES.setJointAngle,
  wait: BLOCK_TYPES.wait,
  repeat: BLOCK_TYPES.repeat,
};

export function registerHcrBlocks(joints: readonly JointConfig[]): void {
  if (joints.length === 0) {
    throw new Error('At least one joint is required to register HCR blocks.');
  }

  const locale = Object.fromEntries(
    Object.entries(en).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
  Blockly.setLocale(locale);
  const options = joints.map(
    (joint) => [joint.name, joint.id] as [string, string],
  );
  const initialJoint = joints[0];
  const jointById = new Map(joints.map((joint) => [joint.id, joint]));

  Blockly.Blocks[BLOCK_TYPES.setJointAngle] = {
    init(this: Blockly.Block) {
      const angleField = new Blockly.FieldNumber(
        initialJoint.initialAngleDeg,
        Math.min(...joints.map((joint) => joint.minAngleDeg)),
        Math.max(...joints.map((joint) => joint.maxAngleDeg)),
        // Tenths of a degree, because that is the resolution the arm has:
        // `hcr-fw` carries angles as tenths and its parser accepts exactly one
        // fractional digit. Whole degrees would round 162.5° — a real elbow
        // limit — to a value the servo cannot be commanded to.
        0.1,
        function validateAngle(
          this: Blockly.FieldNumber,
          value: string | number,
        ) {
          const block = this.getSourceBlock();
          const jointId = block?.getFieldValue(BLOCK_FIELDS.jointId);
          const joint = jointById.get(jointId);
          const numericValue = Number(value);
          if (
            !joint ||
            numericValue < joint.minAngleDeg ||
            numericValue > joint.maxAngleDeg
          ) {
            return null;
          }
          return numericValue;
        },
      );

      this.appendDummyInput()
        .appendField('Set')
        .appendField(
          new Blockly.FieldDropdown(options),
          BLOCK_FIELDS.jointId,
        )
        .appendField('to')
        .appendField(angleField, BLOCK_FIELDS.angle)
        .appendField('°');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#18a6a6');
      this.setTooltip('Move a joint to the specified absolute angle');
    },
  };

  Blockly.Blocks[BLOCK_TYPES.wait] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('Wait')
        .appendField(
          new Blockly.FieldNumber(200, 0, 5_000, 100),
          BLOCK_FIELDS.duration,
        )
        .appendField('ms');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#7c6ee6');
      this.setTooltip(
        'Hold the current pose and wait for the specified duration',
      );
    },
  };

  Blockly.Blocks[BLOCK_TYPES.repeat] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('Repeat')
        .appendField(
          new Blockly.FieldNumber(2, 1, 20, 1),
          BLOCK_FIELDS.count,
        )
        .appendField('times');
      this.appendStatementInput(BLOCK_FIELDS.body).appendField('Do');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#df8a35');
      this.setTooltip('Repeat the nested commands in order');
    },
  };
}

export function createToolbox(
  challenge: Pick<Challenge, 'allowedBlocks'>,
): Blockly.utils.toolbox.ToolboxDefinition {
  const servoContents = challenge.allowedBlocks
    .filter((type) => type === 'set-joint-angle')
    .map((type) => ({
      kind: 'block',
      type: semanticToBlocklyType[type],
    }));
  const controlContents = challenge.allowedBlocks
    .filter((type) => type !== 'set-joint-angle')
    .map((type) => ({
      kind: 'block',
      type: semanticToBlocklyType[type],
    }));

  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Servo',
        colour: '#18a6a6',
        contents: servoContents,
      },
      {
        kind: 'category',
        name: 'Control',
        colour: '#7c6ee6',
        contents: controlContents,
      },
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}

export function blockTypeToSemantic(
  blockType: string,
): AllowedBlockType | undefined {
  return (
    Object.entries(semanticToBlocklyType).find(
      ([, type]) => type === blockType,
    )?.[0] as AllowedBlockType | undefined
  );
}
