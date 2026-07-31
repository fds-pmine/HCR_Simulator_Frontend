import { defaultChallengeDefinition } from '../../data/challenges/defaultChallenge';
import type {
  Challenge,
  ChallengeDefinition,
  ChallengeSummary,
} from '../../types/domain';
import type { ChallengeProvider } from '../contracts';
import { normalizeChallenge } from '../normalizeChallenge';
import { validateChallengeDefinition } from '../validation';

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

  async listChallenges(): Promise<ChallengeSummary[]> {
    return this.definitions.map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
  }

  async getChallenge(id: string): Promise<Challenge> {
    const definition = this.definitions.find((item) => item.id === id);
    if (!definition) {
      throw new Error(`Challenge "${id}" was not found.`);
    }

    return normalizeChallenge(definition);
  }
}
