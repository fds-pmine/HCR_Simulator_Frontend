import { defaultChallengeDefinition } from './defaultChallenge';
import type { ChallengeDefinition } from '../../types/domain';
import type { ScalpProgram, ScalpProgramNode } from '../../features/scalp-path';

type LessonInstruction =
  | { type: 'move-forward'; steps: number }
  | { type: 'turn'; direction: 'left' | 'right' }
  | { type: 'set-tool-mode'; mode: 'hover' | 'cut' }
  | { type: 'wait'; durationMs: number }
  | { type: 'repeat'; count: number; body: LessonInstruction[] };

export interface ScalpPathLesson {
  id: string;
  name: string;
  description: string;
  goal: string;
  solution: ScalpProgram;
}

const move = (steps: number): LessonInstruction => ({ type: 'move-forward', steps });
const left = (): LessonInstruction => ({ type: 'turn', direction: 'left' });
const right = (): LessonInstruction => ({ type: 'turn', direction: 'right' });
const hover = (): LessonInstruction => ({ type: 'set-tool-mode', mode: 'hover' });
const cut = (): LessonInstruction => ({ type: 'set-tool-mode', mode: 'cut' });
const repeat = (count: number, body: LessonInstruction[]): LessonInstruction => ({
  type: 'repeat',
  count,
  body,
});

function program(id: string, instructions: readonly LessonInstruction[]): ScalpProgram {
  let sequence = 0;
  const assign = (items: readonly LessonInstruction[]): ScalpProgramNode[] =>
    items.map((item) => {
      const sourceBlockId = `${id}-path-${sequence++}`;
      if (item.type === 'repeat') {
        return {
          type: 'repeat',
          count: item.count,
          body: assign(item.body),
          sourceBlockId,
        };
      }
      return { ...item, sourceBlockId };
    });
  const nodes = assign(instructions);
  return { nodes, sourceBlockCount: sequence };
}

const CROWN_APPROACH: LessonInstruction[] = [left(), move(2), right(), move(1)];
const CROWN_TOP_PASS: LessonInstruction[] = [...CROWN_APPROACH, cut(), move(8)];
const CROWN_RETURN_PASS: LessonInstruction[] = [
  ...CROWN_TOP_PASS,
  repeat(2, [right()]),
  move(9),
];
const LOWER_ROW_TRANSFER: LessonInstruction[] = [
  ...CROWN_RETURN_PASS,
  hover(),
  left(),
  move(2),
  left(),
];

/** Blank-canvas Scalp Path courses. Servo courses remain in `lessons.ts`. */
export const SCALP_PATH_LESSONS: readonly ScalpPathLesson[] = [
  {
    id: 'scalp-lesson-1-first-cut',
    name: 'Path 1 · First Cut',
    description: 'Make the first safe cutting sweep from the highlighted upper crown.',
    goal: 'In Hover, turn to the crown, move into place, then Set cutter Cut and sweep forward.',
    solution: program('scalp-lesson-1-first-cut', CROWN_TOP_PASS),
  },
  {
    id: 'scalp-lesson-2-repeat-sweep',
    name: 'Path 2 · Repeat a Sweep',
    description: 'Use Repeat to turn around before a return crown pass.',
    goal: 'After the first sweep, Repeat 2 times a Turn right, then move forward 9 cells.',
    solution: program('scalp-lesson-2-repeat-sweep', CROWN_RETURN_PASS),
  },
  {
    id: 'scalp-lesson-3-turn-and-approach',
    name: 'Path 3 · Turn and Approach',
    description: 'Reach and sweep the upper crown without ever exposing a joint angle.',
    goal: 'In Hover, turn left, move 2 cells, turn right and move 1 cell. Then choose Cut and sweep forward.',
    solution: program('scalp-lesson-3-turn-and-approach', CROWN_TOP_PASS),
  },
  {
    id: 'scalp-lesson-4-crown-pass',
    name: 'Path 4 · Crown Pass',
    description: 'Make a controlled return Cut pass across the upper crown.',
    goal: 'Use the Hover approach and crown pass, then turn around and sweep back.',
    solution: program('scalp-lesson-4-crown-pass', CROWN_RETURN_PASS),
  },
  {
    id: 'scalp-lesson-5-hover-transfer',
    name: 'Path 5 · Hover Transfer',
    description: 'Lift before travelling to a different scalp row.',
    goal: 'After the return pass, set Hover, turn toward the lower row and move 2 cells.',
    solution: program('scalp-lesson-5-hover-transfer', LOWER_ROW_TRANSFER),
  },
  {
    id: 'scalp-lesson-6-lower-row',
    name: 'Path 6 · Lower Row',
    description: 'Engage Cut again only after the Hover transfer is complete.',
    goal: 'Use the Hover transfer, turn back east, set Cutter Cut and sweep the lower row.',
    solution: program('scalp-lesson-6-lower-row', [...LOWER_ROW_TRANSFER, cut(), move(9)]),
  },
  {
    id: 'scalp-lesson-7-two-heights',
    name: 'Path 7 · Two Heights',
    description: 'Plan the two heights as one safe turtle route.',
    goal: 'Keep transfers in Hover and sweep each certified row only in Cut mode.',
    solution: program('scalp-lesson-7-two-heights', [...LOWER_ROW_TRANSFER, cut(), move(9)]),
  },
  {
    id: 'scalp-lesson-8-finish',
    name: 'Path 8 · Finish the Path',
    description: 'Join the two certified Cut passes into a complete trim.',
    goal: 'Complete the upper pass, Hover transfer and lower-row sweep without entering a grey cell.',
    solution: program('scalp-lesson-8-finish', [...LOWER_ROW_TRANSFER, cut(), move(9)]),
  },
];

export function describeScalpPathLessonSolution(nodes: readonly ScalpProgramNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'move-forward') return `Move ${node.steps}`;
      if (node.type === 'turn') return `Turn ${node.direction}`;
      if (node.type === 'set-tool-mode') return `Cutter ${node.mode}`;
      if (node.type === 'wait') return `Wait ${node.durationMs}ms`;
      return `Repeat ${node.count} (${describeScalpPathLessonSolution(node.body)})`;
    })
    .join(' → ');
}

export function scalpPathLessonBase(lesson: ScalpPathLesson): ChallengeDefinition {
  return {
    ...defaultChallengeDefinition,
    id: lesson.id,
    name: lesson.name,
    description: lesson.description,
    starterWorkspace: {},
  };
}
