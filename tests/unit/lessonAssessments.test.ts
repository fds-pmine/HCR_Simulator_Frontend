import { describe, expect, it } from 'vitest';
import { passesCutterGridPractical } from '../../src/features/tutorial/lessonAssessments';
import type { CutterGridNodeV1, CutterGridProgramV1 } from '../../src/features/cutter-grid/types';

function program(nodes: CutterGridNodeV1[]): CutterGridProgramV1 {
  return {
    kind: 'cutter-grid',
    version: 1,
    plannerVersion: 'test',
    nodes,
    sourceBlockCount: nodes.length,
  };
}

const move = (
  direction: Extract<CutterGridNodeV1, { type: 'move' }>['direction'],
  distance = 1,
): CutterGridNodeV1 => ({
  type: 'move',
  direction,
  distance,
  sourceBlockId: `${direction}-${distance}`,
});

describe('Cutter Grid Blockly practical gates', () => {
  it('requires a real successful Test, not just matching blocks', () => {
    const workspace = program([move('right'), move('up'), move('forward')]);
    expect(passesCutterGridPractical('cutter-grid-fixed-axes', workspace, 0, 100, 'completed')).toBe(false);
    expect(passesCutterGridPractical('cutter-grid-fixed-axes', workspace, 1, 100, 'error')).toBe(false);
    expect(passesCutterGridPractical('cutter-grid-fixed-axes', workspace, 1, 100, 'completed')).toBe(true);
  });

  it('checks the concept assigned to each Grid lesson', () => {
    expect(passesCutterGridPractical('cutter-grid-distance', program([move('left', 3)]), 1, 0, 'completed')).toBe(true);
    expect(passesCutterGridPractical('cutter-grid-repeat', program([{
      type: 'repeat', count: 2, body: [move('up')], sourceBlockId: 'repeat',
    }]), 1, 0, 'completed')).toBe(true);
    expect(passesCutterGridPractical('cutter-grid-route-order', program([move('left'), move('up')]), 1, 0, 'completed')).toBe(true);
    expect(passesCutterGridPractical('cutter-grid-opposites', program([move('left'), move('right')]), 1, 0, 'completed')).toBe(true);
    expect(passesCutterGridPractical('cutter-grid-wait', program([
      move('up'), { type: 'wait', durationMs: 100, sourceBlockId: 'wait' },
    ]), 1, 0, 'completed')).toBe(true);
    expect(passesCutterGridPractical('cutter-grid-compress', program([move('up', 3)]), 1, 0, 'completed')).toBe(true);
  });

  it('requires a perfect scored run for the certified-cut practical', () => {
    const workspace = program([move('left', 3)]);
    expect(passesCutterGridPractical('cutter-grid-certified-cut', workspace, 1, 99, 'completed')).toBe(false);
    expect(passesCutterGridPractical('cutter-grid-certified-cut', workspace, 1, 100, 'completed')).toBe(true);
  });
});
