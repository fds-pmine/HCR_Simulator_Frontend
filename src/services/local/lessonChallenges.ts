import {
  LESSONS,
  lessonBase,
  type Lesson,
} from '../../data/challenges/lessons';
import {
  SCALP_PATH_LESSONS,
  scalpPathLessonBase,
  type ScalpPathLesson,
} from '../../data/challenges/scalpPathLessons';
import type { ChallengeDefinition, VoxelCoord } from '../../types/domain';
import { compileScalpProgram } from '../../features/scalp-path';
import type { CompiledProgram, RobotCommand } from '../../features/blockly/programTypes';
import { SimulationEngine } from '../../features/simulation/SimulationEngine';
import { keyToCoord } from '../../features/voxel/voxelKey';
import { normalizeChallenge } from '../normalizeChallenge';
import { LocalScoreProvider } from './LocalScoreProvider';

export type CurriculumLesson = Lesson | ScalpPathLesson;
export const ALL_LESSONS: readonly CurriculumLesson[] = [...LESSONS, ...SCALP_PATH_LESSONS];

const TICK_MS = 16;
const MAX_TICKS = 80_000;
const cache = new Map<string, ChallengeDefinition>();

/** Builds either track's target by replaying the language the learner sees. */
export function buildLessonChallenge(lesson: CurriculumLesson): ChallengeDefinition {
  const cached = cache.get(lesson.id);
  if (cached) return cached;

  const scalpPath = isScalpPathLesson(lesson);
  const base = scalpPath ? scalpPathLessonBase(lesson) : lessonBase(lesson);
  const challenge = normalizeChallenge({ ...base, targetHair: base.initialHair });
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());
  const compiled = scalpPath
    ? compileScalpProgram(lesson.solution, challenge)
    : compileServoLesson(lesson);

  engine.run(compiled);
  for (let tick = 0; tick < MAX_TICKS && engine.getSnapshot().status === 'running'; tick += 1) {
    engine.tick(TICK_MS);
  }
  const snapshot = engine.getSnapshot();
  if (snapshot.status !== 'completed') {
    throw new Error(
      `Lesson "${lesson.id}" has a solution that does not complete: ${snapshot.errorMessage ?? snapshot.status}`,
    );
  }

  const voxels: VoxelCoord[] = [...snapshot.hairVoxels].map(keyToCoord);
  const built: ChallengeDefinition = {
    ...base,
    targetHair: { id: `${lesson.id}-target`, name: `${lesson.name} target`, voxels },
  };
  cache.set(lesson.id, built);
  return built;
}

export function lessonChallenges(): ChallengeDefinition[] {
  return ALL_LESSONS.map(buildLessonChallenge);
}

export function findLesson(challengeId: string): CurriculumLesson | undefined {
  return ALL_LESSONS.find((lesson) => lesson.id === challengeId);
}

export function isScalpPathLesson(
  lesson: CurriculumLesson,
): lesson is ScalpPathLesson {
  return !Array.isArray(lesson.solution);
}

function compileServoLesson(lesson: Lesson): CompiledProgram {
  const commands: RobotCommand[] = lesson.solution.map((step, index) => ({
    type: 'set-joint-angle',
    jointId: step.jointId,
    angleDeg: step.angleDeg,
    sourceBlockId: `${lesson.id}-${index}`,
  }));
  return {
    program: { nodes: commands, sourceBlockCount: commands.length },
    runtimeCommands: commands,
    executedCommandCount: commands.length,
  };
}
