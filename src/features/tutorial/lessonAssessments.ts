import type { CutterGridNodeV1, CutterGridProgramV1 } from '../cutter-grid/types';
import type { SimulationStatus } from '../simulation/SimulationEngine';

export interface LessonMultipleChoice {
  question: string;
  options: readonly [string, string, string];
  correctOptionIndex: 0 | 1 | 2;
}

export interface LessonAssessments {
  multipleChoice: LessonMultipleChoice;
  practicalPrompt: string;
}

export function buildConceptQuestion(
  lessonName: string,
  correctStatement: string,
  correctOptionIndex: 0 | 1 | 2,
  falseStatements: readonly [string, string],
): LessonMultipleChoice {
  const options: [string, string, string] = ['', '', ''];
  options[correctOptionIndex] = correctStatement;
  const remaining = ([0, 1, 2] as const).filter(
    (index) => index !== correctOptionIndex,
  );
  options[remaining[0]] = falseStatements[0];
  options[remaining[1]] = falseStatements[1];
  return {
    question: `Which statement is accurate for “${lessonName}”?`,
    options,
    correctOptionIndex,
  };
}

/**
 * What a section asks a learner to have done before it will let them move on.
 *
 * Sections that only ask someone to read or predict stay freely navigable;
 * the ones that ask for work are the lesson. Skipping those and arriving at
 * the checkpoint having built nothing is the failure mode this prevents.
 *
 * The evidence is per section, not per lesson: a 'test' section asks for a Test
 * pressed while that section is open. A lesson-wide "has tested at least once"
 * counter satisfied every later observe and challenge section at once, so the
 * first Test of a lesson marked the whole remaining run done.
 */
export type LessonSectionRequirement = 'none' | 'program' | 'test' | 'step';

/** What a learner has actually done while the current section was open. */
export interface LessonSectionEvidence {
  tested: boolean;
  stepped: boolean;
}

/**
 * A section may name the control it teaches. The activity is a fallback for
 * the ones that do not: "Use Step" asks for Step, and gating it on Test told
 * the learner to press a button that did not release the section.
 */
export function lessonSectionRequirement(
  section: {
    activity: 'read' | 'predict' | 'build' | 'observe' | 'challenge' | 'recap';
    requirement?: LessonSectionRequirement;
  },
): LessonSectionRequirement {
  if (section.requirement) return section.requirement;
  switch (section.activity) {
    // "Create this program in Blockly: …" — the workspace has to show it.
    case 'build':
      return 'program';
    // Reading the overlay, stepping and testing all need a completed run to
    // look at.
    case 'observe':
    case 'challenge':
      return 'test';
    default:
      return 'none';
  }
}

export function meetsCutterGridSectionRequirement(
  requirement: LessonSectionRequirement,
  lessonId: string,
  program: CutterGridProgramV1 | undefined,
  evidence: LessonSectionEvidence,
): boolean {
  if (requirement === 'none') return true;
  if (requirement === 'test') return evidence.tested;
  // A Test runs the whole program at once, which is the thing a Step section
  // is teaching the learner not to do, so it does not stand in for a Step.
  if (requirement === 'step') return evidence.stepped;
  return matchesCutterGridConcept(lessonId, program);
}

/**
 * Servo lessons have no per-lesson structural contract — the scored checkpoint
 * is the contract — so a build section asks only that the workspace holds a
 * program that would actually run.
 */
export function meetsServoSectionRequirement(
  requirement: LessonSectionRequirement,
  executedCommandCount: number,
  evidence: LessonSectionEvidence,
): boolean {
  if (requirement === 'none') return true;
  if (requirement === 'test') return evidence.tested;
  if (requirement === 'step') return evidence.stepped;
  return executedCommandCount >= 1;
}

/**
 * A Grid practical is accepted only after the real Test path has completed.
 * The structural check keeps each practical tied to the concept being taught;
 * merely testing an empty or unrelated workspace cannot unlock a lesson.
 */
export function passesCutterGridPractical(
  lessonId: string,
  program: CutterGridProgramV1 | undefined,
  successfulTestCount: number,
  completionScore: number | undefined,
  simulationStatus: SimulationStatus,
): boolean {
  if (successfulTestCount < 1 || simulationStatus !== 'completed') return false;
  if (lessonId === 'cutter-grid-certified-cut') return (completionScore ?? 0) >= 99.995;
  return matchesCutterGridConcept(lessonId, program);
}

/** The structural half of a practical: does this program show the concept? */
export function matchesCutterGridConcept(
  lessonId: string,
  program: CutterGridProgramV1 | undefined,
): boolean {
  if (!program) return false;
  const nodes = flatten(program.nodes);
  const moves = nodes.filter(
    (node): node is Extract<CutterGridNodeV1, { type: 'move' }> =>
      node.type === 'move',
  );
  const directions = new Set(moves.map((move) => move.direction));

  switch (lessonId) {
    case 'cutter-grid-fixed-axes':
      return new Set(moves.map(directionAxis)).size === 3;
    case 'cutter-grid-distance':
      return moves.some((move) => move.distance >= 2);
    case 'cutter-grid-repeat':
      return containsNode(program.nodes, 'repeat');
    case 'cutter-grid-overcut':
    case 'cutter-grid-route-order':
      return new Set(moves.map(directionAxis)).size >= 2;
    case 'cutter-grid-blocked':
      return moves.length >= 1;
    case 'cutter-grid-opposites':
      return hasOppositePair(directions);
    case 'cutter-grid-wait':
      return containsNode(program.nodes, 'wait') && moves.length >= 1;
    case 'cutter-grid-compress':
      return moves.some((move) => move.distance >= 3);
    case 'cutter-grid-certified-cut':
      // Completion is scored by the practical; structurally this lesson only
      // asks for a route that works all three axes.
      return new Set(moves.map(directionAxis)).size === 3;
    default:
      return false;
  }
}

function flatten(nodes: readonly CutterGridNodeV1[]): CutterGridNodeV1[] {
  return nodes.flatMap((node) =>
    node.type === 'repeat' ? [node, ...flatten(node.body)] : [node],
  );
}

function containsNode(
  nodes: readonly CutterGridNodeV1[],
  type: CutterGridNodeV1['type'],
): boolean {
  return flatten(nodes).some((node) => node.type === type);
}

function directionAxis(
  move: Extract<CutterGridNodeV1, { type: 'move' }>,
): 'x' | 'y' | 'z' {
  if (move.direction === 'left' || move.direction === 'right') return 'x';
  if (move.direction === 'up' || move.direction === 'down') return 'y';
  return 'z';
}

function hasOppositePair(directions: ReadonlySet<string>): boolean {
  return (
    (directions.has('left') && directions.has('right')) ||
    (directions.has('up') && directions.has('down')) ||
    (directions.has('forward') && directions.has('backward'))
  );
}
