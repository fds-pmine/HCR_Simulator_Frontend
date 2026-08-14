import * as Blockly from 'blockly/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { BLOCK_FIELDS, BLOCK_TYPES } from '../../src/features/blockly/blockConstants';
import { registerHcrBlocks } from '../../src/features/blockly/blockDefinitions';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

/**
 * The Servo Angles angle field, per joint.
 *
 * Each joint has its own travel — `baseYaw` 30…150, `wrist` 0…180 — and the
 * block has one number field shared between them. Getting that wrong does not
 * crash anything: the compiler re-checks the range and refuses the program, so
 * the failure lands at Run time as "Base Yaw angle must be between 30° and 150°"
 * on a block the editor let the learner build. That is the worst place for it.
 */
const challenge = normalizeChallenge(defaultChallengeDefinition);
const joints = challenge.robotConfig.joints;

function angleBlock(): { block: Blockly.Block; workspace: Blockly.Workspace } {
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock(BLOCK_TYPES.setJointAngle);
  return { block, workspace };
}

function setJoint(block: Blockly.Block, jointId: string): void {
  block.setFieldValue(jointId, BLOCK_FIELDS.jointId);
}

function setAngle(block: Blockly.Block, angle: number): void {
  block.setFieldValue(angle, BLOCK_FIELDS.angle);
}

function angleOf(block: Blockly.Block): number {
  return Number(block.getFieldValue(BLOCK_FIELDS.angle));
}

beforeAll(() => {
  registerHcrBlocks(joints);
});

describe('the angle field is bounded by the selected joint', () => {
  it.each(joints.map((joint) => [joint.id, joint] as const))(
    '%s rejects an angle above its own maximum',
    (_id, joint) => {
      const { block } = angleBlock();
      setJoint(block, joint.id);
      setAngle(block, joint.initialAngleDeg);

      setAngle(block, joint.maxAngleDeg + 5);

      expect(angleOf(block)).toBeLessThanOrEqual(joint.maxAngleDeg);
    },
  );

  it.each(joints.map((joint) => [joint.id, joint] as const))(
    '%s rejects an angle below its own minimum',
    (_id, joint) => {
      const { block } = angleBlock();
      setJoint(block, joint.id);
      setAngle(block, joint.initialAngleDeg);

      setAngle(block, joint.minAngleDeg - 5);

      expect(angleOf(block)).toBeGreaterThanOrEqual(joint.minAngleDeg);
    },
  );
});

describe('switching joints', () => {
  /**
   * The case that actually reaches a learner.
   *
   * `Set Wrist to 180` is legal — 180 is the wrist's maximum. Change the
   * dropdown to Base Yaw, whose maximum is 150, and the block now reads
   * `Set Base Yaw to 180`: a value the compiler will refuse, sitting in a
   * workspace that gave no indication anything was wrong.
   */
  it('does not leave an angle the newly selected joint cannot reach', () => {
    const { block } = angleBlock();
    const wrist = joints.find((joint) => joint.id === 'wrist')!;
    const baseYaw = joints.find((joint) => joint.id === 'baseYaw')!;

    setJoint(block, wrist.id);
    setAngle(block, wrist.maxAngleDeg);
    expect(angleOf(block)).toBe(180);

    setJoint(block, baseYaw.id);

    expect(angleOf(block)).toBeLessThanOrEqual(baseYaw.maxAngleDeg);
    expect(angleOf(block)).toBeGreaterThanOrEqual(baseYaw.minAngleDeg);
  });

  /**
   * Saved programs must survive a round trip unchanged.
   *
   * Retuning the field's bounds when the joint changes creates an ordering
   * hazard on load: restore the angle first and it is clamped against whatever
   * joint the block was built with, silently rewriting `Set Wrist to 180` as
   * `Set Wrist to 150`. Blockly serializes fields in the order they were
   * appended and the dropdown is appended first, so the joint lands before the
   * angle — but that is a property worth holding onto rather than assuming,
   * because the failure is a quiet edit to work the learner already saved.
   */
  it('survives a save and reload at a joint-specific extreme', () => {
    const { block, workspace } = angleBlock();
    setJoint(block, 'wrist');
    setAngle(block, 180);

    const state = Blockly.serialization.workspaces.save(workspace);

    const reloaded = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(state, reloaded);
    const restored = reloaded.getAllBlocks(false)[0];

    expect(restored.getFieldValue(BLOCK_FIELDS.jointId)).toBe('wrist');
    expect(Number(restored.getFieldValue(BLOCK_FIELDS.angle))).toBe(180);
  });

  it('does not leave an angle below the newly selected joint', () => {
    const { block } = angleBlock();
    const shoulderRoll = joints.find((joint) => joint.id === 'shoulderRoll')!;
    const elbow = joints.find((joint) => joint.id === 'elbow')!;

    setJoint(block, shoulderRoll.id);
    setAngle(block, shoulderRoll.minAngleDeg);
    expect(angleOf(block)).toBe(-45);

    setJoint(block, elbow.id);

    expect(angleOf(block)).toBeGreaterThanOrEqual(elbow.minAngleDeg);
    expect(angleOf(block)).toBeLessThanOrEqual(elbow.maxAngleDeg);
  });
});
