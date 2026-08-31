import { describe, expect, it } from 'vitest';
import {
  lessonSectionRequirement,
  matchesCutterGridExample,
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

  const passes = (lessonId: string, nodes: CutterGridNodeV1[]) =>
    passesCutterGridPractical(lessonId, program(nodes), 1, 0, 'completed');

  it('accepts the program each practical actually asks for', () => {
    // "Reach coordinate (−3, 2, 0) using only two visible Move blocks."
    expect(passes('cutter-grid-distance', [move('left', 3), move('up', 2)])).toBe(true);
    // "Build a four-edge loop and repeat it twice…"
    expect(passes('cutter-grid-repeat', [{
      type: 'repeat',
      count: 2,
      body: [move('up'), move('right'), move('down'), move('left')],
      sourceBlockId: 'repeat',
    }])).toBe(true);
    // "Build a three-block route that changes two axes…"
    expect(passes('cutter-grid-route-order', [move('left'), move('up'), move('left')])).toBe(true);
    // "Build a three-axis outbound route and its exact return path."
    expect(passes('cutter-grid-opposites', [
      move('left', 2), move('up'), move('forward'),
      move('backward'), move('down'), move('right', 2),
    ])).toBe(true);
    // "Place two different waits in a three-move route…"
    expect(passes('cutter-grid-wait', [
      move('up'),
      { type: 'wait', durationMs: 100, sourceBlockId: 'wait-a' },
      move('right'),
      { type: 'wait', durationMs: 500, sourceBlockId: 'wait-b' },
      move('forward'),
    ])).toBe(true);
    // "Rewrite a seven-block route with the fewest safe visible blocks."
    expect(passes('cutter-grid-compress', [move('up', 4), move('left', 3)])).toBe(true);
    // "Build a three-axis route that ends one cell from the origin on every axis."
    expect(passes('cutter-grid-fixed-axes', [move('right'), move('up'), move('forward')])).toBe(true);
    // "Build a two-axis L-shaped route…"
    expect(passes('cutter-grid-overcut', [move('left', 2), move('up', 2)])).toBe(true);
    // "Build a route of at least three moves…"
    expect(passes('cutter-grid-blocked', [move('right'), move('up', 2), move('forward')])).toBe(true);
  });

  /**
   * Every one of these passed before the checks were written to match the
   * prompts above them, so a learner who pressed Test on almost anything was
   * told the practical had passed and the next lesson opened.
   */
  it('rejects a program that only gestures at the concept', () => {
    // Two cells moved, but not to (−3, 2, 0), and only one block.
    expect(passes('cutter-grid-distance', [move('left', 3)])).toBe(false);
    // A Repeat, but the body is one edge and the loop never closes.
    expect(passes('cutter-grid-repeat', [{
      type: 'repeat', count: 2, body: [move('up')], sourceBlockId: 'repeat',
    }])).toBe(false);
    // Two axes, but the route-order practical asks for three blocks.
    expect(passes('cutter-grid-route-order', [move('left'), move('up')])).toBe(false);
    // One opposite pair on one axis, with no outbound three-axis route.
    expect(passes('cutter-grid-opposites', [move('left'), move('right')])).toBe(false);
    // One wait, and two moves rather than three.
    expect(passes('cutter-grid-wait', [
      move('up'), { type: 'wait', durationMs: 100, sourceBlockId: 'wait' },
    ])).toBe(false);
    // Three cells compressed into one block is not a seven-cell route.
    expect(passes('cutter-grid-compress', [move('up', 3)])).toBe(false);
    // Three axes, but the endpoint is not one cell out on every axis.
    expect(passes('cutter-grid-fixed-axes', [move('right', 5), move('up'), move('forward')])).toBe(false);
    // A single move used to be enough for the whole blocked-nodes lesson.
    expect(passes('cutter-grid-blocked', [move('right')])).toBe(false);
  });

  it('requires a perfect scored run for the certified-cut practical', () => {
    const workspace = program([move('left', 3)]);
    expect(passesCutterGridPractical('cutter-grid-certified-cut', workspace, 1, 99, 'completed')).toBe(false);
    expect(passesCutterGridPractical('cutter-grid-certified-cut', workspace, 1, 100, 'completed')).toBe(true);
  });
});

const NOTHING_DONE = { tested: false, stepped: false, overlayShown: false } as const;

