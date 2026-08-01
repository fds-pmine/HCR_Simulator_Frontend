import {
  LESSONS,
  lessonBase,
  type Lesson,
} from '../../data/challenges/lessons';
import type { ChallengeDefinition, VoxelCoord } from '../../types/domain';
import type { CompiledProgram, RobotCommand } from '../../features/blockly/programTypes';
import { SimulationEngine } from '../../features/simulation/SimulationEngine';
import { keyToCoord } from '../../features/voxel/voxelKey';
import { normalizeChallenge } from '../normalizeChallenge';
import { LocalScoreProvider } from './LocalScoreProvider';

/** Ticks are a fixed step here; a lesson is a pure function of its solution. */
const TICK_MS = 16;
const MAX_TICKS = 80_000;

const cache = new Map<string, ChallengeDefinition>();

/**
 * Build a lesson's challenge, deriving its target by running the solution.
 *
 * The target is *measured*, not authored: it is exactly the hair left standing
 * after the lesson's own solution runs, so the lesson is achievable at 100 by
 * construction and cannot ask for hair the arm is unable to reach.
 *
 * Cached, because deriving means simulating and a lesson's target never changes.
 */
export function buildLessonChallenge(lesson: Lesson): ChallengeDefinition {
  const cached = cache.get(lesson.id);
  if (cached) {
    return cached;
  }

  const base = lessonBase(lesson);
  // Target starts as the untouched hair; the run below replaces it.
  const challenge = normalizeChallenge({ ...base, targetHair: base.initialHair });
  const engine = new SimulationEngine(challenge, new LocalScoreProvider());

  const commands: RobotCommand[] = lesson.solution.map((step, index) => ({
    type: 'set-joint-angle',
    jointId: step.jointId,
    angleDeg: step.angleDeg,
    sourceBlockId: `${lesson.id}-${index}`,
  }));
  const compiled: CompiledProgram = {
    program: { nodes: commands, sourceBlockCount: commands.length },
    runtimeCommands: commands,
    executedCommandCount: commands.length,
  };

  engine.run(compiled);
  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    if (engine.getSnapshot().status !== 'running') break;
    engine.tick(TICK_MS);
  }
  const snapshot = engine.getSnapshot();
  if (snapshot.status !== 'completed') {
    // A solution that does not run is a broken lesson, and shipping it would
    // hand somebody an unwinnable challenge — the exact failure this whole
    // construction exists to prevent.
    throw new Error(
      `Lesson "${lesson.id}" has a solution that does not complete: ${snapshot.errorMessage ?? snapshot.status}`,
    );
  }

  const voxels: VoxelCoord[] = [...snapshot.hairVoxels].map(keyToCoord);
  const built: ChallengeDefinition = {
    ...base,
    targetHair: {
      id: `${lesson.id}-target`,
      name: `${lesson.name} target`,
      voxels,
    },
  };
  cache.set(lesson.id, built);
  return built;
}

/** Every lesson, in teaching order. */
export function lessonChallenges(): ChallengeDefinition[] {
  return LESSONS.map(buildLessonChallenge);
}

/** A lesson by challenge id, if it is one. */
export function findLesson(challengeId: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === challengeId);
}
