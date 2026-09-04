import type { Program } from '../features/blockly/programTypes';
import type { ProgrammingMode } from '../features/blockly/programmingMode';
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
  setPlayer(player: {
    playerId: string;
    displayName: string;
    utcOffsetMinutes?: number;
  }): void;

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

/** A program entered against the item a session is currently serving. */
export interface SessionSubmission {
  /** Client-generated idempotency key. Resubmitting returns the first result. */
  submissionId: string;
  challengeId: string;
  /** Must match the version the item was served at, or the response is refused. */
  challengeVersion: number;
  /** Program IR, so the server's own `repeat` expansion is what the cap applies to. */
  program: Program;
}

export interface SessionStartOptions {
  /** Ability seed on the scale measured by `programmingMode`. */
  initialTheta?: number;
  /** Fixed for the session lifetime; defaults to the servo scale on the wire. */
  programmingMode?: ProgrammingMode;
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

  /** Open a mode-pinned session. The server owns warmup and ability estimation. */
  start(options?: SessionStartOptions): Promise<SessionSnapshot>;
  /** The next challenge to attempt. */
  next(sessionId: string): Promise<NextItem>;
  /**
   * Enter a program for the server to replay and score.
   *
   * Must happen before {@link respond}, which reads the score this produces.
   * Skipping it is not a shortcut that costs telemetry — `respond` refuses a
   * submission id it has never scored, so practice simply stops.
   */
  submit(
    sessionId: string,
    submission: SessionSubmission,
  ): Promise<void>;
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

/** What a lesson section asks of the learner. */
export type LessonActivity =
  | 'read'
  | 'predict'
  | 'build'
  | 'observe'
  | 'challenge'
  | 'recap';

/** What happened in a lesson. */
export type LessonOutcome =
  /** It was opened. `section` is where it resumed, which need not be 0. */
  | 'opened'
  /** A section's own gate was met and the learner moved past it. */
  | 'section-passed'
  /** The closed-book quiz was answered correctly. */
  | 'quiz-passed'
  /** Quiz and practical both passed. */
  | 'completed'
  /** The learner left before finishing; `section` is where they stopped. */
  | 'abandoned';

/** One thing a learner did in a lesson. */
export interface LessonEvent {
  lessonId: string;
  /** Zero-based section index within that lesson. */
  section: number;
  /** What that section asks for. Omitted on whole-lesson outcomes. */
  activity?: LessonActivity;
  outcome: LessonOutcome;
  /** Successful Test runs in this lesson so far. */
  tests?: number;
  /** Which editor the lesson teaches. Omitted means `servo`. */
  mode?: ProgrammingMode;
}

/**
 * Where lesson usage goes, when a deployment collects any.
 *
 * The lessons are the one part of the app that never talks to a server: they run
 * and score in the browser, Cutter Grid included. That is deliberate, and it left
 * the course completely invisible in the usage log — a lesson never submits, so a
 * log fed only by submissions saw none of the thing most people actually use.
 *
 * What this reports is therefore **client-asserted**, and the reasoning about what
 * that is worth lives on the server side of the wire
 * (`hcr-backend/docs/01-CONTRACT.md` §usage). Two rules hold on this side:
 *
 * 1. **It never blocks a lesson.** Reporting is fire-and-forget and a failure is
 *    swallowed. A learner mid-section must not wait on, or be interrupted by, a
 *    telemetry request.
 * 2. **It is off unless the learner opted in.** The offline implementation
 *    reports nothing at all, and the HTTP one sends nothing when research
 *    consent was declined — lesson progress is research data, not the operational
 *    minimum the privacy screen calls necessary.
 */
export interface UsageProvider {
  /** Report one lesson interaction. Never throws, never awaited by callers. */
  recordLessonEvent(event: LessonEvent): void;
}
