import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LESSONS } from '../../data/challenges/lessons';
import { shuffled } from './shuffle';
import type { SessionProvider, SessionStartOptions } from '../contracts';
import type {
  NextItem,
  ResponseOutcome,
  SessionResult,
  SessionSnapshot,
} from '../../types/session';

/**
 * Offline practice: every challenge once, in a fresh order each session.
 *
 * There is no CAT engine in the browser — `arona` is a server concern and
 * always was — so this cannot adapt. What it can do is honour the same shape:
 * finish one challenge and the next arrives, until the catalog runs out.
 *
 * `kind` is `'fixed'` and the UI says so. A shuffled sequence presented as an
 * ability estimate would be a lie about what the number means: the order is
 * random, not chosen from how the learner is doing.
 *
 * # Why it shuffles
 *
 * It used to run the lessons in written order with the authored challenge last,
 * on the theory that a hand-ordered climb teaches better than a random one. In
 * a room of thirty on the same nine items that theory costs more than it pays:
 * everyone meets item 1 at the same moment, the answer travels across the room
 * before most have read the goal, and a second session is the first one again.
 * A shuffle per session breaks both — neighbours are on different items, and
 * running practice twice is worth doing.
 *
 * The authored challenge shuffles in with the rest. It is the hardest item and
 * the only one that opens with a starter program, so it can now land first;
 * that is the cost of the shuffle, and an item nobody can finish is still an
 * item they can Submit past, which is how this sequence advances anyway.
 */
export class LocalSessionProvider implements SessionProvider {
  readonly kind = 'fixed' as const;

  /** Everything practice can serve: the lessons, plus the authored challenge. */
  private readonly catalog: readonly string[] = [
    ...LESSONS.map((lesson) => lesson.id),
    DEFAULT_CHALLENGE_ID,
  ];

  /** Each live session's own shuffle and how far into it the learner is. */
  private readonly sessions = new Map<
    string,
    { order: readonly string[]; index: number }
  >();
  private counter = 0;

  async start(options: SessionStartOptions = {}): Promise<SessionSnapshot> {
    // Accepted and ignored: there is no estimator or per-mode bank offline.
    void options;
    const sessionId = `local-${(this.counter += 1)}`;
    this.sessions.set(sessionId, { order: shuffled(this.catalog), index: 0 });
    return {
      sessionId,
      theta: 0,
      responseCount: 0,
      expectedRemaining: this.catalog.length,
      state: 'active',
    };
  }

  async next(sessionId: string): Promise<NextItem> {
    const session = this.session(sessionId);
    const challengeId = session.order[session.index];
    if (!challengeId) {
      throw new Error('You have finished every challenge.');
    }
    return {
      // Nothing to sign against: there is no server to forge a reference to.
      itemRef: `${sessionId}:${challengeId}`,
      challengeId,
      challengeVersion: 1,
      expectedRemaining: session.order.length - session.index,
    };
  }

  async submit(): Promise<void> {
    // Nothing to submit to. Offline the workbench has already scored the run
    // with the same engine, and `respond` below advances the sequence without
    // consulting a score at all.
  }

  async respond(
    sessionId: string,
    itemRef: string,
  ): Promise<ResponseOutcome> {
    const session = this.session(sessionId);
    session.index += 1;
    const done = session.index >= session.order.length;
    return {
      // Offline there is no replayed score to judge against, so an attempt
      // simply advances the sequence. The workbench still shows the real score
      // from the local engine; it just does not feed an estimate.
      correct: true,
      rawScore: 1,
      theta: 0,
      standardError: 0,
      terminated: done,
      ...(done ? { terminationReason: 'Every challenge completed' } : {}),
      ...(itemRef ? {} : {}),
    };
  }

  async finalize(sessionId: string): Promise<SessionResult> {
    const attempted = this.session(sessionId).index;
    this.sessions.delete(sessionId);
    return {
      sessionId,
      finalTheta: 0,
      standardError: 0,
      totalItems: attempted,
      durationMs: 0,
      terminationReason: 'Session closed',
      items: [],
    };
  }

  /**
   * A session's shuffle, created on demand.
   *
   * An id this provider never issued gets its own order rather than an error:
   * the previous version tolerated one the same way, and refusing here would
   * turn a stale id into a dead practice screen with no way back to a live one.
   */
  private session(sessionId: string): { order: readonly string[]; index: number } {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const created = { order: shuffled(this.catalog), index: 0 };
    this.sessions.set(sessionId, created);
    return created;
  }
}
