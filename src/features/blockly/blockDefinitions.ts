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
      // Tenths of a degree, because that is the resolution the arm has:
      // `hcr-fw` carries angles as tenths and its parser accepts exactly one
      // fractional digit. Whole degrees would round 162.5° — a real elbow
      // limit — to a value the servo cannot be commanded to.
      const ANGLE_PRECISION_DEG = 0.1;

      const angleField = new Blockly.FieldNumber(
        initialJoint.initialAngleDeg,
        initialJoint.minAngleDeg,
        initialJoint.maxAngleDeg,
        ANGLE_PRECISION_DEG,
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

      /**
       * Retune the angle field to whichever joint is now selected.
       *
       * The joints do not share a range — `baseYaw` travels 30…150 and `wrist`
       * 0…180 — so a single set of bounds cannot be right for all of them. The
       * field used to carry the union of every joint's range, which made every
       * individual joint's bounds wrong: the spinner offered angles the selected
       * joint could not reach, and changing the dropdown left the previous
       * joint's angle sitting under the new one. `Set Wrist to 180` became
       * `Set Base Yaw to 180`, which is 30° past where the base can turn.
       *
       * Nothing unsafe came of it — the compiler re-checks the range and refuses
       * the program — but the refusal arrived at Run time, pointing at a block
       * the editor had just built without complaint.
       *
       * Clamping rather than resetting keeps as much of the learner's intent as
       * the joint allows, and the number visibly changing is the signal that it
       * was adjusted.
       */
      const applyJointRange = (jointId: string): void => {
        const joint = jointById.get(jointId);
        if (!joint) return;
        angleField.setConstraints(
          joint.minAngleDeg,
          joint.maxAngleDeg,
          ANGLE_PRECISION_DEG,
        );
        const current = Number(angleField.getValue());
        const clamped = Math.min(
          joint.maxAngleDeg,
          Math.max(joint.minAngleDeg, current),
        );
        if (clamped !== current) {
          angleField.setValue(clamped);
        }
      };

      this.appendDummyInput()
        .appendField('Set')
        .appendField(
          new Blockly.FieldDropdown(
            options,
            function validateJoint(this: Blockly.FieldDropdown, jointId: string) {
              // Runs before the dropdown commits, so the new id arrives as an
              // argument rather than through `getFieldValue`.
              applyJointRange(jointId);
              return undefined;
            },
          ),
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
