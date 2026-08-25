import type { Challenge, ChallengeDefinition } from '../../types/domain';
import type { ProgrammingMode } from '../../features/blockly/programmingMode';
import { normalizeChallenge } from '../normalizeChallenge';
import { validateChallengeDefinition } from '../validation';

/**
 * The backend adds psychometric metadata alongside the v1 challenge. The
 * simulator ignores it, but it is surfaced so a caller can read the version it
 * was served without a second request — which a competitive round needs, since
 * submissions must be pinned to the version they were scored against.
 */
export interface ChallengeMeta {
  version: number;
  irt?: {
    discrimination: number;
    difficulty: number;
    guessing: number;
  };
  calibration: 'provisional' | 'online' | 'calibrated' | 'retired' | string;
  responseCount?: number;
  dimensions?: string[];
  masteryThreshold?: number;
  hardwareCompatible: boolean;
  programmingModes?: ProgrammingMode[];
}

export type ChallengeDefinitionDto = ChallengeDefinition & {
  meta?: ChallengeMeta;
};

/**
 * Turn a served DTO into the engine's normalized `Challenge`.
 *
 * Shared by the catalog and the match paths so the two cannot drift: a round's
 * challenge must be byte-identical to the catalog's, or "everyone gets the same
 * item" stops being true.
 */
export function challengeFromDto(dto: ChallengeDefinitionDto): Challenge {
  const definition = toDefinition(dto);
  // Validate even though the data came from our own backend: a version skew
  // between client and server is exactly the case where a malformed challenge
  // would otherwise reach the engine and fail somewhere far less obvious.
  validateChallengeDefinition(definition);
  return normalizeChallenge(definition);
}

/** Version the DTO was served at, defaulting to 1 when the backend omits meta. */
export function versionFromDto(dto: ChallengeDefinitionDto): number {
  return dto.meta?.version ?? 1;
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
