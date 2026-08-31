import { BLOCK_FIELDS, BLOCK_TYPES } from '../blockly/blockConstants';
import {
  CUTTER_GRID_BLOCK_FIELDS,
  CUTTER_GRID_BLOCK_TYPES,
} from '../cutter-grid/blockConstants';
import { parseCutterGridExample, type ExampleNode } from './lessonAssessments';

/**
 * Turn a printed route into blocks on the canvas.
 *
 * A section that says "swap Right for Left" or "debug a route whose Forward
 * and Backward blocks were exchanged" needs that route to exist before the
 * learner can do anything to it. On an empty workspace those sections had no
 * work in them at all, and pressing Test was the only thing left to do.
 */
export function starterWorkspaceFor(route: string): Record<string, unknown> | undefined {
  const nodes = parseCutterGridExample(route);
  if (!nodes) return undefined;
  const first = chain(nodes, 'starter');
  if (!first) return undefined;
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ ...first, x: 40, y: 40 }],
    },
  };
}

/** Blockly serializes a stack as one block with a `next` chain. */
function chain(
  nodes: readonly ExampleNode[],
  prefix: string,
): Record<string, unknown> | undefined {
  if (nodes.length === 0) return undefined;
  const [head, ...rest] = nodes;
  const next = chain(rest, `${prefix}-n`);
  return {
    ...blockFor(head, prefix),
    ...(next ? { next: { block: next } } : {}),
  };
}

function blockFor(node: ExampleNode, id: string): Record<string, unknown> {
  if (node.type === 'move') {
    return {
      type: CUTTER_GRID_BLOCK_TYPES[node.direction],
      id,
      fields: { [CUTTER_GRID_BLOCK_FIELDS.distance]: node.distance },
    };
  }
  if (node.type === 'wait') {
    return {
      type: BLOCK_TYPES.wait,
      id,
      fields: { [BLOCK_FIELDS.duration]: node.durationMs },
    };
  }
  const body = chain(node.body, `${id}-b`);
  return {
    type: BLOCK_TYPES.repeat,
    id,
    fields: { [BLOCK_FIELDS.count]: node.count },
    ...(body ? { inputs: { [BLOCK_FIELDS.body]: { block: body } } } : {}),
  };
}
