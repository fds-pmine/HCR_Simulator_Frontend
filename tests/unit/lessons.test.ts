import { describe, expect, it } from 'vitest';
import { LESSONS, type Lesson } from '../../src/data/challenges/lessons';
import { SCALP_PATH_LESSONS } from '../../src/data/challenges/scalpPathLessons';
import { compileScalpProgram, resolveScalpMotionProfile } from '../../src/features/scalp-path';
import type { CompiledProgram, RobotCommand } from '../../src/features/blockly/programTypes';
import { SimulationEngine } from '../../src/features/simulation/SimulationEngine';
import { LocalScoreProvider } from '../../src/services/local/LocalScoreProvider';
import { buildLessonChallenge, isScalpPathLesson } from '../../src/services/local/lessonChallenges';
import { normalizeChallenge } from '../../src/services/normalizeChallenge';

function compileServoLesson(lesson: Lesson): CompiledProgram {
  const commands: RobotCommand[] = lesson.solution.map((step, index) => ({
    type: 'set-joint-angle', jointId: step.jointId, angleDeg: step.angleDeg, sourceBlockId: `servo-${index}`,
  }));
  return { program: { nodes: commands, sourceBlockCount: commands.length }, runtimeCommands: commands, executedCommandCount: commands.length };
}

async function play(lesson: Lesson | (typeof SCALP_PATH_LESSONS)[number]) {
  const challenge = normalizeChallenge(buildLessonChallenge(lesson));
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());
  const compiled = isScalpPathLesson(lesson)
    ? compileScalpProgram(lesson.solution, challenge)
    : compileServoLesson(lesson);
  engine.run(compiled);
  for (let tick = 0; tick < 80_000 && engine.getSnapshot().status === 'running'; tick += 1) {
    engine.tick(16);
  }
  await engine.waitForScore();
  return { challenge, snapshot: engine.getSnapshot() };
}

describe('the two lesson tracks', () => {
  it('retains the original eight Servo lessons', () => {
    expect(LESSONS).toHaveLength(8);
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(8);
    expect(LESSONS[0].solution).toHaveLength(1);
    expect(LESSONS.every((lesson) => !isScalpPathLesson(lesson))).toBe(true);
  });

  it('adds eight blank-canvas Scalp Path lessons without replacing Servo lessons', () => {
    expect(SCALP_PATH_LESSONS).toHaveLength(8);
    expect(new Set(SCALP_PATH_LESSONS.map((lesson) => lesson.id)).size).toBe(8);
    expect(SCALP_PATH_LESSONS.every((lesson) => lesson.id.startsWith('scalp-lesson-'))).toBe(true);
    expect(SCALP_PATH_LESSONS.every((lesson) => isScalpPathLesson(lesson))).toBe(true);
  });

  it('derives every target from a solution in the learner-visible language', async () => {
    for (const lesson of [...LESSONS, ...SCALP_PATH_LESSONS]) {
      const { challenge, snapshot } = await play(lesson);
      expect(snapshot.status, lesson.id).toBe('completed');
      expect(snapshot.hairVoxels, lesson.id).toEqual(challenge.targetHair.voxels);
      expect(snapshot.scoreResult?.completionScore, lesson.id).toBeCloseTo(100, 6);
      expect(
        challenge.initialHair.voxels.size - challenge.targetHair.voxels.size,
        `${lesson.id} asks for nothing`,
      ).toBeGreaterThan(0);
    }
  }, 30_000);

  it('keeps every Path lesson inside the calibrated profile and teaches Repeat', () => {
    for (const lesson of SCALP_PATH_LESSONS) {
      const challenge = normalizeChallenge(buildLessonChallenge(lesson));
      expect(resolveScalpMotionProfile(challenge).profile, lesson.id).toBeDefined();
    }
    expect(
      SCALP_PATH_LESSONS.some((lesson) =>
        lesson.solution.nodes.some((node) => node.type === 'repeat'),
      ),
    ).toBe(true);
  });
});
