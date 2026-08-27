import type {
  SessionProvider,
  SessionStartOptions,
  SessionSubmission,
} from '../contracts';
import type {
  NextItem,
  ResponseOutcome,
  SessionResult,
  SessionSnapshot,
} from '../../types/session';
import type { ApiClient } from './apiClient';
import { researchHeaders } from '../../features/preferences/researchPreferences';

/**
 * Adaptive practice against the real CAT engine.
 *
 * Every decision — which item, how hard, when to stop — is the server's.
 * `arona` refits the ability estimate from each replayed score and selects the
 * item carrying the most information at it, so the sequence a learner sees is a
 * measurement, not a playlist.
 */
export class HttpSessionProvider implements SessionProvider {
  readonly kind = 'adaptive' as const;

  constructor(private readonly client: ApiClient) {}

  async start(options: SessionStartOptions = {}): Promise<SessionSnapshot> {
    return this.client.post<SessionSnapshot>('/api/v1/sessions', options);
  }

  async next(sessionId: string): Promise<NextItem> {
    return this.client.post<NextItem>(`${this.base(sessionId)}/next`, {});
  }

  async submit(
    sessionId: string,
    submission: SessionSubmission,
  ): Promise<void> {
    // `sessionId` in the body is what binds the scored submission to this
    // session; without it the server scores the program but `respond` cannot
    // find it.
    await this.client.post(
      '/api/v1/submissions',
      {
        ...submission,
        sessionId,
      },
      researchHeaders(),
    );
  }

  async respond(
    sessionId: string,
    itemRef: string,
    submissionId: string,
  ): Promise<ResponseOutcome> {
    // No score in the body. The server looks up the submission it replayed
    // itself — that is what the ability estimate rests on.
    return this.client.post<ResponseOutcome>(`${this.base(sessionId)}/responses`, {
      sessionId,
      itemRef,
      submissionId,
    });
  }

  async finalize(sessionId: string): Promise<SessionResult> {
    return this.client.post<SessionResult>(`${this.base(sessionId)}/finalize`, {});
  }

  private base(sessionId: string): string {
    return `/api/v1/sessions/${encodeURIComponent(sessionId)}`;
  }
}
