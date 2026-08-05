import { describe, expect, it } from 'vitest';
import { LESSONS, type TutorialContext } from '../../src/features/tutorial/lessons';
import type { ScalpProgram, ScalpProgramNode } from '../../src/features/scalp-path';
import type { SimulationSnapshot } from '../../src/features/simulation/SimulationEngine';

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

const context = (over: Partial<TutorialContext> = {}): TutorialContext => ({
  blockCount: 0,
  snapshot: snapshot(),
  testCount: 0,
  ...over,
});

const program = (nodes: ScalpProgramNode[]): ScalpProgram => ({
  nodes,
  sourceBlockCount: nodes.length,
});

const lesson = (id: string) => {
  const found = LESSONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no lesson "${id}"`);
  return found;
};

describe('Scalp Turtle tutorial lessons', () => {
  it('ends on an informational step and never begins a checked step complete', () => {
    expect(LESSONS.length).toBeGreaterThan(4);
    expect(LESSONS[LESSONS.length - 1].done).toBeUndefined();
    for (const entry of LESSONS.filter((candidate) => candidate.done)) {
      expect(entry.done?.(context()), entry.id).toBe(false);
    }
  });

  it('recognizes authored path, turn and cutter blocks', () => {
    expect(lesson('first-block').done?.(context({ blockCount: 1 }))).toBe(true);
    expect(
      lesson('turn').done?.(
        context({
          program: program([{ type: 'turn', direction: 'left', sourceBlockId: 'turn' }]),
        }),
      ),
    ).toBe(true);
    expect(
      lesson('hover-cut').done?.(
        context({
          program: program([{ type: 'set-tool-mode', mode: 'cut', sourceBlockId: 'cut' }]),
        }),
      ),
    ).toBe(true);
  });

  it('recognizes a nested Repeat and a scored Test', () => {
    const repeated = program([
      {
        type: 'repeat',
        count: 2,
        sourceBlockId: 'repeat',
        body: [{ type: 'move-forward', steps: 1, sourceBlockId: 'move' }],
      },
    ]);
    expect(lesson('repeat').done?.(context({ program: repeated }))).toBe(true);
    expect(lesson('test').done?.(context({ testCount: 1 }))).toBe(false);
    expect(
      lesson('test').done?.(
        context({
          testCount: 1,
          snapshot: snapshot({
            scoreResult: {
              completionScore: 50,
              efficiencyScore: 50,
              timeScore: 50,
              finalScore: 50,
              programCost: 1,
            },
          }),
        }),
      ),
    ).toBe(true);
  });
});
