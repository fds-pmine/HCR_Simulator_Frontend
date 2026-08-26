/**
 * Adaptive session types.
 *
 * Mirrors `hcr_contract::api`'s session payloads. The server serializes with
 * `rename_all = "camelCase"`, so these are the wire names verbatim.
 */

export type SessionLifecycle =
  | 'active'
  | 'awaiting-response'
  | 'terminated'
  | 'finalized';

export interface SessionSnapshot {
  sessionId: string;
  /** Ability estimate. Starts at 0 and moves with every response. */
  theta: number;
  /** Absent until there is enough data to estimate one. */
  standardError?: number;
  responseCount: number;
  expectedRemaining?: number;
  state: SessionLifecycle;
  terminationReason?: string;
}

export interface NextItem {
  /**
   * Signed binding of this item to this session.
   *
   * Opaque and unforgeable — it is what stops a response being recorded against
   * an item the session never served.
   */
  itemRef: string;
  challengeId: string;
  /** Pinned, so recalibration cannot move a score already earned. */
  challengeVersion: number;
  expectedRemaining?: number;
}

export interface ResponseOutcome {
  correct: boolean;
  rawScore: number;
  theta: number;
  standardError: number;
  terminated: boolean;
  terminationReason?: string;
}

/** One attempt, as recorded in the session's history. */
export interface SessionItemRecord {
  challengeId: string;
  challengeVersion: number;
  rawScore: number;
  correct: boolean;
  thetaBefore: number;
  thetaAfter: number;
}

/**
 * What closing a session produces.
 *
 * Deliberately **not** a `SessionSnapshot`: the server returns the session's
 * whole history here, and typing it as a snapshot silently loses the per-item
 * record — which is the part worth having.
 */
export interface SessionResult {
  sessionId: string;
  finalTheta: number;
  standardError: number;
  totalItems: number;
  durationMs: number;
  terminationReason: string;
  items: SessionItemRecord[];
}
