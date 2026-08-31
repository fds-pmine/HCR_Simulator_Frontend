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
export type LessonSectionRequirement =
  | 'none' | 'program' | 'test' | 'step' | 'overlay' | 'practical';

/** What a learner has actually done while the current section was open. */
export interface LessonSectionEvidence {
  tested: boolean;
  stepped: boolean;
  /** The Grid and planned-path overlay is showing. */
  overlayShown: boolean;
}

/**
 * A section may name the control it teaches. The activity is a fallback for
 * the ones that do not: "Use Step" asks for Step and "Inspect the overlay"
 * asks for the overlay, and gating either on Test told the learner to press a
 * button that did not release the section.
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

export function meetsCutterGridSectionRequirement(input: {
  requirement: LessonSectionRequirement;
  lessonId: string;
  /** The route this section asks the learner to end up with. */
  expectedRoute: string;
  program: CutterGridProgramV1 | undefined;
  evidence: LessonSectionEvidence;
}): boolean {
  const { requirement, lessonId, expectedRoute, program, evidence } = input;
  if (requirement === 'none') return true;
  if (requirement === 'test') return evidence.tested;
  // A Test runs the whole program at once, which is the thing a Step section
  // is teaching the learner not to do, so it does not stand in for a Step.
  if (requirement === 'step') return evidence.stepped;
  if (requirement === 'overlay') return evidence.overlayShown;
  // The closing challenge is the lesson's practical, checked the same way.
  if (requirement === 'practical') return matchesCutterGridConcept(lessonId, program);
  // "Create this program in Blockly: Left 3" asks for that program, and a
  // drill that says "swap Right for Left" asks for the swapped route — each
  // section is checked against the route it actually asks for.
  return matchesCutterGridExample(expectedRoute, program);
}

/** Whether the workspace holds exactly the route the section printed. */
export function matchesCutterGridExample(
  example: string,
  program: CutterGridProgramV1 | undefined,
): boolean {
  if (!program) return false;
  const expected = parseCutterGridExample(example);
  return expected !== undefined && sameNodes(expected, program.nodes);
}

/** One step of a printed lesson route. */
export type ExampleNode =
  | { type: 'move'; direction: Extract<CutterGridNodeV1, { type: 'move' }>['direction']; distance: number }
  | { type: 'wait'; durationMs: number }
  | { type: 'repeat'; count: number; body: ExampleNode[] };

const DIRECTIONS: Readonly<
  Record<string, Extract<CutterGridNodeV1, { type: 'move' }>['direction']>
> = {
  Right: 'right', Left: 'left', Up: 'up',
  Down: 'down', Forward: 'forward', Backward: 'backward',
};