describe('section gates', () => {
  /**
   * The observe and challenge sections of one lesson each ask for their own
   * Test. They used to share a lesson-wide counter, so the first Test of a
   * lesson reported all seven of them done at once.
   */
  it('accepts a Test only for the section it was pressed on', () => {
    const tested = [10];
    const gridSection = (index: number) =>
      meetsCutterGridSectionRequirement({
        requirement: 'test',
        lessonId: 'cutter-grid-distance',
        expectedRoute: 'Left 3',
        program: undefined,
        evidence: { tested: tested.includes(index), stepped: false, overlayShown: false },
      });
    expect(gridSection(10)).toBe(true);
    expect(gridSection(11)).toBe(false);

    expect(meetsServoSectionRequirement('test', 0, { tested: true, stepped: false, overlayShown: false })).toBe(true);
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

    const gate = (evidence: { tested: boolean; stepped: boolean; overlayShown: boolean }) =>
      meetsCutterGridSectionRequirement({
        requirement: 'step',
        lessonId: 'cutter-grid-fixed-axes',
        expectedRoute: 'Left 3',
        program: undefined,
        evidence,
      });
    expect(gate({ tested: false, stepped: true, overlayShown: false })).toBe(true);
    expect(gate({ tested: true, stepped: false, overlayShown: false })).toBe(false);
    expect(meetsServoSectionRequirement('step', 5, { tested: true, stepped: false, overlayShown: false })).toBe(false);
    expect(meetsServoSectionRequirement('step', 5, { tested: false, stepped: true, overlayShown: false })).toBe(true);
  });

  /**
   * "Inspect the overlay" says to turn on Grid and planned path. It used to be
   * gated on Test, so toggling the overlay the section names did nothing and
   * only a Test released it.
   */
  it('asks for the overlay on the section that teaches the overlay', () => {
    const overlaySection = CUTTER_GRID_LESSONS[0].sections.find(
      (section) => section.title === 'Inspect the overlay',
    );
    expect(overlaySection).toBeDefined();
    expect(lessonSectionRequirement(overlaySection!)).toBe('overlay');

    const gate = (evidence: { tested: boolean; stepped: boolean; overlayShown: boolean }) =>
      meetsCutterGridSectionRequirement({
        requirement: 'overlay',
        lessonId: 'cutter-grid-distance',
        expectedRoute: 'Left 3',
        program: undefined,
        evidence,
      });
    expect(gate({ tested: false, stepped: false, overlayShown: true })).toBe(true);
    expect(gate({ tested: true, stepped: true, overlayShown: false })).toBe(false);
  });

  it('leaves reading sections open and holds build sections on the workspace', () => {
    expect(lessonSectionRequirement({ activity: 'read' })).toBe('none');
    expect(lessonSectionRequirement({ activity: 'observe' })).toBe('test');
    expect(lessonSectionRequirement({ activity: 'challenge' })).toBe('test');
    expect(lessonSectionRequirement({ activity: 'build' })).toBe('program');
    expect(
      meetsCutterGridSectionRequirement({
        requirement: 'none',
        lessonId: 'cutter-grid-distance',
        expectedRoute: 'Left 3',
        program: undefined,
        evidence: NOTHING_DONE,
      }),
    ).toBe(true);
  });

  /**
   * The build section prints a route and says "create this program in Blockly".
   * It is checked against that route, not against the lesson's practical: the
   * two sections ask for different programs.
   */
  it('holds a build section until the workspace holds the printed route', () => {
    const build = (example: string, nodes: CutterGridNodeV1[]) =>
      meetsCutterGridSectionRequirement({
        requirement: 'program',
        lessonId: 'cutter-grid-distance',
        expectedRoute: example,
        program: program(nodes),
        evidence: NOTHING_DONE,
      });

    expect(build('Left 3', [move('left', 3)])).toBe(true);
    expect(build('Left 3', [move('left', 2)])).toBe(false);
    expect(build('Left 3', [move('left', 3), move('up')])).toBe(false);
    expect(build('Right 1 → Up 1 → Forward 1', [
      move('right'), move('up'), move('forward'),
    ])).toBe(true);
    expect(build('Up 2 → Wait 500 ms → Forward 2', [
      move('up', 2),
      { type: 'wait', durationMs: 500, sourceBlockId: 'wait' },
      move('forward', 2),
    ])).toBe(true);
    expect(build('Repeat 3 × [Up 1 → Down 1]', [{
      type: 'repeat', count: 3, body: [move('up'), move('down')], sourceBlockId: 'repeat',
    }])).toBe(true);
    expect(build('Repeat 3 × [Up 1 → Down 1]', [{
      type: 'repeat', count: 2, body: [move('up'), move('down')], sourceBlockId: 'repeat',
    }])).toBe(false);
  });

  it('parses every lesson example it is asked to check', () => {
    for (const lesson of CUTTER_GRID_LESSONS) {
      expect(
        matchesCutterGridExample(lesson.example, undefined),
        `${lesson.id} example`,
      ).toBe(false);
    }
    // A route that parses but does not match still fails, so a parse failure
    // and a mismatch cannot be told apart by the false above alone.
    expect(matchesCutterGridExample('Left 3', program([move('left', 3)]))).toBe(true);
    expect(matchesCutterGridExample('not a route', program([move('left', 3)]))).toBe(false);
  });
});
