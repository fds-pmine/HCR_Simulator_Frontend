import type { ScalpProgram, ScalpProgramNode } from '../scalp-path';
import type { SimulationSnapshot } from '../simulation/SimulationEngine';

export interface TutorialContext {
  program?: ScalpProgram;
  blockCount: number;
  snapshot: SimulationSnapshot;
  testCount: number;
}

export interface Lesson {
  id: string;
  title: string;
  body: string;
  hint?: string;
  done?: (context: TutorialContext) => boolean;
}

/** The tutorial uses exactly the same relative language as the workbench. */
export const LESSONS: readonly Lesson[] = [
  {
    id: 'welcome',
    title: 'Program a path, not a motor',
    body:
      'The dots on the head are scalp cells. You guide the cutter like a turtle: ' +
      'turn it, move it one cell at a time, and choose when it may cut.',
  },
  {
    id: 'first-block',
    title: 'Add your first path action',
    body:
      'Open Path and drag a Move forward block onto the canvas. The tool starts ' +
      'at the bright cursor in Hover mode.',
    hint: 'Path is the teal category in the left toolbox.',
    done: (context) => context.blockCount > 0,
  },
  {
    id: 'turn',
    title: 'Turn before you travel',
    body:
      'Add a Turn block. Left and right change only the turtle heading; they do ' +
      'not move the cutter or touch hair.',
    done: (context) => commandsOf(context.program, 'turn').length > 0,
  },
  {
    id: 'hover-cut',
    title: 'Hover protects transfers',
    body:
      'Add Set cutter Cut after you have chosen a safe row. Use Hover whenever ' +
      'you cross to another row. Hover contact is an error, not a silent cut.',
    done: (context) => commandsOf(context.program, 'set-tool-mode').length > 0,
  },
  {
    id: 'test',
    title: 'Test validates the whole route',
    body:
      'Press Test. It runs the same path validator and replay used for a submit, ' +
      'without making you wait for the 3D animation.',
    done: (context) =>
      context.testCount > 0 && context.snapshot.scoreResult !== undefined,
  },
  {
    id: 'boundary',
    title: 'The disabled cells are real boundaries',
    body:
      'Grey cells look like grid cells but have no certified route. A Move that ' +
      'would enter one is located before the arm starts.',
  },
  {
    id: 'repeat',
    title: 'Repeat a safe pattern',
    body:
      'From Control, add Repeat and put a small turn-and-move pattern inside it. ' +
      'The compiler expands it safely and still points back to your block.',
    done: (context) => hasRepeat(context.program),
  },
  {
    id: 'done',
    title: 'You are ready for a scalp path',
    body:
      'Plan in cells, keep transfers in Hover, cut only on a certified row, and ' +
      'use Repeat to keep the program small. Solo Practice and Versus use this ' +
      'same language.',
  },
];

function flatten(nodes: readonly ScalpProgramNode[]): ScalpProgramNode[] {
  return nodes.flatMap((node) =>
    node.type === 'repeat' ? [node, ...flatten(node.body)] : [node],
  );
}

function commandsOf(
  program: ScalpProgram | undefined,
  type: 'turn' | 'set-tool-mode',
) {
  if (!program) {
    return [];
  }
  return flatten(program.nodes).filter((node) => node.type === type);
}

function hasRepeat(program: ScalpProgram | undefined): boolean {
  return flatten(program?.nodes ?? []).some((node) => node.type === 'repeat');
}