/** Split on the arrows that sit outside a Repeat body. */
function splitSteps(example: string): string[] {
  const steps: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of example) {
    if (character === '[') depth += 1;
    if (character === ']') depth -= 1;
    if (character === '→' && depth === 0) {
      steps.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  steps.push(current);
  return steps.map((step) => step.trim()).filter(Boolean);
}

/**
 * Parse a printed route such as `Left 3 → Up 2` or `Repeat 3 × [Up 1 → Down 1]`.
 *
 * Exported so the lesson-content tests check examples against the same grammar
 * the build gate uses, rather than a second copy of it that can drift.
 */
export function parseCutterGridExample(example: string): ExampleNode[] | undefined {
  const nodes: ExampleNode[] = [];
  for (const step of splitSteps(example)) {
    const repeat = /^Repeat (\d+) × \[(.*)\]$/.exec(step);
    if (repeat) {
      const body = parseCutterGridExample(repeat[2]);
      if (!body) return undefined;
      nodes.push({ type: 'repeat', count: Number(repeat[1]), body });
      continue;
    }
    const wait = /^Wait (\d+) ms$/.exec(step);
    if (wait) {
      nodes.push({ type: 'wait', durationMs: Number(wait[1]) });
      continue;
    }
    const move = /^([A-Za-z]+) (\d+)$/.exec(step);
    const direction = move ? DIRECTIONS[move[1]] : undefined;
    if (!move || !direction) return undefined;
    nodes.push({ type: 'move', direction, distance: Number(move[2]) });
  }
  return nodes.length > 0 ? nodes : undefined;
}

function sameNodes(
  expected: readonly ExampleNode[],
  actual: readonly CutterGridNodeV1[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((node, index) => {
    const built = actual[index];
    if (node.type !== built.type) return false;
    if (node.type === 'move' && built.type === 'move') {
      return node.direction === built.direction && node.distance === built.distance;
    }
    if (node.type === 'wait' && built.type === 'wait') {
      return node.durationMs === built.durationMs;
    }
    return node.type === 'repeat' && built.type === 'repeat'
      && node.count === built.count
      && sameNodes(node.body, built.body);
  });
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
  if (requirement === 'overlay') return evidence.overlayShown;
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

/**
 * The structural half of a practical: does this program do what the lesson's
 * practical prompt asked for?
 *
 * These checks used to be far looser than the prompts above them — "reach
 * (−3, 2, 0) with two Move blocks" accepted any single move of two cells or
 * more — so a learner who pressed Test on nearly anything was told the
 * practical had passed and the next lesson opened. A prompt and its check have
 * to be the same requirement, so where a prompt could not be checked from one
 * program (comparing two routes, repairing a route the lesson never saw) the
 * prompt itself was restated as something a single program can satisfy.
 */
export function matchesCutterGridConcept(
  lessonId: string,
  program: CutterGridProgramV1 | undefined,
): boolean {
  if (!program) return false;
  const visible = movesOf(flatten(program.nodes));
  const executed = movesOf(expand(program.nodes));
  const axes = new Set(executed.map(directionAxis)).size;
  const [x, y, z] = displacement(executed);

  switch (lessonId) {
    // "Build a three-axis route that ends one cell from the origin on every axis."
    case 'cutter-grid-fixed-axes':
      return axes === 3
        && Math.abs(x) === 1 && Math.abs(y) === 1 && Math.abs(z) === 1;
    // "Reach coordinate (−3, 2, 0) using only two visible Move blocks."
    case 'cutter-grid-distance':
      return visible.length === 2 && x === -3 && y === 2 && z === 0;
    // "Build a four-edge loop and repeat it twice without changing the final
    // coordinate." The loop is the Repeat body, so it is the body that has to
    // have four edges and come back to where it started.
    case 'cutter-grid-repeat':
      return flatten(program.nodes).some((node) => {
        if (node.type !== 'repeat') return false;
        const body = movesOf(expand(node.body));
        const [bx, by, bz] = displacement(body);
        return node.count >= 2 && body.length === 4 && bx === 0 && by === 0 && bz === 0;
      });
    // "Build a two-axis L-shaped route, then swap its two moves…"
    case 'cutter-grid-overcut':
      return visible.length === 2
        && new Set(visible.map(directionAxis)).size === 2;
    // "Build a route of at least three moves that only reaches coordinates the
    // arm can certify." A run that completed proves the second half.
    case 'cutter-grid-blocked':
      return visible.length >= 3;
    // "Build a three-axis outbound route and its exact return path."
    case 'cutter-grid-opposites':
      return axes === 3 && x === 0 && y === 0 && z === 0 && isOutAndBack(executed);
    // "Place two different waits in a three-move route…"
    case 'cutter-grid-wait': {
      const waits = flatten(program.nodes).filter(
        (node): node is Extract<CutterGridNodeV1, { type: 'wait' }> => node.type === 'wait',
      );
      return visible.length === 3
        && new Set(waits.map((wait) => wait.durationMs)).size >= 2;
    }
    // "Build a three-block route that changes two axes, then reverse it…"
    case 'cutter-grid-route-order':
      return visible.length === 3
        && new Set(visible.map(directionAxis)).size >= 2;
    // "Rewrite a seven-block route with the fewest safe visible blocks."
    case 'cutter-grid-compress':
      return visible.length <= 3
        && executed.reduce((cells, move) => cells + move.distance, 0) >= 7;
    case 'cutter-grid-certified-cut':
      // Completion is scored by the practical; structurally this lesson only
      // asks for a route that works all three axes.
      return axes === 3;
    default:
      return false;
  }
}

/** Whether the second half retraces the first exactly, in reverse. */
function isOutAndBack(
  moves: readonly Extract<CutterGridNodeV1, { type: 'move' }>[],
): boolean {
  if (moves.length < 2 || moves.length % 2 !== 0) return false;
  const half = moves.length / 2;
  for (let index = 0; index < half; index += 1) {
    const out = moves[index];
    const back = moves[moves.length - 1 - index];
    if (back.distance !== out.distance) return false;
    if (back.direction !== OPPOSITE[out.direction]) return false;
  }
  return true;
}

const OPPOSITE: Readonly<
  Record<Extract<CutterGridNodeV1, { type: 'move' }>['direction'],
  Extract<CutterGridNodeV1, { type: 'move' }>['direction']>
> = {
  left: 'right', right: 'left',
  up: 'down', down: 'up',
  forward: 'backward', backward: 'forward',
};

const STEP: Readonly<
  Record<Extract<CutterGridNodeV1, { type: 'move' }>['direction'], readonly [number, number, number]>
> = {
  right: [1, 0, 0], left: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
  forward: [0, 0, -1], backward: [0, 0, 1],
};

function displacement(
  moves: readonly Extract<CutterGridNodeV1, { type: 'move' }>[],
): [number, number, number] {
  return moves.reduce<[number, number, number]>(
    (at, move) => {
      const step = STEP[move.direction];
      return [
        at[0] + step[0] * move.distance,
        at[1] + step[1] * move.distance,
        at[2] + step[2] * move.distance,
      ];
    },
    [0, 0, 0],
  );
}

function movesOf(
  nodes: readonly CutterGridNodeV1[],
): Extract<CutterGridNodeV1, { type: 'move' }>[] {
  return nodes.filter(
    (node): node is Extract<CutterGridNodeV1, { type: 'move' }> => node.type === 'move',
  );
}

/** The sequence the arm executes: a Repeat body appears `count` times. */
function expand(nodes: readonly CutterGridNodeV1[]): CutterGridNodeV1[] {
  return nodes.flatMap((node) =>
    node.type === 'repeat'
      ? Array.from({ length: node.count }, () => expand(node.body)).flat()
      : [node],
  );
}

function flatten(nodes: readonly CutterGridNodeV1[]): CutterGridNodeV1[] {
  return nodes.flatMap((node) =>
    node.type === 'repeat' ? [node, ...flatten(node.body)] : [node],
  );
}


function directionAxis(
  move: Extract<CutterGridNodeV1, { type: 'move' }>,
): 'x' | 'y' | 'z' {
  if (move.direction === 'left' || move.direction === 'right') return 'x';
  if (move.direction === 'up' || move.direction === 'down') return 'y';
  return 'z';
}
