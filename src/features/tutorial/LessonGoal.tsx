import {
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  LogOut,
} from 'lucide-react';
import type { Lesson } from '../../data/challenges/lessons';
import { useLocalization } from '../preferences/localization';
import { lessonSectionRequirement } from './lessonAssessments';
import { localizeServoLesson } from './servoLessonLocalization';
import { LessonMultipleChoice } from './LessonMultipleChoice';
import { LessonRequirement } from './LessonRequirement';
import { LessonSectionProgress } from './LessonSectionProgress';

interface LessonGoalProps {
  lesson: Lesson;
  completion?: number;
  solved: boolean;
  quizPassed: boolean;
  onQuizPassed: () => void;
  /** Whether this section's own build-or-test requirement is met. */
  sectionSatisfied: boolean;
  sectionIndex: number;
  /** The furthest section reached, so finished ones stay open to review. */
  furthestSectionIndex: number;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onSelectSection: (index: number) => void;
  onNext?: () => void;
  onExit: () => void;
}

/** Twenty-section Servo lesson card; the final section is the scored gate. */
export function LessonGoal({
  lesson,
  completion,
  solved,
  quizPassed,
  onQuizPassed,
  sectionSatisfied,
  sectionIndex,
  furthestSectionIndex,
  onPreviousSection,
  onNextSection,
  onSelectSection,
  onNext,
  onExit,
}: LessonGoalProps) {
  const { locale, t } = useLocalization();
  const displayLesson = localizeServoLesson(lesson, locale);
  const section = displayLesson.sections[sectionIndex];
  const lastSection = sectionIndex === displayLesson.sections.length - 1;
  const quizSection = sectionIndex === displayLesson.sections.length - 2;
  // The quiz and the scored checkpoint carry their own gates below.
  const sectionRequirement = quizSection || lastSection
    ? 'none'
    : lessonSectionRequirement(section);
  const lessonNumber = displayLesson.name.match(/^\d+/)?.[0] ?? '—';

  return (
    <aside
      className={`tutorial servo-lesson-card ${lastSection && solved ? 'is-solved' : ''}`}
      aria-label={t('servoLessonBadge')}
    >
      <header className="tutorial__head">
        <span className="tutorial__badge">
          <GraduationCap size={14} /> {t('servoLessonBadge')}
        </span>
        <span className="tutorial__progress">
          {t('lesson')} {lessonNumber} / 8 · {t('section')} {sectionIndex + 1} /{' '}
          {displayLesson.sections.length}
        </span>
        <button type="button" onClick={onExit} aria-label={t('backToLessons')}>
          <LogOut size={15} />
        </button>
      </header>

      <LessonSectionProgress
        sectionCount={displayLesson.sections.length}
        sectionIndex={sectionIndex}
        furthestIndex={furthestSectionIndex}
        {...(quizSection ? {} : { onSelectSection })}
      />

      <p className="cutter-grid-lesson-card__lesson-name">{displayLesson.name}</p>
      <h2>{lastSection && solved ? t('solved') : section.title}</h2>
      <p>{section.body}</p>
      <span className={`lesson-section-kind is-${section.activity}`}>
        {section.activity.toUpperCase()}
      </span>

      {/*
        What the lesson is actually asking for, on every section that is not
        closed-book. A section such as "Press Test and compare completion with
        your prediction" never says which program to press Test on, and the one
        card that does state it — the outcome — is eleven Next presses back.
      */}
      {quizSection || lastSection ? null : (
        <p className="lesson-goal-recap" data-testid="lesson-goal-recap">
          <strong>{t('thisLesson')}</strong>
          <span>{displayLesson.goal}</span>
        </p>
      )}

      {/*
        Build and observe sections report whether the work is there, and Next
        stays closed until it is: clicking past the practice and arriving at
        the scored checkpoint having built nothing is not a lesson.
      */}
      <LessonRequirement
        requirement={sectionRequirement}
        satisfied={sectionSatisfied}
        testId="angle-section-requirement"
      />

      {quizSection ? (
        <LessonMultipleChoice
          key={displayLesson.id}
          quiz={displayLesson.assessments.multipleChoice}
          passed={quizPassed}
          onPassed={onQuizPassed}
        />
      ) : null}

      {lastSection && !solved ? (
        <div className="lesson-practical" data-testid="lesson-blockly-practical">
          <strong>{t('practicalRequired')}</strong>
          <p>{displayLesson.assessments.practicalPrompt}</p>
        </div>
      ) : null}

      {lastSection && solved ? (
        <p className="tutorial__hint tutorial__hint--good">
          <Check size={13} />
          {t('perfectLesson')}
        </p>
      ) : null}

      <div className="tutorial__foot">
        {sectionIndex > 0 && !quizSection ? (
          <button
            className="ghost-button lesson-section-back"
            type="button"
            onClick={onPreviousSection}
            data-testid="previous-angle-section"
          >
            <ArrowLeft size={14} /> {t('previous')}
          </button>
        ) : <span />}

        {!lastSection ? (
          <button
            className="big-button big-button--primary tutorial__next"
            type="button"
            disabled={(quizSection && !quizPassed) || !sectionSatisfied}
            onClick={onNextSection}
            data-testid="next-angle-section"
          >
            {t('nextSection')} <ArrowRight size={15} />
          </button>
        ) : solved ? (
          <button
            className="big-button big-button--primary tutorial__next"
            type="button"
            onClick={onNext ?? onExit}
            data-testid="next-lesson"
          >
            {onNext ? t('nextLesson') : t('backToLessons')}
            <ArrowRight size={15} />
          </button>
        ) : (
          <span className="tutorial__state">
            <i className="tutorial__dot" />
            {completion === undefined ? t('pressTest') : `${completion.toFixed(1)} / 100`}
          </span>
        )}
      </div>
    </aside>
  );
}
