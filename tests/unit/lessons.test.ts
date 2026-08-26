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

/** Programs a learner might try instead of the intended one. */
const SHORTCUTS: Step[][] = [
  [],
  [{ jointId: 'baseYaw', angleDeg: 55 }],
  [{ jointId: 'baseYaw', angleDeg: 45 }],
  [{ jointId: 'baseYaw', angleDeg: -55 }],
  [{ jointId: 'baseYaw', angleDeg: 55 }, { jointId: 'baseYaw', angleDeg: -55 }],
  [{ jointId: 'shoulder', angleDeg: 70 }, { jointId: 'baseYaw', angleDeg: 45 }],
];

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
      for (const shortcut of SHORTCUTS) {
        if (shortcut.length >= lesson.solution.length) continue;
        const result = play(built, shortcut);
        expect(
          result.completion,
          `${lesson.id} is solved by a ${shortcut.length}-block shortcut`,
        ).toBeLessThan(99.99);
      }
    }
  });

  it('rewards precision in the lessons that are about precision', () => {
    // These two exist so a sloppy full sweep scores well but not perfectly:
    // "nearly right" has to be visibly worse than right.
    for (const id of ['lesson-6-stop-short', 'lesson-7-narrow-band']) {
      const lesson = LESSONS.find((l) => l.id === id);
      if (!lesson) throw new Error(`missing ${id}`);
      const built = buildLessonChallenge(lesson);
      const sloppy = play(built, [{ jointId: 'baseYaw', angleDeg: 55 }]);
      expect(sloppy.completed, id).toBe(true);
      expect(sloppy.completion, id).toBeGreaterThan(90);
      expect(sloppy.completion, id).toBeLessThan(99.99);
    }
  });
});
