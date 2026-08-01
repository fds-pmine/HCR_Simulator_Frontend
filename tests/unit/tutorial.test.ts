import { describe, expect, it } from 'vitest';
import { LESSONS, TUTORIAL_JOINT, type TutorialContext } from '../../src/features/tutorial/lessons';
import type { Program, ProgramNode } from '../../src/features/blockly/programTypes';
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

const setJoint = (angleDeg: number, jointId = TUTORIAL_JOINT): ProgramNode => ({
  type: 'set-joint-angle',
  jointId,
  angleDeg,
  sourceBlockId: `b${angleDeg}`,
});

const program = (nodes: ProgramNode[]): Program => ({
  nodes,
  sourceBlockCount: nodes.length,
});

const lesson = (id: string) => {
  const found = LESSONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no lesson "${id}"`);
  return found;
};

describe('tutorial lessons', () => {
  it('runs a step at a time and ends on an informational step', () => {
    expect(LESSONS.length).toBeGreaterThan(4);
    expect(new Set(LESSONS.map((entry) => entry.id)).size).toBe(LESSONS.length);
    // The last step has nothing to check, so Finish is always reachable.
    expect(LESSONS[LESSONS.length - 1].done).toBeUndefined();
  });

  it('every checked step starts unsatisfied on an empty workspace', () => {
    // A step that is already green when you arrive teaches nothing.
    for (const entry of LESSONS.filter((candidate) => candidate.done)) {
      expect(entry.done?.(context()), entry.id).toBe(false);
    }
  });

  it('notices the first block, and then the specific angle', () => {
    expect(lesson('first-block').done?.(context())).toBe(false);
    expect(
      lesson('first-block').done?.(context({ program: program([setJoint(10)]) })),
    ).toBe(true);

    // The angle step is stricter than the placement step.
    expect(
      lesson('absolute').done?.(context({ program: program([setJoint(10)]) })),
    ).toBe(false);
    expect(
      lesson('absolute').done?.(context({ program: program([setJoint(-55)]) })),
    ).toBe(true);
  });

  it('accepts a head collision as the intended outcome of its step', () => {
    // The one step where an error is success: meeting the constraint on purpose
    // beats hitting it by accident and reading it as a bug.
    expect(
      lesson('head').done?.(
        context({
          snapshot: snapshot({ status: 'error', errorMessage: 'Elbow Joint would contact the head' }),
        }),
      ),
    ).toBe(true);
    expect(
      lesson('head').done?.(
        context({ snapshot: snapshot({ status: 'error', errorMessage: 'Something else' }) }),
      ),
    ).toBe(false);
  });

  it('distinguishes a repeat that sweeps from one that cannot', () => {
    const noop = program([
      { type: 'repeat', count: 5, sourceBlockId: 'r', body: [setJoint(-55)] },
    ]);
    const sweeps = program([
      {
        type: 'repeat',
        count: 3,
        sourceBlockId: 'r',
        body: [setJoint(-55), setJoint(-38)],
      },
    ]);

    // Both contain a repeat, so the "add a repeat" step is happy with either.
    expect(lesson('repeat-noop').done?.(context({ program: noop }))).toBe(true);
    expect(lesson('repeat-noop').done?.(context({ program: sweeps }))).toBe(true);

    // Only one of them can actually move the arm more than once: with absolute
    // commands, a body that writes a single value per joint leaves the arm where
    // the first iteration put it. This is the check that makes the lesson true.
    expect(lesson('repeat-sweep').done?.(context({ program: noop }))).toBe(false);
    expect(lesson('repeat-sweep').done?.(context({ program: sweeps }))).toBe(true);
  });

  it('looks inside repeat bodies when checking for a command', () => {
    const nested = program([
      { type: 'repeat', count: 2, sourceBlockId: 'r', body: [setJoint(-55)] },
    ]);
    expect(lesson('absolute').done?.(context({ program: nested }))).toBe(true);
  });

  it('requires a score, not just a keypress, before calling Test done', () => {
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
