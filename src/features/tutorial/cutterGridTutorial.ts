import type { EditorCompilation } from '../blockly/editorCompilation';
import type { CutterGridNodeV1, CutterGridProgramV1 } from '../cutter-grid/types';
import type { SimulationSnapshot } from '../simulation/SimulationEngine';
import type { Lesson } from './lessons';

export interface CutterGridTutorialContext {
  program?: CutterGridProgramV1;
  blockCount: number;
  snapshot: SimulationSnapshot;
  testCount: number;
}

export interface CutterGridTutorialStep extends Omit<Lesson, 'done'> {
  done?: (context: CutterGridTutorialContext) => boolean;
}

/**
 * The certified route, as the bundled Profile defines it. Kept in step with
 * `referenceProgram` by `cutterGridTutorial.test.ts`: a tutorial that teaches
 * a stale route would strand a learner on the final step, which now waits for
 * a real 100 completion instead of offering to skip.
 *
 * The repeated directions are the lesson, not a mistake: V4 flies one
 * synchronized PTP per visible Move, and a longer block bows further off the
 * straight cell line than the cut can afford.
 */
const REFERENCE_ROUTE = [
  ['left', 3],
  ['up', 6],
  ['up', 2],
  ['forward', 1],
  ['up', 1],
  ['forward', 1],
  ['up', 1],
  ['forward', 6],
  ['forward', 1],
] as const;

/**
 * A guided first run through Cutter Grid using the certified local route.
 * Each authored prefix is executable, so the learner never advances by
 * building a path that the following step immediately asks them to discard.
 */
export const CUTTER_GRID_TUTORIAL_STEPS: readonly CutterGridTutorialStep[] = [
  {
    id: 'grid-welcome',
    title: 'Move the cutter, not the servos',
    body:
      'Cutter Grid lets you describe a path in 3D space. The planner chooses ' +
      'the joint angles, keeps the motion synchronized, and starts from a safe ' +
      'Challenge pose.',
  },
  {
    id: 'grid-left',
    title: 'Place the first move',
    body:
      'Open Cutter Grid and drag “Move left” onto the canvas. Set its distance ' +
      'to 3 voxels.',
    hint: 'Left is −X in the fixed world grid. Type 3 into the number field.',
    done: ({ program }) => hasRoutePrefix(program, REFERENCE_ROUTE.slice(0, 1)),
  },
  {
    id: 'grid-up',
    title: 'Climb on a second axis',
    body:
      'Connect “Move up 6 voxels” underneath the first block. Connected blocks ' +
      'run from top to bottom.',
    hint: 'Up is +Y. Make sure the two blocks snap into one stack.',
    done: ({ program }) => hasRoutePrefix(program, REFERENCE_ROUTE.slice(0, 2)),
  },
  {
    id: 'grid-forward',
    title: 'Climb the rest in a second block',
    body:
      'Connect “Move up 2 voxels”. Two blocks, not one Move up 8: the planner ' +
      'flies each block as a single smooth motion, and a long one curves away ' +
      'from the straight line of cells you are aiming at.',
    hint: 'The program should now read Left 3 → Up 6 → Up 2.',
    done: ({ program }) => hasRoutePrefix(program, REFERENCE_ROUTE.slice(0, 3)),
  },
  {
    id: 'grid-overlay',
    title: 'Read the grid before you run',
    body:
      'The overlay shows reachable, blocked, planned, and already executed ' +
      'coordinates. A blocked path is rejected during planning, before the arm moves.',
  },
  {
    id: 'grid-complete-route',
    title: 'Finish the certified route',
    body:
      'Add the remaining six blocks: Forward 1, Up 1, Forward 1, Up 1, ' +
      'Forward 6, Forward 1. This nine-block route removes the eleven target ' +
      'voxels without an extra cut.',
    hint:
      'Left 3 → Up 6 → Up 2 → Forward 1 → Up 1 → Forward 1 → Up 1 → ' +
      'Forward 6 → Forward 1.',
    done: ({ program }) => isExactRoute(program, REFERENCE_ROUTE),
  },
  {
    id: 'grid-test',
    title: 'Plan and test the whole path',
    body:
      'Press Test. Cutter Grid first plans the complete trajectory, then runs it ' +
      'headlessly and scores the swept cutter path.',
    hint: 'If planning reports an error, check every direction, distance, and block order.',
    done: ({ snapshot, testCount }) =>
      testCount > 0 && (snapshot.scoreResult?.completionScore ?? 0) >= 99.995,
  },
  {
    id: 'grid-done',
    title: 'You are ready for Grid lessons',
    body:
      'You can now compose fixed-axis moves, read the safety overlay, and test a ' +
      'planned cut. The Grid lessons cover Repeat, swept cuts, blocked nodes, ' +
      'waypoints, closed paths, and program compression.',
  },
];

export function cutterGridProgramFromCompilation(
  compilation: EditorCompilation | undefined,
): CutterGridProgramV1 | undefined {
  return compilation?.mode === 'cutter-grid'
    ? compilation.compiled.program
    : undefined;
}

function moveNodes(program: CutterGridProgramV1 | undefined) {
  return (program?.nodes ?? []).filter(
    (node): node is Extract<CutterGridNodeV1, { type: 'move' }> =>
      node.type === 'move',
  );
}

function hasRoutePrefix(
  program: CutterGridProgramV1 | undefined,
  route: ReadonlyArray<readonly [string, number]>,
): boolean {
  const nodes = moveNodes(program);
  return (
    nodes.length >= route.length &&
    route.every(
      ([direction, distance], index) =>
        nodes[index]?.direction === direction && nodes[index]?.distance === distance,
    )
  );
}

function isExactRoute(
  program: CutterGridProgramV1 | undefined,
  route: ReadonlyArray<readonly [string, number]>,
): boolean {
  return program?.nodes.length === route.length && hasRoutePrefix(program, route);
}
