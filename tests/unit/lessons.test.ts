import { describe, expect, it } from 'vitest';
import { LESSONS } from '../../src/data/challenges/lessons';
import { buildLessonChallenge } from '../../src/services/local/lessonChallenges';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import type { CompiledProgram, RobotCommand } from '../../src/features/blockly/programTypes';
import type { ChallengeDefinition } from '../../src/types/domain';

type Step = { jointId: string; angleDeg: number };

function play(definition: ChallengeDefinition, steps: readonly Step[]) {
  const challenge = normalizeChallenge(definition);
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());
  if (steps.length === 0) {
    // Doing nothing: IoU of the untouched hair against the target.
    const target = challenge.targetHair.voxels;
    return {
      completed: true,
      completion: (100 * target.size) / challenge.initialHair.voxels.size,
    };
  }
  const commands: RobotCommand[] = steps.map((step, index) => ({
    type: 'set-joint-angle', jointId: step.jointId, angleDeg: step.angleDeg,
    sourceBlockId: `a${index}`,
  }));
  const compiled: CompiledProgram = {
    program: { nodes: commands, sourceBlockCount: commands.length },
    runtimeCommands: commands, executedCommandCount: commands.length,
  };
  try { engine.run(compiled); } catch { return { completed: false, completion: -1 }; }
  for (let tick = 0; tick < 80_000; tick += 1) {
    if (engine.getSnapshot().status !== 'running') break;
    engine.tick(16);
  }
  const snapshot = engine.getSnapshot();
  if (snapshot.status !== 'completed') return { completed: false, completion: -1 };

  const target = challenge.targetHair.voxels;
  const left = snapshot.hairVoxels;
  let intersection = 0;
  for (const key of left) if (target.has(key)) intersection += 1;
  const union = left.size + target.size - intersection;
  return { completed: true, completion: (100 * intersection) / union };
}

describe('the lesson curriculum', () => {
  it('has eight lessons in a stable order', () => {
    expect(LESSONS).toHaveLength(8);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(8);
    // The first must be winnable with a single block — the whole point of it is
    // that somebody feels successful within a minute of arriving.
    expect(LESSONS[0].solution).toHaveLength(1);
    expect(LESSONS.every((lesson) => lesson.sections.length >= 20)).toBe(true);
    for (const lesson of LESSONS) {
      expect(new Set(lesson.sections.map((section) => section.id)).size).toBe(
        lesson.sections.length,
      );
      expect(lesson.sections.at(-1)?.title).toBe('Scored checkpoint');
    }
  });

  it('keeps every lesson hardware servo initialized at 90°', () => {
    for (const lesson of LESSONS) {
      const challenge = normalizeChallenge(buildLessonChallenge(lesson));
      const servoJoints = challenge.robotConfig.joints.filter(
        (joint) => joint.servo,
      );
      expect(
        servoJoints.map((joint) => joint.initialAngleDeg),
        lesson.id,
      ).toEqual(servoJoints.map(() => 90));
    }
  });

  it('every lesson is solvable at exactly 100', () => {
    // Guaranteed by construction — the target *is* what the solution leaves —
    // but asserted anyway, because the construction is the thing that could
    // break.
    for (const lesson of LESSONS) {
      const result = play(buildLessonChallenge(lesson), lesson.solution);
      expect(result.completed, lesson.id).toBe(true);
      expect(result.completion, lesson.id).toBeCloseTo(100, 6);
    }
  });

  it('every lesson asks for hair that is actually removed', () => {
    for (const lesson of LESSONS) {
      const built = buildLessonChallenge(lesson);
      const challenge = normalizeChallenge(built);
      const asked = challenge.initialHair.voxels.size - challenge.targetHair.voxels.size;
      expect(asked, `${lesson.id} asks for nothing`).toBeGreaterThan(0);
    }
  });

  it('no lesson falls to a shorter program', () => {
    // A step that can be deleted teaches nothing. Four candidates were cut for
    // this: at one working height a single sweep already removes everything in
    // reach, so "sweep again" was padding dressed as a lesson.
    for (const lesson of LESSONS) {
      const built = buildLessonChallenge(lesson);
      for (let removed = 0; removed < lesson.solution.length; removed += 1) {
        const shortcut = lesson.solution.filter((_, index) => index !== removed);
        const result = play(built, shortcut);
        expect(
          result.completion,
          `${lesson.id} still solves after deleting command ${removed + 1}`,
        ).toBeLessThan(99.99);
      }
    }
  });

  it('rewards precision in the lessons that are about precision', () => {
    const edge = LESSONS.find((lesson) => lesson.id === 'lesson-4-elbow');
    const band = LESSONS.find((lesson) => lesson.id === 'lesson-7-narrow-band');
    if (!edge || !band) throw new Error('missing precision lessons');

    const edgeUndercut = play(buildLessonChallenge(edge), [
      { jointId: 'baseYaw', angleDeg: 140 },
    ]);
    const bandOvercut = play(buildLessonChallenge(band), [
      { jointId: 'elbow', angleDeg: 95 },
      { jointId: 'baseYaw', angleDeg: 135 },
    ]);
    for (const [id, sloppy] of [
      [edge.id, edgeUndercut],
      [band.id, bandOvercut],
    ] as const) {
      expect(sloppy.completed, id).toBe(true);
      expect(sloppy.completion, id).toBeGreaterThan(60);
      expect(sloppy.completion, id).toBeLessThan(99.99);
    }
  });
});
