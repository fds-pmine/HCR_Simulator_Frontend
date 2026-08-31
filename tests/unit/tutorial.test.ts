import { describe, expect, it } from 'vitest';
import {
  LESSONS,
  TUTORIAL_HEAD_ANGLE_DEG,
  TUTORIAL_HEAD_JOINT,
  TUTORIAL_ANGLE_DEG,
  TUTORIAL_JOINT,
  TUTORIAL_SWEEP_ANGLE_DEG,
  type TutorialContext,
} from '../../src/features/tutorial/lessons';
import type {
  CompiledProgram,
  Program,
  ProgramNode,
  RobotCommand,
} from '../../src/features/blockly/programTypes';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import type { SimulationSnapshot } from '../../src/features/simulation/SimulationEngine';
import { defaultChallengeDefinition } from '../../src/data/challenges/defaultChallenge';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';

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
      lesson('first-block').done?.(context({ program: program([setJoint(90)]) })),
    ).toBe(true);

    // The angle step is stricter than the placement step.
    expect(
      lesson('absolute').done?.(context({ program: program([setJoint(90)]) })),
    ).toBe(false);
    expect(
      lesson('absolute').done?.(
        context({ program: program([setJoint(TUTORIAL_ANGLE_DEG)]) }),
      ),
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
      {
        type: 'repeat',
        count: 5,
        sourceBlockId: 'r',
        body: [setJoint(TUTORIAL_ANGLE_DEG)],
      },
    ]);
    const sweeps = program([
      {
        type: 'repeat',
        count: 3,
        sourceBlockId: 'r',
        body: [setJoint(TUTORIAL_ANGLE_DEG), setJoint(TUTORIAL_SWEEP_ANGLE_DEG)],
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
      {
        type: 'repeat',
        count: 2,
        sourceBlockId: 'r',
        body: [setJoint(TUTORIAL_ANGLE_DEG)],
      },
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

/**
 * Run a straight-line servo program against the challenge the tutorial pins
 * itself to, and report what the engine did with it.
 *
 * The tutorial's text names specific angles, and those angles are only true of
 * this challenge's joint limits and head position. Asserting them against the
 * real engine is what stops the copy drifting the way it did when the joint
 * convention moved from signed geometric degrees to servo degrees.
 */
function play(steps: readonly { jointId: string; angleDeg: number }[]) {
  const challenge = normalizeChallenge(defaultChallengeDefinition);
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());
  const commands: RobotCommand[] = steps.map((entry, index) => ({
    type: 'set-joint-angle',
    jointId: entry.jointId,
    angleDeg: entry.angleDeg,
    sourceBlockId: `a${index}`,
  }));
  const compiled: CompiledProgram = {
    program: { nodes: commands, sourceBlockCount: commands.length },
    runtimeCommands: commands,
    executedCommandCount: commands.length,
  };
  engine.run(compiled);
  for (let tick = 0; tick < 80_000; tick += 1) {
    if (engine.getSnapshot().status !== 'running') break;
    engine.tick(16);
  }
  const state = engine.getSnapshot();
  return {
    status: state.status,
    errorMessage: state.errorMessage ?? '',
    removed: challenge.initialHair.voxels.size - state.hairVoxels.size,
  };
}

const jointLimits = (jointId: string) => {
  const joint = defaultChallengeDefinition.robotConfig.joints.find(
    (candidate) => candidate.id === jointId,
  );
  if (!joint) throw new Error(`no joint "${jointId}"`);
  return joint;
};

describe('the angles the tutorial teaches', () => {
  it('are inside the shipped challenge\'s joint limits', () => {
    // The block field clamps to the joint's range, so an angle outside it is an
    // instruction the learner physically cannot follow: the step never turns
    // green and the tutorial dead-ends.
    const base = jointLimits(TUTORIAL_JOINT);
    for (const angle of [TUTORIAL_ANGLE_DEG, TUTORIAL_SWEEP_ANGLE_DEG]) {
      expect(angle, `${TUTORIAL_JOINT} ${angle}°`).toBeGreaterThanOrEqual(base.minAngleDeg);
      expect(angle, `${TUTORIAL_JOINT} ${angle}°`).toBeLessThanOrEqual(base.maxAngleDeg);
    }
    const head = jointLimits(TUTORIAL_HEAD_JOINT);
    expect(TUTORIAL_HEAD_ANGLE_DEG).toBeGreaterThanOrEqual(head.minAngleDeg);
    expect(TUTORIAL_HEAD_ANGLE_DEG).toBeLessThanOrEqual(head.maxAngleDeg);
  });

  it('cuts more at the sweep angle than at the first one', () => {
    // "Watch the score climb" has to be true: the second angle in the repeat
    // must widen the swept band, or the step teaches the opposite of its point.
    const first = play([{ jointId: TUTORIAL_JOINT, angleDeg: TUTORIAL_ANGLE_DEG }]);
    const swept = play([
      { jointId: TUTORIAL_JOINT, angleDeg: TUTORIAL_ANGLE_DEG },
      { jointId: TUTORIAL_JOINT, angleDeg: TUTORIAL_SWEEP_ANGLE_DEG },
    ]);
    expect(first.status).toBe('completed');
    expect(swept.status).toBe('completed');
    expect(first.removed).toBeGreaterThan(0);
    expect(swept.removed).toBeGreaterThan(first.removed);
  });

  it('really does stop on the head at the collision step', () => {
    // And only there: the step before it must complete, or the learner meets
    // the collision one step early and reads it as a bug.
    expect(play([{ jointId: TUTORIAL_JOINT, angleDeg: TUTORIAL_ANGLE_DEG }]).status)
      .toBe('completed');
    const collided = play([
      { jointId: TUTORIAL_JOINT, angleDeg: TUTORIAL_ANGLE_DEG },
      { jointId: TUTORIAL_HEAD_JOINT, angleDeg: TUTORIAL_HEAD_ANGLE_DEG },
    ]);
    expect(collided.status).toBe('error');
    expect(collided.errorMessage.toLowerCase()).toContain('head');
    // The step's own predicate accepts what the engine actually produced.
    expect(
      lesson('head').done?.(
        context({
          snapshot: snapshot({
            status: 'error',
            errorMessage: collided.errorMessage,
          }),
        }),
      ),
    ).toBe(true);
  });
});
