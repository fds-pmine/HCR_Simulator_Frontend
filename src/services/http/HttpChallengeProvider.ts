import type {
  Challenge,
  ChallengeDefinition,
  ChallengeSummary,
} from '../../types/domain';
import type { ChallengeProvider } from '../contracts';
import { normalizeChallenge } from '../normalizeChallenge';
import { validateChallengeDefinition } from '../validation';
import type { ApiClient } from './apiClient';

/**
 * The backend adds psychometric metadata alongside the v1 challenge. The
 * simulator ignores it, but it is surfaced so an assessment UI can read the
 * version it was served without a second request.
 */
interface ChallengeMeta {
  version: number;
  calibration: string;
  hardwareCompatible: boolean;
}

type ChallengeDefinitionDto = ChallengeDefinition & { meta?: ChallengeMeta };

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

    const definition = toDefinition(dto);
    // Validate even though the data came from our own backend: a version skew
    // between client and server is exactly the case where a malformed challenge
    // would otherwise reach the engine and fail somewhere far less obvious.
    validateChallengeDefinition(definition);

    return normalizeChallenge(definition);
  }
}

function toDefinition(dto: ChallengeDefinitionDto): ChallengeDefinition {
  const definition: ChallengeDefinitionDto = { ...dto };
  // `meta` is additive backend metadata; the v1 challenge shape has no place
  // for it and the engine must not see fields it does not understand.
  delete definition.meta;
  return {
    ...(definition as ChallengeDefinition),
    // The wire omits an absent workspace entirely; the v1 type requires one.
    starterWorkspace: definition.starterWorkspace ?? {},
  };
}
