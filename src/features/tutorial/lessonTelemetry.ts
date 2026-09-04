import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../../app/servicesContext';
import type { LessonEvent } from '../../services/contracts';
import type { ProgrammingMode } from '../blockly/programmingMode';

/** What a lesson reports, minus the two fields the hook already knows. */
export type LessonReport = Omit<LessonEvent, 'lessonId' | 'mode'>;

/**
 * How soon after opening a lesson a teardown is React rather than a learner.
 *
 * Development remounts every component once to surface effects that are not
 * idempotent (`StrictMode`), and hot reload does the same on every save. Both
 * run the cleanup milliseconds after the setup, and a learner who opened a
 * lesson and gave up inside a fifth of a second is not a learner this data has
 * anything to say about. Losing that row is much cheaper than logging a
 * `abandoned` nobody did.
 */
const REMOUNT_WINDOW_MS = 200;

/**
 * Where the learner is, read at the moment an event has to be reported for them.
 *
 * Held in a ref rather than passed to each call because the two events nobody
 * presses a button for — opening a lesson and leaving one — are reported from
 * effects, which would otherwise close over whichever section was current when
 * the lesson mounted.
 */
export interface LessonPosition {
  /** Section currently open. */
  section: number;
  /** Successful Test runs in this lesson so far. */
  tests: number;
  /** Whether the lesson is finished, which is what makes leaving not giving up. */
  completed: boolean;
}

/**
 * Report lesson usage, if this deployment collects any.
 *
 * The lessons are otherwise invisible to the usage log: they run and score in
 * the browser and never submit, so a log fed by submissions holds nothing about
 * the part of the app most people actually use. These rows answer "is the course
 * being used, and where do people stop" — and nothing else, because the outcomes
 * in them are asserted by this client rather than measured by the server.
 *
 * Two events are reported from here rather than by a caller: `opened`, on
 * arrival, and `abandoned`, when the lesson is left unfinished. The second is
 * the one worth having — it is the only way the log ever learns where a learner
 * ran out of patience, since giving up is precisely the case where nobody
 * presses anything.
 *
 * Every outcome is reported once per lesson visited. A lesson stepped back and
 * forward through does not re-report the sections it already passed, and a
 * remount does not re-report opening it, so counting rows counts learners rather
 * than clicks.
 */
export function useLessonTelemetry(
  lessonId: string,
  mode: ProgrammingMode,
  position: LessonPosition,
): (report: LessonReport) => void {
  const { usageProvider } = useServices();
  // A mirror, not state: nothing renders from it, and the two events reported
  // from effects must see where the learner is now rather than where they were
  // when the effect was set up. Written after each render, never during one.
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  // What this visit has already said. Keyed by lesson rather than rebuilt per
  // effect run, so a remount does not start a second visit to the same lesson.
  const visit = useRef({ lessonId, reported: new Set<string>() });

  const send = useCallback(
    (event: LessonReport) => {
      if (visit.current.lessonId !== lessonId) {
        visit.current = { lessonId, reported: new Set<string>() };
      }
      // One row per outcome, except section passes, which are one per section.
      const key = event.outcome === 'section-passed'
        ? `section-passed:${event.section}`
        : event.outcome;
      if (visit.current.reported.has(key)) return;
      visit.current.reported.add(key);
      usageProvider.recordLessonEvent({ ...event, lessonId, mode });
    },
    [lessonId, mode, usageProvider],
  );

  useEffect(() => {
    const openedAt = Date.now();
    send({
      outcome: 'opened',
      section: positionRef.current.section,
      tests: positionRef.current.tests,
    });

    return () => {
      // A teardown this soon after the setup is React remounting, not somebody
      // leaving. See REMOUNT_WINDOW_MS.
      if (Date.now() - openedAt < REMOUNT_WINDOW_MS) return;
      // Leaving a finished lesson is finishing it, not giving up on it.
      if (positionRef.current.completed) return;
      send({
        outcome: 'abandoned',
        section: positionRef.current.section,
        tests: positionRef.current.tests,
      });
    };
  }, [send]);

  return send;
}
