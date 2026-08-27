import { BLOCK_FIELDS, BLOCK_TYPES } from '../../features/blockly/blockConstants';

interface SerializedBlock {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, string | number>;
  inputs?: Record<string, { block: SerializedBlock }>;
  next?: { block: SerializedBlock };
}

function chain(
  block: SerializedBlock,
  next?: SerializedBlock,
): SerializedBlock {
  return next ? { ...block, next: { block: next } } : block;
}

function setJoint(
  id: string,
  jointId: string,
  angleDeg: number,
  next?: SerializedBlock,
): SerializedBlock {
  return chain(
    {
      type: BLOCK_TYPES.setJointAngle,
      id,
      fields: {
        [BLOCK_FIELDS.jointId]: jointId,
        [BLOCK_FIELDS.angle]: angleDeg,
      },
    },
    next,
  );
}

// Every mapped motor begins at 90°. The starter changes only X so its visible
// block, live telemetry, rendered movement, and hardware command all agree.
const starterProgram = setJoint(
  'starter-base-sweep',
  'baseYaw',
  150,
);

starterProgram.x = 40;
starterProgram.y = 40;

export const starterWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [starterProgram],
  },
};
