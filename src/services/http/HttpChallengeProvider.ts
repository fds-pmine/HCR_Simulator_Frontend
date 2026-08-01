import type { Challenge, ChallengeSummary } from '../../types/domain';
import type { ChallengeProvider } from '../contracts';
import type { ApiClient } from './apiClient';
import { challengeFromDto, type ChallengeDefinitionDto } from './challengeDto';

/**
 * Serves challenges from the HCR backend.
 *
 * Implements the same `ChallengeProvider` interface as the local one, so the
 * workbench, engine and scoring are untouched — this is the seam SPEC v0.3 §15
 * reserved, used exactly as intended.
 */
export class HttpChallengeProvider implements ChallengeProvider {
  constructor(private readonly client: ApiClient) {}

  async listChallenges(): Promise<ChallengeSummary[]> {
    return this.client.get<ChallengeSummary[]>('/api/v1/challenges');
  }

  async getChallenge(id: string): Promise<Challenge> {
    const dto = await this.client.get<ChallengeDefinitionDto>(
      `/api/v1/challenges/${encodeURIComponent(id)}`,
    );
    return challengeFromDto(dto);
  }
}
