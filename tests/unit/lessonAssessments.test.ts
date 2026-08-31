import { describe, expect, it } from 'vitest';
import {
  lessonSectionRequirement,
  meetsCutterGridSectionRequirement,
  meetsServoSectionRequirement,
  passesCutterGridPractical,
} from '../../src/features/tutorial/lessonAssessments';
import type { CutterGridNodeV1, CutterGridProgramV1 } from '../../src/features/cutter-grid/types';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { LESSONS } from '../../src/data/challenges/lessons';

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

const NOTHING_DONE = { tested: false, stepped: false } as const;

describe('section gates', () => {
  /**
   * The observe and challenge sections of one lesson each ask for their own
   * Test. They used to share a lesson-wide counter, so the first Test of a
   * lesson reported all seven of them done at once.
   */
  it('accepts a Test only for the section it was pressed on', () => {
    const tested = [10];
    const gridSection = (index: number) =>
      meetsCutterGridSectionRequirement('test', 'cutter-grid-distance', undefined, {
        tested: tested.includes(index),
        stepped: false,
      });
    expect(gridSection(10)).toBe(true);
    expect(gridSection(11)).toBe(false);

    expect(meetsServoSectionRequirement('test', 0, { tested: true, stepped: false })).toBe(true);
    expect(meetsServoSectionRequirement('test', 5, NOTHING_DONE)).toBe(false);
  });

  /**
   * The "Use Step" section says "Reset, then press Step once", and it used to
   * be gated on Test — pressing the button the section names left it waiting.
   */
  it('asks for Step, not Test, on a section that teaches Step', () => {
    const stepSection = CUTTER_GRID_LESSONS[0].sections.find(
      (section) => section.title === 'Use Step',
    );
    const servoStepSection = LESSONS[0].sections.find(
      (section) => section.title === 'Use Step',
    );
    expect(stepSection).toBeDefined();
    expect(servoStepSection).toBeDefined();
    expect(lessonSectionRequirement(stepSection!)).toBe('step');
    expect(lessonSectionRequirement(servoStepSection!)).toBe('step');

    const gate = (evidence: { tested: boolean; stepped: boolean }) =>
      meetsCutterGridSectionRequirement('step', 'cutter-grid-fixed-axes', undefined, evidence);
    expect(gate({ tested: false, stepped: true })).toBe(true);
    expect(gate({ tested: true, stepped: false })).toBe(false);
    expect(meetsServoSectionRequirement('step', 5, { tested: true, stepped: false })).toBe(false);
    expect(meetsServoSectionRequirement('step', 5, { tested: false, stepped: true })).toBe(true);
  });

  it('leaves reading sections open and holds build sections on the workspace', () => {
    expect(lessonSectionRequirement({ activity: 'read' })).toBe('none');
    expect(lessonSectionRequirement({ activity: 'observe' })).toBe('test');
    expect(lessonSectionRequirement({ activity: 'challenge' })).toBe('test');
    expect(lessonSectionRequirement({ activity: 'build' })).toBe('program');
    expect(
      meetsCutterGridSectionRequirement('none', 'cutter-grid-distance', undefined, NOTHING_DONE),
    ).toBe(true);
    expect(
      meetsCutterGridSectionRequirement(
        'program',
        'cutter-grid-distance',
        program([move('left', 3)]),
        NOTHING_DONE,
      ),
    ).toBe(true);
  });
});
