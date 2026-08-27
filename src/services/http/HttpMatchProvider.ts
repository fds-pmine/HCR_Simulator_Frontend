import type {
  MatchChallenge,
  MatchProvider,
  MatchSubmission,
} from '../contracts';
import type {
  ClockSample,
  MatchConfig,
  MatchResults,
  MatchState,
  MatchSubmissionAck,
} from '../../types/match';
import type { ApiClient } from './apiClient';
import { challengeFromDto, versionFromDto, type ChallengeDefinitionDto } from './challengeDto';
import { researchHeaders } from '../../features/preferences/researchPreferences';

/**
 * Header carrying the authenticated player.
 *
 * In a real deployment this is written by whatever validates the bearer token,
 * and anything a client puts here is overwritten. The `examples/serve` dev
 * server has no auth layer, so it trusts the header as sent — which is why that
 * example is a development server and says so.
 */
const PLAYER_HEADER = 'X-HCR-Player';

/**
 * Header carrying the display name.
 *
 * Cosmetic — it labels a row on the roster and the leaderboard and grants
 * nothing — so unlike {@link PLAYER_HEADER} the client is entitled to choose it.
 */
const PLAYER_NAME_HEADER = 'X-HCR-Player-Name';
const PLAYER_UTC_OFFSET_HEADER = 'X-HCR-Player-Utc-Offset-Minutes';

/** How many clock samples to take. `06-MULTIPLAYER.md` §5. */
const CLOCK_SAMPLES = 5;

/**
 * Competitive rounds against the HCR backend.
 *
 * Every fairness property lives on the server: the deadline is judged by server
 * receive time, scores stay hidden until the round closes, and the challenge is
 * not served before the start. This class does no enforcement of its own and
 * must not be read as if it did — a patched client simply gets refused.
 */
export class HttpMatchProvider implements MatchProvider {
  readonly kind = 'online' as const;

  private player: {
    playerId: string;
    displayName: string;
    utcOffsetMinutes?: number;
  } = { playerId: 'player', displayName: 'Player' };

  constructor(private readonly client: ApiClient) {}

  setPlayer(player: {
    playerId: string;
    displayName: string;
    utcOffsetMinutes?: number;
  }): void {
    this.player = player;
  }

  async createMatch(config: MatchConfig): Promise<MatchState> {
    return this.client.post<MatchState>('/api/v1/matches', config, this.headers());
  }

  async joinMatch(matchId: string): Promise<MatchState> {
    return this.client.post<MatchState>(
      `${this.base(matchId)}/join`,
      {},
      this.headers(),
    );
  }

  async startMatch(matchId: string): Promise<MatchState> {
    return this.client.post<MatchState>(
      `${this.base(matchId)}/start`,
      {},
      this.headers(),
    );
  }

  async getMatch(matchId: string): Promise<MatchState> {
    return this.client.get<MatchState>(this.base(matchId), this.headers());
  }

  async getMatchChallenge(matchId: string): Promise<MatchChallenge> {
    const dto = await this.client.get<ChallengeDefinitionDto>(
      `${this.base(matchId)}/challenge`,
      this.headers(),
    );
    return { challenge: challengeFromDto(dto), version: versionFromDto(dto) };
  }

  async getResults(matchId: string): Promise<MatchResults> {
    return this.client.get<MatchResults>(
      `${this.base(matchId)}/results`,
      this.headers(),
    );
  }

  async submit(
    matchId: string,
    submission: MatchSubmission,
  ): Promise<MatchSubmissionAck> {
    // `clientScore` is deliberately not forwarded. The contract has a
    // `clientPreview` field for divergence telemetry, but it requires the
    // canonical hash of the result voxels and this client computes none —
    // sending a wrong hash would report divergence that did not happen, which is
    // worse than sending nothing. The score itself is irrelevant either way: the
    // server replays the IR and uses its own.
    return this.client.post<MatchSubmissionAck>(
      `${this.base(matchId)}/submissions`,
      {
        matchId,
        submissionId: submission.submissionId,
        challengeId: submission.challengeId,
        challengeVersion: submission.challengeVersion,
        program: submission.program,
      },
      { ...this.headers(), ...researchHeaders() },
    );
  }

  /**
   * Estimate the offset between this browser's clock and the server's.
   *
   * Takes several samples and keeps the one with the lowest round-trip time,
   * since that is the sample least distorted by queuing. Purely a UI courtesy:
   * the countdown it feeds is advisory, and acceptance is decided by server
   * receive time regardless of what this returns.
   */
  async syncClock(): Promise<ClockSample> {
    let best: ClockSample = { offsetMs: 0, rttMs: Number.POSITIVE_INFINITY };

    for (let index = 0; index < CLOCK_SAMPLES; index += 1) {
      const sentAt = Date.now();
      const { serverTime } = await this.client.get<{ serverTime: number }>(
        '/api/v1/time',
      );
      const rttMs = Date.now() - sentAt;
      const offsetMs = serverTime - (sentAt + rttMs / 2);
      if (rttMs < best.rttMs) {
        best = { offsetMs, rttMs };
      }
    }

    return Number.isFinite(best.rttMs) ? best : { offsetMs: 0, rttMs: 0 };
  }

  private base(matchId: string): string {
    return `/api/v1/matches/${encodeURIComponent(matchId)}`;
  }

  private headers(): Record<string, string> {
    return {
      [PLAYER_HEADER]: this.player.playerId,
      [PLAYER_NAME_HEADER]: this.player.displayName,
      ...(this.player.utcOffsetMinutes === undefined
        ? {}
        : { [PLAYER_UTC_OFFSET_HEADER]: String(this.player.utcOffsetMinutes) }),
    };
  }
}
