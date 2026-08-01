import type { Program } from '../features/blockly/programTypes';
import type {
  Challenge,
  ChallengeSummary,
  ScoreInput,
  ScoreResult,
} from '../types/domain';
import type {
  ClockSample,
  MatchConfig,
  MatchResults,
  MatchState,
  MatchSubmissionAck,
} from '../types/match';

export interface ChallengeProvider {
  listChallenges(): Promise<ChallengeSummary[]>;
  getChallenge(id: string): Promise<Challenge>;
}

export interface ScoreProvider {
  score(input: ScoreInput): Promise<ScoreResult>;
}

/** The challenge a round is played on, with the version it was pinned at. */
export interface MatchChallenge {
  challenge: Challenge;
  version: number;
}

/** A program entered into a round. */
export interface MatchSubmission {
  /** Client-generated idempotency key. Resubmitting returns the first result. */
  submissionId: string;
  challengeId: string;
  challengeVersion: number;
  /**
   * Program IR — never a pre-expanded command list, so the server's own `repeat`
   * expansion is what the command cap applies to.
   */
  program: Program;
  /**
   * The score the browser computed for this program.
   *
   * Only the offline practice provider reads this, and only because it has no
   * server to replay against — which is precisely why an offline round is
   * practice and not a result. {@link MatchProvider} implementations backed by a
   * real service **must ignore it**: a client that could supply its own score
   * would make server-side replay decorative.
   */
  clientScore?: ScoreResult;
}

/**
 * Competitive rounds: everyone starts together on the same challenge and has a
 * fixed wall-clock window to submit.
 *
 * Rules and fairness controls: `hcr-backend/docs/06-MULTIPLAYER.md`.
 */
export interface MatchProvider {
  /** Whether rounds are played against a real server, or simulated locally. */
  readonly kind: 'online' | 'practice';

  /** Identity used for `join` and `submit`. */
  setPlayer(player: { playerId: string; displayName: string }): void;

  /**
   * Open a lobby.
   *
   * Takes a **complete** config, not a partial one — the server rejects a body
   * with fields missing, and defaulting them there would turn a typo into a
   * zero-length round. Build it with `matchConfig()`.
   */
  createMatch(config: MatchConfig): Promise<MatchState>;
  /** Enter a lobby. Rejected once the round has started. */
  joinMatch(matchId: string): Promise<MatchState>;
  /** Fix the roster, set the deadline and reveal the challenge. */
  startMatch(matchId: string): Promise<MatchState>;
  /** Current phase, deadline and roster. */
  getMatch(matchId: string): Promise<MatchState>;
  /** Refused before the start: revealing early is a head start. */
  getMatchChallenge(matchId: string): Promise<MatchChallenge>;
  /** Refused until the round closes: early standings are a known bar to aim at. */
  getResults(matchId: string): Promise<MatchResults>;
  /** Enter a program. The acknowledgement carries no score, by design. */
  submit(
    matchId: string,
    submission: MatchSubmission,
  ): Promise<MatchSubmissionAck>;
  /** Estimate the local-to-server clock offset so the countdown agrees. */
  syncClock(): Promise<ClockSample>;
}
