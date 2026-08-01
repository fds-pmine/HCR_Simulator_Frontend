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
import type {
  NextItem,
  ResponseOutcome,
  SessionResult,
  SessionSnapshot,
} from '../types/session';

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

/**
 * Adaptive practice: the server picks each challenge from the learner's ability.
 *
 * This is what makes Solo a progression rather than a menu. After each attempt
 * the CAT engine (`arona`) refits the ability estimate and selects the item with
 * the most information at it — so finishing an easy challenge produces a harder
 * one, and struggling produces an easier one. Rules and reasoning:
 * `hcr-backend/docs/03-DYNAMIC-QBANK.md`.
 */
export interface SessionProvider {
  /** Whether items are chosen adaptively, or served from a fixed order. */
  readonly kind: 'adaptive' | 'fixed';

  /**
   * Open a session, optionally seeded with an ability estimate.
   *
   * Passed after the intro challenge has been scored: with no responses θ
   * carries no information, so the first "adaptive" choice would come from a
   * prior rather than from the learner. Seeding means the second challenge is
   * already tailored.
   */
  start(initialTheta?: number): Promise<SessionSnapshot>;
  /** The next challenge to attempt. */
  next(sessionId: string): Promise<NextItem>;
  /**
   * Record an attempt, moving the ability estimate.
   *
   * The score is **not** passed: the server looks up the submission it already
   * replayed. A client that could supply its own score would make the whole
   * adaptive estimate a fiction.
   */
  respond(
    sessionId: string,
    itemRef: string,
    submissionId: string,
  ): Promise<ResponseOutcome>;
  /** Close the session and collect its history. */
  finalize(sessionId: string): Promise<SessionResult>;
}
