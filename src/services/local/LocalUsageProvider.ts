import type { UsageProvider } from '../contracts';

/**
 * Collects nothing.
 *
 * The offline app makes no network requests of its own — SPEC v0.3 §15 — and
 * that promise is not one telemetry gets to be the exception to. A learner
 * working through the lessons with no server configured is not a learner whose
 * progress is stored somewhere they cannot see; it simply is not stored.
 *
 * Silent rather than throwing: the lesson calls this on every section, and a
 * provider that threw when unconfigured would make the offline build the broken
 * one.
 */
export class LocalUsageProvider implements UsageProvider {
  recordLessonEvent(): void {
    // Deliberately empty. See above.
  }
}
