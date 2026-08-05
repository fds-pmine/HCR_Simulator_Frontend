import { defaultChallengeDefinition } from '../../data/challenges/defaultChallenge';
import type {
  Challenge,
  ChallengeDefinition,
  ChallengeSummary,
} from '../../types/domain';
import type { ChallengeProvider } from '../contracts';
import { normalizeChallenge } from '../normalizeChallenge';
import { validateChallengeDefinition } from '../validation';
import { ALL_LESSONS, buildLessonChallenge, findLesson } from './lessonChallenges';

export class LocalChallengeProvider implements ChallengeProvider {
  private readonly definitions: readonly ChallengeDefinition[];

  constructor(
    definitions: readonly ChallengeDefinition[] = [
      defaultChallengeDefinition,
    ],
  ) {
    definitions.forEach(validateChallengeDefinition);
    this.definitions = definitions;
  }

  /**
   * The authored challenge, then the lessons.
   *
   * Lesson summaries come from the lesson *specs* rather than from built
   * challenges: building one means simulating its solution to derive the
   * target, and listing should not pay for eight simulations nobody asked for.
   * {@link getChallenge} does that work, once, when a lesson is actually opened.
   */
  async listChallenges(): Promise<ChallengeSummary[]> {
    return [
      ...this.definitions.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
      ...ALL_LESSONS.map(({ id, name, description }) => ({ id, name, description })),
    ];
  }

  async getChallenge(id: string): Promise<Challenge> {
    const definition = this.definitions.find((item) => item.id === id);
    if (definition) {
      return normalizeChallenge(definition);
    }

    // Lessons are resolved here rather than held as data: their targets are
    // derived by running their solutions, which is what makes them winnable by
    // construction. `buildLessonChallenge` caches, so this is paid once.
    const lesson = findLesson(id);
    if (lesson) {
      return normalizeChallenge(buildLessonChallenge(lesson));
    }

    throw new Error(`Challenge "${id}" was not found.`);
  }
}
