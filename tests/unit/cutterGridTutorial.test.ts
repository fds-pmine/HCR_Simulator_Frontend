import { describe, expect, it } from 'vitest';
import type { CutterGridProgramV1 } from '../../src/features/cutter-grid/types';
import type { SimulationSnapshot } from '../../src/features/simulation/SimulationEngine';
import {
  CUTTER_GRID_TUTORIAL_STEPS,
  type CutterGridTutorialContext,
} from '../../src/features/tutorial/cutterGridTutorial';

const snapshot = (over: Partial<SimulationSnapshot> = {}): SimulationSnapshot => ({
  status: 'idle',
  jointAngles: {},
  endEffector: [0, 0, 0],
  hairVoxels: new Set(),
  initialVoxelCount: 0,
  targetVoxelCount: 0,
  metrics: { sourceBlockCount: 0, executedCommandCount: 0, estimatedDurationMs: 0 },
  logs: [],
  ...over,
});

const program = (
  route: ReadonlyArray<readonly [
    'right' | 'left' | 'up' | 'down' | 'forward' | 'backward',
    number,
  ]>,
): CutterGridProgramV1 => ({
  kind: 'cutter-grid',
  version: 1,
  plannerVersion: 'test',
  sourceBlockCount: route.length,
  nodes: route.map(([direction, distance], index) => ({
    type: 'move',
    direction,
    distance,
    sourceBlockId: `move-${index}`,
  })),
});

const context = (
  over: Partial<CutterGridTutorialContext> = {},
): CutterGridTutorialContext => ({
  blockCount: 0,
  snapshot: snapshot(),
  testCount: 0,
  ...over,
});

const step = (id: string) => {
  const found = CUTTER_GRID_TUTORIAL_STEPS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No Cutter Grid tutorial step "${id}".`);
  return found;
};

describe('Cutter Grid tutorial', () => {
  it('has unique steps and always leaves Finish reachable', () => {
    expect(CUTTER_GRID_TUTORIAL_STEPS).toHaveLength(8);
    expect(new Set(CUTTER_GRID_TUTORIAL_STEPS.map((entry) => entry.id)).size).toBe(8);
    expect(CUTTER_GRID_TUTORIAL_STEPS.at(-1)?.done).toBeUndefined();
  });

  it('accepts the certified route one prefix at a time', () => {
    const route = [
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

    expect(step('grid-left').done?.(context())).toBe(false);
    expect(step('grid-left').done?.(context({ program: program(route.slice(0, 1)) }))).toBe(true);
    expect(step('grid-up').done?.(context({ program: program(route.slice(0, 1)) }))).toBe(false);
    expect(step('grid-up').done?.(context({ program: program(route.slice(0, 2)) }))).toBe(true);
    expect(step('grid-forward').done?.(context({ program: program(route.slice(0, 3)) }))).toBe(true);
    expect(step('grid-complete-route').done?.(context({ program: program(route) }))).toBe(true);
  });

  it('rejects a reordered or extended final route', () => {
    const certified = [
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
    const reordered = program([certified[1], certified[0], ...certified.slice(2)]);
    const extended = program([...certified, ['backward', 1]]);
    expect(step('grid-complete-route').done?.(context({ program: reordered }))).toBe(false);
    expect(step('grid-complete-route').done?.(context({ program: extended }))).toBe(false);
  });

  it('requires a successful scored Test before completing the run step', () => {
    const scoreResult = {
      completionScore: 100,
      efficiencyScore: 100,
      timeScore: 100,
      finalScore: 100,
      programCost: 5,
    };
    expect(step('grid-test').done?.(context({ snapshot: snapshot({ scoreResult }) }))).toBe(false);
    expect(
      step('grid-test').done?.(
        context({ snapshot: snapshot({ scoreResult }), testCount: 1 }),
      ),
    ).toBe(true);
  });
});
