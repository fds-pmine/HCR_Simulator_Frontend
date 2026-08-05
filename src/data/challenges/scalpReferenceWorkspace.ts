import { SCALP_BLOCK_FIELDS, SCALP_BLOCK_TYPES } from '../../features/scalp-path';

interface SerializedBlock {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, string | number>;
  next?: { block: SerializedBlock };
}

function chain(blocks: SerializedBlock[]): SerializedBlock {
  return blocks.reduceRight<SerializedBlock | undefined>(
    (next, block) => (next ? { ...block, next: { block: next } } : block),
    undefined,
  )!;
}

function turn(id: string, direction: 'left' | 'right'): SerializedBlock {
  return {
    id,
    type: SCALP_BLOCK_TYPES.turn,
    fields: { [SCALP_BLOCK_FIELDS.direction]: direction },
  };
}

function move(id: string, steps: number): SerializedBlock {
  return {
    id,
    type: SCALP_BLOCK_TYPES.moveForward,
    fields: { [SCALP_BLOCK_FIELDS.steps]: steps },
  };
}

function cutter(id: string, mode: 'hover' | 'cut'): SerializedBlock {
  return {
    id,
    type: SCALP_BLOCK_TYPES.setToolMode,
    fields: { [SCALP_BLOCK_FIELDS.mode]: mode },
  };
}

/**
 * The smallest certified path for the shipped crown challenge. It deliberately
 * uses only relative turtle instructions and removes exactly the target trim
 * set under the frozen compatibility scoring baseline.
 */
const referencePath = chain([
  turn('scalp-ref-turn-north', 'left'),
  move('scalp-ref-climb', 2),
  turn('scalp-ref-turn-east', 'right'),
  move('scalp-ref-approach', 1),
  cutter('scalp-ref-cut-crown', 'cut'),
  move('scalp-ref-first-sweep', 8),
]);

referencePath.x = 40;
referencePath.y = 40;

export const scalpReferenceWorkspaceState: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [referencePath],
  },
};
