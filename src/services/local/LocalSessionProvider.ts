import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LESSONS } from '../../data/challenges/lessons';
import type { SessionProvider } from '../contracts';
import type {
  NextItem,
  ResponseOutcome,
  SessionResult,
  SessionSnapshot,
} from '../../types/session';

/**
 * Offline practice: the lessons, in the order they were written.
 *
 * There is no CAT engine in the browser — `arona` is a server concern and
 * always was — so this cannot adapt. What it can do is honour the same shape:
 * finish one challenge and the next arrives, each harder than the last, because
 * the lessons are ordered that way by hand.
 *
 * `kind` is `'fixed'` and the UI says so. A fixed sequence presented as an
 * ability estimate would be a lie about what the number means.
 *
 * The authored challenge comes **last**, as the finale. It is the only one with
 * a starter program and the only one not built for teaching a single idea, so
 * putting it first would open practice on the hardest thing available — and
 * leaving it out entirely would make it unreachable offline, which an earlier
 * version of this did.
 */
export class LocalSessionProvider implements SessionProvider {
  readonly kind = 'fixed' as const;

  /** Lessons in teaching order, then the authored challenge. */
  private readonly order: readonly string[] = [
    ...LESSONS.map((lesson) => lesson.id),
    DEFAULT_CHALLENGE_ID,
  ];

  private readonly progress = new Map<string, number>();
  private counter = 0;

  async start(initialTheta?: number): Promise<SessionSnapshot> {
    // Accepted and ignored: there is no estimator here to seed. Taking the
    // parameter keeps the two providers interchangeable.
    void initialTheta;
    const sessionId = `local-${(this.counter += 1)}`;
    this.progress.set(sessionId, 0);
    return {
      sessionId,
      theta: 0,
      responseCount: 0,
      expectedRemaining: this.order.length,
      state: 'active',
    };
  }

  async next(sessionId: string): Promise<NextItem> {
    const index = this.progress.get(sessionId) ?? 0;
    const challengeId = this.order[index];
    if (!challengeId) {
      throw new Error('You have finished every challenge.');
    }
    return {
      // Nothing to sign against: there is no server to forge a reference to.
      itemRef: `${sessionId}:${challengeId}`,
      challengeId,
      challengeVersion: 1,
      expectedRemaining: this.order.length - index,
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
    const index = this.progress.get(sessionId) ?? 0;
    this.progress.set(sessionId, index + 1);
    const done = index + 1 >= this.order.length;
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
    const index = this.progress.get(sessionId) ?? 0;
    this.progress.delete(sessionId);
    return {
      sessionId,
      finalTheta: 0,
      standardError: 0,
      totalItems: index,
      durationMs: 0,
      terminationReason: 'Session closed',
      items: [],
    };
  }
}
