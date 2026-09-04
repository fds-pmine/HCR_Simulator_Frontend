import { Check } from 'lucide-react';
import { useLocalization } from '../preferences/localization';
import type { LessonSectionRequirement } from './lessonAssessments';

/**
 * Which message names the control that releases a section.
 *
 * "Waiting for you" never said *what* it was waiting for, and the control it
 * wants is rarely the obvious one: an observe section wants Test, not Run —
 * Run animates the identical program and leaves the section closed, which
 * reads as the gate being broken rather than as the wrong button.
 */
const PROMPT = {
  program: 'buildTheProgram',
  test: 'pressTest',
  step: 'pressStep',
  overlay: 'showTheOverlay',
  practical: 'practicalRequired',
} as const;

/** Sections whose control is Test, and therefore need Run distinguished. */
const NEEDS_TEST: readonly LessonSectionRequirement[] = ['test', 'practical'];

export function LessonRequirement({
  requirement,
  satisfied,
  testId,
}: {
  requirement: LessonSectionRequirement;
  satisfied: boolean;
  testId: string;
}) {
  const { t } = useLocalization();
  if (requirement === 'none') return null;
  return (
    <>
      <span
        className={`tutorial__state ${satisfied ? 'is-done' : ''}`}
        data-testid={testId}
      >
        {satisfied ? <Check size={14} /> : <i className="tutorial__dot" />}
        {satisfied ? t('done') : t(PROMPT[requirement])}
      </span>
      {!satisfied && NEEDS_TEST.includes(requirement) ? (
        <span className="lesson-run-vs-test" data-testid="run-vs-test">
          {t('runVsTest')}
        </span>
      ) : null}
    </>
  );
}
