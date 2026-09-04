import type { ApiClient } from './apiClient';
import type { LessonEvent, UsageProvider } from '../contracts';
import {
  loadResearchPreferences,
  researchHeaders,
} from '../../features/preferences/researchPreferences';
import { loadIdentity } from '../../features/match/identity';

/** Header carrying the reporting player, as everywhere else on this API. */
const PLAYER_HEADER = 'X-HCR-Player';

/**
 * Reports lesson usage to the backend.
 *
 * Two things this deliberately does not do:
 *
 * 1. **Wait.** `recordLessonEvent` returns immediately and the request is left
 *    unawaited. A section gate must never depend on a POST, and a slow or dead
 *    server must never be something a learner can feel.
 * 2. **Report without consent.** Lesson progress is research data — it says how
 *    somebody learned, which is the whole point of collecting it — so it is sent
 *    only when the learner granted the program-and-scores consent. The privacy
 *    screen calls the necessary data "the compiled Blockly program, challenge
 *    version and score", needed for online scoring; a lesson needs no server at
 *    all, so nothing here can be justified as operationally necessary.
 *
 * Errors are swallowed for the same reason the server swallows its own write
 * failures: losing a row of telemetry must never cost the learner anything.
 */
export class HttpUsageProvider implements UsageProvider {
  constructor(private readonly client: ApiClient) {}

  recordLessonEvent(event: LessonEvent): void {
    if (!loadResearchPreferences().programAndScores) return;

    void this.client
      .post('/api/v1/usage/lessons', event, {
        [PLAYER_HEADER]: loadIdentity().playerId,
        ...researchHeaders(),
      })
      .catch(() => {
        // Fire-and-forget: a failed report is a lost row, not a failed lesson.
      });
  }
}
