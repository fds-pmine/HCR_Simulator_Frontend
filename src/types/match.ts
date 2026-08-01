/**
 * Competitive round types.
 *
 * Mirrors `hcr-backend/docs/schema/hcr-v1.d.ts` §6b and the Rust contract in
 * `hcr_contract::round`. The backend serializes with `rename_all = "camelCase"`,
 * so these are the wire names verbatim — no adapter layer, nothing to drift.
 */
import type { ProgramMetrics } from './domain';

/** Lifecycle of a round. */
export type MatchPhase =
  | 'lobby'
  | 'countdown'
  | 'running'
  | 'grading'
  | 'results'
  | 'cancelled';

/**
 * What decides the winner.
 *
 * `completion` is voxel IoU against the target — the stated game rule, "closest
 * to the target wins". `final` folds in efficiency and time at 0.4 weight, which
 * quietly rewards short programs over accurate haircuts, so it is opt-in.
 */
export type RankBy = 'completion' | 'final';

/** A pinned challenge for a round. */
export interface MatchChallengeRef {
  challengeId: string;
  version: number;
}

/** Round settings. */
export interface MatchConfig {
  durationMs: number;
  rankBy: RankBy;
  maxPlayers: number;
  /** Minimum gap between one player's submissions, enforced server-side. */
  minSubmitIntervalMs: number;
  /** Absent means the server picks, and everyone still gets the identical item. */
  challengeRef?: MatchChallengeRef;
}

/**
 * Defaults mirroring `hcr_contract::round::MatchConfig`'s `Default` impl.
 *
 * The server requires a **complete** config: only `rankBy` and `challengeRef`
 * carry `#[serde(default)]`, and defaulting the rest per-field would silently
 * produce a zero-length round rather than a five-minute one. So the client fills
 * the whole thing in, and {@link matchConfig} is the only way it is built.
 */
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  durationMs: 5 * 60_000,
  rankBy: 'completion',
  maxPlayers: 16,
  minSubmitIntervalMs: 2_000,
};

/** Build a complete round config from partial overrides. */
export function matchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...DEFAULT_MATCH_CONFIG, ...overrides };
}

/** A participant. */
export interface MatchPlayer {
  playerId: string;
  displayName: string;
  connected: boolean;
  /** Whether they have submitted at least once. Never *what* they scored. */
  submitted: boolean;
}

/** Public state of a round. */
export interface MatchState {
  matchId: string;
  phase: MatchPhase;
  config: MatchConfig;
  /** Server epoch-ms; absent until the round starts. */
  opensAt?: number;
  /**
   * Server epoch-ms deadline.
   *
   * Authoritative. The countdown in the HUD is rendered from it, but acceptance
   * is decided by server *receive* time — a mis-synced client can be surprised,
   * never advantaged.
   */
  closesAt?: number;
  /** Server clock when this state was produced, for offset estimation. */
  serverTime: number;
  players: MatchPlayer[];
}

/** Why a submission was turned away. */
export type MatchRejection =
  | 'after-deadline'
  | 'rate-limited'
  | 'not-participant'
  | 'wrong-phase'
  | 'wrong-challenge';

/**
 * Response to a submission during a round.
 *
 * Deliberately carries **no score**: revealing standings mid-round would let a
 * player refine against a known bar.
 */
export interface MatchSubmissionAck {
  submissionId: string;
  accepted: boolean;
  serverReceivedAt: number;
  rejectedReason?: MatchRejection;
}

/** One player's standing. */
export interface MatchResultRow {
  rank: number;
  playerId: string;
  displayName: string;
  completionScore: number;
  finalScore: number;
  metrics: ProgramMetrics;
  /** Absent when the player never got a submission in. */
  submissionId?: string;
  serverReceivedAt?: number;
}

/** Final standings, best first. */
export interface MatchResults {
  matchId: string;
  challengeId: string;
  challengeVersion: number;
  rankBy: RankBy;
  rows: MatchResultRow[];
}

/** One round of clock synchronization against the server. */
export interface ClockSample {
  /** Add to a local `Date.now()` to get server time. */
  offsetMs: number;
  /** Round-trip time of the sample that produced it. */
  rttMs: number;
}

/** Human-readable reasons, for the HUD. */
export const REJECTION_LABELS: Record<MatchRejection, string> = {
  'after-deadline': 'Too late — the round had already closed.',
  'rate-limited': 'Slow down: submissions are rate limited.',
  'not-participant': 'You are not in this round.',
  'wrong-phase': 'The round is not accepting submissions right now.',
  'wrong-challenge': 'That program was scored against a different challenge.',
};
