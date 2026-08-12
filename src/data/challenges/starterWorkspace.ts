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

// Servo degrees. Geometric equivalents in comments, since the poses these
// produce were chosen in the old convention and are easier to check that way.
const starterProgram = setJoint(
  'starter-shoulder-roll',
  'shoulderRoll',
  15, // simulation-only joint, so still geometric
  setJoint(
    'starter-shoulder',
    'shoulder',
    130, // geometric 80
    setJoint(
      'starter-elbow',
      'elbow',
      152.5, // geometric 0
      setJoint(
        'starter-wrist',
        'wrist',
        10, // geometric -80
        setJoint('starter-base-sweep', 'baseYaw', 145), // geometric 55
      ),
    ),
  ),
);

starterProgram.x = 40;
starterProgram.y = 40;

export const starterWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [starterProgram],
  },
};
